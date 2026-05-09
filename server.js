// Direkter Start (npm start / npm run dev)
'use strict';
require('dotenv').config();

const { initDb } = require('./src/database');
const app  = require('./src/app');
const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[OK] Feuerwehr Störungsmelder läuft auf Port ${PORT}`);
      console.log(`[OK] Umgebung: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch(err => {
    console.error('[FATAL] Datenbank konnte nicht initialisiert werden:', err);
    process.exit(1);
  });
