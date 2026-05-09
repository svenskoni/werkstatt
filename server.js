// Direktstart via: node server.js / npm start / npm run dev
// Wird von Plesk Passenger NICHT verwendet - nur fuer lokale Entwicklung
'use strict';
require('dotenv').config();

const { initDb } = require('./src/database');
const app  = require('./src/app');
const PORT = parseInt(process.env.PORT || '3000', 10);

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[OK] Server laeuft auf http://localhost:${PORT}`);
      console.log(`[OK] Umgebung: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch(err => {
    console.error('[FATAL] Datenbank konnte nicht initialisiert werden:', err);
    process.exit(1);
  });
