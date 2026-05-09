'use strict';
const express        = require('express');
const session        = require('express-session');
const ejsLayouts     = require('express-ejs-layouts');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const path           = require('path');
const fs             = require('fs');

const authRoutes      = require('../routes/auth');
const stoerungRoutes  = require('../routes/stoerungen');

const app = express();

// ── Upload-Verzeichnis sicherstellen ──────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// ── Sicherheits-Header ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'unpkg.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdn.jsdelivr.net'],
      fontSrc:    ["'self'", 'fonts.gstatic.com', 'api.fontshare.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
    }
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 63072000, includeSubDomains: true, preload: true }
    : false
}));

// ── Rate Limiting ─────────────────────────────────────────────────────────
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false }));

// ── Body-Parser & statische Dateien ──────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Session ───────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'bitte-in-env-aendern-' + Math.random(),
  resave:            false,
  saveUninitialized: false,
  name:              'fw.sid',
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   8 * 60 * 60 * 1000  // 8 Stunden
  }
}));

// ── Template Engine ───────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');

// ── Globale Template-Variablen ────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.user        = req.session.user || null;
  res.locals.currentPath = req.path;
  next();
});

// ── Routen ────────────────────────────────────────────────────────────────
app.use('/',        authRoutes);
app.use('/',        stoerungRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { title: '404 – Nicht gefunden', message: 'Die angeforderte Seite existiert nicht.' });
});

// ── Fehler-Handler ────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err);
  const status = err.status || 500;
  res.status(status).render('error', {
    title:   `${status} – Serverfehler`,
    message: process.env.NODE_ENV === 'production' ? 'Ein interner Fehler ist aufgetreten.' : err.message
  });
});

module.exports = app;
