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
  klein: '\uD83D\uDFE2 Klein', normal: '\uD83D\uDFE1 Normal', schwer: '\uD83D\uDFE0 Schwer', totalausfall: '\uD83D\uDD34 Totalausfall',
};
const STATUS_LABEL = {
  gesendet:        'Eingegangen',
  bestaetigt:      'In Bearbeitung',
  erledigt:        'Erledigt',
  zurueckgewiesen: 'Zur\u00fcckgewiesen',
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
.footer{padding:12px 28px;background:#f7f7f7;font-size:12px;color:#888;border-top:1px solid #e0e0e0}
.schwere-change{background:#fff8e1;border-left:3px solid #e67e22;padding:8px 12px;border-radius:4px;font-size:13px;margin:8px 0}
.changed-by{background:#eaf4fb;border-left:3px solid #2980b9;padding:8px 12px;border-radius:4px;font-size:13px;margin:8px 0}`;

function extractMelderMail(kontakt) {
  const match = String(kontakt || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].trim() : null;
}

// ── Admin-Mail ─────────────────────────────────────────────────────────────
function buildAdminHtml(storung, alterSchwere, changedBy) {
  const baseUrl   = process.env.APP_BASE_URL;
  const schwere   = SCHWERE_LABEL[storung.schwere]  || storung.schwere;
  const status    = STATUS_LABEL[storung.status]    || storung.status;
  const datum     = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const detailUrl = `${baseUrl}/stoerung/${storung.id}`;

  const schwereChangeHtml = alterSchwere
    ? `<tr><th>Schweregrad geändert</th><td class="schwere-change"><strong>${SCHWERE_LABEL[alterSchwere] || alterSchwere} \u2192 ${schwere}</strong> <span style="color:#e67e22">(vom Admin angepasst)</span></td></tr>`
    : '';

  // Wer hat den Status geändert? Nur anzeigen wenn explizit übergeben und verschieden von createdBy
  const changedByHtml = changedBy
    ? `<tr><th>Status geändert von</th><td><strong>${escHtml(changedBy)}</strong></td></tr>`
    : '';

  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}</style></head><body><div class="wrap">
  <div class="header"><h1>\uD83D\uDEA8 St\u00f6rungsmeldung \u2013 ${escHtml(storung.fahrzeug)}</h1><p>Eingegangen: ${datum}</p></div>
  <div class="body">
    <table>
      <tr><th>Fahrzeug</th><td><strong>${escHtml(storung.fahrzeug)}</strong></td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      ${schwereChangeHtml}
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Status</th><td><strong>${status}</strong></td></tr>
      ${changedByHtml}
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)} \u2013 ${escHtml(storung.melderKontakt)}</td></tr>
      <tr><th>Erfasst von</th><td>${escHtml(storung.createdBy)}</td></tr>
      <tr><th>Meldungs-ID</th><td><code>${storung.id}</code></td></tr>
      <tr><th>Statusupdates</th><td>${Number(storung.melderBenachrichtigung) === 1 ? '\u2705 Melder m\u00f6chte informiert werden' : '\u274C Keine Melder-Benachrichtigung'}</td></tr>
    </table>
    ${storung.beschreibung ? `<div class="desc">${escHtml(storung.beschreibung)}</div>` : ''}
    ${storung.attachments && storung.attachments.length > 0 ? `<p style="font-size:13px;color:#666">\uD83D\uDCCE ${storung.attachments.length} Anhang/Anh\u00e4nge</p>` : ''}
    <a href="${detailUrl}" class="btn">Detail ansehen \u2192</a>
  </div>
  <div class="footer">Feuerwehr LZ Frechen \u2013 St\u00f6rungsmelder</div>
</div></body></html>`;
}

// ── Melder-Bestätigung (Eingang) ────────────────────────────────────────────
function buildMelderBestaetigung(storung) {
  const benachrichtigt = Number(storung.melderBenachrichtigung) === 1;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}</style></head><body><div class="wrap">
  <div class="header"><h1>\u2705 Ihre St\u00f6rungsmeldung ist eingegangen</h1><p>Feuerwehr LZ Frechen \u2013 St\u00f6rungsmelder</p></div>
  <div class="body">
    <p style="font-size:15px">Hallo ${escHtml(storung.melderName)},<br><br>
    Ihre St\u00f6rungsmeldung f\u00fcr <strong>${escHtml(storung.fahrzeug)}</strong> wurde erfolgreich erfasst und wird zeitnah bearbeitet.</p>
    <div class="ticket">\uD83C\uDFAB ${escHtml(storung.id)}</div>
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Eingegangen</th><td>${new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</td></tr>
    </table>
    <p style="font-size:13px;color:#666;margin-top:16px">
      ${benachrichtigt
        ? 'Sie erhalten automatisch eine E-Mail, sobald sich der Status Ihrer Meldung \u00e4ndert.'
        : 'Sie erhalten keine weiteren automatischen Benachrichtigungen zu Status\u00e4nderungen.<br>Bei R\u00fcckfragen verwenden Sie bitte Ihre Ticket-Nummer.'}
    </p>
  </div>
  <div class="footer">Feuerwehr LZ Frechen \u2013 St\u00f6rungsmelder</div>
</div></body></html>`;
}

// ── Melder-Status-Mail ──────────────────────────────────────────────────
function buildMelderStatusHtml(storung, note, changedBy, alterSchwere) {
  const status = STATUS_LABEL[storung.status] || storung.status;
  const isZurueck = storung.status === 'zurueckgewiesen';
  const statusColor = storung.status === 'erledigt' ? '#27ae60'
    : storung.status === 'bestaetigt' ? '#e67e22'
    : isZurueck ? '#c0392b'
    : '#2980b9';

  const zurueckHinweis = isZurueck
    ? `<p style="font-size:13px;color:#c0392b;margin-top:12px">\u2715 Ihr Ticket wurde zur\u00fcckgewiesen. Bei R\u00fcckfragen wenden Sie sich bitte direkt an ${escHtml(changedBy || 'die Werkstatt')}.</p>`
    : '';

  const schwereChangeHtml = alterSchwere
    ? `<div class="schwere-change" style="margin-top:12px">\u2139\uFE0F <strong>Schweregrad wurde angepasst:</strong> ${escHtml(SCHWERE_LABEL[alterSchwere] || alterSchwere)} \u2192 <strong>${escHtml(SCHWERE_LABEL[storung.schwere] || storung.schwere)}</strong></div>`
    : '';

  // Wer hat geändert – immer sichtbar für den Melder
  const changedByHtml = changedBy
    ? `<div class="changed-by" style="margin-top:12px">\uD83D\uDC64 <strong>Status geändert von:</strong> ${escHtml(changedBy)}</div>`
    : '';

  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}
  .status-badge{display:inline-block;padding:6px 16px;border-radius:20px;font-weight:bold;font-size:16px;color:#fff;background:${statusColor}}
  </style></head><body><div class="wrap">
  <div class="header"><h1>\uD83D\uDD14 Status\u00e4nderung \u2013 ${escHtml(storung.fahrzeug)}</h1><p>Ticket: ${escHtml(storung.id)}</p></div>
  <div class="body">
    <p style="font-size:15px">Hallo ${escHtml(storung.melderName)},<br><br>
    der Status Ihrer St\u00f6rungsmeldung wurde aktualisiert:</p>
    <p style="text-align:center;margin:20px 0"><span class="status-badge">${status}</span></p>
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Schweregrad</th><td>${escHtml(SCHWERE_LABEL[storung.schwere] || storung.schwere)}</td></tr>
      <tr><th>Neuer Status</th><td><strong>${status}</strong></td></tr>
      <tr><th>Ge\u00e4ndert von</th><td><strong>${escHtml(changedBy || '\u2014')}</strong></td></tr>
      <tr><th>Ticket-Nr.</th><td><code>${storung.id}</code></td></tr>
    </table>
    ${schwereChangeHtml}
    ${changedByHtml}
    ${note ? `<div class="desc" style="margin-top:12px"><strong>Hinweis:</strong> ${escHtml(note)}</div>` : ''}
    ${storung.status === 'erledigt' ? '<p style="font-size:13px;color:#27ae60;margin-top:12px">\u2705 Ihre Meldung wurde abgeschlossen. Vielen Dank!</p>' : ''}
    ${zurueckHinweis}
  </div>
  <div class="footer">Feuerwehr LZ Frechen \u2013 St\u00f6rungsmelder</div>
</div></body></html>`;
}

// ── Öffentliche Funktionen ──────────────────────────────────────────────────────
async function sendStorungMail(storung) {
  const recipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (!recipients.length) { console.warn('[Mailer] Keine Empf\u00e4nger (MAIL_RECIPIENTS)'); return; }
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM, to: recipients.join(', '),
      subject: `[St\u00f6rung] ${storung.fahrzeug} \u2013 ${schwere} \u2013 ${storung.fehlerBeschreibung.slice(0,50)}`,
      html: buildAdminHtml(storung, null, null),
      text: `St\u00f6rung: ${storung.fahrzeug}\nMelder: ${storung.melderName}\nFehler: ${storung.fehlerBeschreibung}\nMeldungs-ID: ${storung.id}`,
    });
    console.log(`[Mailer] Admin-Mail gesendet an: ${recipients.join(', ')}`);
  } catch (err) {
    console.error('[Mailer] sendStorungMail FEHLER:', err.message);
  }
}

async function sendMelderBestaetigung(storung) {
  const melderMail = extractMelderMail(storung.melderKontakt);
  if (!melderMail) {
    console.log('[Mailer] Keine Melder-Mail, Best\u00e4tigung \u00fcbersprungen:', storung.melderKontakt);
    return;
  }
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM, to: melderMail,
      subject: `\u2705 St\u00f6rungsmeldung eingegangen \u2013 Ticket ${storung.id}`,
      html: buildMelderBestaetigung(storung),
      text: `Hallo ${storung.melderName},\nIhre Meldung wurde erfasst. Ticket-Nr.: ${storung.id}\nFahrzeug: ${storung.fahrzeug}\nFehler: ${storung.fehlerBeschreibung}`,
    });
    console.log(`[Mailer] Best\u00e4tigung an Melder: ${melderMail}`);
  } catch (err) {
    console.error('[Mailer] sendMelderBestaetigung FEHLER:', err.message);
  }
}

async function sendStatusMail(storung, changedBy, note) {
  const alterSchwere = storung._schwereGeaendert ? storung._alterSchwere : null;

  // Admin immer benachrichtigen
  const recipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (recipients.length) {
    const status = STATUS_LABEL[storung.status] || storung.status;
    const schwereHinweis = alterSchwere ? ` [Schwere: ${SCHWERE_LABEL[alterSchwere] || alterSchwere} \u2192 ${SCHWERE_LABEL[storung.schwere] || storung.schwere}]` : '';
    try {
      await getTransport().sendMail({
        from: process.env.MAIL_FROM, to: recipients.join(', '),
        subject: `[Status] ${storung.fahrzeug} \u2192 ${status}${schwereHinweis} | von: ${changedBy} | Melder: ${storung.melderName}`,
        html: buildAdminHtml(storung, alterSchwere, changedBy),
        text: `Statuswechsel: ${storung.fahrzeug} \u2192 ${status}${schwereHinweis}\nGe\u00e4ndert von: ${changedBy}\nMelder: ${storung.melderName}`,
      });
      console.log(`[Mailer] Status-Mail Admin gesendet`);
    } catch (err) {
      console.error('[Mailer] sendStatusMail Admin FEHLER:', err.message);
    }
  }

  const melderMail = extractMelderMail(storung.melderKontakt);
  if (!melderMail) return;

  const isZurueck = storung.status === 'zurueckgewiesen';
  const melderBekommt = isZurueck || Number(storung.melderBenachrichtigung) === 1;
  if (!melderBekommt) return;

  const status = STATUS_LABEL[storung.status] || storung.status;
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM, to: melderMail,
      subject: isZurueck
        ? `\u274C Ihre St\u00f6rungsmeldung wurde zur\u00fcckgewiesen \u2013 Ticket ${storung.id}`
        : `\uD83D\uDD14 Status\u00e4nderung Ihrer St\u00f6rungsmeldung \u2013 ${status}`,
      html: buildMelderStatusHtml(storung, note, changedBy, alterSchwere),
      text: `Hallo ${storung.melderName},\nStatus Ihrer Meldung ${storung.id}: ${status}\nGe\u00e4ndert von: ${changedBy}${note ? '\nHinweis: ' + note : ''}${isZurueck ? '\nBei R\u00fcckfragen wenden Sie sich bitte direkt an ' + (changedBy || 'die Werkstatt') + '.' : ''}`,
    });
    console.log(`[Mailer] Status-Mail an Melder gesendet (${isZurueck ? 'Zur\u00fcckweisung \u2013 Pflicht' : 'Opt-in'}): ${melderMail}`);
  } catch (err) {
    console.error('[Mailer] sendStatusMail Melder FEHLER:', err.message);
  }
}

async function sendDeleteMail(storung, deletedBy, grund) {
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  const datum   = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const subject = `[Gel\u00f6scht] St\u00f6rung ${storung.id} \u2013 ${storung.fahrzeug} | Gel\u00f6scht von: ${deletedBy} | Melder: ${storung.melderName}`;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}
  .grund{background:#fff3f3;border-left:3px solid #c0392b;padding:10px 14px;border-radius:4px;font-size:14px;white-space:pre-wrap;margin-top:12px}
  </style></head><body><div class="wrap">
  <div class="header"><h1>\uD83D\uDDD1\uFE0F St\u00f6rung gel\u00f6scht \u2013 ${escHtml(storung.fahrzeug)}</h1><p>Gel\u00f6scht von: ${escHtml(deletedBy)}</p></div>
  <div class="body">
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)}</td></tr>
      <tr><th>Erfasst am</th><td>${datum}</td></tr>
      <tr><th>Gel\u00f6scht von</th><td><strong>${escHtml(deletedBy)}</strong></td></tr>
    </table>
    <div class="grund"><strong>Begr\u00fcndung:</strong><br>${escHtml(grund)}</div>
  </div>
  <div class="footer">Feuerwehr LZ Frechen \u2013 St\u00f6rungsmelder</div>
</div></body></html>`;
  const recipients = process.env.MAIL_RECIPIENTS.split(',').map(e => e.trim()).filter(Boolean);
  if (recipients.length) {
    try {
      await getTransport().sendMail({ from: process.env.MAIL_FROM, to: recipients.join(', '), subject, html, text: `Gel\u00f6scht: ${storung.id} \u2013 ${grund}` });
      console.log(`[Mailer] L\u00f6sch-Mail Admin gesendet`);
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
          subject: `Ihre St\u00f6rungsmeldung wurde entfernt \u2013 ${storung.fahrzeug}`,
          html, text: `Ihre Meldung ${storung.id} wurde gel\u00f6scht.\nGel\u00f6scht von: ${deletedBy}\nBegr\u00fcndung: ${grund}`,
        });
        console.log(`[Mailer] L\u00f6sch-Mail Melder gesendet: ${melderMail}`);
      } catch (err) {
        console.error('[Mailer] sendDeleteMail Melder FEHLER:', err.message);
      }
    }
  }
}

module.exports = { sendStorungMail, sendMelderBestaetigung, sendStatusMail, sendDeleteMail };
