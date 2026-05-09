// Plesk Phusion Passenger - kompatibler Einstiegspunkt
// Unterstuetzt beide Modi: Passenger (module.exports) UND direkter Start
'use strict';
require('dotenv').config();

const { initDb } = require('./src/database');
const expressApp = require('./src/app');
const http = require('http');

const PORT = parseInt(process.env.PORT || '3000', 10);

// Pruefe ob Passenger diese Datei als Modul laedt
if (typeof PhusionPassenger !== 'undefined') {
  // Passenger-Modus: auf 'passenger' lauschen
  PhusionPassenger.configure({ autoInstall: false });
  initDb()
    .then(() => {
      expressApp.listen('passenger', () =>
        console.log('[OK] Passenger-Modus gestartet'));
    })
    .catch(err => console.error('[FATAL] DB:', err.message));
} else {
  // Direkter Start (npm start)
  initDb()
    .then(() => {
      expressApp.listen(PORT, '0.0.0.0', () =>
        console.log(`[OK] Server auf Port ${PORT}`));
    })
    .catch(err => { console.error('[FATAL] DB:', err.message); process.exit(1); });
}

module.exports = expressApp;
