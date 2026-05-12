'use strict';
const express  = require('express');
const path     = require('path');
const multer   = require('multer');
const db       = require('../src/database');
const mailer   = require('../src/mailer');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Multer ──────────────────────────────────────────────────────────────────
const MAX_MB  = parseInt(process.env.MAX_UPLOAD_MB || '8', 10);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
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

router.post('/stoerung/neu', requireLogin, upload.array('attachments', 6), async (req, res) => {
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
    if (!fahrzeug)           errors.push('Bitte ein Fahrzeug ausw\u00e4hlen.');
    if (!schwere)            errors.push('Bitte einen Schweregrad ausw\u00e4hlen.');
    if (!fehlerBeschreibung) errors.push('Fehlerbeschreibung ist erforderlich.');
    if (!melderHandy && !melderMail) errors.push('Bitte Handy oder E-Mail angeben.');
    if (errors.length) return renderNeu(res, errors, old, req.session.user);
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
    console.error('[Neu]', err);
    renderNeu(res, ['Speichern fehlgeschlagen. Bitte erneut versuchen.'], old, req.session.user);
  }
});

// ── Störung-Detail ────────────────────────────────────────────────────────────────────────
router.get('/stoerung/:id', requireLogin, async (req, res) => {
  try {
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).render('error', { title: '404', message: 'St\u00f6rung nicht gefunden.' });
    // Admin-Mail-Map f\u00fcr Reminder-Dropdown mitgeben
    const adminMailMap = req.session.user && req.session.user.role === 'admin' ? mailer.getAdminMailMap() : {};
    res.render('stoerung-detail', { storung, user: req.session.user, adminMailMap });
  } catch (err) {
    console.error('[Detail]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'St\u00f6rung konnte nicht geladen werden.' });
  }
});

// ── Status ändern (nur Admin) ──────────────────────────────────────────────────────────────────
router.post('/stoerung/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const { status, notiz, neuSchwere } = req.body;
    const allowed = ['gesendet', 'bestaetigt', 'erledigt', 'zurueckgewiesen'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Ung\u00fcltiger Status.' });
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'Nicht gefunden.' });
    const validSchwere = ['klein', 'normal', 'schwer', 'totalausfall'];
    const gepr\u00fcfteSchwere = neuSchwere && validSchwere.includes(neuSchwere) ? neuSchwere : null;
    const updated = await db.updateStatus(storung.id, status, req.session.user.username, notiz || null, gepr\u00fcfteSchwere);
    mailer.sendStatusMail(updated, req.session.user.username, notiz || null)
      .catch(err => console.error('[Route] sendStatusMail:', err.message));
    res.json({ ok: true, newStatus: status });
  } catch (err) {
    console.error('[Status]', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ── Erinnerung setzen (nur Admin) ───────────────────────────────────────────────────────────────
router.post('/stoerung/:id/reminder', requireRole('admin'), async (req, res) => {
  try {
    const { reminderAt, reminderTo } = req.body;
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'Nicht gefunden.' });

    if (!reminderAt) {
      // Erinnerung l\u00f6schen
      await db.clearReminder(storung.id);
      return res.json({ ok: true, cleared: true });
    }

    // reminderAt ist lokale Datumszeit des Admins (datetime-local = "2026-05-15T14:30")
    // Wir speichern als ISO-String (UTC).
    const dt = new Date(reminderAt);
    if (isNaN(dt.getTime())) return res.status(400).json({ error: 'Ung\u00fcltiges Datum.' });
    if (dt <= new Date()) return res.status(400).json({ error: 'Datum muss in der Zukunft liegen.' });

    // reminderTo: entweder direkt eine Mail-Adresse oder ein Username aus ADMIN_MAILS
    const to = reminderTo && reminderTo.includes('@')
      ? reminderTo.trim()
      : (mailer.resolveAdminMail(reminderTo) || mailer.resolveAdminMail(req.session.user.username));

    if (!to) return res.status(400).json({ error: 'Keine g\u00fcltige Admin-E-Mail gefunden. Bitte ADMIN_MAILS in der .env konfigurieren.' });

    await db.setReminder(storung.id, dt.toISOString(), to);
    res.json({
      ok: true,
      reminderAt: dt.toISOString(),
      reminderTo: to,
      localTime: dt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
    });
  } catch (err) {
    console.error('[Reminder]', err);
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
    console.error('[L\u00f6schen]', err);
    res.status(500).json({ error: 'L\u00f6schen fehlgeschlagen.' });
  }
});

// ── Such-API ─────────────────────────────────────────────────────────────────────────
router.get('/api/suche', requireLogin, async (req, res) => {
  try {
    const { fahrzeug, monat, status } = req.query;
    if (!fahrzeug) return res.status(400).json({ error: 'Fahrzeug fehlt.' });
    const statusList = status
      ? status.split(',').filter(s => ['gesendet','bestaetigt','erledigt','zurueckgewiesen'].includes(s))
      : ['gesendet','bestaetigt','erledigt'];
    const rows = await db.searchByFahrzeugMonat(fahrzeug, monat || null, statusList);
    res.json(rows.map(r => ({
      id: r.id, fahrzeug: r.fahrzeug, fehlerBeschreibung: r.fehlerBeschreibung,
      schwere: r.schwere, status: r.status, createdAt: r.createdAt,
    })));
  } catch (err) {
    console.error('[API Suche]', err);
    res.status(500).json({ error: 'Fehler.' });
  }
});

// ── Ähnliche Fehler API ───────────────────────────────────────────────────────────────────────
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
