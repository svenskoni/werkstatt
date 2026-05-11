'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../src/database');
const mailer   = require('../src/mailer');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Multer ────────────────────────────────────────────────────────────────────────
const MAX_MB  = parseInt(process.env.MAX_UPLOAD_MB || '8', 10);
if (isNaN(MAX_MB) || MAX_MB <= 0) { throw new Error('MAX_UPLOAD_MB ist keine gültige Zahl'); }

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

// FIX: Whitelist der erlaubten MIME-Types (explizit, kein startsWith-Wildcard)
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
]);

// FIX: Whitelist der erlaubten Extensions
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.mp4', '.mov', '.avi', '.webm',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // FIX: Extension muss in Whitelist sein, sonst kein Upload
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error(`Dateityp nicht erlaubt: ${ext}`));
    }
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // FIX: MIME + Extension beide prüfen
    if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
      return cb(new Error('Nur Bild- und Videodateien erlaubt (jpg/png/gif/webp/mp4/mov/avi/webm).'));
    }
    cb(null, true);
  }
});

// FIX: Hilfsfunktion – bereits gespeicherte Upload-Dateien bei Fehler löschen
function cleanupUploads(files) {
  if (!files || !files.length) return;
  for (const f of files) {
    try { fs.unlinkSync(f.path); } catch {}
  }
}

function renderNeu(res, errors, old, user) {
  res.status(errors.length ? 400 : 200).render('stoerung-neu', { errors: errors || [], old: old || {}, user });
}

// ── Dashboard ────────────────────────────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res) => {
  try {
    const [gesendet, bestaetigt, erledigt, zurueckgewiesen] = await Promise.all([
      db.getByStatus('gesendet'),
      db.getByStatus('bestaetigt'),
      db.getByStatus('erledigt'),
      db.getByStatus('zurueckgewiesen'),
    ]);
    const stats = {
      total:    gesendet.length + bestaetigt.length + erledigt.length + zurueckgewiesen.length,
      offen:    gesendet.length,
      aktiv:    bestaetigt.length,
      erledigt: erledigt.length + zurueckgewiesen.length,
    };
    res.render('dashboard', { gesendet, bestaetigt, erledigt, zurueckgewiesen, stats, user: req.session.user });
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Dashboard konnte nicht geladen werden.' });
  }
});

// ── Neue Störung ──────────────────────────────────────────────────────────────────────────────────
router.get('/stoerung/neu', requireLogin, (req, res) => {
  renderNeu(res, [], {}, req.session.user);
});

router.post('/stoerung/neu', requireLogin,
  // FIX: Multer-Fehler abfangen bevor Route-Handler läuft
  (req, res, next) => {
    upload.array('attachments', 6)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return renderNeu(res, [`Datei zu groß. Maximal ${MAX_MB} MB pro Datei.`], req.body || {}, req.session.user);
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return renderNeu(res, ['Maximal 6 Dateien erlaubt.'], req.body || {}, req.session.user);
        }
        return renderNeu(res, [`Upload-Fehler: ${err.message}`], req.body || {}, req.session.user);
      }
      if (err) {
        return renderNeu(res, [`Upload abgelehnt: ${err.message}`], req.body || {}, req.session.user);
      }
      next();
    });
  },
  async (req, res) => {
    const old = req.body || {};
    try {
      const { fahrzeug, schwere, fehlerBeschreibung, beschreibung, melderName, melderHandy, melderMail } = req.body;

      const melderBenachrichtigung = req.body.melderBenachrichtigung === '1' ? 1 : 0;

      const kontaktTeile = [];
      if (melderHandy && melderHandy.trim()) kontaktTeile.push(melderHandy.trim());
      if (melderMail   && melderMail.trim())  kontaktTeile.push(melderMail.trim());
      const melderKontakt = kontaktTeile.join(' / ');

      const errors = [];
      if (!melderName)         errors.push('Name des Melders ist erforderlich.');
      if (!fahrzeug)           errors.push('Bitte ein Fahrzeug auswählen.');
      if (!schwere)            errors.push('Bitte einen Schweregrad auswählen.');
      if (!fehlerBeschreibung) errors.push('Fehlerbeschreibung ist erforderlich.');
      if (!melderHandy && !melderMail) errors.push('Bitte Handy oder E-Mail angeben.');
      if (errors.length) {
        // FIX: Uploads löschen wenn Validierung fehlschlägt
        cleanupUploads(req.files);
        return renderNeu(res, errors, old, req.session.user);
      }

      const attachments = (req.files || []).map(f => ({
        filename: f.filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size,
      }));

      const storung = await db.createStorung({
        fahrzeug, schwere, fehlerBeschreibung,
        beschreibung: beschreibung || '',
        createdBy: req.session.user.username,
        melderName: melderName || '',
        melderKontakt,
        melderBenachrichtigung,
        attachments,
      });

      mailer.sendStorungMail(storung).catch(err => console.error('[Route] sendStorungMail:', err.message));
      mailer.sendMelderBestaetigung(storung).catch(err => console.error('[Route] sendMelderBestaetigung:', err.message));

      res.redirect('/');
    } catch (err) {
      // FIX: Uploads löschen wenn DB-Insert fehlschlägt
      cleanupUploads(req.files);
      console.error('[Neu]', err);
      renderNeu(res, ['Speichern fehlgeschlagen. Bitte erneut versuchen.'], old, req.session.user);
    }
  }
);

// ── Störung-Detail ──────────────────────────────────────────────────────────────────────────────────
router.get('/stoerung/:id', requireLogin, async (req, res) => {
  try {
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).render('error', { title: '404', message: 'Störung nicht gefunden.' });
    res.render('stoerung-detail', { storung, user: req.session.user });
  } catch (err) {
    console.error('[Detail]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Störung konnte nicht geladen werden.' });
  }
});

// ── Status ändern (nur Admin) ────────────────────────────────────────────────────────────────────
router.post('/stoerung/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const { status, notiz } = req.body;
    const allowed = ['gesendet', 'bestaetigt', 'erledigt', 'zurueckgewiesen'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });

    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'Nicht gefunden.' });

    const updated = await db.updateStatus(storung.id, status, req.session.user.username, notiz || null);

    mailer.sendStatusMail(updated, req.session.user.username, notiz || null)
      .catch(err => console.error('[Route] sendStatusMail:', err.message));

    res.json({ ok: true, newStatus: status });
  } catch (err) {
    console.error('[Status]', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ── Störung löschen (nur Admin) ──────────────────────────────────────────────────────────────────
router.post('/stoerung/:id/loeschen', requireRole('admin'), async (req, res) => {
  try {
    const { grund } = req.body;
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'Nicht gefunden.' });
    mailer.sendDeleteMail(storung, req.session.user.username, grund || 'Kein Grund angegeben')
      .catch(err => console.error('[Route] sendDeleteMail:', err.message));
    await db.deleteStorung(storung.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Löschen]', err);
    res.status(500).json({ error: 'Löschen fehlgeschlagen.' });
  }
});

// ── Such-API ──────────────────────────────────────────────────────────────────────────────────────
router.get('/api/suche', requireLogin, async (req, res) => {
  try {
    const { fahrzeug, monat, status } = req.query;
    if (!fahrzeug) return res.status(400).json({ error: 'Fahrzeug fehlt.' });
    const statusList = status
      ? status.split(',').filter(s => ['gesendet','bestaetigt','erledigt','zurueckgewiesen'].includes(s))
      : ['gesendet','bestaetigt','erledigt'];
    const rows = await db.searchByFahrzeugMonat(fahrzeug, monat || null, statusList);
    res.json(rows);
  } catch (err) {
    console.error('[API Suche]', err);
    res.status(500).json({ error: 'Fehler.' });
  }
});

// ── Ähnliche Fehler API ───────────────────────────────────────────────────────────────────────────
router.get('/api/similar', requireLogin, async (req, res) => {
  try {
    const { q, fahrzeug, includeErledigt } = req.query;
    if (!q || q.length < 3) return res.json([]);
    const rows = await db.searchSimilarFehler(q, fahrzeug || null, includeErledigt === '1');
    res.json(rows.map(r => ({ id: r.id, fehler: r.fehlerBeschreibung, status: r.status })));
  } catch (err) {
    console.error('[API Similar]', err);
    res.status(500).json({ error: 'Fehler.' });
  }
});

module.exports = router;
