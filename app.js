// Plesk Passenger Einstiegspunkt
// Passenger erwartet diese Datei im Anwendungsstamm
'use strict';
require('dotenv').config();

const { initDb } = require('./src/database');
const app = require('./src/app');

let ready = false;

initDb()
  .then(() => { ready = true; console.log('[OK] DB initialisiert'); })
  .catch(err => { console.error('[FATAL] DB Fehler:', err); process.exit(1); });

module.exports = app;
