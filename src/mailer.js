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
  klein: '\uD83D\uDFE2 Klein', normal: '\uD83D\uDFE1 Normal', totalausfall: '\uD83D\uDD34 Totalausfall',
};
const KLASSE_LABEL = { kfz: 'KFZ', geraet: 'Ger\u00e4t' };
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
.changed-by{background:#eaf4fb;border-left:3px solid #2980b9;padding:8px 12px;border-radius:4px;font-size:13px;margin:8px 0}
.klasse-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:bold;background:#e8f4f8;color:#1a6080}
.eskalation-banner{background:#fdecea;border-left:4px solid #c0392b;padding:10px 14px;border-radius:4px;font-size:13px;margin-bottom:12px;font-weight:bold}`;

function extractMelderMail(kontakt) {
  const match = String(kontakt || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].trim() : null;
}

function getEskalationsListe() {
  const raw = process.env.ADMIN_ESCALATION || '';
  return raw.split(',').reduce((acc, entry) => {
    const [username, email] = entry.trim().split(':').map(s => s.trim());
    if (username && email && email.includes('@')) acc.push({ username, email });
    return acc;
  }, []);
}

function resolveAdminMail(username) {
  if (!username) return null;
  const liste = getEskalationsListe();
  const entry = liste.find(e => e.username === username);
  return entry ? entry.email : null;
}

async function resolveEskalationsEmpfaenger(stufe, abwesendeUsernames) {
  const liste = getEskalationsListe();
  const abwesendSet = new Set(abwesendeUsernames || []);
  const verfuegbare = liste.filter(e => !abwesendSet.has(e.username));
  return verfuegbare[stufe] || null;
}

function getWerkstattRecipients(klasse) {
  const envKey = klasse === 'geraet' ? 'MAIL_GERAET' : 'MAIL_KFZ';
  const raw = process.env[envKey] || '';
  return raw.split(',').map(e => e.trim()).filter(Boolean);
}

// ── HTML-Builder ──────────────────────────────────────────────────────────────────────────────

/** Admin-Mail: Neue Meldung oder Eskalation.
 *  - kein 'Erfasst von' (ist nur intern relevant)
 *  - kein 'Status geändert von' (entfernt per Issue #25)
 */
function buildAdminHtml(storung, alterSchwere, eskalationsStufe) {
  const baseUrl   = process.env.APP_BASE_URL;
  const schwere   = SCHWERE_LABEL[storung.schwere]  || storung.schwere;
  const status    = STATUS_LABEL[storung.status]    || storung.status;
  const klasse    = KLASSE_LABEL[storung.klasse]    || storung.klasse || 'KFZ';
  const datum     = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const detailUrl = `${baseUrl}/stoerung/${storung.id}`;
  const schwereChangeHtml = alterSchwere
    ? `<tr><th>Schweregrad ge\u00e4ndert</th><td class="schwere-change"><strong>${SCHWERE_LABEL[alterSchwere] || alterSchwere} \u2192 ${schwere}</strong></td></tr>`
    : '';
  const eskalationsBanner = eskalationsStufe && eskalationsStufe > 0
    ? `<div class="eskalation-banner">\u26A0\uFE0F Eskalationsstufe ${eskalationsStufe}: Bisher keine Reaktion auf diese Meldung.</div>`
    : '';
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}</style></head><body><div class="wrap">
  <div class="header"><h1>\uD83D\uDEA8 St\u00f6rungsmeldung \u2013 ${escHtml(storung.fahrzeug)}</h1><p>Eingegangen: ${datum}</p></div>
  <div class="body">
    ${eskalationsBanner}
    <table>
      <tr><th>Fahrzeug</th><td><strong>${escHtml(storung.fahrzeug)}</strong></td></tr>
      <tr><th>Klasse</th><td><span class="klasse-badge">${escHtml(klasse)}</span></td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      ${schwereChangeHtml}
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Status</th><td><strong>${status}</strong></td></tr>
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)} \u2013 ${escHtml(storung.melderKontakt)}</td></tr>
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

function buildWerkstattHtml(storung, changedBy) {
  const baseUrl   = process.env.APP_BASE_URL;
  const schwere   = SCHWERE_LABEL[storung.schwere]  || storung.schwere;
  const klasse    = KLASSE_LABEL[storung.klasse]    || storung.klasse || 'KFZ';
  const datum     = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const detailUrl = `${baseUrl}/stoerung/${storung.id}`;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}</style></head><body><div class="wrap">
  <div class="header"><h1>\uD83D\uDD27 Auftrag f\u00fcr ${escHtml(klasse)}-Werkstatt: ${escHtml(storung.fahrzeug)}</h1><p>Ticket: ${storung.id}</p></div>
  <div class="body">
    <p style="font-size:15px">Eine St\u00f6rung wurde zur Bearbeitung freigegeben.</p>
    <table>
      <tr><th>Fahrzeug</th><td><strong>${escHtml(storung.fahrzeug)}</strong></td></tr>
      <tr><th>Klasse</th><td><span class="klasse-badge">${escHtml(klasse)}</span></td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)} \u2013 ${escHtml(storung.melderKontakt)}</td></tr>
      <tr><th>Erfasst am</th><td>${datum}</td></tr>
      <tr><th>Freigegeben von</th><td><strong>${escHtml(changedBy)}</strong></td></tr>
      <tr><th>Ticket-Nr.</th><td><code>${storung.id}</code></td></tr>
    </table>
    ${storung.beschreibung ? `<div class="desc">${escHtml(storung.beschreibung)}</div>` : ''}
    <a href="${detailUrl}" class="btn">Ticket ansehen \u2192</a>
  </div>
  <div class="footer">Feuerwehr LZ Frechen \u2013 St\u00f6rungsmelder</div>
</div></body></html>`;
}

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
        : 'Sie erhalten keine weiteren automatischen Benachrichtigungen.<br>Bei R\u00fcckfragen verwenden Sie bitte Ihre Ticket-Nummer.'}
    </p>
  </div>
  <div class="footer">Feuerwehr LZ Frechen \u2013 St\u00f6rungsmelder</div>
</div></body></html>`;
}

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
  const changedByHtml = changedBy
    ? `<div class="changed-by" style="margin-top:12px">\uD83D\uDC64 <strong>Status ge\u00e4ndert von:</strong> ${escHtml(changedBy)}</div>`
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

function buildDeleteHtml(storung, deletedBy, grund) {
  const klasse = KLASSE_LABEL[storung.klasse] || storung.klasse || 'KFZ';
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  const datum = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>${CSS}</style></head><body><div class="wrap">
  <div class="header"><h1>\uD83D\uDDD1\uFE0F Ticket gel\u00f6scht \u2013 ${escHtml(storung.fahrzeug)}</h1><p>Ticket: ${escHtml(storung.id)}</p></div>
  <div class="body">
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Klasse</th><td><span class="klasse-badge">${escHtml(klasse)}</span></td></tr>
      <tr><th>Schweregrad</th><td>${schwere}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Gel\u00f6scht von</th><td><strong>${escHtml(deletedBy)}</strong></td></tr>
      <tr><th>Grund</th><td>${escHtml(grund)}</td></tr>
      <tr><th>Erfasst am</th><td>${datum}</td></tr>
      <tr><th>Ticket-Nr.</th><td><code>${storung.id}</code></td></tr>
    </table>
  </div>
  <div class="footer">Feuerwehr LZ Frechen \u2013 St\u00f6rungsmelder</div>
</div></body></html>`;
}

// ── Öffentliche Funktionen ─────────────────────────────────────────────────────────────────────────────

async function sendStorungMail(storung, abwesendeUsernames) {
  const empfaenger = await resolveEskalationsEmpfaenger(0, abwesendeUsernames || []);
  if (!empfaenger) {
    console.warn('[Mailer] Keine verf\u00fcgbaren Admins in ADMIN_ESCALATION f\u00fcr neue St\u00f6rung.');
    return;
  }
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  const klasse  = KLASSE_LABEL[storung.klasse]   || storung.klasse || 'KFZ';
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   empfaenger.email,
      subject: `[St\u00f6rung] ${storung.fahrzeug} | ${klasse} | ${schwere} \u2013 ${storung.fehlerBeschreibung.slice(0, 50)}`,
      html: buildAdminHtml(storung, null, 0),
      text: `St\u00f6rung: ${storung.fahrzeug} (${klasse})\nMelder: ${storung.melderName}\nFehler: ${storung.fehlerBeschreibung}\nMeldungs-ID: ${storung.id}`,
    });
    console.log(`[Mailer] Neue St\u00f6rung an: ${empfaenger.username} <${empfaenger.email}>`);
  } catch (err) {
    console.error('[Mailer] sendStorungMail FEHLER:', err.message);
  }
}

async function sendMelderBestaetigung(storung) {
  const melderMail = extractMelderMail(storung.melderKontakt);
  if (!melderMail) { console.log('[Mailer] Keine Melder-Mail, Best\u00e4tigung \u00fcbersprungen'); return; }
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   melderMail,
      subject: `\u2705 St\u00f6rungsmeldung eingegangen \u2013 Ticket ${storung.id}`,
      html: buildMelderBestaetigung(storung),
      text: `Hallo ${storung.melderName},\nIhre Meldung wurde erfasst. Ticket-Nr.: ${storung.id}`,
    });
    console.log(`[Mailer] Best\u00e4tigung an Melder: ${melderMail}`);
  } catch (err) {
    console.error('[Mailer] sendMelderBestaetigung FEHLER:', err.message);
  }
}

async function sendEskalationsMail(storung, stufe, abwesendeUsernames) {
  const empfaenger = await resolveEskalationsEmpfaenger(stufe, abwesendeUsernames || []);
  if (!empfaenger) {
    console.warn(`[Mailer] Eskalation Stufe ${stufe}: Keine weiteren verf\u00fcgbaren Admins.`);
    return false;
  }
  const klasse = KLASSE_LABEL[storung.klasse] || storung.klasse || 'KFZ';
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   empfaenger.email,
      subject: `[\u26A0\uFE0F Eskalation ${stufe}] ${storung.fahrzeug} | ${klasse} | ${schwere} \u2013 ${storung.fehlerBeschreibung.slice(0, 45)}`,
      html: buildAdminHtml(storung, null, stufe),
      text: `Eskalation Stufe ${stufe}:\nFahrzeug: ${storung.fahrzeug}\nFehler: ${storung.fehlerBeschreibung}\nTicket: ${storung.id}\nBisher keine Reaktion.`,
    });
    console.log(`[Mailer] Eskalation Stufe ${stufe} an: ${empfaenger.username} <${empfaenger.email}>`);
    return true;
  } catch (err) {
    console.error(`[Mailer] sendEskalationsMail Stufe ${stufe} FEHLER:`, err.message);
    return false;
  }
}

async function sendStatusMail(storung, changedBy, note) {
  const alterSchwere = storung._schwereGeaendert ? storung._alterSchwere : null;
  const status = STATUS_LABEL[storung.status] || storung.status;
  const klasse = KLASSE_LABEL[storung.klasse] || storung.klasse || 'KFZ';

  // 1. Best\u00e4tigung an den Admin der die \u00c4nderung vorgenommen hat
  const changedByMail = resolveAdminMail(changedBy);
  if (changedByMail) {
    const schwereHinweis = alterSchwere
      ? ` [Schwere: ${SCHWERE_LABEL[alterSchwere] || alterSchwere} \u2192 ${SCHWERE_LABEL[storung.schwere] || storung.schwere}]`
      : '';
    try {
      await getTransport().sendMail({
        from: process.env.MAIL_FROM,
        to:   changedByMail,
        subject: `[Status] ${storung.fahrzeug} | ${klasse} \u2192 ${status}${schwereHinweis} | ${storung.id}`,
        html: buildAdminHtml(storung, alterSchwere, 0),
        text: `Statuswechsel: ${storung.fahrzeug} (${klasse}) \u2192 ${status}\nGe\u00e4ndert von: ${changedBy}`,
      });
      console.log(`[Mailer] Status-Mail an: ${changedBy} <${changedByMail}>`);
    } catch (err) { console.error('[Mailer] sendStatusMail Admin FEHLER:', err.message); }
  } else {
    console.warn(`[Mailer] sendStatusMail: Keine Mail f\u00fcr Admin '${changedBy}' in ADMIN_ESCALATION.`);
  }

  // 2. Werkstatt-Mail bei 'bestaetigt'
  if (storung.status === 'bestaetigt') {
    const werkstattRecipients = getWerkstattRecipients(storung.klasse);
    if (werkstattRecipients.length) {
      try {
        await getTransport().sendMail({
          from: process.env.MAIL_FROM,
          to:   werkstattRecipients.join(', '),
          subject: `[Auftrag ${klasse}] ${storung.fahrzeug} \u2013 ${storung.fehlerBeschreibung.slice(0, 50)} | ${storung.id}`,
          html: buildWerkstattHtml(storung, changedBy),
          text: `Auftrag f\u00fcr ${klasse}-Werkstatt:\nFahrzeug: ${storung.fahrzeug}\nFehler: ${storung.fehlerBeschreibung}\nTicket: ${storung.id}\nFreigegeben von: ${changedBy}`,
        });
        console.log(`[Mailer] Werkstatt-Mail (${klasse}) an: ${werkstattRecipients.join(', ')}`);
      } catch (err) { console.error('[Mailer] sendStatusMail Werkstatt FEHLER:', err.message); }
    } else {
      console.warn(`[Mailer] Keine Werkstatt-Empf\u00e4nger f\u00fcr Klasse '${storung.klasse}' (${klasse === 'KFZ' ? 'MAIL_KFZ' : 'MAIL_GERAET'} nicht gesetzt).`);
    }
  }

  // 3. Melder (Opt-in oder Zur\u00fcckweisung)
  const melderMail = extractMelderMail(storung.melderKontakt);
  if (!melderMail) return;
  const isZurueck = storung.status === 'zurueckgewiesen';
  if (!isZurueck && Number(storung.melderBenachrichtigung) !== 1) return;
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   melderMail,
      subject: isZurueck
        ? `\u274C Ihre St\u00f6rungsmeldung wurde zur\u00fcckgewiesen \u2013 Ticket ${storung.id}`
        : `\uD83D\uDD14 Status\u00e4nderung Ihrer St\u00f6rungsmeldung \u2013 ${status}`,
      html: buildMelderStatusHtml(storung, note, changedBy, alterSchwere),
      text: `Hallo ${storung.melderName},\nStatus Ihrer Meldung ${storung.id}: ${status}\nGe\u00e4ndert von: ${changedBy}`,
    });
  } catch (err) { console.error('[Mailer] sendStatusMail Melder FEHLER:', err.message); }
}

async function sendDeleteMail(storung, deletedBy, grund) {
  const liste = getEskalationsListe();
  if (!liste.length) { console.warn('[Mailer] sendDeleteMail: ADMIN_ESCALATION leer.'); return; }
  const empfaenger = liste.map(e => e.email).join(', ');
  const klasse = KLASSE_LABEL[storung.klasse] || storung.klasse || 'KFZ';
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   empfaenger,
      subject: `[Gel\u00f6scht] ${storung.fahrzeug} | ${klasse} | ${storung.id} \u2013 von ${deletedBy}`,
      html: buildDeleteHtml(storung, deletedBy, grund),
      text: `Ticket gel\u00f6scht:\nFahrzeug: ${storung.fahrzeug}\nTicket: ${storung.id}\nGel\u00f6scht von: ${deletedBy}\nGrund: ${grund}`,
    });
    console.log(`[Mailer] Delete-Mail an alle Admins: ${empfaenger}`);
  } catch (err) {
    console.error('[Mailer] sendDeleteMail FEHLER:', err.message);
  }
}

module.exports = {
  sendStorungMail,
  sendMelderBestaetigung,
  sendEskalationsMail,
  sendStatusMail,
  sendDeleteMail,
  resolveAdminMail,
  getEskalationsListe,
};
