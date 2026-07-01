// =====================================================================
//  POST /api/sms/inbound
//  Webhook do SMS Gateway (evento "sms:received").
//  Quando alguem responde SIM/NAO (PT ou EN), atualiza a escala no Notion.
// =====================================================================
import { DS, queryAll, txt, relId, pageId, phoneKey, perthToday, setEscalaStatus, appendObservacao } from "./_lib.js";

// Interpreta a resposta da pessoa de forma tolerante (portugues + ingles).
// Na duvida devolve "?" (vira observacao no Notion para um humano decidir).
function interpreta(msg) {
  const raw = (msg || "").trim();

  // 1) Emojis comuns
  if (/[\u{1F44D}✅\u{1F646}\u{1F197}\u{1F44C}]/u.test(raw)) return "sim"; // 👍 ✅ 🙆 🆗 👌
  if (/[❌\u{1F6AB}\u{1F44E}]/u.test(raw)) return "nao";                   // ❌ 🚫 👎

  // 2) Normaliza: minusculas, troca acentos, tira apostrofos, so letras e espacos
  const t = raw
    .toLowerCase()
    .replace(/[áàâãä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìî]/g, "i")
    .replace(/[óòôõö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/ç/g, "c")
    .replace(/['’]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "?";

  const palavras = t.split(" ");
  const tem = (...lista) => lista.some((w) => palavras.includes(w));
  const contem = (...lista) => lista.some((f) => t.includes(f));

  // 3) Frases positivas que contem palavra negativa (tem prioridade sobre negacao)
  if (contem("no problem", "no worries", "not a problem")) return "sim";

  // 4) Negacao (PT + EN)
  if (
    tem("nao", "n", "nops", "nunca", "negativo", "impossivel", "fora",
        "no", "nope", "nah", "cant", "cannot", "wont", "unable") ||
    contem("nao posso", "nao vou", "nao consigo", "nao da", "nao poderei", "nao to", "nao estarei", "nao tenho",
           "cant make", "can not", "will not", "wont be", "not able", "not coming", "not going", "not gonna", "cant come", "cant make it")
  ) return "nao";

  // 5) Confirmacao (PT + EN)
  if (
    tem("sim", "s", "yes", "y", "yeah", "yep", "yup", "ok", "okay", "claro", "confirmo", "confirmado",
        "confirmar", "confirma", "confirm", "confirmed", "posso", "vou", "irei", "bora", "beleza", "blz",
        "certo", "certeza", "positivo", "combinado", "dentro", "estarei", "comparecerei", "pode",
        "show", "tranquilo", "sure", "absolutely", "definitely", "coming") ||
    contem("pode contar", "com certeza", "to dentro", "estou dentro", "vou sim", "posso sim",
           "ta certo", "ta bom", "tudo certo", "sem problema",
           "i can", "i will", "ill be there", "i am in", "im in", "count me in", "of course", "see you there", "will do", "ill come", "i can make")
  ) return "sim";

  return "?";
}

export default async function handler(req, res) {
  // Responde rapido; o SMS Gateway reenvia se nao receber 200.
  try {
    const body = req.body || {};
    const payload = body.payload || body;
    const sender = payload.sender || payload.phoneNumber || "";
    const message = payload.message || payload.text || "";
    if (!sender) return res.status(200).json({ ok: true, skip: "sem remetente" });

    const resposta = interpreta(message);
    const key = phoneKey(sender);

    const [staffPages, eventoPages, escalaPages] = await Promise.all([
      queryAll(DS.STAFF), queryAll(DS.EVENTOS), queryAll(DS.ESCALAS),
    ]);

    // Acha o funcionario pelo telefone
    let staffId = "";
    let staffNome = "";
    for (const p of staffPages) {
      const props = p.properties;
      const candidato = phoneKey(txt(props["Phone (+61)"]) || txt(props["Telefone"]));
      if (candidato && candidato === key) { staffId = pageId(p); staffNome = txt(props["Nome"]); break; }
    }
    if (!staffId) return res.status(200).json({ ok: true, skip: "telefone nao encontrado" });

    // Data de cada evento
    const dataEvento = {};
    for (const p of eventoPages) dataEvento[pageId(p)] = (txt(p.properties["Data"]) || "").slice(0, 10);

    // Escalas dessa pessoa em eventos de hoje em diante, a mais proxima primeiro
    const today = perthToday();
    const minhas = escalaPages
      .filter((p) => relId(p.properties["Funcionário"]) === staffId)
      .map((p) => ({ id: pageId(p), evId: relId(p.properties["Evento"]) }))
      .filter((e) => dataEvento[e.evId] && dataEvento[e.evId] >= today)
      .sort((a, b) => dataEvento[a.evId].localeCompare(dataEvento[b.evId]));

    if (!minhas.length) return res.status(200).json({ ok: true, skip: "sem escala futura" });

    const alvo = minhas[0];
    const carimbo = new Date().toLocaleString("pt-BR", { timeZone: "Australia/Perth" });

    if (resposta === "sim") {
      await setEscalaStatus(alvo.id, "Confirmado");
      await appendObservacao(alvo.id, `Confirmou via SMS em ${carimbo}.`);
    } else if (resposta === "nao") {
      await setEscalaStatus(alvo.id, "Pendente");
      await appendObservacao(alvo.id, `RECUSOU via SMS em ${carimbo}: "${message.trim()}".`);
    } else {
      await appendObservacao(alvo.id, `Resposta SMS em ${carimbo} (nao entendida, conferir): "${message.trim()}".`);
    }

    res.status(200).json({ ok: true, staff: staffNome, resposta });
  } catch (e) {
    // Mesmo com erro, devolve 200 para nao acumular reenvios em loop.
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
