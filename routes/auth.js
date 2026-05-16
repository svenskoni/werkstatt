'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../src/database');
const { verifyAdmin, verifyCrewPassword, requireRole } = require('../middleware/auth');

// ── Brute-Force-Schutz ─────────────────────────────────────────────────────────────────
//
// Strategie: Pro IP-Adresse werden Fehlversuche gezählt.
// Nach MAX_ATTEMPTS wird die IP für LOCKOUT_MS gesperrt.
// Zusätzlich wird bei Admin-Logins auch der Username gezählt
// (verhindert gezieltes Erraten eines bekannten Nutzernamens).
//
// Konfiguration (kann später in .env ausgelagert werden):
const MAX_ATTEMPTS  = 5;           // Fehlversuche bis Sperre
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 Minuten Sperre
const ATTEMPT_TTL   = 15 * 60 * 1000; // Fenster in dem Versuche gezählt werden

// { key -> { count, firstAt, lockedUntil } }
const _attempts = new Map();

// Automatisch abgelaufene Einträge aufräumen (alle 5 Minuten)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _attempts) {
    if (now > (v.lockedUntil || 0) && now - v.firstAt > ATTEMPT_TTL) {
      _attempts.delete(k);
    }
  }
}, 5 * 60 * 1000).unref();

function getEntry(key) {
  const now = Date.now();
  let e = _attempts.get(key);
  if (!e || now - e.firstAt > ATTEMPT_TTL) {
    e = { count: 0, firstAt: now, lockedUntil: 0 };
    _attempts.set(key, e);
  }
  return e;
}

/** Gibt null zurück wenn ok, sonst verbleibende Sperrzeit in Sekunden. */
function checkLocked(key) {
  const e = _attempts.get(key);
  if (!e) return null;
  if (e.lockedUntil && Date.now() < e.lockedUntil) {
    return Math.ceil((e.lockedUntil - Date.now()) / 1000);
  }
  return null;
}

function recordFailure(key) {
  const e = getEntry(key);
  e.count++;
  if (e.count >= MAX_ATTEMPTS) {
    e.lockedUntil = Date.now() + LOCKOUT_MS;
    console.warn(`[Auth] Login-Sperre für "${key}" (${e.count} Fehlversuche).`);
  }
}

function recordSuccess(key) {
  _attempts.delete(key);
}

/** Gibt die Client-IP zurück (Proxy-aware via x-forwarded-for). */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? xff.split(',')[0] : req.ip || 'unknown').trim();
}

// ── Routen ──────────────────────────────────────────────────────────────────────

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { tab: 'crew', error: null, locked: false, retryAfter: 0 });
});

// POST /login  – type=crew oder type=admin (Hidden-Feld im Formular)
router.post('/login', async (req, res) => {
  const { type, username, password } = req.body;
  const ip = clientIp(req);

  // Schlüssel: IP immer, bei Admin zusätzlich Username
  const ipKey   = `ip:${ip}`;
  const userKey = type === 'admin' && username ? `user:${String(username).toLowerCase().trim()}` : null;

  // ─ Sperre prüfen ────────────────────────────────────────────────
  const ipWait   = checkLocked(ipKey);
  const userWait = userKey ? checkLocked(userKey) : null;
  const waitSec  = Math.max(ipWait || 0, userWait || 0);

  if (waitSec > 0) {
    const minRest = Math.ceil(waitSec / 60);
    const tab = type === 'admin' ? 'admin' : 'crew';
    return res.status(429).render('login', {
      tab,
      error: `Zu viele Fehlversuche. Bitte ${minRest} Minute${minRest !== 1 ? 'n' : ''} warten.`,
      locked: true,
      retryAfter: waitSec,
    });
  }

  // ─ Crew-Login ─────────────────────────────────────────────────
  if (type === 'crew') {
    const user = await verifyCrewPassword(password);
    if (!user) {
      recordFailure(ipKey);
      return res.render('login', { tab: 'crew', error: 'Passwort falsch.', locked: false, retryAfter: 0 });
    }
    recordSuccess(ipKey);
    req.session.user = user;
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    return res.redirect(returnTo);
  }

  // ─ Admin-Login ─────────────────────────────────────────────────
  if (type === 'admin') {
    const user = await verifyAdmin(username, password);
    if (!user) {
      recordFailure(ipKey);
      if (userKey) recordFailure(userKey);
      return res.render('login', { tab: 'admin', error: 'Benutzername oder Passwort falsch.', locked: false, retryAfter: 0 });
    }
    recordSuccess(ipKey);
    if (userKey) recordSuccess(userKey);
    req.session.user = user;
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    return res.redirect(returnTo);
  }

  // Unbekannter type
  res.render('login', { tab: 'crew', error: 'Ungültige Anfrage.', locked: false, retryAfter: 0 });
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Urlaub / Abwesenheit ───────────────────────────────────────────

/** GET /api/urlaub/status – eigener Abwesenheitsstatus */
router.get('/api/urlaub/status', requireRole('admin'), async (req, res) => {
  try {
    const eintrag = await db.getAdminUrlaub(req.session.user.username);
    res.json({ abwesend: !!eintrag, abwesend_bis: eintrag ? eintrag.abwesend_bis : null });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden des Urlaubs-Status.' });
  }
});

/** POST /api/urlaub/setzen – Abwesenheit setzen oder löschen */
router.post('/api/urlaub/setzen', requireRole('admin'), async (req, res) => {
  try {
    const { abwesend_bis } = req.body;
    const username = req.session.user.username;

    if (!abwesend_bis) {
      await db.setAdminUrlaub(username, null);
      return res.json({ ok: true, abwesend: false });
    }

    const datum = new Date(abwesend_bis);
    if (isNaN(datum.getTime()) || datum <= new Date()) {
      return res.status(400).json({ error: 'Datum muss in der Zukunft liegen.' });
    }

    await db.setAdminUrlaub(username, datum.toISOString());
    res.json({ ok: true, abwesend: true, abwesend_bis: datum.toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Speichern.' });
  }
});

module.exports = router;
