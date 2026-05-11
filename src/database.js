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
      schwere                TEXT NOT NULL,
      fehlerBeschreibung     TEXT NOT NULL,
      beschreibung           TEXT,
      status                 TEXT NOT NULL DEFAULT 'gesendet',
      createdBy              TEXT NOT NULL,
      createdAt              TEXT NOT NULL,
      melderName             TEXT NOT NULL,
      melderKontakt          TEXT NOT NULL,
      melderBenachrichtigung INTEGER NOT NULL DEFAULT 0
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
  `);

  // Spalte nachrüsten falls noch nicht vorhanden
  try {
    await db.execute(`ALTER TABLE stoerungen ADD COLUMN melderBenachrichtigung INTEGER NOT NULL DEFAULT 0`);
  } catch { /* already exists */ }

  // --- Daten-Migration: Alter Bug hat melderBenachrichtigung immer auf 1 gesetzt.
  // Alle Einträge wo kein Kontakt (keine E-Mail) vorhanden ist, können keine
  // Benachrichtigung erhalten – auf 0 zurücksetzen.
  // Zusatzbed: Einträge ohne '@' im Kontakt haben keine gültige Mail → auf 0 setzen.
  await db.execute(
    `UPDATE stoerungen SET melderBenachrichtigung = 0
     WHERE melderBenachrichtigung = 1
       AND (melderKontakt NOT LIKE '%@%' OR melderKontakt IS NULL OR melderKontakt = '')`
  );
}

async function run(sql, args = []) { return db.execute({ sql, args }); }
async function all(sql, args = []) { const r = await db.execute({ sql, args }); return r.rows; }
async function get(sql, args = []) { const r = await db.execute({ sql, args }); return r.rows[0] || null; }

async function generateTicketId(fahrzeug, isoDate) {
  const d     = new Date(isoDate);
  const year  = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `${fahrzeug}-${year}-${month}-`;
  const row = await get(`SELECT COUNT(*) as cnt FROM stoerungen WHERE id LIKE ?`, [prefix + '%']);
  const next = (row ? Number(row.cnt) : 0) + 1;
  return prefix + String(next).padStart(3, '0');
}

async function createStorung({ fahrzeug, schwere, fehlerBeschreibung, beschreibung, createdBy, melderName, melderKontakt, melderBenachrichtigung = 0, attachments = [] }) {
  const now = new Date().toISOString();
  const id  = await generateTicketId(fahrzeug, now);
  // Explizit Number-Vergleich: nur wenn exakt 1, sonst 0
  const benFlag = Number(melderBenachrichtigung) === 1 ? 1 : 0;
  await run(
    `INSERT INTO stoerungen (id,fahrzeug,schwere,fehlerBeschreibung,beschreibung,status,createdBy,createdAt,melderName,melderKontakt,melderBenachrichtigung) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, fahrzeug, schwere, fehlerBeschreibung, beschreibung || '', 'gesendet', createdBy, now, melderName, melderKontakt, benFlag]
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
  s.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [id]);
  s.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY createdAt ASC`, [id]);
  return s;
}

async function getAllStorungen() {
  const rows = await all(`SELECT * FROM stoerungen ORDER BY createdAt DESC`);
  return Promise.all(rows.map(async s => {
    s.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [s.id]);
    s.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY createdAt ASC`, [s.id]);
    return s;
  }));
}

async function getByStatus(status) {
  const rows = await all(`SELECT * FROM stoerungen WHERE status = ? ORDER BY createdAt DESC`, [status]);
  return Promise.all(rows.map(async s => {
    s.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [s.id]);
    s.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY createdAt ASC`, [s.id]);
    return s;
  }));
}

async function updateStatus(id, newStatus, changedBy, note) {
  const now = new Date().toISOString();
  await run(`UPDATE stoerungen SET status = ? WHERE id = ?`, [newStatus, id]);
  await run(
    `INSERT INTO stoerung_history (stoerungId,status,changedBy,changedAt,note) VALUES (?,?,?,?,?)`,
    [id, newStatus, changedBy, now, note || null]
  );
  return getStorungById(id);
}

async function searchByFahrzeugMonat(fahrzeug, monat, statuses) {
  const validStatuses = ['gesendet', 'bestaetigt', 'erledigt'];
  const filtered = Array.isArray(statuses) && statuses.length > 0
    ? statuses.filter(s => validStatuses.includes(s))
    : validStatuses;
  const placeholders = filtered.map(() => '?').join(',');
  const args = [fahrzeug, ...filtered];
  let sql = `SELECT id, fahrzeug, fehlerBeschreibung, schwere, status, createdAt
             FROM stoerungen
             WHERE fahrzeug = ? AND status IN (${placeholders})`;
  if (monat) { sql += ` AND strftime('%Y-%m', createdAt) = ?`; args.push(monat); }
  sql += ` ORDER BY createdAt DESC`;
  return all(sql, args);
}

async function searchSimilarFehler(query, fahrzeug, includeErledigt = false) {
  const like = '%' + query.toLowerCase() + '%';
  const orderBy = `ORDER BY CASE status WHEN 'erledigt' THEN 1 ELSE 0 END ASC, createdAt DESC`;
  if (fahrzeug) {
    if (includeErledigt) {
      return all(
        `SELECT * FROM stoerungen WHERE fahrzeug = ? AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`,
        [fahrzeug, like]
      );
    }
    return all(
      `SELECT * FROM stoerungen WHERE status != 'erledigt' AND fahrzeug = ? AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`,
      [fahrzeug, like]
    );
  }
  if (includeErledigt) {
    return all(
      `SELECT * FROM stoerungen WHERE lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`,
      [like]
    );
  }
  return all(
    `SELECT * FROM stoerungen WHERE status != 'erledigt' AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`,
    [like]
  );
}

async function getAttachmentsForCompression(cutoffIso) {
  return all(`
    SELECT a.* FROM stoerung_attachments a
    JOIN stoerungen s ON s.id = a.stoerungId
    WHERE s.status = 'erledigt' AND s.createdAt < ? AND a.compressed = 0
  `, [cutoffIso]);
}
async function markAttachmentCompressed(id) { return run(`UPDATE stoerung_attachments SET compressed = 1 WHERE id = ?`, [id]); }
async function getOldestAttachments() { return all(`SELECT * FROM stoerung_attachments ORDER BY createdAt ASC`); }
async function deleteAttachment(id) { return run(`DELETE FROM stoerung_attachments WHERE id = ?`, [id]); }
async function deleteStorung(id) { return run(`DELETE FROM stoerungen WHERE id = ?`, [id]); }

module.exports = {
  initDb,
  createStorung, getStorungById, getAllStorungen, getByStatus, updateStatus,
  searchByFahrzeugMonat, searchSimilarFehler,
  getAttachmentsForCompression, markAttachmentCompressed,
  getOldestAttachments, deleteAttachment,
  deleteStorung,
};
