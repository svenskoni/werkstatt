'use strict';
const bcrypt = require('bcryptjs');

/**
 * Admins: ADMIN_1_NAME / ADMIN_1_PASS_HASH
 *         ADMIN_2_NAME / ADMIN_2_PASS_HASH  … beliebig viele
 * Mannschaft: CREW_PASS_HASH  (kein Name nötig)
 */
function getAdmins() {
  const admins = [];
  let i = 1;
  while (true) {
    const name = process.env[`ADMIN_${i}_NAME`];
    const hash = process.env[`ADMIN_${i}_PASS_HASH`];
    if (!name || !hash) break;
    admins.push({ username: name.trim(), passHash: hash, role: 'admin' });
    i++;
  }
  // Rückwärtskompatibilität: alter USER_ADMIN_NAME
  const legacyName = process.env.USER_ADMIN_NAME;
  const legacyHash = process.env.USER_ADMIN_PASS_HASH;
  if (legacyName && legacyHash && !admins.find(a => a.username.toLowerCase() === legacyName.toLowerCase())) {
    admins.push({ username: legacyName.trim(), passHash: legacyHash, role: 'admin' });
  }
  return admins;
}

/** Login für Admins: Name + Passwort */
async function verifyAdmin(username, password) {
  const admins = getAdmins();
  const admin  = admins.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!admin) return null;
  const ok = await bcrypt.compare(password, admin.passHash);
  if (!ok) return null;
  return { username: admin.username, role: 'admin' };
}

/** Login für Mannschaft: nur Passwort */
async function verifyCrewPassword(password) {
  const hash = process.env.CREW_PASS_HASH;
  if (!hash) return null;
  const ok = await bcrypt.compare(password, hash);
  if (!ok) return null;
  return { username: 'Mannschaft', role: 'crew' };
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

module.exports = { verifyAdmin, verifyCrewPassword, requireLogin, requireRole, optionalLogin };
