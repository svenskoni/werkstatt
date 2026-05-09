// Plesk Phusion Passenger Einstiegspunkt
// WICHTIG: Passenger ruft diese Datei auf und verwaltet den HTTP-Server selbst.
// Kein app.listen() hier - Passenger macht das intern!
'use strict';
require('dotenv').config();

const { initDb } = require('./src/database');
const application = require('./src/app');

// Datenbank beim ersten Request initialisieren (Passenger-kompatibel)
let dbReady = false;
const originalHandler = application;

const wrappedApp = async (req, res, next) => {
  if (!dbReady) {
    try {
      await initDb();
      dbReady = true;
    } catch (err) {
      console.error('[FATAL] DB init fehlgeschlagen:', err);
      res.status(500).send('Datenbankfehler beim Start');
      return;
    }
  }
  return originalHandler(req, res, next);
};

// Express-App als Passenger-Modul exportieren
module.exports = application;

// DB sofort initialisieren (non-blocking)
initDb()
  .then(() => { dbReady = true; console.log('[OK] Datenbank bereit'); })
  .catch(err => console.error('[ERROR] DB init:', err));
