'use strict';
const { createClient } = require('@libsql/client');
const path = require('path');
const fs   = require('fs');

const DB_DIR  = path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_PATH || path.join(DB_DIR, 'stoerungen.db');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = createClient({ url: 'file:' + DB_FILE });

async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS stoerungen (
      id                     TEXT PRIMARY KEY,
      fahrzeug               TEXT NOT NULL,
      klasse                 TEXT NOT NULL DEFAULT 'kfz',
      schwere                TEXT NOT NULL,
      fehlerBeschreibung     TEXT NOT NULL,
      beschreibung           TEXT,
      status                 TEXT NOT NULL DEFAULT 'gesendet',
      createdBy              TEXT NOT NULL,
      createdAt              TEXT NOT NULL,
      updatedAt              TEXT,
      melderName             TEXT NOT NULL,
      melderKontakt          TEXT NOT NULL,
      melderBenachrichtigung INTEGER NOT NULL DEFAULT 0,
      reminderAt             TEXT,
      reminderTo             TEXT,
      eskalation_stufe       INTEGER NOT NULL DEFAULT 0,
      eskaliert_at           TEXT
    );
    CREATE TABLE IF NOT EXISTS stoerung_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      stoerungId TEXT NOT NULL,
      status     TEXT NOT NULL,
      changedBy  TEXT NOT NULL,
      changedAt  TEXT NOT NULL,
      note       TEXT,
      FOREIGN KEY (stoerungId) REFERENCES stoerungen(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS stoerung_attachments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      stoerungId   TEXT NOT NULL,
      filename     TEXT NOT NULL,
      originalname TEXT NOT NULL,
      mimetype     TEXT NOT NULL,
      size         INTEGER NOT NULL,
      createdAt    TEXT NOT NULL,
      compressed   INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (stoerungId) REFERENCES stoerungen(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS admin_urlaub (
      username    TEXT PRIMARY KEY,
      abwesend_bis TEXT NOT NULL
    );
  `);

  const cols = await all(`PRAGMA table_info(stoerungen)`);
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('eskalation_stufe')) {
    await run(`ALTER TABLE stoerungen ADD COLUMN eskalation_stufe INTEGER NOT NULL DEFAULT 0`);
  }
  if (!colNames.includes('eskaliert_at')) {
    await run(`ALTER TABLE stoerungen ADD COLUMN eskaliert_at TEXT`);
  }
}

async function run(sql, args = []) { return db.execute({ sql, args }); }
async function all(sql, args = []) { const r = await db.execute({ sql, args }); return r.rows; }
async function get(sql, args = []) { const r = await db.execute({ sql, args }); return r.rows[0] || null; }

function normalizeRow(row) {
  if (!row) return row;
  const out = Object.assign({}, row);
  out.melderBenachrichtigung = Number(out.melderBenachrichtigung ?? 0);
  out.klasse = out.klasse || 'kfz';
  return out;
}

function sanitizeFahrzeugForId(fahrzeug) {
  return fahrzeug
    .normalize('NFD')
    .replace(/\u00e4/g, 'ae').replace(/\u00f6/g, 'oe').replace(/\u00fc/g, 'ue')
    .replace(/\u00c4/g, 'Ae').replace(/\u00d6/g, 'Oe').replace(/\u00dc/g, 'Ue')
    .replace(/\u00df/g, 'ss')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function generateTicketId(fahrzeug, isoDate) {
  const safePrefix = sanitizeFahrzeugForId(fahrzeug);
  const d      = new Date(isoDate);
  const year   = d.getUTCFullYear();
  const month  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `${safePrefix}-${year}-${month}-`;
  const row = await get(
    `SELECT MAX(CAST(substr(id, ?) AS INTEGER)) AS maxNum FROM stoerungen WHERE id LIKE ?`,
    [prefix.length + 1, prefix + '%']
  );
  const next = (row && row.maxNum != null ? Number(row.maxNum) : 0) + 1;
  return prefix + String(next).padStart(3, '0');
}

async function createStorung({ fahrzeug, klasse = 'kfz', schwere, fehlerBeschreibung, beschreibung, createdBy, melderName, melderKontakt, melderBenachrichtigung = 0, attachments = [] }) {
  const now     = new Date().toISOString();
  const id      = await generateTicketId(fahrzeug, now);
  const benFlag = Number(melderBenachrichtigung) === 1 ? 1 : 0;
  const validKlasse  = ['kfz', 'geraet'];
  const safeKlasse   = validKlasse.includes(klasse) ? klasse : 'kfz';
  const validSchwere = ['klein', 'normal', 'totalausfall'];
  const safeSchwere  = validSchwere.includes(schwere) ? schwere : 'normal';
  await run(
    `INSERT INTO stoerungen (id,fahrzeug,klasse,schwere,fehlerBeschreibung,beschreibung,status,createdBy,createdAt,updatedAt,melderName,melderKontakt,melderBenachrichtigung) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, fahrzeug, safeKlasse, safeSchwere, fehlerBeschreibung, beschreibung || '', 'gesendet', createdBy, now, now, melderName, melderKontakt, benFlag]
  );
  await run(
    `INSERT INTO stoerung_history (stoerungId,status,changedBy,changedAt,note) VALUES (?,?,?,?,?)`,
    [id, 'gesendet', melderName, now, null]
  );
  for (const a of attachments) {
    await run(
      `INSERT INTO stoerung_attachments (stoerungId,filename,originalname,mimetype,size,createdAt) VALUES (?,?,?,?,?,?)`,
      [id, a.filename, a.originalname, a.mimetype, a.size, now]
    );
  }
  return getStorungById(id);
}

async function getStorungById(id) {
  const s = await get(`SELECT * FROM stoerungen WHERE id = ?`, [id]);
  if (!s) return null;
  const row = normalizeRow(s);
  row.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [id]);
  row.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY createdAt ASC`, [id]);
  return row;
}

async function getAllStorungen() {
  const rows = await all(`SELECT * FROM stoerungen ORDER BY COALESCE(updatedAt, createdAt) DESC`);
  return Promise.all(rows.map(async s => {
    const row = normalizeRow(s);
    row.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [s.id]);
    row.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY createdAt ASC`, [s.id]);
    return row;
  }));
}

/**
 * Vollst\u00e4ndige St\u00f6rungen nach Status (inkl. history + attachments).
 */
async function getByStatus(status) {
  const rows = await all(
    `SELECT * FROM stoerungen WHERE status = ? ORDER BY COALESCE(updatedAt, createdAt) DESC`,
    [status]
  );
  return Promise.all(rows.map(async s => {
    const row = normalizeRow(s);
    row.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [s.id]);
    row.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY createdAt ASC`, [s.id]);
    return row;
  }));
}

// Subquery-Snippet für attachmentCount — einmalig definiert, in beiden Slim-Funktionen genutzt
const ATTACH_COUNT_SQL = `(SELECT COUNT(*) FROM stoerung_attachments WHERE stoerungId = s.id) AS attachmentCount`;

/**
 * Schlanke Abfrage ohne history/attachments, aber MIT attachmentCount.
 * Für Dashboard-Spalten Offen + Bearbeitung (kein Limit) und Fernseher-Dashboard.
 */
async function getByStatusSlim(status, { fahrzeug = null, klasse = null, limit = null } = {}) {
  let sql = `SELECT s.id, s.fahrzeug, s.klasse, s.schwere, s.fehlerBeschreibung, s.status,
                    s.createdAt, s.updatedAt, s.melderName, s.eskalation_stufe,
                    ${ATTACH_COUNT_SQL}
             FROM stoerungen s WHERE s.status = ?`;
  const args = [status];
  if (fahrzeug) { sql += ` AND s.fahrzeug = ?`; args.push(fahrzeug); }
  if (klasse)   { sql += ` AND s.klasse = ?`;   args.push(klasse); }
  sql += ` ORDER BY COALESCE(s.updatedAt, s.createdAt) DESC`;
  if (limit)    { sql += ` LIMIT ?`;             args.push(limit); }
  const rows = await all(sql, args);
  return rows.map(r => { const n = normalizeRow(r); n.attachmentCount = Number(n.attachmentCount || 0); return n; });
}

/**
 * Kombinierte schlanke Abfrage für Erledigt + Zurückgewiesen, MIT attachmentCount.
 * Liefert exakt `limit` Zeilen direkt aus der DB.
 */
async function getErledigtSlim({ fahrzeug = null, klasse = null, limit = 10 } = {}) {
  let sql = `SELECT s.id, s.fahrzeug, s.klasse, s.schwere, s.fehlerBeschreibung, s.status,
                    s.createdAt, s.updatedAt, s.melderName, s.eskalation_stufe,
                    ${ATTACH_COUNT_SQL}
             FROM stoerungen s
             WHERE s.status IN ('erledigt', 'zurueckgewiesen')`;
  const args = [];
  if (fahrzeug) { sql += ` AND s.fahrzeug = ?`; args.push(fahrzeug); }
  if (klasse)   { sql += ` AND s.klasse = ?`;   args.push(klasse); }
  sql += ` ORDER BY COALESCE(s.updatedAt, s.createdAt) DESC LIMIT ?`;
  args.push(limit);
  const rows = await all(sql, args);
  return rows.map(r => { const n = normalizeRow(r); n.attachmentCount = Number(n.attachmentCount || 0); return n; });
}

/**
 * Zählt Einträge eines Status ohne Daten zu laden.
 */
async function countByStatus(status) {
  const row = await get(`SELECT COUNT(*) AS cnt FROM stoerungen WHERE status = ?`, [status]);
  return row ? Number(row.cnt) : 0;
}

async function updateStatus(id, newStatus, changedBy, note, neuSchwere, neuKlasse) {
  const now = new Date().toISOString();
  const current = await get(`SELECT schwere, klasse FROM stoerungen WHERE id = ?`, [id]);
  const alterSchwere = current ? current.schwere : null;
  const validSchwere = ['klein', 'normal', 'totalausfall'];
  const schwereGeaendert = neuSchwere && validSchwere.includes(neuSchwere) && neuSchwere !== alterSchwere;

  const validKlasse = ['kfz', 'geraet'];
  const alterKlasse = current ? current.klasse : 'kfz';
  const klasseGeaendert = neuKlasse && validKlasse.includes(neuKlasse) && neuKlasse !== alterKlasse;

  let setClauses = 'status = ?, updatedAt = ?, eskalation_stufe = 0, eskaliert_at = NULL';
  let setArgs    = [newStatus, now];
  if (schwereGeaendert) { setClauses += ', schwere = ?'; setArgs.push(neuSchwere); }
  if (klasseGeaendert)  { setClauses += ', klasse = ?';  setArgs.push(neuKlasse); }
  setArgs.push(id);
  await run(`UPDATE stoerungen SET ${setClauses} WHERE id = ?`, setArgs);

  const SCHWERE_LABEL = {
    klein: '\uD83D\uDFE2 Klein', normal: '\uD83D\uDFE1 Normal', totalausfall: '\uD83D\uDD34 Totalausfall',
  };
  const KLASSE_LABEL = { kfz: 'KFZ', geraet: 'Ger\u00e4t' };

  let historyNote = note || null;
  const aenderungen = [];
  if (schwereGeaendert) aenderungen.push(`Schweregrad: ${SCHWERE_LABEL[alterSchwere] || alterSchwere} \u2192 ${SCHWERE_LABEL[neuSchwere] || neuSchwere}`);
  if (klasseGeaendert)  aenderungen.push(`Klasse: ${KLASSE_LABEL[alterKlasse] || alterKlasse} \u2192 ${KLASSE_LABEL[neuKlasse] || neuKlasse}`);
  if (aenderungen.length) {
    const hinweis = '[' + aenderungen.join(' | ') + ']';
    historyNote = historyNote ? `${historyNote} ${hinweis}` : hinweis;
  }

  await run(
    `INSERT INTO stoerung_history (stoerungId,status,changedBy,changedAt,note) VALUES (?,?,?,?,?)`,
    [id, newStatus, changedBy, now, historyNote]
  );
  const updated = await getStorungById(id);
  updated._alterSchwere      = schwereGeaendert ? alterSchwere : null;
  updated._schwereGeaendert  = schwereGeaendert;
  updated._alterKlasse       = klasseGeaendert ? alterKlasse : null;
  updated._klasseGeaendert   = klasseGeaendert;
  return updated;
}

async function addHistoryNote(stoerungId, changedBy, note) {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO stoerung_history (stoerungId,status,changedBy,changedAt,note) VALUES (?,?,?,?,?)`,
    [stoerungId, 'notiz', changedBy, now, note]
  );
}

async function setReminder(id, reminderAt, reminderTo) {
  await run(
    `UPDATE stoerungen SET reminderAt = ?, reminderTo = ? WHERE id = ?`,
    [reminderAt || null, reminderTo || null, id]
  );
  return getStorungById(id);
}

async function getDueReminders() {
  const now = new Date().toISOString();
  return all(
    `SELECT * FROM stoerungen
     WHERE reminderAt IS NOT NULL
       AND reminderAt <= ?
       AND status NOT IN ('erledigt','zurueckgewiesen')`,
    [now]
  );
}

async function clearReminder(id) {
  await run(`UPDATE stoerungen SET reminderAt = NULL, reminderTo = NULL WHERE id = ?`, [id]);
}

async function setAdminUrlaub(username, abwesendBis) {
  if (!abwesendBis) {
    await run(`DELETE FROM admin_urlaub WHERE username = ?`, [username]);
  } else {
    await run(
      `INSERT INTO admin_urlaub (username, abwesend_bis) VALUES (?,?)
       ON CONFLICT(username) DO UPDATE SET abwesend_bis = excluded.abwesend_bis`,
      [username, abwesendBis]
    );
  }
}

async function getAbwesendeAdmins() {
  const now = new Date().toISOString();
  return all(
    `SELECT username, abwesend_bis FROM admin_urlaub WHERE abwesend_bis > ?`,
    [now]
  );
}

async function getAdminUrlaub(username) {
  const now = new Date().toISOString();
  return get(
    `SELECT username, abwesend_bis FROM admin_urlaub WHERE username = ? AND abwesend_bis > ?`,
    [username, now]
  );
}

async function cleanupAbgelaufeneUrlaube() {
  const now = new Date().toISOString();
  await run(`DELETE FROM admin_urlaub WHERE abwesend_bis <= ?`, [now]);
}

async function getEskalationsFaellige(stunden) {
  const cutoff = new Date(Date.now() - stunden * 60 * 60 * 1000).toISOString();
  return all(
    `SELECT * FROM stoerungen
     WHERE status = 'gesendet'
       AND (
         (eskalation_stufe = 0 AND createdAt  <= ?)
         OR
         (eskalation_stufe > 0 AND eskaliert_at <= ?)
       )`,
    [cutoff, cutoff]
  );
}

async function setEskalationsStufe(id, stufe) {
  const now = new Date().toISOString();
  await run(
    `UPDATE stoerungen SET eskalation_stufe = ?, eskaliert_at = ? WHERE id = ?`,
    [stufe, now, id]
  );
}

async function searchByFahrzeugMonat(fahrzeug, monat, statuses, ticketId, freitext) {
  const validStatuses = ['gesendet', 'bestaetigt', 'erledigt', 'zurueckgewiesen'];
  const filtered = Array.isArray(statuses) && statuses.length > 0
    ? statuses.filter(s => validStatuses.includes(s))
    : validStatuses;
  const placeholders = filtered.map(() => '?').join(',');
  const args = [fahrzeug, ...filtered];

  let sql = `SELECT id, fahrzeug, klasse, fehlerBeschreibung, schwere, status, createdAt
             FROM stoerungen
             WHERE fahrzeug = ? AND status IN (${placeholders})`;

  if (monat) {
    sql += ` AND strftime('%Y-%m', createdAt) = ?`;
    args.push(monat);
  }
  if (ticketId && ticketId.trim()) {
    sql += ` AND lower(id) LIKE ?`;
    args.push('%' + ticketId.trim().toLowerCase() + '%');
  }
  if (freitext && freitext.trim()) {
    sql += ` AND lower(fehlerBeschreibung) LIKE ?`;
    args.push('%' + freitext.trim().toLowerCase() + '%');
  }

  sql += ` ORDER BY COALESCE(updatedAt, createdAt) DESC`;
  return all(sql, args);
}

async function searchSimilarFehler(query, fahrzeug, includeErledigt = false) {
  const like    = '%' + query.toLowerCase() + '%';
  const orderBy = `ORDER BY CASE status WHEN 'erledigt' THEN 1 ELSE 0 END ASC, COALESCE(updatedAt, createdAt) DESC`;
  const excludeStatuses = `status NOT IN ('erledigt', 'zurueckgewiesen')`;
  if (fahrzeug) {
    if (includeErledigt) return all(`SELECT * FROM stoerungen WHERE fahrzeug = ? AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`, [fahrzeug, like]);
    return all(`SELECT * FROM stoerungen WHERE ${excludeStatuses} AND fahrzeug = ? AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`, [fahrzeug, like]);
  }
  if (includeErledigt) return all(`SELECT * FROM stoerungen WHERE lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`, [like]);
  return all(`SELECT * FROM stoerungen WHERE ${excludeStatuses} AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`, [like]);
}

async function getAttachmentsForCompression(cutoffIso) {
  return all(`SELECT a.* FROM stoerung_attachments a JOIN stoerungen s ON s.id = a.stoerungId WHERE s.status = 'erledigt' AND s.createdAt < ? AND a.compressed = 0`, [cutoffIso]);
}
async function markAttachmentCompressed(id) { return run(`UPDATE stoerung_attachments SET compressed = 1 WHERE id = ?`, [id]); }
async function getOldestAttachmentsForPurge() {
  return all(`SELECT a.*, s.status AS storungStatus FROM stoerung_attachments a JOIN stoerungen s ON s.id = a.stoerungId ORDER BY CASE s.status WHEN 'erledigt' THEN 0 WHEN 'zurueckgewiesen' THEN 0 ELSE 1 END ASC, a.createdAt ASC`);
}
async function deleteAttachment(id) { return run(`DELETE FROM stoerung_attachments WHERE id = ?`, [id]); }
async function deleteStorung(id) {
  const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
  const attachments = await all(`SELECT filename FROM stoerung_attachments WHERE stoerungId = ?`, [id]);
  for (const att of attachments) {
    const filePath = path.join(UPLOAD_DIR, att.filename);
    try { fs.unlinkSync(filePath); } catch (e) { if (e.code !== 'ENOENT') console.warn('[DB] deleteStorung file error:', e.message); }
  }
  return run(`DELETE FROM stoerungen WHERE id = ?`, [id]);
}

module.exports = {
  initDb,
  createStorung, getStorungById, getAllStorungen,
  getByStatus, getByStatusSlim, getErledigtSlim, countByStatus,
  updateStatus, addHistoryNote,
  setReminder, getDueReminders, clearReminder,
  setAdminUrlaub, getAbwesendeAdmins, getAdminUrlaub, cleanupAbgelaufeneUrlaube,
  getEskalationsFaellige, setEskalationsStufe,
  searchByFahrzeugMonat, searchSimilarFehler,
  getAttachmentsForCompression, markAttachmentCompressed,
  getOldestAttachmentsForPurge, deleteAttachment,
  deleteStorung,
};
