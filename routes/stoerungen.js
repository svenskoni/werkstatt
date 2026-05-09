'use strict';
const express       = require('express');
const multer        = require('multer');
const path          = require('path');
const { v4: uuidv4 } = require('uuid');
const sanitizeHtml  = require('sanitize-html');
const db            = require('../src/datastore');
const mailer        = require('../src/mailer');
const { requireLogin, requireRole, optionalLogin } = require('../middleware/auth');

const router = express.Router();

// --- Upload-Konfiguration -----------------------------------------------
const MAX_MB  = parseInt(process.env.MAX_UPLOAD_MB || '8', 10);
const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp',
  'video/mp4','video/quicktime','video/x-msvideo','video/webm'
]);

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads'),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const safe = uuidv4() + ext;
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  }
});

const VEHICLES = (process.env.VEHICLES || 'LF10,HLF20,TLF3000,DLA23,ELW1,MTF').split(',').map(v => v.trim());

function sanitize(str) {
  return sanitizeHtml(String(str || ''), { allowedTags: [], allowedAttributes: {} }).trim();
}

// ========================================================================
// GET / – Dashboard
// ========================================================================
router.get('/', optionalLogin, (req, res) => {
  const gesendet   = db.getByStatus('gesendet');
  const bestaetigt = db.getByStatus('bestaetigt');
  const erledigt   = db.getByStatus('erledigt');

  res.render('dashboard', {
    gesendet, bestaetigt, erledigt,
    stats: {
      total:    gesendet.length + bestaetigt.length + erledigt.length,
      offen:    gesendet.length,
      aktiv:    bestaetigt.length,
      erledigt: erledigt.length,
    },
    VEHICLES,
  });
});

// ========================================================================
// GET /stoerung/neu – Formular
// ========================================================================
router.get('/stoerung/neu', requireRole('user', 'admin'), (req, res) => {
  res.render('stoerung-neu', { VEHICLES, errors: null, old: {} });
});

// ========================================================================
// POST /stoerung/neu – Speichern
// ========================================================================
router.post('/stoerung/neu', requireRole('user', 'admin'), upload.array('attachments', 6), (req, res) => {
  const { fahrzeug, schwere, fehlerBeschreibung, beschreibung } = req.body;
  const errors = [];

  if (!VEHICLES.includes(fahrzeug)) errors.push('Ungültiges Fahrzeug.');
  if (!['klein','normal','schwer','totalausfall'].includes(schwere)) errors.push('Ungültiger Schweregrad.');
  if (!fehlerBeschreibung || fehlerBeschreibung.trim().length < 3) errors.push('Fehlerbeschreibung zu kurz (mind. 3 Zeichen).');

  if (errors.length > 0) {
    return res.status(400).render('stoerung-neu', {
      VEHICLES, errors,
      old: { fahrzeug, schwere, fehlerBeschreibung, beschreibung }
    });
  }

  const storung = db.createStorung({
    id:               uuidv4(),
    fahrzeug:         sanitize(fahrzeug),
    schwere:          sanitize(schwere),
    fehlerBeschreibung: sanitize(fehlerBeschreibung),
    beschreibung:     sanitize(beschreibung),
    createdBy:        req.session.user.username,
    attachments:      (req.files || []).map(f => ({
      filename:     f.filename,
      originalname: f.originalname,
      mimetype:     f.mimetype,
      size:         f.size,
    }))
  });

  // E-Mail asynchron versenden
  mailer.sendStorungMail(storung).catch(err => console.error('[Mailer] Fehler:', err.message));

  res.redirect('/?success=created');
});

// ========================================================================
// GET /stoerung/:id – Detail
// ========================================================================
router.get('/stoerung/:id', optionalLogin, (req, res) => {
  const storung = db.getStorungById(req.params.id);
  if (!storung) {
    return res.status(404).render('error', {
      title: '404 – Nicht gefunden',
      message: 'Diese Störung existiert nicht.'
    });
  }
  const SCHWERE = {
    klein:       { label: 'Klein',        icon: '🟢' },
    normal:      { label: 'Normal',       icon: '🟡' },
    schwer:      { label: 'Schwer',       icon: '🟠' },
    totalausfall:{ label: 'Totalausfall', icon: '🔴' },
  };
  res.render('stoerung-detail', { storung, SCHWERE });
});

// ========================================================================
// POST /status/:id – Status ändern (Admin)
// ========================================================================
router.post('/status/:id', requireRole('admin'), express.json(), (req, res) => {
  const { newStatus, note } = req.body;
  const allowed = ['gesendet','bestaetigt','erledigt'];

  if (!allowed.includes(newStatus)) {
    return res.status(400).json({ error: 'Ungültiger Status.' });
  }

  const storung = db.getStorungById(req.params.id);
  if (!storung) return res.status(404).json({ error: 'Nicht gefunden.' });

  db.updateStatus(req.params.id, newStatus, req.session.user.username, note);

  // Status-Mail asynchron
  const updated = db.getStorungById(req.params.id);
  mailer.sendStatusMail(updated, req.session.user.username)
    .catch(err => console.error('[Mailer] Status-Mail Fehler:', err.message));

  if (req.accepts('json')) return res.json({ ok: true });
  res.redirect('/?success=updated');
});

// API: ähnliche Fehler suchen (Autovervollständigung)
router.get('/api/similar', requireRole('user', 'admin'), (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const results = db.searchSimilarFehler(q);
  res.json(results.map(s => ({ id: s.id, fahrzeug: s.fahrzeug, fehler: s.fehlerBeschreibung, schwere: s.schwere })));
});

module.exports = router;
