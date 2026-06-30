// =====================================================================
//  GET /api/sms/register-webhook   (use UMA vez, depois pode ignorar)
//  Registra no SMS Gateway o webhook que recebe as respostas SIM/NAO.
//  Abra no navegador:  https://SEU-SITE/api/sms/register-webhook?pin=SEU_PIN
// =====================================================================
export default async function handler(req, res) {
  const pin = req.query.pin;
  if (process.env.PANEL_PIN && pin !== process.env.PANEL_PIN) {
    return res.status(401).json({ error: "PIN invalido. Use ?pin=SEU_PIN" });
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const webhookUrl = "https://" + host + "/api/sms/inbound";
  const auth = "Basic " + Buffer.from(process.env.SMS_USER + ":" + process.env.SMS_PASS).toString("base64");

  try {
    const r = await fetch("https://api.sms-gate.app/3rdparty/v1/webhooks", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, event: "sms:received" }),
    });
    const t = await r.text();
    res.status(r.ok ? 200 : 500).json({
      ok: r.ok,
      registrado_para: webhookUrl,
      resposta_servidor: t,
      dica: r.ok ? "Pronto! As respostas SIM/NAO agora atualizam o Notion." : "Veja o erro acima.",
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
