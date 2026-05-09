'use strict';
const bcrypt = require('bcryptjs');

function getUsers() {
  return [
    {
      username: process.env.USER_VIEW_NAME  || 'viewer',
      passHash: process.env.USER_VIEW_PASS_HASH,
      role: 'view'
    },
    {
      username: process.env.USER_USER_NAME  || 'benutzer',
      passHash: process.env.USER_USER_PASS_HASH,
      role: 'user'
    },
    {
      username: process.env.USER_ADMIN_NAME || 'admin',
      passHash: process.env.USER_ADMIN_PASS_HASH,
      role: 'admin'
    },
  ].filter(u => u.passHash);
}

async function verifyUser(username, password) {
  const users = getUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !user.passHash) return null;
  const ok = await bcrypt.compare(password, user.passHash);
  if (!ok) return null;
  return { username: user.username, role: user.role };
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: '403 – Zugriff verweigert',
        message: 'Sie haben keine Berechtigung für diese Aktion.'
      });
    }
    next();
  };
}

function optionalLogin(req, res, next) {
  next();
}

module.exports = { verifyUser, requireLogin, requireRole, optionalLogin };
