'use strict';
const fs    = require('fs');
const path  = require('path');
const Jimp  = require('jimp');
const db    = require('./database');

const UPLOAD_DIR    = path.join(__dirname, '..', 'public', 'uploads');

// NaN-Guard für numerische Env-Vars
const _maxMb    = parseInt(process.env.MAX_UPLOAD_DIR_MB, 10);
const _compDays = parseInt(process.env.COMPRESS_AFTER_DAYS, 10);
if (isNaN(_maxMb)    || _maxMb    <= 0) { console.error('[Cleanup] MAX_UPLOAD_DIR_MB ist keine gültige Zahl'); process.exit(1); }
if (isNaN(_compDays) || _compDays <  0) { console.error('[Cleanup] COMPRESS_AFTER_DAYS ist keine gültige Zahl'); process.exit(1); }
const MAX_BYTES     = _maxMb * 1024 * 1024;
const COMPRESS_DAYS = _compDays;

const IMG_MIME = new Set(['image/jpeg','image/png','image/gif','image/webp']);

// U8: Maximale Bildauflösung (OOM-Schutz für Jimp)
const MAX_IMAGE_DIMENSION = 8000;

function dirSizeBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir)) {
    try { total += fs.statSync(path.join(dir, f)).size; } catch {}
  }
  return total;
}

async function compressImage(filePath) {
  const origSize = fs.statSync(filePath).size;
  const tmp = filePath + '.tmp.jpg';
  try {
    const img = await Jimp.read(filePath);

    // U8-FIX: Auflösung prüfen – extrem grosse Bilder überspringen (OOM-Schutz)
    if (img.bitmap.width > MAX_IMAGE_DIMENSION || img.bitmap.height > MAX_IMAGE_DIMENSION) {
      console.warn(`[Cleanup] Bild zu gross (${img.bitmap.width}x${img.bitmap.height}), übersprungen: ${path.basename(filePath)}`);
      return { compressed: false, skipped: true };
    }

    // U7-FIX: Jimp v0.x API – scaleToFit(width, height) statt scaleToFit({w,h})
    if (img.bitmap.width > 1280 || img.bitmap.height > 1280) {
      img.scaleToFit(1280, 1280);
    }
    await img.quality(60).write(tmp);
    const newSize = fs.statSync(tmp).size;
    if (newSize < origSize) {
      fs.renameSync(tmp, filePath);
      return { compressed: true, saved: origSize - newSize };
    }
    try { fs.unlinkSync(tmp); } catch {}
    return { compressed: false };
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

async function runCompression() {
  const cutoff = new Date(Date.now() - COMPRESS_DAYS * 86400_000).toISOString();
  const attachments = await db.getAttachmentsForCompression(cutoff);
  let count = 0, savedTotal = 0;
  for (const att of attachments) {
    if (!IMG_MIME.has(att.mimetype)) continue;
    const filePath = path.join(UPLOAD_DIR, att.filename);
    try {
      const result = await compressImage(filePath);
      if (result.compressed) {
        savedTotal += result.saved;
        count++;
        await db.markAttachmentCompressed(att.id);
      } else if (result.skipped) {
        // Als komprimiert markieren damit kein endloser Retry
        await db.markAttachmentCompressed(att.id);
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        await db.markAttachmentCompressed(att.id).catch(() => {});
        console.warn('[Cleanup] Datei nicht mehr vorhanden:', att.filename);
      } else {
        console.warn('[Cleanup] Komprimierung fehlgeschlagen:', att.filename, err.message);
      }
    }
  }
  if (count > 0)
    console.log(`[Cleanup] ${count} Bilder komprimiert, ${(savedTotal/1024/1024).toFixed(1)} MB gespart.`);
}

async function runPurge() {
  let used = dirSizeBytes(UPLOAD_DIR);
  if (used <= MAX_BYTES) return;
  console.warn(`[Cleanup] Upload-Ordner ${(used/1024/1024/1024).toFixed(2)} GB – starte Purge.`);

  // U4-FIX: Erst Anhänge von erledigten/zurückgewiesenen Tickets löschen,
  // dann erst die ältesten aller Anhänge – aktive Tickets werden so geschützt
  const candidates = await db.getOldestAttachmentsForPurge();
  for (const att of candidates) {
    if (used <= MAX_BYTES) break;
    const filePath = path.join(UPLOAD_DIR, att.filename);
    try {
      const stat = fs.statSync(filePath);
      fs.unlinkSync(filePath);
      used -= stat.size;
      console.log(`[Cleanup] Purge: ${att.filename} (Störung ${att.stoerungId}, Status: ${att.storungStatus})`);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[Cleanup] Purge-Fehler:', att.filename, err.message);
    }
    await db.deleteAttachment(att.id).catch(e => console.warn('[Cleanup] DB deleteAttachment:', e.message));
  }
}

// Re-entrant Guard
let _isRunning = false;

async function runAll() {
  if (_isRunning) {
    console.warn('[Cleanup] Lauf übersprungen – vorheriger Lauf noch aktiv.');
    return;
  }
  _isRunning = true;
  try {
    try { await runCompression(); } catch (e) { console.error('[Cleanup] Compression-Fehler:', e); }
    try { await runPurge();       } catch (e) { console.error('[Cleanup] Purge-Fehler:', e); }
  } finally {
    _isRunning = false;
  }
}

function scheduleDaily() {
  runAll();
  setInterval(runAll, 24 * 60 * 60 * 1000);
}

module.exports = { scheduleDaily, runAll, runCompression, runPurge };
