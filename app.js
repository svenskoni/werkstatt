// Phusion Passenger Einstiegspunkt fuer Plesk
// Passenger importiert diese Datei als Modul - KEIN app.listen() hier!
'use strict';
require('dotenv').config();

const { initDb } = require('./src/database');
const app = require('./src/app');

// Datenbank initialisieren (async, non-blocking)
initDb()
  .then(() => console.log('[OK] Datenbank initialisiert'))
  .catch(err => {
    console.error('[FATAL] Datenbank-Initialisierung fehlgeschlagen:', err.message);
    // Nicht process.exit() - Passenger wuerde die App beenden
  });

// Passenger erwartet module.exports = express-app
module.exports = app;
