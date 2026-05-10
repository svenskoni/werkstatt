'use strict';
require('dotenv').config();

const { initDb }  = require('./src/database');
const expressApp  = require('./src/app');

// Plesk / Phusion Passenger: Port-Wert ist egal, wichtig ist nur, DASS listen() aufgerufen wird.
// Wenn Plesk eine PORT-Variable setzt, nutzen wir sie, sonst Standard 3000.
const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    expressApp.listen(PORT, () => {
      console.log('[OK] Feuerwehr Stoerungsmelder laeuft (Port ' + PORT + ', Plesk/Passenger)');
    });
  })
  .catch(err => {
    console.error('[FATAL] DB-Initialisierung fehlgeschlagen:', err.message);
    process.exit(1);
  });
