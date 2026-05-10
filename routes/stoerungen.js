'use strict';
const express        = require('express');
const multer         = require('multer');
const path           = require('path');
const { v4: uuidv4 } = require('uuid');
const sanitizeHtml   = require('sanitize-html');
const db             = require('../src/database');   // async SQLite
const mailer         = require('../src/mailer');
const { requireLogin, requireRole, optionalLogin } = require('../middleware/auth');

const router = express.Router();

// --- Upload-Konfiguration ------------------------------------------------
const MAX_MB     = parseInt(process.env.MAX_UPLOAD_MB || '8', 10);
const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp',
  'video/mp4','video/quicktime','video/x-msvideo','video/webm',
]);

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads'),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    cb(null, uuidv4() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
});

const VEHICLES = (process.env.VEHICLES || 'LF10,HLF20,TLF3000,DLA23,ELW1,MTF')
  .split(',').map(v => v.trim());

function sanitize(str) {
  return sanitizeHtml(String(str || ''), { allowedTags: [], allowedAttributes: {} }).trim();
}

// ========================================================================
// GET / – Dashboard
// ========================================================================
router.get('/', optionalLogin, async (req, res, next) => {
  try {
    const [gesendet, bestaetigt, erledigt] = await Promise.all([
      db.getByStatus('gesendet'),
      db.getByStatus('bestaetigt'),
      db.getByStatus('erledigt'),
    ]);
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
  } catch (err) { next(err); }
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
router.post('/stoerung/neu', requireRole('user', 'admin'),
  upload.array('attachments', 6),
  async (req, res, next) => {
    try {
      const { fahrzeug, schwere, fehlerBeschreibung, beschreibung, melderName, melderHandy, melderMail } = req.body;
      const errors = [];

      if (!melderName || melderName.trim().length < 3)
        errors.push('Name des Melders ist erforderlich (mind. 3 Zeichen).');
      if ((!melderHandy || melderHandy.trim().length < 5) && (!melderMail || melderMail.trim().length < 5))
        errors.push('Handy oder E‑Mail muss ausgefüllt sein.');

      if (!VEHICLES.includes(fahrzeug))
        errors.push('Ungültiges Fahrzeug.');
      if (!['klein','normal','schwer','totalausfall'].includes(schwere))
        errors.push('Ungültiger Schweregrad.');
      if (!fehlerBeschreibung || fehlerBeschreibung.trim().length < 3)
        errors.push('Fehlerbeschreibung zu kurz (mind. 3 Zeichen).');

      if (errors.length > 0) {
        return res.status(400).render('stoerung-neu', {
          VEHICLES, errors,
          old: { fahrzeug, schwere, fehlerBeschreibung, beschreibung, melderName, melderHandy, melderMail },
        });
      }

      let melderKontakt = '';
      if (melderHandy && melderHandy.trim()) melderKontakt += 'Handy: ' + melderHandy.trim();
      if (melderMail && melderMail.trim()) {
        if (melderKontakt) melderKontakt += ' | ';
        melderKontakt += 'Mail: ' + melderMail.trim();
      }

      const storung = await db.createStorung({
        id:                 uuidv4(),
        fahrzeug:           sanitize(fahrzeug),
        schwere:            sanitize(schwere),
        fehlerBeschreibung: sanitize(fehlerBeschreibung),
        beschreibung:       sanitize(beschreibung),
        createdBy:          req.session.user.username,
        melderName:         sanitize(melderName),
        melderKontakt:      sanitize(melderKontakt),
        attachments:        (req.files || []).map(f => ({
          filename:     f.filename,
          originalname: f.originalname,
          mimetype:     f.mimetype,
          size:         f.size,
        })),
      });

      mailer.sendStorungMail(storung).catch(err =>
        console.error('[Mailer] Fehler:', err.message));

      res.redirect('/?success=created');
    } catch (err) { next(err); }
  }
);

// ========================================================================
// GET /stoerung/:id – Detail
// ========================================================================
router.get('/stoerung/:id', optionalLogin, async (req, res, next) => {
  try {
    const storung = await db.getStorungById(req.params.id);
    if (!storung) {
      return res.status(404).render('error', {
        title: '404 – Nicht gefunden',
        message: 'Diese Störung existiert nicht.',
      });
    }
    const SCHWERE = {
      klein:        { label: 'Klein',        icon: '\uD83D\uDFE2' },
      normal:       { label: 'Normal',       icon: '\uD83D\uDFE1' },
      schwer:       { label: 'Schwer',       icon: '\uD83D\uDFE0' },
      totalausfall: { label: 'Totalausfall', icon: '\uD83D\uDD34' },
    };
    res.render('stoerung-detail', { storung, SCHWERE });
  } catch (err) { next(err); }
});

// ========================================================================
// POST /status/:id – Status ändern (Admin)
// ========================================================================
router.post('/status/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { newStatus, note } = req.body;
    const allowed = ['gesendet', 'bestaetigt', 'erledigt'];

    if (!allowed.includes(newStatus)) {
      return res.status(400).json({ error: 'Ungültiger Status.' });
    }

    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'Nicht gefunden.' });

    const updated = await db.updateStatus(
      req.params.id, newStatus, req.session.user.username, note);

    mailer.sendStatusMail(updated, req.session.user.username)
      .catch(err => console.error('[Mailer] Status-Mail Fehler:', err.message));

    if (req.accepts('json')) return res.json({ ok: true });
    res.redirect('/?success=updated');
  } catch (err) { next(err); }
});

// ========================================================================
// GET /api/similar – Ähnliche Fehler (Autovervollständigung)
// ========================================================================
router.get('/api/similar', requireRole('user', 'admin'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const results = await db.searchSimilarFehler(q);
    res.json(results.map(s => ({
      id:       s.id,
      fahrzeug: s.fahrzeug,
      fehler:   s.fehlerBeschreibung,
      schwere:  s.schwere,
    })));
  } catch (err) { next(err); }
});

module.exports = router;
