// =====================================================================
//  POST /api/sms/inbound
//  Webhook do SMS Gateway (evento "sms:received").
//  Quando alguem responde SIM/NAO, atualiza a escala no Notion.
// =====================================================================
import { DS, queryAll, txt, relId, pageId, phoneKey, perthToday, setEscalaStatus, appendObservacao } from "./_lib.js";

function interpreta(msg) {
  const t = (msg || "").trim().toLowerCase();
  if (/^(sim|s|yes|y|ok|confirmo|confirmado|👍�✅)/.test(t)) return "sim";
  if (/^(nao|não|n|no|negativo|❌)/.test(t)) return "nao";
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
      await appendObservacao(alvo.id, `Resposta SMS em ${carimbo}: "${message.trim()}".`);
    }

    res.status(200).json({ ok: true, staff: staffNome, resposta });
  } catch (e) {
    // Mesmo com erro, devolve 200 para nao acumular reenvios em loop.
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
