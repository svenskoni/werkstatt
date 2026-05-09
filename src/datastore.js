'use strict';
/**
 * Datastore – alle Datenbankoperationen für Störungen.
 * Nutzt SQLite über src/database.js
 */
const db = require('./database');
const { v4: uuidv4 } = require('uuid');

const STATUS = { GESENDET: 'gesendet', BESTAETIGT: 'bestaetigt', ERLEDIGT: 'erledigt' };
const SCHWERE = {
  klein:       { label: 'Klein',              icon: '🟢', priority: 1 },
  normal:      { label: 'Normal',             icon: '🟡', priority: 2 },
  schwer:      { label: 'Schwer',             icon: '🟠', priority: 3 },
  totalausfall:{ label: 'Totalausfall Fzg.',  icon: '🔴', priority: 4 }
};

function createStorung({ fahrzeug, schwere, fehlerBeschreibung, beschreibung, attachments, createdBy }) {
  const id  = uuidv4();
  const now = new Date().toISOString();
  const attachmentsJson = JSON.stringify(attachments || []);
  const historyJson     = JSON.stringify([{ status: STATUS.GESENDET, changedBy: createdBy, changedAt: now, note: '' }]);

  db.prepare(`
    INSERT INTO stoerungen (id, fahrzeug, schwere, fehlerBeschreibung, beschreibung, attachments, status, createdBy, createdAt, updatedAt, history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, fahrzeug, schwere, fehlerBeschreibung, beschreibung || '', attachmentsJson, STATUS.GESENDET, createdBy, now, now, historyJson);

  return getStorungById(id);
}

function getStorungById(id) {
  const row = db.prepare('SELECT * FROM stoerungen WHERE id = ?').get(id);
  if (!row) return null;
  return parse(row);
}

function getStorungenByStatus(status) {
  return db.prepare('SELECT * FROM stoerungen WHERE status = ? ORDER BY createdAt DESC').all(status).map(parse);
}

function updateStorungStatus(id, newStatus, changedBy, note = '') {
  const storung = getStorungById(id);
  if (!storung) return null;
  const now     = new Date().toISOString();
  const history = storung.history;
  history.push({ status: newStatus, changedBy, changedAt: now, note: note || '' });
  db.prepare('UPDATE stoerungen SET status = ?, updatedAt = ?, history = ? WHERE id = ?')
    .run(newStatus, now, JSON.stringify(history), id);
  return getStorungById(id);
}

function findSimilarOpenStorungen(fahrzeug, query) {
  const q = `%${query.toLowerCase()}%`;
  return db.prepare(`
    SELECT id, fahrzeug, fehlerBeschreibung, schwere, status
    FROM stoerungen
    WHERE fahrzeug = ? AND status != ? AND LOWER(fehlerBeschreibung) LIKE ?
    LIMIT 5
  `).all(fahrzeug, STATUS.ERLEDIGT, q).map(parse);
}

function getStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'gesendet'   THEN 1 ELSE 0 END) AS gesendet,
      SUM(CASE WHEN status = 'bestaetigt' THEN 1 ELSE 0 END) AS bestaetigt,
      SUM(CASE WHEN status = 'erledigt'   THEN 1 ELSE 0 END) AS erledigt
    FROM stoerungen
  `).get();
  return row || { total: 0, gesendet: 0, bestaetigt: 0, erledigt: 0 };
}

function parse(row) {
  return {
    ...row,
    attachments: JSON.parse(row.attachments || '[]'),
    history:     JSON.parse(row.history     || '[]')
  };
}

module.exports = { createStorung, getStorungById, getStorungenByStatus, updateStorungStatus, findSimilarOpenStorungen, getStats, STATUS, SCHWERE };