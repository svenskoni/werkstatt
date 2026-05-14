'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../src/database');
const { verifyAdmin, verifyCrewPassword, requireRole } = require('../middleware/auth');

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { tab: 'crew', error: null });
});

// POST /login  (Melder)
router.post('/login/crew', async (req, res) => {
  const { password } = req.body;
  const user = await verifyCrewPassword(password);
  if (!user) {
    return res.render('login', { tab: 'crew', error: 'Passwort falsch.' });
  }
  req.session.user = user;
  const returnTo = req.session.returnTo || '/';
  delete req.session.returnTo;
  res.redirect(returnTo);
});

// POST /login  (Admin)
router.post('/login/admin', async (req, res) => {
  const { username, password } = req.body;
  const user = await verifyAdmin(username, password);
  if (!user) {
    return res.render('login', { tab: 'admin', error: 'Benutzername oder Passwort falsch.' });
  }
  req.session.user = user;
  const returnTo = req.session.returnTo || '/';
  delete req.session.returnTo;
  res.redirect(returnTo);
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Urlaub / Abwesenheit ────────────────────────────────────────────────────────

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
