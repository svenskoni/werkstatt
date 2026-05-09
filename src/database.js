'use strict';
// SQLite-Datenbankschicht mit sqlite3 (async, kein nativer Build nötig)
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'stoerungen.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

// WAL-Modus & Foreign Keys
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS stoerungen (
    id                 TEXT PRIMARY KEY,
    fahrzeug           TEXT NOT NULL,
    schwere            TEXT NOT NULL,
    fehlerBeschreibung TEXT NOT NULL,
    beschreibung       TEXT,
    status             TEXT NOT NULL DEFAULT 'gesendet',
    createdBy          TEXT NOT NULL,
    createdAt          TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stoerung_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    stoerungId TEXT NOT NULL,
    status     TEXT NOT NULL,
    changedBy  TEXT NOT NULL,
    changedAt  TEXT NOT NULL,
    note       TEXT,
    FOREIGN KEY (stoerungId) REFERENCES stoerungen(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stoerung_attachments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    stoerungId   TEXT NOT NULL,
    filename     TEXT NOT NULL,
    originalname TEXT NOT NULL,
    mimetype     TEXT NOT NULL,
    size         INTEGER NOT NULL,
    FOREIGN KEY (stoerungId) REFERENCES stoerungen(id) ON DELETE CASCADE
  )`);
});

// ── Hilfsfunktion: Promise-Wrapper ────────────────────────────────────────
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve(this);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}

// ── CRUD ─────────────────────────────────────────────────────────────────
async function createStorung({ id, fahrzeug, schwere, fehlerBeschreibung, beschreibung, createdBy, attachments = [] }) {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO stoerungen (id,fahrzeug,schwere,fehlerBeschreibung,beschreibung,status,createdBy,createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    [id, fahrzeug, schwere, fehlerBeschreibung, beschreibung || '', 'gesendet', createdBy, now]
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
  s.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ?`, [id]);
  return s;
}

async function getAllStorungen() {
  const rows = await all(`SELECT * FROM stoerungen ORDER BY createdAt DESC`);
  return Promise.all(rows.map(async s => {
    s.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [s.id]);
    s.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ?`, [s.id]);
    return s;
  }));
}

async function getByStatus(status) {
  const rows = await all(`SELECT * FROM stoerungen WHERE status = ? ORDER BY createdAt DESC`, [status]);
  return Promise.all(rows.map(async s => {
    s.history     = await all(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`, [s.id]);
    s.attachments = await all(`SELECT * FROM stoerung_attachments WHERE stoerungId = ?`, [s.id]);
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

module.exports = { createStorung, getStorungById, getAllStorungen, getByStatus, updateStatus, searchSimilarFehler };
