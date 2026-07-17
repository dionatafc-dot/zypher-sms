// =====================================================================
//  _lib.js  -  Funcoes compartilhadas (Notion + SMS Gateway)
//  Nao e uma rota (comeca com "_"). E importado pelos outros arquivos.
// =====================================================================

// ---- IDs das fontes de dados (data sources) no Notion ----------------
export const DS = {
  STAFF:   "45e34f2d-ebb6-467f-a998-31d8f0786f6d",
  EVENTOS: "52f152eb-bfd4-4246-9b9b-c78b8e023191",
  ESCALAS: "740e1a36-00ba-41b4-aac3-02b4d80f2108",
};

const NOTION_VERSION = "2025-09-03";

// ---- Seguranca: confere o PIN do painel ------------------------------
export function checkPin(req, res) {
  const expected = process.env.PANEL_PIN;
  if (!expected) return true; // se nao configurou PIN, libera (nao recomendado)
  const got = req.headers["x-panel-pin"];
  if (got && got === expected) return true;
  res.status(401).json({ error: "PIN invalido" });
  return false;
}

// ---- Chamada generica ao Notion --------------------------------------
async function notion(path, method = "GET", body) {
  const r = await fetch("https://api.notion.com/v1/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.NOTION_TOKEN,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("Notion " + r.status + ": " + t);
  }
  return r.json();
}

// Le TODAS as linhas de uma fonte de dados (com paginacao)
export async function queryAll(dataSourceId) {
  let results = [];
  let cursor = undefined;
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const data = await notion("data_sources/" + dataSourceId + "/query", "POST", body);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

// Atualiza o Status (tipo "status") de uma pagina de Escala
export async function setEscalaStatus(pageId, statusName) {
  return notion("pages/" + pageId, "PATCH", {
    properties: { Status: { status: { name: statusName } } },
  });
}

// Acrescenta texto ao campo Observacoes de uma Escala
export async function appendObservacao(pageId, texto) {
  return notion("pages/" + pageId, "PATCH", {
    properties: { "Observações": { rich_text: [{ text: { content: texto.slice(0, 1900) } }] } },
  });
}

// Atualiza o Status (select: Enviar/Enviado/Confirmado/Recusado) de uma pagina de Staff
export async function setStaffStatus(pageId, statusName) {
  return notion("pages/" + pageId, "PATCH", {
    properties: { Status: { select: { name: statusName } } },
  });
}

// Escreve texto no campo Notas de uma pagina de Staff
export async function setNota(pageId, texto) {
  return notion("pages/" + pageId, "PATCH", {
    properties: { "Notas": { rich_text: [{ text: { content: texto.slice(0, 1900) } }] } },
  });
}

// ---- Leitura de propriedades do Notion -------------------------------
export function txt(prop) {
  if (!prop) return "";
  if (prop.type === "title") return (prop.title || []).map((x) => x.plain_text).join("");
  if (prop.type === "rich_text") return (prop.rich_text || []).map((x) => x.plain_text).join("");
  if (prop.type === "formula") return prop.formula?.string || "";
  if (prop.type === "phone_number") return prop.phone_number || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "date") return prop.date?.start || "";
  return "";
}

// Pega o ID da primeira pagina relacionada (sem tracos)
export function relId(prop) {
  const rel = prop?.relation;
  if (!rel || !rel.length) return "";
  return (rel[0].id || "").replace(/-/g, "");
}

export function pageId(page) {
  return (page.id || "").replace(/-/g, "");
}

// ---- Telefone --------------------------------------------------------
// Converte para o formato internacional australiano +61XXXXXXXXX
export function toIntl(raw) {
  if (!raw) return "";
  let d = String(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  d = d.replace(/\D/g, "");
  if (d.startsWith("61")) return "+" + d;
  if (d.startsWith("0")) return "+61" + d.slice(1);
  if (d.length === 9) return "+61" + d; // ja sem o zero
  return "+" + d;
}

// Normaliza para os ultimos 9 digitos (para comparar numeros)
export function phoneKey(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  return d.slice(-9);
}

// ---- Data de hoje em Perth (Australia Ocidental) ---------------------
export function perthToday() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Perth",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

// ---- Envio de SMS pela nuvem do SMS Gateway --------------------------
export async function sendSms(phone, text) {
  const auth = "Basic " + Buffer.from(process.env.SMS_USER + ":" + process.env.SMS_PASS).toString("base64");
  const body = { textMessage: { text }, phoneNumbers: [phone] };
  if (process.env.SMS_DEVICE_ID) body.deviceId = process.env.SMS_DEVICE_ID;
  const r = await fetch("https://api.sms-gate.app/3rdparty/v1/messages", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("SMS " + r.status + ": " + t);
  return t;
}
