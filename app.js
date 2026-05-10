'use strict';
require('dotenv').config();

const { initDb }  = require('./src/database');
const expressApp  = require('./src/app');

// Plesk setzt die PORT-Variable automatisch, kein Fallback/Wrapper nötig
const PORT = parseInt(process.env.PORT, 10);

if (!PORT) {
  console.error('[FATAL] Keine PORT-Variable gesetzt. Bitte Plesk-Node.js-Integration verwenden.');
  process.exit(1);
}

initDb()
  .then(() => {
    expressApp.listen(PORT, '127.0.0.1', () => {
      console.log('[OK] Feuerwehr Stoerungsmelder laeuft auf Port ' + PORT + ' (Plesk)');
    });
  })
  .catch(err => {
    console.error('[FATAL] DB-Initialisierung fehlgeschlagen:', err.message);
    process.exit(1);
  });
