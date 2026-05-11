'use strict';
const express  = require('express');
const path     = require('path');
const multer   = require('multer');
const db       = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Multer-Konfiguration ──────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Nur Bild- und Videodateien erlaubt.'));
  }
});

// Hilfsfunktion: Ticket-ID
function generateId(fahrzeug) {
  const d   = new Date();
  const yy  = d.getFullYear();
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rnd = Math.floor(Math.random() * 900 + 100);
  return `${fahrzeug.toUpperCase()}-${yy}-${mm}${day}-${rnd}`;
}

// ── Dashboard (Login erforderlich) ──────────────────────────────────────────
router.get('/', requireLogin, (req, res) => {
  try {
    const gesendet   = db.prepare("SELECT * FROM stoerungen WHERE status='gesendet'   ORDER BY createdAt DESC").all();
    const bestaetigt = db.prepare("SELECT * FROM stoerungen WHERE status='bestaetigt' ORDER BY createdAt DESC").all();
    const erledigt   = db.prepare("SELECT * FROM stoerungen WHERE status='erledigt'   ORDER BY createdAt DESC").all();
    const stats = {
      total:    gesendet.length + bestaetigt.length + erledigt.length,
      offen:    gesendet.length,
      aktiv:    bestaetigt.length,
      erledigt: erledigt.length
    };
    res.render('index', { gesendet, bestaetigt, erledigt, stats, user: req.session.user });
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Dashboard konnte nicht geladen werden.' });
  }
});

// ── Neue Störung – Formular (alle eingeloggten User) ────────────────────────
router.get('/stoerung/neu', requireLogin, (req, res) => {
  res.render('stoerung-neu', { error: null, user: req.session.user });
});

// ── Neue Störung – Speichern ─────────────────────────────────────────────────
router.post('/stoerung/neu', requireLogin, upload.array('attachments', 6), (req, res) => {
  try {
    const { fahrzeug, schwere, fehlerBeschreibung, melder } = req.body;
    if (!fahrzeug || !schwere || !fehlerBeschreibung) {
      return res.status(400).render('stoerung-neu', {
        error: 'Bitte alle Pflichtfelder ausfüllen.',
        user: req.session.user
      });
    }
    const id        = generateId(fahrzeug);
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO stoerungen (id, fahrzeug, schwere, fehlerBeschreibung, melder, status, createdAt)
      VALUES (?, ?, ?, ?, ?, 'gesendet', ?)
    `).run(id, fahrzeug, schwere, fehlerBeschreibung, melder || '', createdAt);

    if (req.files && req.files.length > 0) {
      const ins = db.prepare('INSERT INTO stoerung_attachments (stoerungId, filename, mimetype, size) VALUES (?,?,?,?)');
      req.files.forEach(f => ins.run(id, f.filename, f.mimetype, f.size));
    }

    db.prepare('INSERT INTO stoerung_history (stoerungId, von, nach, notiz, changedAt) VALUES (?,?,?,?,?)')
      .run(id, null, 'gesendet', 'Störung gemeldet', createdAt);

    res.redirect('/');
  } catch (err) {
    console.error('[Neu]', err);
    res.status(500).render('stoerung-neu', { error: 'Speichern fehlgeschlagen.', user: req.session.user });
  }
});

// ── Störung-Detail ─────────────────────────────────────────────────────────
router.get('/stoerung/:id', requireLogin, (req, res) => {
  try {
    const s = db.prepare('SELECT * FROM stoerungen WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).render('error', { title: '404', message: 'Störung nicht gefunden.' });
    const attachments = db.prepare('SELECT * FROM stoerung_attachments WHERE stoerungId = ? ORDER BY id ASC').all(s.id);
    const history     = db.prepare('SELECT * FROM stoerung_history WHERE stoerungId = ? ORDER BY changedAt ASC').all(s.id);
    res.render('stoerung-detail', { s, attachments, history, user: req.session.user });
  } catch (err) {
    console.error('[Detail]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Störung konnte nicht geladen werden.' });
  }
});

// ── Status ändern (nur Admin) ─────────────────────────────────────────────
router.post('/stoerung/:id/status', requireRole('admin'), (req, res) => {
  try {
    const { status, notiz } = req.body;
    const allowed = ['gesendet', 'bestaetigt', 'erledigt'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
    const s = db.prepare('SELECT * FROM stoerungen WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Nicht gefunden.' });
    const changedAt = new Date().toISOString();
    db.prepare('UPDATE stoerungen SET status = ?, updatedAt = ? WHERE id = ?').run(status, changedAt, s.id);
    db.prepare('INSERT INTO stoerung_history (stoerungId, von, nach, notiz, changedAt) VALUES (?,?,?,?,?)')
      .run(s.id, s.status, status, notiz || '', changedAt);
    res.json({ ok: true, newStatus: status });
  } catch (err) {
    console.error('[Status]', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ── Störung löschen (nur Admin) ───────────────────────────────────────────
router.post('/stoerung/:id/loeschen', requireRole('admin'), (req, res) => {
  try {
    const s = db.prepare('SELECT * FROM stoerungen WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).render('error', { title: '404', message: 'Nicht gefunden.' });
    db.prepare('DELETE FROM stoerung_attachments WHERE stoerungId = ?').run(s.id);
    db.prepare('DELETE FROM stoerung_history WHERE stoerungId = ?').run(s.id);
    db.prepare('DELETE FROM stoerungen WHERE id = ?').run(s.id);
    res.redirect('/');
  } catch (err) {
    console.error('[Löschen]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Löschen fehlgeschlagen.' });
  }
});

// ── Such-API ──────────────────────────────────────────────────────────────
router.get('/api/suche', requireLogin, (req, res) => {
  try {
    const { fahrzeug, monat, status } = req.query;
    if (!fahrzeug) return res.status(400).json({ error: 'Fahrzeug fehlt.' });
    const statusList = status ? status.split(',').filter(s => ['gesendet','bestaetigt','erledigt'].includes(s)) : ['gesendet','bestaetigt','erledigt'];
    const placeholders = statusList.map(() => '?').join(',');
    let sql    = `SELECT * FROM stoerungen WHERE fahrzeug = ? AND status IN (${placeholders})`;
    const args = [fahrzeug, ...statusList];
    if (monat) { sql += ' AND strftime(\'%Y-%m\', createdAt) = ?'; args.push(monat); }
    sql += ' ORDER BY createdAt DESC LIMIT 100';
    res.json(db.prepare(sql).all(...args));
  } catch (err) {
    console.error('[API Suche]', err);
    res.status(500).json({ error: 'Fehler.' });
  }
});

module.exports = router;
