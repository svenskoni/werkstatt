'use strict';
const express = require('express');
const db      = require('../src/database');

const router = express.Router();

const SCHWERE = {
  klein:        { label: 'Klein',        icon: '\uD83D\uDFE2' },
  normal:       { label: 'Normal',       icon: '\uD83D\uDFE1' },
  totalausfall: { label: 'Totalausfall', icon: '\uD83D\uDD34' },
};

/**
 * Gemeinsame Daten-Logik – wird von HTML-Route und JSON-Route genutzt.
 */
async function buildDaten() {
  const VEHICLES = (process.env.VEHICLES || '').split(',').map(v => v.trim()).filter(Boolean);
  const [gesendet, bestaetigt] = await Promise.all([
    db.getByStatusSlim('gesendet'),
    db.getByStatusSlim('bestaetigt'),
  ]);
  const fahrzeugDaten = VEHICLES.map(fz => ({
    name: fz,
    offen: gesendet.filter(t => t.fahrzeug === fz),
    aktiv:  bestaetigt.filter(t => t.fahrzeug === fz),
  }));
  return { fahrzeugDaten, VEHICLES, anzahlOffen: gesendet.length, anzahlAktiv: bestaetigt.length };
}

/**
 * Token-Prüfung als Mini-Middleware.
 */
function checkToken(req, res, next) {
  const token = process.env.FERNSEHER_TOKEN;
  if (!token || !token.trim() || req.params.token !== token.trim()) return next('route');
  next();
}

/**
 * GET /view/:token
 * Zeigt das Fernseher-Dashboard – kein Login erforderlich.
 */
router.get('/:token', checkToken, async (req, res, next) => {
  try {
    const daten = await buildDaten();
    res.render('fernseher', { layout: false, SCHWERE, ...daten });
  } catch (err) {
    console.error('[Fernseher]', err);
    res.status(500).send('Fehler beim Laden des Fernseher-Dashboards.');
  }
});

/**
 * GET /view/:token/daten
 * JSON-Endpunkt für den clientseitigen fetch-Refresh.
 * Gleicher Token-Schutz, kein Login nötig.
 */
router.get('/:token/daten', checkToken, async (req, res, next) => {
  try {
    const daten = await buildDaten();
    res.json({ ok: true, SCHWERE, ...daten });
  } catch (err) {
    console.error('[Fernseher/daten]', err);
    res.status(500).json({ ok: false, error: 'Datenbankfehler' });
  }
});

module.exports = router;
