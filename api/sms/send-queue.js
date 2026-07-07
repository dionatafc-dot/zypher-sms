// =====================================================================
//  POST /api/sms/send-queue
//  Corpo: { items: [{ escalaId, phone, message, nome }] }
//  Envia o SMS de cada item e desmarca a caixinha "Enviar" no Notion.
// =====================================================================
import { checkPin, sendSms } from "./_lib.js";

const NOTION_VERSION = "2025-09-03";

async function marcarEnviado(pageId, carimbo) {
  const r = await fetch("https://api.notion.com/v1/pages/" + pageId, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + process.env.NOTION_TOKEN,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        "Enviar": { checkbox: false },
        "Observações": { rich_text: [{ text: { content: ("Enviado por SMS em " + carimbo + ".").slice(0, 1900) } }] },
      },
    }),
  });
  if (!r.ok) throw new Error("Notion " + r.status + ": " + (await r.text()));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!checkPin(req, res)) return;

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Sem itens para enviar." });
  }

  const out = [];
  for (const it of items) {
    const nome = (it.nome || "").trim();
    const primeiro = nome.split(" ")[0] || nome;
    const texto = String(it.message || "")
      .replaceAll("{primeiro_nome}", primeiro)
      .replaceAll("{first_name}", primeiro)
      .replaceAll("{nome}", nome)
      .replaceAll("{name}", nome);

    if (!it.phone) { out.push({ escalaId: it.escalaId, nome, ok: false, error: "sem telefone" }); continue; }
    if (!texto) { out.push({ escalaId: it.escalaId, nome, ok: false, error: "sem mensagem" }); continue; }

    try {
      await sendSms(it.phone, texto);
      if (it.escalaId) {
        const carimbo = new Date().toLocaleString("pt-BR", { timeZone: "Australia/Perth" });
        try { await marcarEnviado(it.escalaId, carimbo); } catch (e) { /* SMS ja foi; ignora erro no Notion */ }
      }
      out.push({ escalaId: it.escalaId, nome, ok: true });
    } catch (e) {
      out.push({ escalaId: it.escalaId, nome, ok: false, error: String(e.message || e) });
    }
  }

  const enviados = out.filter((x) => x.ok).length;
  res.status(200).json({ enviados, total: items.length, resultados: out });
}
