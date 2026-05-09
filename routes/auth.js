'use strict';
const express    = require('express');
const rateLimit  = require('express-rate-limit');
const { verifyUser } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Zu viele Login-Versuche. Bitte in 15 Minuten erneut versuchen.'
});

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

// POST /login
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).render('login', { error: 'Bitte Benutzername und Passwort eingeben.' });
  }

  const user = await verifyUser(String(username).trim(), String(password));
  if (!user) {
    // Kurze Verzögerung gegen Timing-Angriffe
    await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
    return res.status(401).render('login', { error: 'Benutzername oder Passwort falsch.' });
  }

  // Session regenerieren (Session Fixation verhindern)
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('error', { title: 'Fehler', message: 'Login fehlgeschlagen.' });
    req.session.user = user;
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
  });
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('fw_sid');
    res.redirect('/');
  });
});

module.exports = router;
