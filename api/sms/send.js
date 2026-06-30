// =====================================================================
//  POST /api/sms/send
//  Corpo: { message, recipients: [{ nome, phone }] }
//  Envia o SMS para cada pessoa, personalizando {nome} e {primeiro_nome}.
// =====================================================================
import { checkPin, sendSms } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!checkPin(req, res)) return;

  const { message, recipients } = req.body || {};
  if (!message || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "Faltou a mensagem ou a lista de pessoas." });
  }

  const out = [];
  for (const r of recipients) {
    const nome = (r.nome || "").trim();
    const primeiro = nome.split(" ")[0] || nome;
    const texto = String(message)
      .replaceAll("{nome}", nome)
      .replaceAll("{primeiro_nome}", primeiro);

    if (!r.phone) {
      out.push({ nome, ok: false, error: "sem telefone" });
      continue;
    }
    try {
      await sendSms(r.phone, texto);
      out.push({ nome, ok: true });
    } catch (e) {
      out.push({ nome, ok: false, error: String(e.message || e) });
    }
  }

  const enviados = out.filter((x) => x.ok).length;
  res.status(200).json({ enviados, total: recipients.length, resultados: out });
}
