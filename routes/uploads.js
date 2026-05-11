'use strict';
/**
 * routes/uploads.js
 *
 * S1: Upload-Dateien sind NUR für eingeloggte Nutzer abrufbar.
 * S2: Path-Traversal-Schutz durch path.basename + Validierung.
 * S5: Explizite Content-Type + Content-Disposition Headers.
 */
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { requireLogin } = require('../middleware/auth');

const router     = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

// Erlaubte Dateiendungen
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.webm', '.mkv']);

// MIME-Map für sichere Content-Type-Ausgabe
const EXT_MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.avi':  'video/x-msvideo',
  '.webm': 'video/webm',
  '.mkv':  'video/x-matroska',
};

/**
 * GET /uploads/:filename
 * S1: requireLogin – ohne Login → Redirect zu /login
 * S2: path.basename verhindert ../ und absolute Pfade
 * S5: Expliziter Content-Type + nosniff
 */
router.get('/uploads/:filename', requireLogin, (req, res) => {
  // S2: Nur den Dateinamen extrahieren – kein Verzeichnis-Traversal möglich
  const filename = path.basename(req.params.filename);

  // Leerstring, versteckte Dateien (.htaccess etc.) oder ungültige Dateinamen ablehnen
  if (!filename || filename.startsWith('.')) {
    return res.status(400).json({ error: 'Ungültiger Dateiname.' });
  }

  // Nur erlaubte Dateiendungen
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return res.status(403).json({ error: 'Dateityp nicht erlaubt.' });
  }

  const filePath = path.join(UPLOAD_DIR, filename);

  // S2: Sicherstellen dass der aufgelöste Pfad wirklich im UPLOAD_DIR liegt
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    return res.status(403).json({ error: 'Zugriff verweigert.' });
  }

  // Existenz prüfen
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'Datei nicht gefunden.' });
  }

  // S5: Expliziten MIME-Typ setzen – verhindert MIME-Sniffing-Angriffe
  const mime = EXT_MIME[ext] || 'application/octet-stream';
  res.set('Content-Type', mime);
  res.set('X-Content-Type-Options', 'nosniff');  // redundant zu Helmet, aber explizit
  res.set('Content-Disposition', 'inline');       // Browser zeigt an, lädt nicht herunter
  res.set('Cache-Control', 'private, max-age=3600'); // kein CDN-Cache für private Uploads

  res.sendFile(resolved);
});

module.exports = router;
