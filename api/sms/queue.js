// =====================================================================
//  GET /api/sms/queue?table=staff|candidatos
//  Fila de envio: linhas com Status = "Enviar" e Message preenchida.
//  "staff" = tabela Staff (equipe). "candidatos" = Candidatos - Entrevistas Floor Staff.
// =====================================================================
import { DS, checkPin, queryAll, txt, pageId, toIntl } from "./_lib.js";

const TABLES = {
  staff: { id: DS.STAFF, excludeNome: "Zypher Lounge" },
  candidatos: { id: DS.CANDIDATOS },
};

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  try {
    const tableKey = TABLES[req.query.table] ? req.query.table : "staff";
    const cfg = TABLES[tableKey];
    const pages = await queryAll(cfg.id);

    const queue = [];
    for (const p of pages) {
      const props = p.properties;
      const status = txt(props["Status"]);          // select: "Enviar" | "Enviado" | "Confirmado" | "Recusado" | ...
      const message = txt(props["Message"]);
      const nome = txt(props["Nome"]);
      if (status !== "Enviar" || !message) continue;
      if (cfg.excludeNome && nome === cfg.excludeNome) continue; // linha da casa, nao e uma pessoa
      const phone = txt(props["Phone (+61)"]) || toIntl(txt(props["Telefone"]));
      const funcao = txt(props["Função principal"]) || txt(props["Destaque"]);
      const prioridade = props["Prioridade"]?.number;
      queue.push({
        escalaId: pageId(p),  // id da pagina (usado para marcar Enviado)
        nome,
        phone,
        funcao,
        evento: "",
        status,
        mensagem: message,
        prioridade: prioridade ?? null,
      });
    }
    if (tableKey === "candidatos") {
      queue.sort((a, b) => (a.prioridade ?? 999) - (b.prioridade ?? 999) || (a.nome || "").localeCompare(b.nome || ""));
    } else {
      queue.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    }

    res.status(200).json({ queue, table: tableKey });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
