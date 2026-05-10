'use strict';
const express = require('express');
const { verifyUser } = require('../middleware/auth');

const router = express.Router();

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

// POST /login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await verifyUser((username || '').trim(), password || '');

    if (!user) {
      return res.status(401).render('login', { error: 'Benutzername oder Passwort falsch.' });
    }

    // Session regenerieren (Session-Fixation-Schutz)
    req.session.regenerate(err => {
      if (err) {
        console.error('[Login] Session-Fehler:', err);
        return res.status(500).render('login', { error: 'Session-Fehler.' });
      }
      req.session.user = {
        username: user.username,
        role:     user.role,
      };
      res.redirect('/');
    });
  } catch (err) {
    console.error('[Login] Fehler:', err);
    res.status(500).render('login', { error: 'Interner Fehler beim Login.' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
