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
      updatedAt              TEXT,
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

  // Migration: Spalten nachträglich hinzufügen falls noch nicht vorhanden
  for (const migration of [
    `ALTER TABLE stoerungen ADD COLUMN melderBenachrichtigung INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE stoerungen ADD COLUMN updatedAt TEXT`,
  ]) {
    try { await db.execute(migration); } catch { /* already exists */ }
  }

  // updatedAt befüllen für bestehende Einträge (einmalig)
  await db.execute(`
    UPDATE stoerungen SET updatedAt = createdAt WHERE updatedAt IS NULL
  `);

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
  const d      = new Date(isoDate);
  const year   = d.getUTCFullYear();
  const month  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `${fahrzeug}-${year}-${month}-`;
  const row = await get(
    `SELECT MAX(CAST(substr(id, ?) AS INTEGER)) AS maxNum FROM stoerungen WHERE id LIKE ?`,
    [prefix.length + 1, prefix + '%']
  );
  const next = (row && row.maxNum != null ? Number(row.maxNum) : 0) + 1;
  return prefix + String(next).padStart(3, '0');
}

async function createStorung({ fahrzeug, schwere, fehlerBeschreibung, beschreibung, createdBy, melderName, melderKontakt, melderBenachrichtigung = 0, attachments = [] }) {
  const now     = new Date().toISOString();
  const id      = await generateTicketId(fahrzeug, now);
  const benFlag = Number(melderBenachrichtigung) === 1 ? 1 : 0;
  await run(
    `INSERT INTO stoerungen (id,fahrzeug,schwere,fehlerBeschreibung,beschreibung,status,createdBy,createdAt,updatedAt,melderName,melderKontakt,melderBenachrichtigung) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, fahrzeug, schwere, fehlerBeschreibung, beschreibung || '', 'gesendet', createdBy, now, now, melderName, melderKontakt, benFlag]
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
  const rows = await all(`SELECT * FROM stoerungen ORDER BY COALESCE(updatedAt, createdAt) DESC`);
  return Promise.all(rows.map(async s => {
    s.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [s.id]);
    s.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY createdAt ASC`, [s.id]);
    return s;
  }));
}

async function getByStatus(status) {
  const rows = await all(
    `SELECT * FROM stoerungen WHERE status = ? ORDER BY COALESCE(updatedAt, createdAt) DESC`,
    [status]
  );
  return Promise.all(rows.map(async s => {
    s.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [s.id]);
    s.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY createdAt ASC`, [s.id]);
    return s;
  }));
}

async function updateStatus(id, newStatus, changedBy, note, neuSchwere) {
  const now = new Date().toISOString();

  const current = await get(`SELECT schwere FROM stoerungen WHERE id = ?`, [id]);
  const alterSchwere = current ? current.schwere : null;

  const validSchwere = ['klein', 'normal', 'schwer', 'totalausfall'];
  const schwereGeaendert = neuSchwere && validSchwere.includes(neuSchwere) && neuSchwere !== alterSchwere;

  if (schwereGeaendert) {
    await run(`UPDATE stoerungen SET status = ?, schwere = ?, updatedAt = ? WHERE id = ?`, [newStatus, neuSchwere, now, id]);
  } else {
    await run(`UPDATE stoerungen SET status = ?, updatedAt = ? WHERE id = ?`, [newStatus, now, id]);
  }

  const SCHWERE_LABEL = {
    klein: '\uD83D\uDFE2 Klein', normal: '\uD83D\uDFE1 Normal', schwer: '\uD83D\uDFE0 Schwer', totalausfall: '\uD83D\uDD34 Totalausfall',
  };
  let historyNote = note || null;
  if (schwereGeaendert) {
    const aenderung = `[Schweregrad ge\u00e4ndert: ${SCHWERE_LABEL[alterSchwere] || alterSchwere} \u2192 ${SCHWERE_LABEL[neuSchwere] || neuSchwere}]`;
    historyNote = historyNote ? `${historyNote} ${aenderung}` : aenderung;
  }

  await run(
    `INSERT INTO stoerung_history (stoerungId,status,changedBy,changedAt,note) VALUES (?,?,?,?,?)`,
    [id, newStatus, changedBy, now, historyNote]
  );

  const updated = await getStorungById(id);
  updated._alterSchwere     = schwereGeaendert ? alterSchwere : null;
  updated._schwereGeaendert = schwereGeaendert;
  return updated;
}

async function searchByFahrzeugMonat(fahrzeug, monat, statuses) {
  const validStatuses = ['gesendet', 'bestaetigt', 'erledigt', 'zurueckgewiesen'];
  const filtered = Array.isArray(statuses) && statuses.length > 0
    ? statuses.filter(s => validStatuses.includes(s))
    : validStatuses;
  const placeholders = filtered.map(() => '?').join(',');
  const args = [fahrzeug, ...filtered];
  let sql = `SELECT id, fahrzeug, fehlerBeschreibung, schwere, status, createdAt
             FROM stoerungen
             WHERE fahrzeug = ? AND status IN (${placeholders})`;
  if (monat) { sql += ` AND strftime('%Y-%m', createdAt) = ?`; args.push(monat); }
  sql += ` ORDER BY COALESCE(updatedAt, createdAt) DESC`;
  return all(sql, args);
}

async function searchSimilarFehler(query, fahrzeug, includeErledigt = false) {
  const like    = '%' + query.toLowerCase() + '%';
  const orderBy = `ORDER BY CASE status WHEN 'erledigt' THEN 1 ELSE 0 END ASC, COALESCE(updatedAt, createdAt) DESC`;
  const excludeStatuses = `status NOT IN ('erledigt', 'zurueckgewiesen')`;
  if (fahrzeug) {
    if (includeErledigt) {
      return all(
        `SELECT * FROM stoerungen WHERE fahrzeug = ? AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`,
        [fahrzeug, like]
      );
    }
    return all(
      `SELECT * FROM stoerungen WHERE ${excludeStatuses} AND fahrzeug = ? AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`,
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
    `SELECT * FROM stoerungen WHERE ${excludeStatuses} AND lower(fehlerBeschreibung) LIKE ? ${orderBy} LIMIT 8`,
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

async function getOldestAttachmentsForPurge() {
  return all(`
    SELECT a.*, s.status AS storungStatus
    FROM stoerung_attachments a
    JOIN stoerungen s ON s.id = a.stoerungId
    ORDER BY
      CASE s.status
        WHEN 'erledigt'        THEN 0
        WHEN 'zurueckgewiesen' THEN 0
        ELSE                        1
      END ASC,
      a.createdAt ASC
  `);
}

async function getOldestAttachments() { return all(`SELECT * FROM stoerung_attachments ORDER BY createdAt ASC`); }

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
  createStorung, getStorungById, getAllStorungen, getByStatus, updateStatus,
  searchByFahrzeugMonat, searchSimilarFehler,
  getAttachmentsForCompression, markAttachmentCompressed,
  getOldestAttachments, getOldestAttachmentsForPurge, deleteAttachment,
  deleteStorung,
};
