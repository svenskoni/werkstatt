'use strict';
const express    = require('express');
const bcrypt     = require('bcryptjs');
const router     = express.Router();

// Nutzer aus .env laden
function getUsers() {
  return [
    {
      username: 'viewer',
      passwordHash: process.env.VIEWER_PASSWORD_HASH || '',
      role: 'view',
      displayName: process.env.VIEWER_DISPLAY || 'Betrachter',
    },
    {
      username: 'benutzer',
      passwordHash: process.env.USER_PASSWORD_HASH || '',
      role: 'user',
      displayName: process.env.USER_DISPLAY || 'Benutzer',
    },
    {
      username: 'admin',
      passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
      role: 'admin',
      displayName: process.env.ADMIN_DISPLAY || 'Administrator',
    },
  ];
}

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

// POST /login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = getUsers();
    const user  = users.find(u => u.username === (username || '').trim().toLowerCase());

    if (!user || !user.passwordHash) {
      return res.status(401).render('login', { error: 'Benutzername oder Passwort falsch.' });
    }

    const valid = await bcrypt.compare(password || '', user.passwordHash);
    if (!valid) {
      return res.status(401).render('login', { error: 'Benutzername oder Passwort falsch.' });
    }

    // Session regenerieren (Session-Fixation-Schutz)
    req.session.regenerate(err => {
      if (err) return res.status(500).render('login', { error: 'Session-Fehler.' });
      req.session.user = {
        username:    user.username,
        role:        user.role,
        displayName: user.displayName,
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
