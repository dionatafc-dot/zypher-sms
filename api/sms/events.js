// =====================================================================
//  GET  /api/sms/events   -> eventos de hoje em diante + a escala de cada um
//  POST /api/sms/events   -> grava UM campo de UMA linha da escala no Notion
//                            { escalaId, campo, valor, data }
//  Alimenta a aba "Rosters" do painel (nome, funcao, status, inicio, fim).
//  Os dois metodos moram no mesmo arquivo: a Vercel conta 1 funcao por
//  arquivo, e o plano tem limite.
// =====================================================================
import { DS, checkPin, queryAll, txt, relId, pageId, toIntl, perthToday, updateEscala } from "./_lib.js";

// Perth nao tem horario de verao: e sempre +08:00 o ano inteiro.
const PERTH_OFFSET = "+08:00";

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

export const STATUS_OPCOES = ["Pendente", "Confirmado", "Finalizado", "No show"];

// Monta o pedaco de "properties" do Notion para UM campo editavel.
// Valor vazio sempre limpa o campo, nunca grava lixo.
// O painel devolve os ids sem tracos (pageId() tira). Numa relacao o Notion
// espera o UUID completo, entao poe os tracos de volta antes de gravar.
function comTracos(id) {
  const s = String(id || "").replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(s)) return id;
  return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
}

function propsParaCampo(campo, valor, data) {
  const v = String(valor == null ? "" : valor).trim();
  if (campo === "nome") {
    return { "Funcionário 1": { relation: v ? [{ id: comTracos(v) }] : [] } };
  }
  if (campo === "funcao") {
    return { Escala: { title: v ? [{ text: { content: v.slice(0, 200) } }] : [] } };
  }
  if (campo === "status") {
    if (v && !STATUS_OPCOES.includes(v)) throw new Error("Status invalido: " + v);
    return { Status: v ? { status: { name: v } } : { status: null } };
  }
  if (campo === "inicio" || campo === "fim") {
    const coluna = campo === "inicio" ? "Início" : "Fim";
    if (!v) return { [coluna]: { date: null } };
    if (!/^\d{2}:\d{2}$/.test(v)) throw new Error("Hora invalida: " + v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) throw new Error("Data do evento faltando");
    return { [coluna]: { date: { start: data + "T" + v + ":00.000" + PERTH_OFFSET } } };
  }
  throw new Error("Campo invalido: " + campo);
}

async function salvar(req, res) {
  const { escalaId, campo, valor, data } = req.body || {};
  if (!escalaId) return res.status(400).json({ error: "escalaId faltando" });
  await updateEscala(escalaId, propsParaCampo(campo, valor, data));
  res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (!checkPin(req, res)) return;
  try {
    if (req.method === "POST") return await salvar(req, res);
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
        funcId, // id do funcionario, para o menu de nomes ja vir marcado
        nome: pessoa ? pessoa.nome : "",
        phone: pessoa ? pessoa.phone : "",
        temPessoa: !!funcId,
        inicio: hhmm(txt(props["Início"])),
        fim: hhmm(txt(props["Fim"])),
      });
    }

    // Opcoes do menu de Posicao: nao existe um "select" no Notion para isso
    // (Posicao e o titulo da linha), entao a lista e o que ja esta em uso.
    const posicoes = [...new Set(escalaPages.map((p) => txt(p.properties["Escala"])).filter(Boolean))].sort();

    // Ordena eventos por data e a escala por funcao
    const list = Object.values(events).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    for (const ev of list) ev.roster.sort((a, b) => (a.funcao || "").localeCompare(b.funcao || ""));

    // Lista da equipe inteira (para "mostrar toda a equipe")
    const allStaff = Object.values(staff)
      .filter((s) => s.nome && s.nome !== "Zypher Lounge")
      .sort((a, b) => a.nome.localeCompare(b.nome));

    res.status(200).json({ today, events: list, staff: allStaff, posicoes, statusOpcoes: STATUS_OPCOES });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
