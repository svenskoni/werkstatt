'use strict';
require('dotenv').config();

const { initDb }  = require('./src/database');
const expressApp  = require('./src/app');

const PORT = parseInt(process.env.PORT || '3000', 10);

initDb()
  .then(() => {
    expressApp.listen(PORT, '127.0.0.1', () => {
      console.log('[OK] Feuerwehr Stoerungsmelder laeuft auf Port ' + PORT);
    });
  })
  .catch(err => {
    console.error('[FATAL] DB-Initialisierung fehlgeschlagen:', err.message);
    process.exit(1);
  });
