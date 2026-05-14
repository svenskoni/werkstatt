'use strict';
const express        = require('express');
const session        = require('express-session');
const ejsLayouts     = require('express-ejs-layouts');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const path           = require('path');
const fs             = require('fs');

const authRoutes     = require('../routes/auth');
const stoerungRoutes = require('../routes/stoerungen');
const uploadsRoute   = require('../routes/uploads');
const db             = require('./database');
const cleanup        = require('./cleanup');
const reminder       = require('./reminder');
const { requireLogin, requireRole } = require('../middleware/auth');

// Pflicht-Variablen prüfen
const REQUIRED_ENV = [
  'NODE_ENV', 'SESSION_SECRET', 'APP_BASE_URL',
  'VEHICLES',
  'MAX_UPLOAD_MB', 'MAX_UPLOAD_DIR_MB', 'COMPRESS_AFTER_DAYS',
  'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURE',
  'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM',
  'ADMIN_ESCALATION',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('[Config] Fehlende Umgebungsvariablen:', missing.join(', '));
  process.exit(1);
}

const VEHICLES = process.env.VEHICLES.split(',').map(v => v.trim());

// Issue #13: 'schwer' entfernt – nur noch klein / normal / totalausfall
const SCHWERE = {
  klein:        { label: 'Klein',        icon: '\ud83d\udfe2' },
  normal:       { label: 'Normal',       icon: '\ud83d\udfe1' },
  totalausfall: { label: 'Totalausfall', icon: '\ud83d\udd34' },
};

const app = express();

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      fontSrc:     ["'self'"],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
      mediaSrc:    ["'self'"],
    }
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 63072000, includeSubDomains: true, preload: true }
    : false
}));

app.use(rateLimit({ windowMs: 15*60*1000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use('/login', rateLimit({ windowMs: 15*60*1000, max: 15, standardHeaders: true, legacyHeaders: false }));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => { res.set('Cache-Control', 'public, max-age=3600'); }
}));

app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  name:              'fw.sid',
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8*60*60*1000 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');

app.use((req, res, next) => {
  res.locals.user        = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.path        = req.path;
  res.locals.VEHICLES    = VEHICLES;
  res.locals.SCHWERE     = SCHWERE;
  next();
});

// ── Urlaub / Abwesenheit API ──────────────────────────────────────────────────

/** GET /api/urlaub/status – eigenen Abwesenheitsstatus abfragen */
app.get('/api/urlaub/status', requireLogin, async (req, res) => {
  try {
    const eintrag = await db.getAdminUrlaub(req.session.user.username);
    if (eintrag) {
      res.json({ abwesend: true, abwesend_bis: eintrag.abwesend_bis });
    } else {
      res.json({ abwesend: false });
    }
  } catch (err) {
    console.error('[Urlaub] status FEHLER:', err.message);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

/** POST /api/urlaub/setzen – Abwesenheit setzen oder aufheben */
app.post('/api/urlaub/setzen', requireLogin, async (req, res) => {
  try {
    const { abwesend_bis } = req.body;
    if (abwesend_bis) {
      const dt = new Date(abwesend_bis);
      if (isNaN(dt.getTime())) return res.status(400).json({ error: 'Ungültiges Datum.' });
      if (dt <= new Date()) return res.status(400).json({ error: 'Datum muss in der Zukunft liegen.' });
      await db.setAdminUrlaub(req.session.user.username, dt.toISOString());
      console.log(`[Urlaub] ${req.session.user.username} abwesend bis ${dt.toISOString()}`);
      res.json({ ok: true, abwesend_bis: dt.toISOString() });
    } else {
      await db.setAdminUrlaub(req.session.user.username, null);
      console.log(`[Urlaub] ${req.session.user.username} Abwesenheit aufgehoben`);
      res.json({ ok: true, abwesend_bis: null });
    }
  } catch (err) {
    console.error('[Urlaub] setzen FEHLER:', err.message);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ── Routen ────────────────────────────────────────────────────────────────────
app.use('/', authRoutes);
app.use('/', uploadsRoute);
app.use('/', stoerungRoutes);

app.use((req, res) => res.status(404).render('error', { title: '404 \u2013 Nicht gefunden', message: 'Die Seite existiert nicht.' }));
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).render('error', {
    title: `${err.status || 500} \u2013 Fehler`,
    message: process.env.NODE_ENV === 'production' ? 'Ein interner Fehler ist aufgetreten.' : err.message,
  });
});

db.initDb()
  .then(() => {
    cleanup.scheduleDaily();
    reminder.start();
  })
  .catch(err => { console.error('[Init] DB-Fehler:', err); process.exit(1); });

module.exports = app;
