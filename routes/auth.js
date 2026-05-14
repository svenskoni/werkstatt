'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../src/database');

const ADMINS = (() => {
  try {
    const raw = process.env.ADMIN_USERS || '';
    return Object.fromEntries(
      raw.split(',').map(e => {
        const [u, p] = e.trim().split(':');
        return [u && u.trim(), p && p.trim()];
      }).filter(([u, p]) => u && p)
    );
  } catch { return {}; }
})();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (ADMINS[username] && ADMINS[username] === password) {
    req.session.user = { username };
    return res.redirect('/');
  }
  res.render('login', { error: 'Benutzername oder Passwort falsch.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Urlaub / Abwesenheit ────────────────────────────────────────────────────────

/** GET /api/urlaub/status – eigener Abwesenheitsstatus */
router.get('/api/urlaub/status', requireAuth, async (req, res) => {
  try {
    const eintrag = await db.getAdminUrlaub(req.session.user.username);
    res.json({ abwesend: !!eintrag, abwesend_bis: eintrag ? eintrag.abwesend_bis : null });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden des Urlaubs-Status.' });
  }
});

/** POST /api/urlaub/setzen – Abwesenheit setzen oder löschen */
router.post('/api/urlaub/setzen', requireAuth, async (req, res) => {
  try {
    const { abwesend_bis } = req.body;
    const username = req.session.user.username;

    if (!abwesend_bis) {
      // Abwesenheit aufheben
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
module.exports.requireAuth = requireAuth;
