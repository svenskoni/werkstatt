'use strict';
// SQLite-Datenbankschicht mit better-sqlite3
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'stoerungen.db');

// Verzeichnis sicherstellen
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema anlegen
db.exec(`
  CREATE TABLE IF NOT EXISTS stoerungen (
    id              TEXT PRIMARY KEY,
    fahrzeug        TEXT NOT NULL,
    schwere         TEXT NOT NULL,
    fehlerBeschreibung TEXT NOT NULL,
    beschreibung    TEXT,
    status          TEXT NOT NULL DEFAULT 'gesendet',
    createdBy       TEXT NOT NULL,
    createdAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stoerung_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    stoerungId  TEXT NOT NULL,
    status      TEXT NOT NULL,
    changedBy   TEXT NOT NULL,
    changedAt   TEXT NOT NULL,
    note        TEXT,
    FOREIGN KEY (stoerungId) REFERENCES stoerungen(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stoerung_attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    stoerungId    TEXT NOT NULL,
    filename      TEXT NOT NULL,
    originalname  TEXT NOT NULL,
    mimetype      TEXT NOT NULL,
    size          INTEGER NOT NULL,
    FOREIGN KEY (stoerungId) REFERENCES stoerungen(id) ON DELETE CASCADE
  );
`);

// --- CRUD Funktionen ---------------------------------------------------
const stmts = {
  insertStorung:      db.prepare(`INSERT INTO stoerungen (id,fahrzeug,schwere,fehlerBeschreibung,beschreibung,status,createdBy,createdAt) VALUES (?,?,?,?,?,?,?,?)`),
  insertHistory:      db.prepare(`INSERT INTO stoerung_history (stoerungId,status,changedBy,changedAt,note) VALUES (?,?,?,?,?)`),
  insertAttachment:   db.prepare(`INSERT INTO stoerung_attachments (stoerungId,filename,originalname,mimetype,size) VALUES (?,?,?,?,?)`),
  getAll:             db.prepare(`SELECT * FROM stoerungen ORDER BY createdAt DESC`),
  getByStatus:        db.prepare(`SELECT * FROM stoerungen WHERE status = ? ORDER BY createdAt DESC`),
  getById:            db.prepare(`SELECT * FROM stoerungen WHERE id = ?`),
  updateStatus:       db.prepare(`UPDATE stoerungen SET status = ? WHERE id = ?`),
  getHistory:         db.prepare(`SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC`),
  getAttachments:     db.prepare(`SELECT * FROM stoerung_attachments WHERE stoerungId = ?`),
  getOpenByFahrzeug:  db.prepare(`SELECT * FROM stoerungen WHERE status != 'erledigt' AND fahrzeug = ? ORDER BY createdAt DESC`),
  searchFehler:       db.prepare(`SELECT * FROM stoerungen WHERE status != 'erledigt' AND lower(fehlerBeschreibung) LIKE ? ORDER BY createdAt DESC LIMIT 5`),
};

function createStorung({ id, fahrzeug, schwere, fehlerBeschreibung, beschreibung, createdBy, attachments = [] }) {
  const now = new Date().toISOString();
  db.transaction(() => {
    stmts.insertStorung.run(id, fahrzeug, schwere, fehlerBeschreibung, beschreibung || '', 'gesendet', createdBy, now);
    stmts.insertHistory.run(id, 'gesendet', createdBy, now, null);
    for (const a of attachments) {
      stmts.insertAttachment.run(id, a.filename, a.originalname, a.mimetype, a.size);
    }
  })();
  return getStorungById(id);
}

function getStorungById(id) {
  const s = stmts.getById.get(id);
  if (!s) return null;
  s.history     = stmts.getHistory.all(id);
  s.attachments = stmts.getAttachments.all(id);
  return s;
}

function getAllStorungen() {
  const rows = stmts.getAll.all();
  return rows.map(s => {
    s.history     = stmts.getHistory.all(s.id);
    s.attachments = stmts.getAttachments.all(s.id);
    return s;
  });
}

function getByStatus(status) {
  const rows = stmts.getByStatus.all(status);
  return rows.map(s => {
    s.history     = stmts.getHistory.all(s.id);
    s.attachments = stmts.getAttachments.all(s.id);
    return s;
  });
}

function updateStatus(id, newStatus, changedBy, note) {
  const now = new Date().toISOString();
  db.transaction(() => {
    stmts.updateStatus.run(newStatus, id);
    stmts.insertHistory.run(id, newStatus, changedBy, now, note || null);
  })();
  return getStorungById(id);
}

function searchSimilarFehler(query) {
  return stmts.searchFehler.all('%' + query.toLowerCase() + '%');
}

module.exports = { createStorung, getStorungById, getAllStorungen, getByStatus, updateStatus, searchSimilarFehler };
