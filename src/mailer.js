'use strict';
const nodemailer = require('nodemailer');

let transport;

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host:   process.env.MAIL_HOST,
      port:   parseInt(process.env.MAIL_PORT, 10),
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' }
    });
  }
  return transport;
}

const SCHWERE_LABEL = {
  klein:        '🟢 Klein',
  normal:       '🟡 Normal',
  schwer:       '🟠 Schwer',
  totalausfall: '🔴 Totalausfall',
};

const STATUS_LABEL = {
  gesendet:   'Eingegangen',
  bestaetigt: 'In Bearbeitung',
  erledigt:   'Erledigt',
};

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildHtml(storung) {
  const baseUrl  = process.env.APP_BASE_URL;
  const schwere  = SCHWERE_LABEL[storung.schwere]  || storung.schwere;
  const status   = STATUS_LABEL[storung.status]    || storung.status;
  const datum    = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const detailUrl = `${baseUrl}/stoerung/${storung.id}`;

  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
  <style>body{font-family:Arial,sans-serif;color:#222;background:#f4f4f4;margin:0;padding:0}
  .wrap{max-width:600px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)}
  .header{background:#c0392b;color:#fff;padding:20px 28px}
  .header h1{margin:0;font-size:20px}
  .header p{margin:4px 0 0;opacity:.85;font-size:13px}
  .body{padding:24px 28px}
  table{width:100%;border-collapse:collapse;margin:12px 0}
  th,td{padding:9px 12px;border:1px solid #e0e0e0;font-size:14px;text-align:left}
  th{background:#f7f7f7;width:38%}
  .btn{display:inline-block;margin-top:16px;padding:11px 22px;background:#c0392b;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold}
  .desc{background:#f9f9f9;border-left:3px solid #c0392b;padding:10px 14px;border-radius:4px;font-size:13px;white-space:pre-wrap}
  .footer{padding:12px 28px;background:#f7f7f7;font-size:12px;color:#888;border-top:1px solid #e0e0e0}
  </style></head><body><div class="wrap">
  <div class="header">
    <h1>🚨 Neue Störungsmeldung – ${escHtml(storung.fahrzeug)}</h1>
    <p>Eingegangen: ${datum}</p>
  </div>
  <div class="body">
    <table>
      <tr><th>Fahrzeug</th><td><strong>${escHtml(storung.fahrzeug)}</strong></td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Status</th><td>${status}</td></tr>
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)} &ndash; ${escHtml(storung.melderKontakt)}</td></tr>
      <tr><th>Erfasst von</th><td>${escHtml(storung.createdBy)}</td></tr>
      <tr><th>Meldungs-ID</th><td><code style="font-size:11px">${storung.id}</code></td></tr>
    </table>
    ${storung.beschreibung ? `<div class="desc">${escHtml(storung.beschreibung)}</div>` : ''}
    ${storung.attachments.length > 0 ? `<p style="font-size:13px;color:#666">📎 ${storung.attachments.length} Anhang/Anhänge mitgesendet</p>` : ''}
    <a href="${detailUrl}" class="btn">Detail ansehen →</a>
  </div>
  <div class="footer">Feuerwehr LZ Frechen – Störungsmelder</div>
</div></body></html>`;
}

async function sendStorungMail(storung) {
  const recipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (recipients.length === 0) {
    console.warn('[Mailer] Keine Empfänger konfiguriert (MAIL_RECIPIENTS)');
    return;
  }
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  const subject = `[Störung] ${storung.fahrzeug} – ${schwere} – ${storung.fehlerBeschreibung.slice(0, 50)}`;
  await getTransport().sendMail({
    from:    process.env.MAIL_FROM,
    to:      recipients.join(', '),
    subject,
    html:    buildHtml(storung),
    text:    `Störung: ${storung.fahrzeug} | ${schwere}\nFehler: ${storung.fehlerBeschreibung}\nGemeldet von: ${storung.melderName} (${storung.melderKontakt})\nDetail: ${process.env.APP_BASE_URL}/stoerung/${storung.id}`,
  });
  console.log(`[Mailer] E-Mail gesendet an ${recipients.join(', ')} für Störung ${storung.id}`);
}

async function sendStatusMail(storung, changedBy) {
  const recipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (recipients.length === 0) return;
  const status  = STATUS_LABEL[storung.status] || storung.status;
  const subject = `[Status] ${storung.fahrzeug} → ${status}`;
  await getTransport().sendMail({
    from:    process.env.MAIL_FROM,
    to:      recipients.join(', '),
    subject,
    html:    buildHtml(storung),
    text:    `Statuswechsel: ${storung.fahrzeug} → ${status}\nGeändert von: ${changedBy}\nDetail: ${process.env.APP_BASE_URL}/stoerung/${storung.id}`,
  });
}

/**
 * Benachrichtigung beim Löschen einer Störung.
 * - Admins (MAIL_RECIPIENTS) erhalten immer eine Info.
 * - Melder erhält eine Kopie, falls eine E-Mail in melderKontakt steht.
 */
async function sendDeleteMail(storung, deletedBy, grund) {
  const schwere  = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  const datum    = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const subject  = `[Gelöscht] Störung ${storung.id} – ${storung.fahrzeug}`;

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
  <style>body{font-family:Arial,sans-serif;color:#222;background:#f4f4f4;margin:0;padding:0}
  .wrap{max-width:600px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)}
  .header{background:#7a1a1a;color:#fff;padding:20px 28px}
  .header h1{margin:0;font-size:20px}
  .header p{margin:4px 0 0;opacity:.85;font-size:13px}
  .body{padding:24px 28px}
  table{width:100%;border-collapse:collapse;margin:12px 0}
  th,td{padding:9px 12px;border:1px solid #e0e0e0;font-size:14px;text-align:left}
  th{background:#f7f7f7;width:38%}
  .grund{background:#fff3f3;border-left:3px solid #c0392b;padding:10px 14px;border-radius:4px;font-size:14px;white-space:pre-wrap;margin-top:12px}
  .footer{padding:12px 28px;background:#f7f7f7;font-size:12px;color:#888;border-top:1px solid #e0e0e0}
  </style></head><body><div class="wrap">
  <div class="header">
    <h1>🗑️ Störung gelöscht – ${escHtml(storung.fahrzeug)}</h1>
    <p>Gelöscht von: ${escHtml(deletedBy)}</p>
  </div>
  <div class="body">
    <table>
      <tr><th>Fahrzeug</th><td><strong>${escHtml(storung.fahrzeug)}</strong></td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)} &ndash; ${escHtml(storung.melderKontakt)}</td></tr>
      <tr><th>Erfasst am</th><td>${datum}</td></tr>
      <tr><th>Meldungs-ID</th><td><code style="font-size:11px">${storung.id}</code></td></tr>
      <tr><th>Gelöscht von</th><td>${escHtml(deletedBy)}</td></tr>
    </table>
    <p style="font-size:14px;font-weight:bold;margin-top:16px">Begründung:</p>
    <div class="grund">${escHtml(grund)}</div>
  </div>
  <div class="footer">Feuerwehr LZ Frechen – Störungsmelder</div>
</div></body></html>`;

  const text = `Störung gelöscht: ${storung.id}\nFahrzeug: ${storung.fahrzeug}\nGelöscht von: ${deletedBy}\nBegründung: ${grund}`;

  // Admin-Benachrichtigung
  const adminRecipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (adminRecipients.length > 0) {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   adminRecipients.join(', '),
      subject,
      html,
      text,
    });
  }

  // Melder-Benachrichtigung falls E-Mail in melderKontakt
  const mailMatch = (storung.melderKontakt || '').match(/Mail:\s*([^\s|,]+@[^\s|,]+)/i);
  if (mailMatch) {
    const melderMail = mailMatch[1].trim();
    await getTransport().sendMail({
      from:    process.env.MAIL_FROM,
      to:      melderMail,
      subject: `Ihre Störungsmeldung wurde gelöscht – ${storung.fahrzeug}`,
      html,
      text,
    });
    console.log(`[Mailer] Lösch-Mail an Melder gesendet: ${melderMail}`);
  }
}

module.exports = { sendStorungMail, sendStatusMail, sendDeleteMail };
