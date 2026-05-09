'use strict';
const express        = require('express');
const session        = require('express-session');
const ejsLayouts     = require('express-ejs-layouts');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const path           = require('path');
const fs             = require('fs');

const authRouter      = require('../routes/auth');
const stoerungRouter  = require('../routes/stoerungen');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// --- Sicherheits-Header (Helmet) ----------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'",
                   'https://fonts.googleapis.com',
                   'https://api.fontshare.com'],
      fontSrc:    ["'self'",
                   'https://fonts.gstatic.com',
                   'https://api.fontshare.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc:  ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'same-origin' },
}));

// --- Globales Rate-Limit ------------------------------------------------
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Zu viele Anfragen – bitte später erneut versuchen.'
}));

// --- View Engine --------------------------------------------------------
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');
app.use(ejsLayouts);
app.set('layout', 'layout');

// --- Static / Upload Verzeichnisse ---------------------------------------
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Body Parser --------------------------------------------------------
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// --- Session ------------------------------------------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-please-change',
  resave: false,
  saveUninitialized: false,
  name: 'fw_sid',
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 Stunden
  }
}));

// --- Globale Template-Variablen -----------------------------------------
app.use((req, res, next) => {
  res.locals.user    = req.session.user || null;
  res.locals.path    = req.path;
  res.locals.SCHWERE = {
    klein:       { label: 'Klein',        icon: '🟢', order: 1 },
    normal:      { label: 'Normal',       icon: '🟡', order: 2 },
    schwer:      { label: 'Schwer',       icon: '🟠', order: 3 },
    totalausfall:{ label: 'Totalausfall', icon: '🔴', order: 4 },
  };
  next();
});

// --- Routen -------------------------------------------------------------
app.use('/',         authRouter);
app.use('/',         stoerungRouter);

// --- 404 ----------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 – Seite nicht gefunden',
    message: 'Die angeforderte Seite existiert nicht.'
  });
});

// --- Fehlerbehandlung ---------------------------------------------------
app.use((err, req, res, _next) => {
  console.error('[Error]', err);
  const status = err.status || 500;
  res.status(status).render('error', {
    title: status + ' – Fehler',
    message: isProd ? 'Ein interner Fehler ist aufgetreten.' : err.message
  });
});

module.exports = app;
