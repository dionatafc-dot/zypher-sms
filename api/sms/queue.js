// =====================================================================
//  GET /api/sms/queue
//  Fila de envio: escalas com a caixinha "Enviar" marcada e mensagem escrita.
// =====================================================================
import { DS, checkPin, queryAll, txt, relId, pageId, toIntl } from "./_lib.js";

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  try {
    const [staffPages, escalaPages, eventoPages] = await Promise.all([
      queryAll(DS.STAFF),
      queryAll(DS.ESCALAS),
      queryAll(DS.EVENTOS),
    ]);

    // Mapa de funcionarios: id -> { nome, phone }
    const staff = {};
    for (const p of staffPages) {
      const props = p.properties;
      staff[pageId(p)] = {
        nome: txt(props["Nome"]),
        phone: txt(props["Phone (+61)"]) || toIntl(txt(props["Telefone"])),
      };
    }

    // Mapa de eventos: id -> nome
    const eventoNome = {};
    for (const p of eventoPages) eventoNome[pageId(p)] = txt(p.properties["Evento"]);

    // Monta a fila: so escalas com "Enviar" marcado e "Mensagem" preenchida
    const queue = [];
    for (const p of escalaPages) {
      const props = p.properties;
      const marcado = props["Enviar"] && props["Enviar"].checkbox === true;
      const mensagem = txt(props["Mensagem"]);
      if (!marcado || !mensagem) continue;
      const pessoa = staff[relId(props["Funcionário"])] || { nome: "", phone: "" };
      queue.push({
        escalaId: pageId(p),
        nome: pessoa.nome,
        phone: pessoa.phone,
        funcao: txt(props["Escala"]),
        evento: eventoNome[relId(props["Evento"])] || "",
        status: txt(props["Status"]) || "Pendente",
        mensagem,
      });
    }
    queue.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

    res.status(200).json({ queue });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
