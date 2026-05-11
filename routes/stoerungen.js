'use strict';
const express  = require('express');
const path     = require('path');
const multer   = require('multer');
const db       = require('../src/database');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Multer-Konfiguration ──────────────────────────────────────────────────────
const MAX_MB  = parseInt(process.env.MAX_UPLOAD_MB || '8', 10);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Nur Bild- und Videodateien erlaubt.'));
  }
});

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res) => {
  try {
    const [gesendet, bestaetigt, erledigt] = await Promise.all([
      db.getByStatus('gesendet'),
      db.getByStatus('bestaetigt'),
      db.getByStatus('erledigt'),
    ]);
    const stats = {
      total:    gesendet.length + bestaetigt.length + erledigt.length,
      offen:    gesendet.length,
      aktiv:    bestaetigt.length,
      erledigt: erledigt.length,
    };
    res.render('index', { gesendet, bestaetigt, erledigt, stats, user: req.session.user });
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Dashboard konnte nicht geladen werden.' });
  }
});

// ── Neue Störung – Formular ────────────────────────────────────────────────
router.get('/stoerung/neu', requireLogin, (req, res) => {
  res.render('stoerung-neu', { error: null, user: req.session.user });
});

// ── Neue Störung – Speichern ────────────────────────────────────────────────
router.post('/stoerung/neu', requireLogin, upload.array('attachments', 6), async (req, res) => {
  try {
    const { fahrzeug, schwere, fehlerBeschreibung, beschreibung, melderName, melderKontakt } = req.body;
    const melderBenachrichtigung = req.body.melderBenachrichtigung ? 1 : 0;
    if (!fahrzeug || !schwere || !fehlerBeschreibung || !melderName) {
      return res.status(400).render('stoerung-neu', {
        error: 'Bitte alle Pflichtfelder ausfüllen.',
        user: req.session.user
      });
    }
    const attachments = (req.files || []).map(f => ({
      filename:     f.filename,
      originalname: f.originalname,
      mimetype:     f.mimetype,
      size:         f.size,
    }));
    await db.createStorung({
      fahrzeug, schwere, fehlerBeschreibung,
      beschreibung:         beschreibung || '',
      createdBy:            req.session.user.username,
      melderName:           melderName || '',
      melderKontakt:        melderKontakt || '',
      melderBenachrichtigung,
      attachments,
    });
    res.redirect('/');
  } catch (err) {
    console.error('[Neu]', err);
    res.status(500).render('stoerung-neu', { error: 'Speichern fehlgeschlagen.', user: req.session.user });
  }
});

// ── Störung-Detail ──────────────────────────────────────────────────────────
router.get('/stoerung/:id', requireLogin, async (req, res) => {
  try {
    const s = await db.getStorungById(req.params.id);
    if (!s) return res.status(404).render('error', { title: '404', message: 'Störung nicht gefunden.' });
    res.render('stoerung-detail', {
      s,
      attachments: s.attachments || [],
      history:     s.history     || [],
      user:        req.session.user,
    });
  } catch (err) {
    console.error('[Detail]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Störung konnte nicht geladen werden.' });
  }
});

// ── Status ändern (nur Admin) ─────────────────────────────────────────────
router.post('/stoerung/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const { status, notiz } = req.body;
    const allowed = ['gesendet', 'bestaetigt', 'erledigt'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
    const s = await db.getStorungById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Nicht gefunden.' });
    await db.updateStatus(s.id, status, req.session.user.username, notiz || null);
    res.json({ ok: true, newStatus: status });
  } catch (err) {
    console.error('[Status]', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ── Störung löschen (nur Admin) ───────────────────────────────────────────
router.post('/stoerung/:id/loeschen', requireRole('admin'), async (req, res) => {
  try {
    const s = await db.getStorungById(req.params.id);
    if (!s) return res.status(404).render('error', { title: '404', message: 'Nicht gefunden.' });
    await db.deleteStorung(s.id);
    res.redirect('/');
  } catch (err) {
    console.error('[Löschen]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Löschen fehlgeschlagen.' });
  }
});

// ── Such-API ──────────────────────────────────────────────────────────────
router.get('/api/suche', requireLogin, async (req, res) => {
  try {
    const { fahrzeug, monat, status } = req.query;
    if (!fahrzeug) return res.status(400).json({ error: 'Fahrzeug fehlt.' });
    const statusList = status
      ? status.split(',').filter(s => ['gesendet','bestaetigt','erledigt'].includes(s))
      : ['gesendet','bestaetigt','erledigt'];
    const rows = await db.searchByFahrzeugMonat(fahrzeug, monat || null, statusList);
    res.json(rows);
  } catch (err) {
    console.error('[API Suche]', err);
    res.status(500).json({ error: 'Fehler.' });
  }
});

module.exports = router;
