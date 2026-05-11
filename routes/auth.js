'use strict';
const express = require('express');
const { verifyAdmin, verifyCrewPassword } = require('../middleware/auth');

const router = express.Router();

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, tab: 'crew' });
});

// POST /login  –  type=crew|admin
router.post('/login', async (req, res) => {
  try {
    const type     = (req.body.type || 'crew').trim();
    const password = (req.body.password || '').trim();
    const username = (req.body.username || '').trim();

    let user = null;

    if (type === 'admin') {
      user = await verifyAdmin(username, password);
    } else {
      user = await verifyCrewPassword(password);
    }

    if (!user) {
      return res.status(401).render('login', {
        error: type === 'admin'
          ? 'Name oder Passwort falsch.'
          : 'Passwort falsch.',
        tab: type
      });
    }

    req.session.regenerate(err => {
      if (err) {
        console.error('[Login] Session-Fehler:', err);
        return res.status(500).render('login', { error: 'Session-Fehler.', tab: type });
      }
      req.session.user = { username: user.username, role: user.role };
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    console.error('[Login] Fehler:', err);
    res.status(500).render('login', { error: 'Interner Fehler.', tab: 'crew' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
