// =====================================================================
//  GET /api/sms/queue
//  Fila de envio: pessoas na tabela Staff com Status = "Enviar" e Message.
// =====================================================================
import { DS, checkPin, queryAll, txt, pageId, toIntl } from "./_lib.js";

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  try {
    const staffPages = await queryAll(DS.STAFF);

    const queue = [];
    for (const p of staffPages) {
      const props = p.properties;
      const status = txt(props["Status"]);          // select: "Enviar" | "Enviado" | "Confirmado" | "Recusado"
      const message = txt(props["Message"]);
      const nome = txt(props["Nome"]);
      if (status !== "Enviar" || !message) continue;
      if (nome === "Zypher Lounge") continue;        // linha da casa, nao e uma pessoa
      const phone = txt(props["Phone (+61)"]) || toIntl(txt(props["Telefone"]));
      const funcao = txt(props["Função principal"]);
      queue.push({
        escalaId: pageId(p),  // id da pagina do Staff (usado para marcar Enviado)
        nome,
        phone,
        funcao,
        evento: "",
        status,
        mensagem: message,
      });
    }
    queue.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

    res.status(200).json({ queue });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
