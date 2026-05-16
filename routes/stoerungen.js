'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../src/database');
const mailer   = require('../src/mailer');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Multer ────────────────────────────────────────────────────────────────────────────────────
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
    if (ALLOWED_MIMES.has(file.mimetype) && ALLOWED_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
  }
});

function checkMagicBytesServer(filePath, mime) {
  try {
    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    if (mime === 'image/jpeg')
      return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    if (mime === 'image/png')
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    if (mime === 'image/gif')
      return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
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

// ── Dashboard ──────────────────────────────────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res) => {
  try {
    const [gesendet, bestaetigt, totalErl, totalZur] = await Promise.all([
      db.getByStatus('gesendet'),
      db.getByStatus('bestaetigt'),
      db.countByStatus('erledigt'),
      db.countByStatus('zurueckgewiesen'),
    ]);

    const stats = {
      total:    gesendet.length + bestaetigt.length + totalErl + totalZur,
      offen:    gesendet.length,
      aktiv:    bestaetigt.length,
      erledigt: totalErl + totalZur,
    };

    res.render('dashboard', {
      gesendet,
      bestaetigt,
      // Erledigt-Spalte wird client-seitig per API befüllt
      erledigt: [],
      zurueckgewiesen: [],
      stats,
      user: req.session.user,
    });
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'Dashboard konnte nicht geladen werden.' });
  }
});

// ── API: Erledigt-Spalte (lazy, max 10, mit Schnellfilter) ────────────────────────────────
// GET /api/dashboard/erledigt?fahrzeug=FRE1&klasse=kfz
router.get('/api/dashboard/erledigt', requireLogin, async (req, res) => {
  try {
    const LIMIT = 10;
    const validKlasse = ['kfz', 'geraet'];
    const fahrzeug = req.query.fahrzeug && req.query.fahrzeug.trim() ? req.query.fahrzeug.trim() : null;
    const klasse   = req.query.klasse   && validKlasse.includes(req.query.klasse) ? req.query.klasse : null;

    const opts = { limit: LIMIT, fahrzeug, klasse };
    const [erledigt, zurueck] = await Promise.all([
      db.getByStatusSlim('erledigt',        opts),
      db.getByStatusSlim('zurueckgewiesen', opts),
    ]);

    // Zusammenführen, nach Datum sortieren, auf LIMIT begrenzen
    const combined = [...erledigt, ...zurueck]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
      .slice(0, LIMIT);

    const user = req.session.user;
    const html = combined.map(s => {
      const wrap = s.status === 'zurueckgewiesen'
        ? `<div style="margin-bottom:var(--space-1)"><span style="display:inline-block;font-size:var(--text-xs);font-weight:600;padding:2px 8px;border-radius:var(--radius-full);background:var(--color-primary-highlight);color:var(--color-primary);letter-spacing:0.02em">\u2715 Ticket zur\u00fcckgewiesen</span></div>`
        : '';
      const isAdmin  = user && user.role === 'admin';
      const schwereMap = { klein: '\uD83D\uDFE2 Klein', normal: '\uD83D\uDFE1 Normal', totalausfall: '\uD83D\uDD34 Totalausfall' };
      const klasseMap  = { kfz: 'KFZ', geraet: 'Ger\u00e4t' };
      const dateStr = (iso) => {
        const d = new Date(iso);
        return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' })
          + ' ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Berlin' });
      };
      // Wiederöffnen: KEIN data-mit-schwere / data-mit-klasse — nur Notizfeld
      const reopenBtn = isAdmin ? `
        <button class="btn btn-xs btn-ghost status-change-btn"
          data-id="${s.id}"
          data-target="gesendet"
          data-title="Wieder\u00f6ffnen"
          data-desc="Status wird auf \u00bbEingegangen\u00ab zur\u00fcckgesetzt."
          data-label="Wieder\u00f6ffnen">
          \u21b5 Wieder\u00f6ffnen
        </button>` : '';
      return `
        <div class="kanban-card-wrap" data-fahrzeug="${s.fahrzeug}" data-klasse="${s.klasse || 'kfz'}">
          ${wrap}
          <article class="stoerung-card card-${s.status}" role="article">
            <div class="card-top">
              <span class="card-fahrzeug">${s.fahrzeug}</span>
              <div style="display:flex;gap:var(--space-1);align-items:center">
                <span class="klasse-chip">${klasseMap[s.klasse] || s.klasse || 'KFZ'}</span>
                <span class="schwere-badge schwere-${s.schwere}">${schwereMap[s.schwere] || s.schwere}</span>
              </div>
            </div>
            <p class="card-fehler">${s.fehlerBeschreibung}</p>
            <div class="card-bottom">
              <span class="card-meta">${s.melderName}</span>
              <span class="card-meta">&middot;</span>
              <span class="card-meta">${dateStr(s.createdAt)}</span>
            </div>
            <div class="card-actions">
              <a href="/stoerung/${s.id}" class="btn btn-ghost btn-xs">Details</a>
              ${reopenBtn}
            </div>
          </article>
        </div>`;
    }).join('');

    res.json({ html, total: combined.length });
  } catch (err) {
    console.error('[API Erledigt]', err);
    res.status(500).json({ error: 'Fehler beim Laden.' });
  }
});

// ── Neue Störung ──────────────────────────────────────────────────────────────────────────────────────────
router.get('/stoerung/neu', requireLogin, (req, res) => {
  renderNeu(res, [], {}, req.session.user);
});

router.post('/stoerung/neu', requireLogin, (req, res, next) => {
  upload.array('attachments', 6)(req, res, err => {
    if (err) {
      deleteUploadedFiles(req.files);
      if (err.code === 'LIMIT_FILE_SIZE')
        return renderNeu(res, [`Eine oder mehrere Dateien \u00fcberschreiten das Limit von ${MAX_MB} MB.`], req.body || {}, req.session.user);
      if (err.code === 'LIMIT_FILE_COUNT')
        return renderNeu(res, ['Maximal 6 Dateien erlaubt.'], req.body || {}, req.session.user);
      if (err.code === 'LIMIT_UNEXPECTED_FILE')
        return renderNeu(res, ['Ung\u00fcltiger Dateityp. Nur JPG, PNG, GIF, WebP, MP4 und MOV erlaubt.'], req.body || {}, req.session.user);
      console.error('[Upload] Multer-Fehler:', err.message);
      return renderNeu(res, ['Fehler beim Hochladen. Bitte erneut versuchen.'], req.body || {}, req.session.user);
    }
    next();
  });
}, async (req, res) => {
  const old = req.body || {};
  try {
    const { fahrzeug, klasse, schwere, fehlerBeschreibung, beschreibung, melderName, melderHandy, melderMail } = req.body;
    const melderBenachrichtigung = req.body.melderBenachrichtigung === '1' ? 1 : 0;
    const kontaktTeile = [];
    if (melderHandy && melderHandy.trim()) kontaktTeile.push(melderHandy.trim());
    if (melderMail   && melderMail.trim())  kontaktTeile.push(melderMail.trim());
    const melderKontakt = kontaktTeile.join(' / ');

    const validKlasse = ['kfz', 'geraet'];
    const safeKlasse  = validKlasse.includes(klasse) ? klasse : null;

    const errors = [];
    if (!melderName || melderName.trim().length < 3) errors.push('Name des Melders ist erforderlich (mind. 3 Zeichen).');
    if (!fahrzeug)          errors.push('Bitte ein Fahrzeug ausw\u00e4hlen.');
    if (!safeKlasse)        errors.push('Bitte eine Klasse w\u00e4hlen: KFZ oder Ger\u00e4t.');
    if (!schwere)           errors.push('Bitte einen Schweregrad ausw\u00e4hlen.');
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
      errors.push(`Folgende Dateien wurden abgelehnt (Inhalt stimmt nicht mit Dateityp \u00fcberein): ${invalidFiles.join(', ')}`);

    if (errors.length) {
      deleteUploadedFiles(uploadedFiles.filter(f => !invalidFiles.includes(f.originalname)));
      return renderNeu(res, errors, old, req.session.user);
    }

    const attachments = uploadedFiles
      .filter(f => !invalidFiles.includes(f.originalname))
      .map(f => ({ filename: f.filename, originalname: f.originalname, mimetype: f.mimetype, size: f.size }));

    const storung = await db.createStorung({
      fahrzeug, klasse: safeKlasse, schwere, fehlerBeschreibung,
      beschreibung: beschreibung || '',
      createdBy: req.session.user.username,
      melderName: melderName.trim(),
      melderKontakt,
      melderBenachrichtigung,
      attachments,
    });

    const abwesende = await db.getAbwesendeAdmins();
    const abwesendeUsernames = abwesende.map(a => a.username);
    mailer.sendStorungMail(storung, abwesendeUsernames).catch(err => console.error('[Route] sendStorungMail:', err.message));
    mailer.sendMelderBestaetigung(storung).catch(err => console.error('[Route] sendMelderBestaetigung:', err.message));
    res.redirect('/');
  } catch (err) {
    console.error('[Neu]', err);
    deleteUploadedFiles(req.files);
    renderNeu(res, ['Speichern fehlgeschlagen. Bitte erneut versuchen.'], old, req.session.user);
  }
});

// ── Störung-Detail ────────────────────────────────────────────────────────────────────────────────────────
router.get('/stoerung/:id', requireLogin, async (req, res) => {
  try {
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).render('error', { title: '404', message: 'St\u00f6rung nicht gefunden.' });
    res.render('stoerung-detail', { storung, user: req.session.user });
  } catch (err) {
    console.error('[Detail]', err);
    res.status(500).render('error', { title: 'Fehler', message: 'St\u00f6rung konnte nicht geladen werden.' });
  }
});

// ── Status ändern (nur Admin) ────────────────────────────────────────────────────────────────────────────────────────
router.post('/stoerung/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const { status, notiz, neuSchwere, neuKlasse } = req.body;
    const allowed = ['gesendet', 'bestaetigt', 'erledigt', 'zurueckgewiesen'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Ung\u00fcltiger Status.' });
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'Nicht gefunden.' });
    const validSchwere = ['klein', 'normal', 'totalausfall'];
    const geprüfteSchwere = neuSchwere && validSchwere.includes(neuSchwere) ? neuSchwere : null;
    const validKlasse = ['kfz', 'geraet'];
    const geprüfteKlasse = neuKlasse && validKlasse.includes(neuKlasse) ? neuKlasse : null;
    const updated = await db.updateStatus(storung.id, status, req.session.user.username, notiz || null, geprüfteSchwere, geprüfteKlasse);
    mailer.sendStatusMail(updated, req.session.user.username, notiz || null)
      .catch(err => console.error('[Route] sendStatusMail:', err.message));
    res.json({ ok: true, newStatus: status });
  } catch (err) {
    console.error('[Status]', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ── Info-Notiz hinzufügen (nur Admin) ─────────────────────────────────────────────────────────────────────────
router.post('/stoerung/:id/notiz', requireRole('admin'), async (req, res) => {
  try {
    const { notiz } = req.body;
    if (!notiz || !notiz.trim()) return res.status(400).json({ error: 'Notiz darf nicht leer sein.' });
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'St\u00f6rung nicht gefunden.' });
    await db.addHistoryNote(storung.id, req.session.user.username, notiz.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error('[Notiz]', err);
    res.status(500).json({ error: 'Notiz konnte nicht gespeichert werden.' });
  }
});

// ── Erinnerung setzen/löschen (nur Admin) ────────────────────────────────────────────────────────────────────────
router.post('/stoerung/:id/reminder', requireRole('admin'), async (req, res) => {
  try {
    const { reminderAt, reminderTo } = req.body;
    const storung = await db.getStorungById(req.params.id);
    if (!storung) return res.status(404).json({ error: 'St\u00f6rung nicht gefunden.' });

    if (!reminderAt || !reminderAt.trim()) {
      await db.setReminder(storung.id, null, null);
      return res.json({ ok: true });
    }

    const parsed = new Date(reminderAt);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Ung\u00fcltiges Datum.' });
    }

    if (parsed.getTime() < Date.now() - 60 * 1000) {
      return res.status(400).json({ error: 'Erinnerungszeitpunkt liegt in der Vergangenheit.' });
    }

    const safeAt = parsed.toISOString();
    const safeTo = reminderTo && reminderTo.trim() ? reminderTo.trim() : null;
    await db.setReminder(storung.id, safeAt, safeTo);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Reminder]', err);
    res.status(500).json({ error: 'Erinnerung konnte nicht gespeichert werden.' });
  }
});

// ── Störung löschen (nur Admin) ──────────────────────────────────────────────────────────────────────────────────────────
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

// ── Such-API ─────────────────────────────────────────────────────────────────────────────────────────────
router.get('/api/suche', requireLogin, async (req, res) => {
  try {
    const { fahrzeug, monat, status, ticketId, q, klasse } = req.query;
    if (!fahrzeug) return res.status(400).json({ error: 'Fahrzeug fehlt.' });
    const statusList = status
      ? status.split(',').filter(s => ['gesendet','bestaetigt','erledigt','zurueckgewiesen'].includes(s))
      : ['gesendet','bestaetigt','erledigt'];
    const validKlasse = ['kfz', 'geraet'];
    const klasseFilter = klasse && validKlasse.includes(klasse) ? klasse : null;
    const rows = await db.searchByFahrzeugMonat(
      fahrzeug, monat || null, statusList, ticketId || null, q || null
    );
    const filtered = klasseFilter
      ? rows.filter(r => (r.klasse || 'kfz') === klasseFilter)
      : rows;
    res.json(filtered.map(r => ({
      id: r.id, fahrzeug: r.fahrzeug, klasse: r.klasse || 'kfz',
      fehlerBeschreibung: r.fehlerBeschreibung,
      schwere: r.schwere, status: r.status, createdAt: r.createdAt,
    })));
  } catch (err) {
    console.error('[API Suche]', err);
    res.status(500).json({ error: 'Fehler.' });
  }
});

// ── Ähnliche Fehler API ─────────────────────────────────────────────────────────────────────────────────────────
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
