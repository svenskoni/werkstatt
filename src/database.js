'use strict';
// SQLite via @libsql/client – reines JavaScript, kein node-gyp erforderlich
const { createClient } = require('@libsql/client');
const path = require('path');
const fs   = require('fs');

const DB_DIR  = path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_PATH || path.join(DB_DIR, 'stoerungen.db');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = createClient({ url: 'file:' + DB_FILE });

// Schema beim Start anlegen
async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS stoerungen (
      id                 TEXT PRIMARY KEY,
      fahrzeug           TEXT NOT NULL,
      schwere            TEXT NOT NULL,
      fehlerBeschreibung TEXT NOT NULL,
      beschreibung       TEXT,
      status             TEXT NOT NULL DEFAULT 'gesendet',
      createdBy          TEXT NOT NULL,
      createdAt          TEXT NOT NULL,
      melderName         TEXT NOT NULL,
      melderKontakt      TEXT NOT NULL
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
      FOREIGN KEY (stoerungId) REFERENCES stoerungen(id) ON DELETE CASCADE
    );
  `);
}

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────
async function run(sql, args = []) {
  return db.execute({ sql, args });
}
async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
async function get(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] || null;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
async function createStorung({ id, fahrzeug, schwere, fehlerBeschreibung, beschreibung, createdBy, melderName, melderKontakt, attachments = [] }) {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO stoerungen (id,fahrzeug,schwere,fehlerBeschreibung,beschreibung,status,createdBy,createdAt,melderName,melderKontakt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, fahrzeug, schwere, fehlerBeschreibung, beschreibung || '', 'gesendet', createdBy, now, melderName, melderKontakt]
  );
  await run(
    `INSERT INTO stoerung_history (stoerungId,status,changedBy,changedAt,note) VALUES (?,?,?,?,?)`,
    [id, 'gesendet', createdBy, now, null]
  );
  for (const a of attachments) {
    await run(
      `INSERT INTO stoerung_attachments (stoerungId,filename,originalname,mimetype,size) VALUES (?,?,?,?,?)`,
      [id, a.filename, a.originalname, a.mimetype, a.size]
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

async function searchSimilarFehler(query) {
  return all(
    `SELECT * FROM stoerungen WHERE status != 'erledigt' AND lower(fehlerBeschreibung) LIKE ? ORDER BY createdAt DESC LIMIT 5`,
    ['%' + query.toLowerCase() + '%']
  );
}

module.exports = { initDb, createStorung, getStorungById, getAllStorungen, getByStatus, updateStatus, searchSimilarFehler };
