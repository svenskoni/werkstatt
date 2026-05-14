'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../src/database');
const mailer   = require('../src/mailer');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Multer ──────────────────────────────────────────────────────────────────
const MAX_MB  = parseInt(process.env.MAX_UPLOAD_MB || '8', 10);
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime',
]);
const ALLOWED_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.mp4','.mov']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTS.has(ext) ? ext : '';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.has(file.mimetype) && ALLOWED_EXTS.has(ext)) cb(null, true);
    else cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
});

function checkMagicBytesServer(filePath, mime) {
  try {
    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    if (mime === 'image/jpeg')  return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    if (mime === 'image/png')   return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    if (mime === 'image/gif')   return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
    if (mime === 'image/webp') {
      const riff = buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46;
      const webp = buf[8]===0x57 && buf[9]===0x45 && buf[10]===0x42 && buf[11]===0x50;
      return riff && webp;
    }
    if (mime === 'video/mp4' || mime === 'video/quicktime')
      return buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
    return false;
  } catch { return false; }
}

function deleteUploadedFiles(files) {
  if (!files || !files.length) return;
  for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
}

function renderNeu(res, errors, old, user) {
  res.status(errors.length ? 400 : 200).render('stoerung-neu', { errors: errors || [], old: old || {}, user });
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
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

// ── Neue Störung ──────────────────────────────────────────────────────────────────────
router.get('/stoerung/neu', requireLogin, (req, res) => {
  renderNeu(res, [], {}, req.session.user);
});

router.post('/stoerung/neu', requireLogin, (req, res, next) => {
  upload.array('attachments', 6)(req, res, err => {
    if (err) {
      deleteUploadedFiles(req.files);
      if (err.code === 'LIMIT_FILE_SIZE')       return renderNeu(res, [`Eine oder mehrere Dateien überschreiten das Limit von ${MAX_MB} MB.`], req.body || {}, req.session.user);
      if (err.code === 'LIMIT_FILE_COUNT')      return renderNeu(res, ['Maximal 6 Dateien erlaubt.'], req.body || {}, req.session.user);
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return renderNeu(res, ['Ungültiger Dateityp. Nur JPG, PNG, GIF, WebP, MP4 und MOV erlaubt.'], req.body || {}, req.session.user);
      console.error('[Upload] Multer-Fehler:', err.message);
      return renderNeu(res, ['Fehler beim Hochladen. Bitte erneut versuchen.'], req.body || {}, req.session.user);
    }
    next();
  });
}, async (req, res) => {
  const old = req.body || {};
  try {
    const { fahrzeug, schwere, fehlerBeschreibung, beschreibung, melderName, melderHandy, melderMail } = req.body;
    const kontaktTeile = [];
    if (melderHandy && melderHandy.trim()) kontaktTeile.push(melderHandy.trim());
    if (melderMail   && melderMail.trim())  kontaktTeile.push(melderMail.trim());
    const melderKontakt = kontaktTeile.join(' / ');

    const errors = [];
    if (!melderName || melderName.trim().length < 3) errors.push('Name des Melders ist erforderlich (mind. 3 Zeichen).');
    if (!fahrzeug)           errors.push('Bitte ein Fahrzeug auswählen.');
    if (!schwere)            errors.push('Bitte einen Schweregrad auswählen.');
    if (!fehlerBeschreibung || fehlerBeschreibung.trim().length < 6) errors.push('Fehlerbeschreibung ist erforderlich (mind. 6 Zeichen).');
    if (!melderHandy && !melderMail) errors.push('Bitte Handy oder E-Mail angeben.');

    const uploadedFiles = req.files || [];
    const invalidFiles  = [];
    for (const f of uploadedFiles) {
      if (!checkMagicBytesServer(f.path, f.mimetype)) {
        invalidFiles.push(f.originalname);
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
    }
    if (invalidFiles.length)
      errors.push(`Folgende Dateien wurden abgelehnt (Inhalt stimmt nicht mit Dateityp überein): ${invalidFiles.join(', ')}`);

    if (errors.length) {
      deleteUploadedFiles(uploadedFiles.filter(f => !invalidFiles.includes(f.originalname)));
      return renderNeu(res, errors, old, req.session.user);
    }

    const attachments = uploadedFiles
      .filter(f => !invalidFiles.includes(f.originalname))
      .map(f => ({ filename: f.filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size }));

    const storung = await db.createStorung({
      fahrzeug, schwere, fehlerBeschreibung,
      beschreibung: beschreibung || '',
      createdBy: req.session.user.username,
      melderName: melderName.trim(),
      melderKontakt,
      melderBenachrichtigung: 0,
      attachments,
    });
    mailer.sendStorungMail(storung).catch(err => console.error('[Route] sendStorungMail:', err.message));
    res.redirect('/');
  } catch (err) {
    console.error('[Neu]', err);
    deleteUploadedFiles(req.files);
    renderNeu(res, ['Speichern fehlgeschlagen. Bitte erneut versuchen.'], old, req.session.user);
  }
});

// ── Störung-Detail ────────────────────────────────────────────────────────────────────────
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

// ── Status ändern (nur Admin) ──────────────────────────────────────────────────────────────────
router.post('/stoerung/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const { status, notiz, neuSchwere } = req.body;
    const allowed = ['gesendet', 'bestaetigt', 'erledigt', 'zurueckgewiesen'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'Nicht gefunden.' });
    const validSchwere = ['klein', 'normal', 'schwer', 'totalausfall'];
    const geprüfteSchwere = neuSchwere && validSchwere.includes(neuSchwere) ? neuSchwere : null;
    await db.updateStatus(storung.id, status, req.session.user.username, notiz || null, geprüfteSchwere);
    res.json({ ok: true, newStatus: status });
  } catch (err) {
    console.error('[Status]', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ── Störung löschen (nur Admin) ──────────────────────────────────────────────────────────────────────
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

// ── Such-API ──────────────────────────────────────────────────────────────────
router.get('/api/suche', requireLogin, async (req, res) => {
  try {
    const { fahrzeug, monat, status, ticketId, q } = req.query;
    if (!fahrzeug) return res.status(400).json({ error: 'Fahrzeug fehlt.' });
    const statusList = status
      ? status.split(',').filter(s => ['gesendet','bestaetigt','erledigt','zurueckgewiesen'].includes(s))
      : ['gesendet','bestaetigt','erledigt'];
    const rows = await db.searchByFahrzeugMonat(fahrzeug, monat || null, statusList, ticketId || null, q || null);
    res.json(rows.map(r => ({
      id: r.id, fahrzeug: r.fahrzeug, fehlerBeschreibung: r.fehlerBeschreibung,
      schwere: r.schwere, status: r.status, createdAt: r.createdAt,
    })));
  } catch (err) {
    console.error('[API Suche]', err);
    res.status(500).json({ error: 'Fehler.' });
  }
});

// ── Ähnliche Fehler API ───────────────────────────────────────────────────────
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
