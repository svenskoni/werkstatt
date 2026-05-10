'use strict';
/**
 * Speicher-Verwaltung
 *
 * Regel 1 – Komprimierung:
 *   Bilder von erledigten Störungen, die älter als 7 Tage sind, werden mit
 *   sharp auf max. 1280px / 60 % JPEG-Qualität verkleinert.
 *   Videos werden nicht angefasst (sharp unterstützt kein Video).
 *
 * Regel 2 – Notfall-Purge:
 *   Überschreitet public/uploads/ ein konfigurierbares Limit (Standard 5 GB),
 *   werden die ältesten Anhänge (Datei + DB-Eintrag) gelöscht bis wieder
 *   unter dem Limit.
 *
 * Beide Regeln laufen automatisch einmal täglich beim App-Start.
 */

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');
const db    = require('./database');

const UPLOAD_DIR    = path.join(__dirname, '..', 'public', 'uploads');
const MAX_BYTES     = parseInt(process.env.MAX_UPLOAD_DIR_MB  || String(5 * 1024), 10) * 1024 * 1024;
const COMPRESS_DAYS = parseInt(process.env.COMPRESS_AFTER_DAYS || '7', 10);
const IMG_MIME      = new Set(['image/jpeg','image/png','image/gif','image/webp']);

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

function dirSizeBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir)) {
    try { total += fs.statSync(path.join(dir, f)).size; } catch {}
  }
  return total;
}

async function compressImage(filePath) {
  const tmp = filePath + '.tmp';
  try {
    await sharp(filePath)
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toFile(tmp);
    // nur ersetzen wenn komprimiert wirklich kleiner
    const origSize = fs.statSync(filePath).size;
    const newSize  = fs.statSync(tmp).size;
    if (newSize < origSize) {
      fs.renameSync(tmp, filePath);
      return { compressed: true, saved: origSize - newSize };
    }
    fs.unlinkSync(tmp);
    return { compressed: false };
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

// ── Regel 1: Komprimierung nach 7 Tagen ─────────────────────────────────────

async function runCompression() {
  const cutoff = new Date(Date.now() - COMPRESS_DAYS * 86400_000).toISOString();
  const attachments = await db.getAttachmentsForCompression(cutoff);
  let count = 0, savedTotal = 0;
  for (const att of attachments) {
    if (!IMG_MIME.has(att.mimetype)) continue;
    const filePath = path.join(UPLOAD_DIR, att.filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const result = await compressImage(filePath);
      if (result.compressed) {
        savedTotal += result.saved;
        count++;
        await db.markAttachmentCompressed(att.id);
      }
    } catch (err) {
      console.warn('[Cleanup] Komprimierung fehlgeschlagen:', att.filename, err.message);
    }
  }
  if (count > 0)
    console.log(`[Cleanup] ${count} Bilder komprimiert, ${(savedTotal/1024/1024).toFixed(1)} MB gespart.`);
}

// ── Regel 2: Notfall-Purge bei > 5 GB ───────────────────────────────────────

async function runPurge() {
  let used = dirSizeBytes(UPLOAD_DIR);
  if (used <= MAX_BYTES) return;
  console.warn(`[Cleanup] Upload-Ordner ${(used/1024/1024/1024).toFixed(2)} GB – starte Purge.`);

  // älteste Anhänge zuerst (nach createdAt ASC)
  const candidates = await db.getOldestAttachments();
  for (const att of candidates) {
    if (used <= MAX_BYTES) break;
    const filePath = path.join(UPLOAD_DIR, att.filename);
    try {
      if (fs.existsSync(filePath)) {
        const size = fs.statSync(filePath).size;
        fs.unlinkSync(filePath);
        used -= size;
      }
      await db.deleteAttachment(att.id);
      console.log(`[Cleanup] Purge: ${att.filename} (Störung ${att.stoerungId})`);
    } catch (err) {
      console.warn('[Cleanup] Purge-Fehler:', att.filename, err.message);
    }
  }
}

// ── Einstiegspunkt ───────────────────────────────────────────────────────────

async function runAll() {
  try { await runCompression(); } catch (e) { console.error('[Cleanup] Compression-Fehler:', e); }
  try { await runPurge();       } catch (e) { console.error('[Cleanup] Purge-Fehler:', e); }
}

// Einmal täglich automatisch ausführen
function scheduleDaily() {
  runAll();
  setInterval(runAll, 24 * 60 * 60 * 1000);
}

module.exports = { scheduleDaily, runAll, runCompression, runPurge };
