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
const db             = require('./database');
const cleanup        = require('./cleanup');

// Pflicht-Variablen prüfen
const REQUIRED_ENV = [
  'NODE_ENV', 'SESSION_SECRET', 'APP_BASE_URL',
  'VEHICLES',
  'MAX_UPLOAD_MB', 'MAX_UPLOAD_DIR_MB', 'COMPRESS_AFTER_DAYS',
  'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURE',
  'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM', 'MAIL_RECIPIENTS',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('[Config] Fehlende Umgebungsvariablen:', missing.join(', '));
  process.exit(1);
}

const VEHICLES = process.env.VEHICLES.split(',').map(v => v.trim());

const SCHWERE = {
  klein:        { label: 'Klein',        icon: '🟢' },
  normal:       { label: 'Normal',       icon: '🟡' },
  schwer:       { label: 'Schwer',       icon: '🟠' },
  totalausfall: { label: 'Totalausfall', icon: '🔴' },
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
    }
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 63072000, includeSubDomains: true, preload: true }
    : false
}));

// FIX #15: /login Rate-Limit VOR globalem Limit registrieren
// sonst greift nur der globale Limit (200/15min) und der /login-Limit (15/15min) wirkt nicht
app.use('/login', rateLimit({ windowMs: 15*60*1000, max: 15, standardHeaders: true, legacyHeaders: false }));
app.use(rateLimit({ windowMs: 15*60*1000, max: 200, standardHeaders: true, legacyHeaders: false }));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  name:              'fw.sid',
  // FIX #4: secure nicht allein an NODE_ENV koppeln – explizite Env-Var als Override
  cookie: {
    httpOnly: true,
    secure:   process.env.COOKIE_SECURE !== 'false',  // default: true (sicher)
    sameSite: 'lax',
    maxAge:   8 * 60 * 60 * 1000
  }
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

app.use('/', authRoutes);
app.use('/', stoerungRoutes);

app.use((req, res) => res.status(404).render('error', { title: '404 – Nicht gefunden', message: 'Die Seite existiert nicht.' }));
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).render('error', {
    title: `${err.status || 500} – Fehler`,
    message: process.env.NODE_ENV === 'production' ? 'Ein interner Fehler ist aufgetreten.' : err.message,
  });
});

// FIX #12: DB erst initialisieren, dann Server starten
// app.js exportiert die App – server.js wartet auf initDb() bevor listen()
db.initDb()
  .then(() => cleanup.scheduleDaily())
  .catch(err => { console.error('[Init] DB-Fehler:', err); process.exit(1); });

module.exports = app;
