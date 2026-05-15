'use strict';
const express        = require('express');
const session        = require('express-session');
const ejsLayouts     = require('express-ejs-layouts');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const path           = require('path');
const fs             = require('fs');

const authRoutes       = require('../routes/auth');
const stoerungRoutes   = require('../routes/stoerungen');
const uploadsRoute     = require('../routes/uploads');
const fernseherRoute   = require('../routes/fernseher');
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
  'ADMIN_1_NAME', 'ADMIN_1_PASS_HASH',  // mind. ein Admin muss konfiguriert sein
  'CREW_PASS_HASH',                      // Melder-Passwort
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

// ── Routen ─────────────────────────────────────────────────────────────────────────────
// Fernseher-Route VOR den Auth-Routen registrieren (kein Login nötig, eigenes layout:false)
app.use('/', fernseherRoute);

app.use('/', authRoutes);      // inkl. /login, /logout, /api/urlaub/*
app.use('/', uploadsRoute);
app.use('/', stoerungRoutes);

app.use((req, res) => res.status(404).render('error', { title: '404 – Nicht gefunden', message: 'Die Seite existiert nicht.' }));
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).render('error', {
    title: `${err.status || 500} – Fehler`,
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
