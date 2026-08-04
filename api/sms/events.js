// =====================================================================
//  GET /api/sms/events
//  Devolve os proximos eventos com a escala (quem trabalha) de cada um.
//  Alimenta a aba "Rosters" do painel: nome, funcao, inicio e fim.
// =====================================================================
import { DS, checkPin, queryAll, txt, relId, pageId, toIntl, perthToday } from "./_lib.js";

// Hora do turno no fuso de Perth ("2026-08-15T19:00:00+08:00" -> "19:00").
// Devolve "" quando a data nao tem hora (ainda nao foi preenchida no Notion).
const PERTH_HHMM = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Perth", hour: "2-digit", minute: "2-digit", hour12: false,
});
function hhmm(iso) {
  if (!iso || iso.length <= 10) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : PERTH_HHMM.format(d);
}

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  try {
    const [staffPages, eventoPages, escalaPages] = await Promise.all([
      queryAll(DS.STAFF),
      queryAll(DS.EVENTOS),
      queryAll(DS.ESCALAS),
    ]);

    // Mapa de funcionarios: id -> { nome, phone }
    const staff = {};
    for (const p of staffPages) {
      const props = p.properties;
      const nome = txt(props["Nome"]);
      const phone = txt(props["Phone (+61)"]) || toIntl(txt(props["Telefone"]));
      staff[pageId(p)] = { id: pageId(p), nome, phone };
    }

    // Mapa de eventos: id -> objeto
    const today = perthToday();
    const events = {};
    for (const p of eventoPages) {
      const props = p.properties;
      const data = txt(props["Data"]);
      if (data && data.slice(0, 10) < today) continue; // so eventos de hoje em diante
      events[pageId(p)] = {
        id: pageId(p),
        nome: txt(props["Evento"]),
        data: data ? data.slice(0, 10) : "",
        inicio: txt(props["Início (hora)"]),
        fim: txt(props["Fim (hora)"]),
        roster: [],
      };
    }

    // Distribui as escalas pelos eventos
    for (const p of escalaPages) {
      const props = p.properties;
      const evId = relId(props["Evento"]);
      if (!events[evId]) continue;
      // A coluna no Notion chama-se "Funcionário 1" (com o 1), nao "Funcionário".
      const funcId = relId(props["Funcionário 1"]);
      const pessoa = staff[funcId];
      events[evId].roster.push({
        escalaId: pageId(p),
        funcao: txt(props["Escala"]),
        status: txt(props["Status"]) || "Pendente",
        nome: pessoa ? pessoa.nome : "",
        phone: pessoa ? pessoa.phone : "",
        temPessoa: !!funcId,
        inicio: hhmm(txt(props["Início"])),
        fim: hhmm(txt(props["Fim"])),
      });
    }

    // Ordena eventos por data e a escala por funcao
    const list = Object.values(events).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    for (const ev of list) ev.roster.sort((a, b) => (a.funcao || "").localeCompare(b.funcao || ""));

    // Lista da equipe inteira (para "mostrar toda a equipe")
    const allStaff = Object.values(staff)
      .filter((s) => s.nome && s.nome !== "Zypher Lounge")
      .sort((a, b) => a.nome.localeCompare(b.nome));

    res.status(200).json({ today, events: list, staff: allStaff });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
