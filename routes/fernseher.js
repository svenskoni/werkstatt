'use strict';
const express = require('express');
const db      = require('../src/database');

const router = express.Router();

/**
 * GET /:token
 * Zeigt das Fernseher-Dashboard – kein Login erforderlich.
 * Nur aktiv wenn FERNSEHER_TOKEN gesetzt ist und mit dem URL-Segment übereinstimmt.
 * Auto-Refresh alle 60 Sekunden.
 */
router.get('/:token', async (req, res, next) => {
  const token = process.env.FERNSEHER_TOKEN;

  // Deaktiviert oder falsches Token → 404 (kein Hinweis dass diese Route existiert)
  if (!token || !token.trim() || req.params.token !== token.trim()) {
    return next();
  }

  try {
    const VEHICLES = (process.env.VEHICLES || '').split(',').map(v => v.trim()).filter(Boolean);
    const SCHWERE = {
      klein:        { label: 'Klein',        icon: '\uD83D\uDFE2' },
      normal:       { label: 'Normal',       icon: '\uD83D\uDFE1' },
      totalausfall: { label: 'Totalausfall', icon: '\uD83D\uDD34' },
    };

    const [gesendet, bestaetigt] = await Promise.all([
      db.getByStatus('gesendet'),
      db.getByStatus('bestaetigt'),
    ]);

    // Pro Fahrzeug: offene + aktive Tickets zusammenstellen
    const fahrzeugDaten = VEHICLES.map(fz => ({
      name: fz,
      offen:   gesendet.filter(t => t.fahrzeug === fz),
      aktiv:   bestaetigt.filter(t => t.fahrzeug === fz),
    }));

    // Gesamt-Zähler für Header
    const anzahlOffen = gesendet.length;
    const anzahlAktiv = bestaetigt.length;

    res.render('fernseher', {
      layout:        false,   // eigenes vollbild-Layout, kein normaler Header
      fahrzeugDaten,
      VEHICLES,
      SCHWERE,
      anzahlOffen,
      anzahlAktiv,
    });
  } catch (err) {
    console.error('[Fernseher]', err);
    res.status(500).send('Fehler beim Laden des Fernseher-Dashboards.');
  }
});

module.exports = router;
