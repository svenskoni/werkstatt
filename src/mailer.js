'use strict';
const nodemailer = require('nodemailer');

let transport;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host:   process.env.MAIL_HOST,
      port:   parseInt(process.env.MAIL_PORT, 10),
      secure: process.env.MAIL_SECURE === 'true',
      auth:   { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
      tls:    { rejectUnauthorized: process.env.NODE_ENV === 'production' }
    });
  }
  return transport;
}

const SCHWERE_LABEL = {
  klein: '🟢 Klein', normal: '🟡 Normal', schwer: '🟠 Schwer', totalausfall: '🔴 Totalausfall',
};
const STATUS_LABEL = {
  gesendet:        'Eingegangen',
  bestaetigt:      'In Bearbeitung',
  erledigt:        'Erledigt',
  zurueckgewiesen: 'Zurückgewiesen',
};

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const CSS = `body{font-family:Arial,sans-serif;color:#222;background:#f4f4f4;margin:0;padding:0}
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
.ticket{font-size:28px;font-weight:bold;letter-spacing:1px;color:#c0392b;text-align:center;padding:16px;background:#fff5f5;border-radius:6px;margin:16px 0}
.footer{padding:12px 28px;background:#f7f7f7;font-size:12px;color:#888;border-top:1px solid #e0e0e0}`;

/**
 * Extrahiert die erste gültige E-Mail-Adresse aus melderKontakt.
 */
function extractMelderMail(kontakt) {
  const match = String(kontakt || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].trim() : null;
}

function buildAdminHtml(storung) {
  const baseUrl  = process.env.APP_BASE_URL;
  const schwere  = SCHWERE_LABEL[storung.schwere]  || storung.schwere;
  const status   = STATUS_LABEL[storung.status]    || storung.status;
  const datum    = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const detailUrl = `${baseUrl}/stoerung/${storung.id}`;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}</style></head><body><div class="wrap">
  <div class="header"><h1>🚨 Störungsmeldung – ${escHtml(storung.fahrzeug)}</h1><p>Eingegangen: ${datum}</p></div>
  <div class="body">
    <table>
      <tr><th>Fahrzeug</th><td><strong>${escHtml(storung.fahrzeug)}</strong></td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Status</th><td>${status}</td></tr>
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)} – ${escHtml(storung.melderKontakt)}</td></tr>
      <tr><th>Erfasst von</th><td>${escHtml(storung.createdBy)}</td></tr>
      <tr><th>Meldungs-ID</th><td><code>${storung.id}</code></td></tr>
      <tr><th>Statusupdates</th><td>${Number(storung.melderBenachrichtigung) === 1 ? '✅ Melder möchte informiert werden' : '❌ Keine Melder-Benachrichtigung'}</td></tr>
    </table>
    ${storung.beschreibung ? `<div class="desc">${escHtml(storung.beschreibung)}</div>` : ''}
    ${storung.attachments && storung.attachments.length > 0 ? `<p style="font-size:13px;color:#666">📎 ${storung.attachments.length} Anhang/Anhänge</p>` : ''}
    <a href="${detailUrl}" class="btn">Detail ansehen →</a>
  </div>
  <div class="footer">Feuerwehr LZ Frechen – Störungsmelder</div>
</div></body></html>`;
}

/** Bestätigungsmail an Melder nach Eingang */
function buildMelderBestaetigung(storung) {
  const benachrichtigt = Number(storung.melderBenachrichtigung) === 1;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}</style></head><body><div class="wrap">
  <div class="header"><h1>✅ Ihre Störungsmeldung ist eingegangen</h1><p>Feuerwehr LZ Frechen – Störungsmelder</p></div>
  <div class="body">
    <p style="font-size:15px">Hallo ${escHtml(storung.melderName)},<br><br>
    Ihre Störungsmeldung für <strong>${escHtml(storung.fahrzeug)}</strong> wurde erfolgreich erfasst und wird zeitnah bearbeitet.</p>
    <div class="ticket">🎫 ${escHtml(storung.id)}</div>
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Eingegangen</th><td>${new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td></tr>
    </table>
    <p style="font-size:13px;color:#666;margin-top:16px">
      ${benachrichtigt
        ? 'Sie erhalten automatisch eine E-Mail, sobald sich der Status Ihrer Meldung ändert.'
        : 'Sie erhalten keine weiteren automatischen Benachrichtigungen.<br>Bei Rückfragen verwenden Sie bitte Ihre Ticket-Nummer.'}
    </p>
  </div>
  <div class="footer">Feuerwehr LZ Frechen – Störungsmelder</div>
</div></body></html>`;
}

/** Statusänderungs-Mail an Melder */
function buildMelderStatusHtml(storung, note) {
  const status = STATUS_LABEL[storung.status] || storung.status;
  const isZurueck = storung.status === 'zurueckgewiesen';
  const statusColor = storung.status === 'erledigt' ? '#27ae60'
    : storung.status === 'bestaetigt' ? '#e67e22'
    : isZurueck ? '#c0392b'
    : '#2980b9';
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}
  .status-badge{display:inline-block;padding:6px 16px;border-radius:20px;font-weight:bold;font-size:16px;color:#fff;background:${statusColor}}
  </style></head><body><div class="wrap">
  <div class="header"><h1>🔔 Statusänderung – ${escHtml(storung.fahrzeug)}</h1><p>Ticket: ${escHtml(storung.id)}</p></div>
  <div class="body">
    <p style="font-size:15px">Hallo ${escHtml(storung.melderName)},<br><br>
    der Status Ihrer Störungsmeldung wurde aktualisiert:</p>
    <p style="text-align:center;margin:20px 0"><span class="status-badge">${status}</span></p>
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Neuer Status</th><td><strong>${status}</strong></td></tr>
      <tr><th>Ticket-Nr.</th><td><code>${storung.id}</code></td></tr>
    </table>
    ${note ? `<div class="desc" style="margin-top:12px"><strong>Hinweis:</strong> ${escHtml(note)}</div>` : ''}
    ${storung.status === 'erledigt' ? '<p style="font-size:13px;color:#27ae60;margin-top:12px">✅ Ihre Meldung wurde abgeschlossen. Vielen Dank!</p>' : ''}
    ${isZurueck ? '<p style="font-size:13px;color:#c0392b;margin-top:12px">✕ Ihr Ticket wurde zurückgewiesen. Bei Fragen wenden Sie sich bitte direkt an die Werkstatt.</p>' : ''}
  </div>
  <div class="footer">Feuerwehr LZ Frechen – Störungsmelder</div>
</div></body></html>`;
}

// ── Öffentliche Funktionen ───────────────────────────────────────────────────────────────────

async function sendStorungMail(storung) {
  const recipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (!recipients.length) { console.warn('[Mailer] Keine Empfänger (MAIL_RECIPIENTS)'); return; }
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM, to: recipients.join(', '),
      subject: `[Störung] ${storung.fahrzeug} – ${schwere} – ${storung.fehlerBeschreibung.slice(0,50)}`,
      html: buildAdminHtml(storung),
      text: `Störung: ${storung.fahrzeug}\nMelder: ${storung.melderName}\nFehler: ${storung.fehlerBeschreibung}\nMeldungs-ID: ${storung.id}`,
    });
    console.log(`[Mailer] Admin-Mail gesendet an: ${recipients.join(', ')}`);
  } catch (err) {
    console.error('[Mailer] sendStorungMail FEHLER:', err.message);
  }
}

/** Bestätigungs-Mail an Melder – immer senden wenn E-Mail vorhanden */
async function sendMelderBestaetigung(storung) {
  const melderMail = extractMelderMail(storung.melderKontakt);
  if (!melderMail) {
    console.log('[Mailer] Keine Melder-Mail im Kontakt gefunden:', storung.melderKontakt);
    return;
  }
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM, to: melderMail,
      subject: `✅ Störungsmeldung eingegangen – Ticket ${storung.id}`,
      html: buildMelderBestaetigung(storung),
      text: `Hallo ${storung.melderName},\nIhre Meldung wurde erfasst. Ticket-Nr.: ${storung.id}\nFahrzeug: ${storung.fahrzeug}\nFehler: ${storung.fehlerBeschreibung}`,
    });
    console.log(`[Mailer] Bestätigung an Melder: ${melderMail}`);
  } catch (err) {
    console.error('[Mailer] sendMelderBestaetigung FEHLER:', err.message);
  }
}

async function sendStatusMail(storung, changedBy, note) {
  // Admin-Info immer
  const recipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (recipients.length) {
    const status = STATUS_LABEL[storung.status] || storung.status;
    try {
      await getTransport().sendMail({
        from: process.env.MAIL_FROM, to: recipients.join(', '),
        subject: `[Status] ${storung.fahrzeug} → ${status} (Melder: ${storung.melderName})`,
        html: buildAdminHtml(storung),
        text: `Statuswechsel: ${storung.fahrzeug} → ${status}\nMelder: ${storung.melderName}\nGeändert von: ${changedBy}`,
      });
      console.log(`[Mailer] Status-Mail Admin gesendet`);
    } catch (err) {
      console.error('[Mailer] sendStatusMail Admin FEHLER:', err.message);
    }
  }
  // Melder nur wenn opt-in UND E-Mail vorhanden
  if (Number(storung.melderBenachrichtigung) === 1) {
    const melderMail = extractMelderMail(storung.melderKontakt);
    if (melderMail) {
      const status = STATUS_LABEL[storung.status] || storung.status;
      try {
        await getTransport().sendMail({
          from: process.env.MAIL_FROM, to: melderMail,
          subject: `🔔 Statusänderung Ihrer Störungsmeldung – ${status}`,
          html: buildMelderStatusHtml(storung, note),
          text: `Hallo ${storung.melderName},\nStatus Ihrer Meldung ${storung.id}: ${status}${note ? '\nHinweis: ' + note : ''}`,
        });
        console.log(`[Mailer] Status-Mail an Melder: ${melderMail}`);
      } catch (err) {
        console.error('[Mailer] sendStatusMail Melder FEHLER:', err.message);
      }
    }
  }
}

async function sendDeleteMail(storung, deletedBy, grund) {
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  const datum   = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const subject = `[Gelöscht] Störung ${storung.id} – ${storung.fahrzeug} (Melder: ${storung.melderName})`;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}
  .grund{background:#fff3f3;border-left:3px solid #c0392b;padding:10px 14px;border-radius:4px;font-size:14px;white-space:pre-wrap;margin-top:12px}
  </style></head><body><div class="wrap">
  <div class="header"><h1>🗑️ Störung gelöscht – ${escHtml(storung.fahrzeug)}</h1><p>Gelöscht von: ${escHtml(deletedBy)}</p></div>
  <div class="body">
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)}</td></tr>
      <tr><th>Erfasst am</th><td>${datum}</td></tr>
      <tr><th>Gelöscht von</th><td>${escHtml(deletedBy)}</td></tr>
    </table>
    <div class="grund"><strong>Begründung:</strong><br>${escHtml(grund)}</div>
  </div>
  <div class="footer">Feuerwehr LZ Frechen – Störungsmelder</div>
</div></body></html>`;
  const recipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (recipients.length) {
    try {
      await getTransport().sendMail({ from: process.env.MAIL_FROM, to: recipients.join(', '), subject, html, text: `Gelöscht: ${storung.id} – ${grund}` });
      console.log(`[Mailer] Lösch-Mail Admin gesendet`);
    } catch (err) {
      console.error('[Mailer] sendDeleteMail Admin FEHLER:', err.message);
    }
  }
  if (Number(storung.melderBenachrichtigung) === 1 && storung.status !== 'erledigt') {
    const melderMail = extractMelderMail(storung.melderKontakt);
    if (melderMail) {
      try {
        await getTransport().sendMail({
          from: process.env.MAIL_FROM, to: melderMail,
          subject: `Ihre Störungsmeldung wurde entfernt – ${storung.fahrzeug}`,
          html, text: `Ihre Meldung ${storung.id} wurde gelöscht.\nBegründung: ${grund}`,
        });
        console.log(`[Mailer] Lösch-Mail Melder gesendet: ${melderMail}`);
      } catch (err) {
        console.error('[Mailer] sendDeleteMail Melder FEHLER:', err.message);
      }
    }
  }
}

module.exports = { sendStorungMail, sendMelderBestaetigung, sendStatusMail, sendDeleteMail };
