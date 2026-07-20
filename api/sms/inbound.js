// =====================================================================
//  POST /api/sms/inbound
//  Webhook do SMS Gateway (evento "sms:received").
//  Quando alguem responde SIM/NAO (PT ou EN), procura o telefone na tabela
//  Staff e na tabela Candidatos (nessa ordem) e atualiza o Status de quem achar.
// =====================================================================
import { DS, queryAll, txt, pageId, phoneKey, setStaffStatus, setNota } from "./_lib.js";

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

    // Acha a pessoa pelo telefone: primeiro na tabela Staff, depois em Candidatos.
    let staffId = "";
    let staffNome = "";
    for (const dsId of [DS.STAFF, DS.CANDIDATOS]) {
      const pages = await queryAll(dsId);
      for (const p of pages) {
        const props = p.properties;
        const numero = phoneKey(txt(props["Phone (+61)"]) || txt(props["Telefone"]));
        if (numero && numero === key) { staffId = pageId(p); staffNome = txt(props["Nome"]); break; }
      }
      if (staffId) break;
    }
    if (!staffId) return res.status(200).json({ ok: true, skip: "telefone nao encontrado" });

    const carimbo = new Date().toLocaleString("pt-BR", { timeZone: "Australia/Perth" });

    if (resposta === "sim") {
      await setStaffStatus(staffId, "Confirmado");
      await setNota(staffId, `Confirmou via SMS em ${carimbo}.`);
    } else if (resposta === "nao") {
      await setStaffStatus(staffId, "Recusado");
      await setNota(staffId, `RECUSOU via SMS em ${carimbo}: "${message.trim()}".`);
    } else {
      await setNota(staffId, `Resposta SMS em ${carimbo} (nao entendida, conferir): "${message.trim()}".`);
    }

    res.status(200).json({ ok: true, staff: staffNome, resposta });
  } catch (e) {
    // Mesmo com erro, devolve 200 para nao acumular reenvios em loop.
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
