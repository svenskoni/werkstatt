'use strict';
// Plesk Startdatei – muss im Anwendungsstamm liegen
// Plesk setzt PORT automatisch; TLS wird von Plesk/nginx übernommen
require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  const env = process.env.NODE_ENV || 'production';
  console.log('\n\u{1F692} Feuerwehr Störungsmelder');
  console.log('   Port: ' + PORT);
  console.log('   ENV:  ' + env);
  console.log('   DB:   ' + (process.env.DB_PATH || './data/stoerungen.db'));
});
