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
  const entry = getEskalationsListe().find(e => e.username === username);
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
  return (process.env[envKey] || '').split(',').map(e => e.trim()).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════════════════════
// CSS – gemeinsame Basis für alle Mails
// ══════════════════════════════════════════════════════════════════════════════
const CSS_BASE = `
body{font-family:Arial,sans-serif;color:#222;background:#f4f4f4;margin:0;padding:0}
.wrap{max-width:600px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.header{padding:20px 28px;color:#fff}
.header h1{margin:0;font-size:20px;font-weight:bold}
.header p{margin:4px 0 0;opacity:.85;font-size:13px}
.type-banner{padding:10px 28px;font-size:13px;font-weight:bold;border-bottom:1px solid rgba(0,0,0,.08)}
.body{padding:24px 28px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:9px 12px;border:1px solid #e0e0e0;font-size:14px;text-align:left}
th{background:#f7f7f7;width:38%}
.btn{display:inline-block;margin-top:16px;padding:11px 22px;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold}
.desc{background:#f9f9f9;border-left:3px solid #ccc;padding:10px 14px;border-radius:4px;font-size:13px;white-space:pre-wrap;margin-top:12px}
.ticket{font-size:26px;font-weight:bold;letter-spacing:1px;text-align:center;padding:14px;border-radius:6px;margin:16px 0}
.footer{padding:12px 28px;background:#f7f7f7;font-size:12px;color:#888;border-top:1px solid #e0e0e0;text-align:center}
.klasse-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:bold;background:#e8f4f8;color:#1a6080}
.info-box{padding:9px 14px;border-radius:4px;font-size:13px;margin:8px 0;border-left:4px solid #ccc}
`;

// ══════════════════════════════════════════════════════════════════════════════
// Mail-Typen für Admins
// Jeder Typ definiert: headerColor, bannerColor, bannerText, icon
// ══════════════════════════════════════════════════════════════════════════════
const MAIL_TYPES = {
  neu: {
    headerColor: '#c0392b',
    bannerColor: '#fdecea', bannerText: '#c0392b',
    icon: '\uD83D\uDEA8',
    label: 'Neue St\u00f6rungsmeldung',
    btnColor: '#c0392b',
  },
  statuswechsel: {
    headerColor: '#2980b9',
    bannerColor: '#eaf4fb', bannerText: '#1a5276',
    icon: '\uD83D\uDD04',
    label: 'Status\u00e4nderung',
    btnColor: '#2980b9',
  },
  werkstatt: {
    headerColor: '#1a7a4a',
    bannerColor: '#eafaf1', bannerText: '#1a7a4a',
    icon: '\uD83D\uDD27',
    label: 'Werkstattauftrag',
    btnColor: '#1a7a4a',
  },
  eskalation: {
    headerColor: '#922b21',
    bannerColor: '#fdecea', bannerText: '#922b21',
    icon: '\u26A0\uFE0F',
    label: 'Eskalation',
    btnColor: '#922b21',
  },
  erinnerung: {
    headerColor: '#b7770d',
    bannerColor: '#fef9e7', bannerText: '#7d6608',
    icon: '\u23F0',
    label: 'Erinnerung',
    btnColor: '#b7770d',
  },
  geloescht: {
    headerColor: '#555',
    bannerColor: '#f5f5f5', bannerText: '#444',
    icon: '\uD83D\uDDD1\uFE0F',
    label: 'Ticket gel\u00f6scht',
    btnColor: '#555',
  },
};

/**
 * Einheitlicher Admin-Mail-Builder.
 *
 * @param {object} storung
 * @param {object} opts
 *   type          - Schlüssel aus MAIL_TYPES (default: 'neu')
 *   eskalationsStufe - Zahl, nur bei type='eskalation'
 *   alterSchwere  - vorheriger Schwere-Wert (string)
 *   changedBy     - Username des Ändernden
 *   grund         - Lösch-Grund (nur type='geloescht')
 *   note          - Freitext-Hinweis
 *   extraRows     - array von { label, value, raw } für zusätzliche Tabellenzeilen
 */
function buildAdminHtml(storung, opts = {}) {
  const type    = MAIL_TYPES[opts.type] || MAIL_TYPES.neu;
  const baseUrl = process.env.APP_BASE_URL;
  const schwere = SCHWERE_LABEL[storung.schwere]  || storung.schwere;
  const status  = STATUS_LABEL[storung.status]    || storung.status;
  const klasse  = KLASSE_LABEL[storung.klasse]    || storung.klasse || 'KFZ';
  const datum   = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const detailUrl = `${baseUrl}/stoerung/${storung.id}`;

  // Banner-Zeile (Typ-spezifisch)
  const bannerText = opts.type === 'eskalation' && opts.eskalationsStufe > 0
    ? `${type.icon} Eskalationsstufe ${opts.eskalationsStufe}: Bisher keine Reaktion auf diese Meldung.`
    : opts.type === 'erinnerung'
    ? `${type.icon} Erinnerung: Dieses Ticket wartet noch auf Bearbeitung.`
    : `${type.icon} ${type.label}`;

  // Schwere-Änderung-Zeile
  const schwereRow = opts.alterSchwere
    ? `<tr><th>Schwere geändert</th><td style="color:#c0392b"><strong>${escHtml(SCHWERE_LABEL[opts.alterSchwere] || opts.alterSchwere)} \u2192 ${escHtml(schwere)}</strong></td></tr>`
    : '';

  // Zusätzliche Zeilen je nach Typ
  let extraRowsHtml = '';
  if (opts.type === 'statuswechsel' || opts.type === 'werkstatt') {
    extraRowsHtml += `<tr><th>Status</th><td><strong>${escHtml(status)}</strong></td></tr>`;
  }
  if (opts.changedBy) {
    const label = opts.type === 'werkstatt' ? 'Freigegeben von' : 'Geändert von';
    extraRowsHtml += `<tr><th>${label}</th><td><strong>${escHtml(opts.changedBy)}</strong></td></tr>`;
  }
  if (opts.type === 'geloescht' && opts.grund) {
    extraRowsHtml += `<tr><th>Lösch-Grund</th><td>${escHtml(opts.grund)}</td></tr>`;
  }
  if (opts.extraRows) {
    opts.extraRows.forEach(r => {
      extraRowsHtml += `<tr><th>${escHtml(r.label)}</th><td>${r.raw ? r.value : escHtml(r.value)}</td></tr>`;
    });
  }

  // Hinweis-Box
  const noteHtml = opts.note
    ? `<div class="info-box" style="border-color:#2980b9;background:#eaf4fb;margin-top:12px">\uD83D\uDCAC <strong>Hinweis:</strong> ${escHtml(opts.note)}</div>`
    : '';

  // Anhänge
  const attachHtml = (storung.attachments && storung.attachments.length > 0)
    ? `<p style="font-size:13px;color:#666;margin-top:8px">\uD83D\uDCCE ${storung.attachments.length} Anhang/Anhänge</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><style>${CSS_BASE}</style></head>
<body>
<div class="wrap">
  <div class="header" style="background:${type.headerColor}">
    <h1>${type.icon} Störungsmelder – ${escHtml(storung.fahrzeug)}</h1>
    <p>Ticket&nbsp;${escHtml(storung.id)} &middot; ${datum}</p>
  </div>
  <div class="type-banner" style="background:${type.bannerColor};color:${type.bannerText}">${bannerText}</div>
  <div class="body">
    <table>
      <tr><th>Fahrzeug</th><td><strong>${escHtml(storung.fahrzeug)}</strong></td></tr>
      <tr><th>Klasse</th><td><span class="klasse-badge">${escHtml(klasse)}</span></td></tr>
      <tr><th>Schweregrad</th><td>${escHtml(schwere)}</td></tr>
      ${schwereRow}
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Gemeldet von</th><td>${escHtml(storung.melderName)} – ${escHtml(storung.melderKontakt)}</td></tr>
      <tr><th>Erfasst am</th><td>${datum}</td></tr>
      ${extraRowsHtml}
      <tr><th>Meldungs-ID</th><td><code>${escHtml(storung.id)}</code></td></tr>
    </table>
    ${storung.beschreibung ? `<div class="desc" style="border-color:${type.headerColor}">${escHtml(storung.beschreibung)}</div>` : ''}
    ${noteHtml}
    ${attachHtml}
    ${opts.type !== 'geloescht' ? `<a href="${detailUrl}" class="btn" style="background:${type.btnColor}">Detail ansehen \u2192</a>` : ''}
  </div>
  <div class="footer">Feuerwehr LZ Frechen &ndash; Störungsmelder</div>
</div>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Melder-Mails (Design eigene Farbe, aber gleiche Struktur)
// ══════════════════════════════════════════════════════════════════════════════

function buildMelderBestaetigung(storung) {
  const datum = new Date(storung.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><style>${CSS_BASE}</style></head>
<body>
<div class="wrap">
  <div class="header" style="background:#1a7a4a">
    <h1>\u2705 Störungsmeldung eingegangen</h1>
    <p>Feuerwehr LZ Frechen &ndash; Störungsmelder</p>
  </div>
  <div class="type-banner" style="background:#eafaf1;color:#1a7a4a">\u2705 Ihre Meldung wurde erfolgreich erfasst.</div>
  <div class="body">
    <p style="font-size:15px">Hallo ${escHtml(storung.melderName)},<br><br>
    Ihre Störungsmeldung für <strong>${escHtml(storung.fahrzeug)}</strong> wurde erfasst und wird zeitnah bearbeitet.</p>
    <div class="ticket" style="color:#1a7a4a;background:#eafaf1">\uD83C\uDFAB ${escHtml(storung.id)}</div>
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Eingegangen</th><td>${datum}</td></tr>
      <tr><th>Ticket-Nr.</th><td><code>${escHtml(storung.id)}</code></td></tr>
    </table>
    <p style="font-size:13px;color:#666;margin-top:16px">Bei Rückfragen verwenden Sie bitte Ihre Ticket-Nummer.</p>
  </div>
  <div class="footer">Feuerwehr LZ Frechen &ndash; Störungsmelder</div>
</div>
</body></html>`;
}

function buildMelderStatusHtml(storung, note, changedBy, alterSchwere) {
  const status = STATUS_LABEL[storung.status] || storung.status;
  const isZurueck = storung.status === 'zurueckgewiesen';
  const isErledigt = storung.status === 'erledigt';
  const statusColor = isErledigt ? '#1a7a4a' : isZurueck ? '#c0392b' : storung.status === 'bestaetigt' ? '#e67e22' : '#2980b9';
  const schwereChangeHtml = alterSchwere
    ? `<div class="info-box" style="border-color:#e67e22;background:#fef9e7;margin-top:10px">\u2139\uFE0F Schweregrad geändert: <strong>${escHtml(SCHWERE_LABEL[alterSchwere] || alterSchwere)} \u2192 ${escHtml(SCHWERE_LABEL[storung.schwere] || storung.schwere)}</strong></div>`
    : '';
  const abschlussHtml = isErledigt
    ? `<p style="font-size:13px;color:#1a7a4a;margin-top:12px">\u2705 Ihre Meldung wurde abgeschlossen. Vielen Dank!</p>`
    : isZurueck
    ? `<p style="font-size:13px;color:#c0392b;margin-top:12px">\u274C Ihr Ticket wurde zurückgewiesen. Bei Rückfragen wenden Sie sich bitte an ${escHtml(changedBy || 'die Werkstatt')}.</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><style>${CSS_BASE}.status-badge{display:inline-block;padding:6px 18px;border-radius:20px;font-weight:bold;font-size:16px;color:#fff;background:${statusColor}}</style></head>
<body>
<div class="wrap">
  <div class="header" style="background:${statusColor}">
    <h1>\uD83D\uDD14 Statusänderung – ${escHtml(storung.fahrzeug)}</h1>
    <p>Ticket&nbsp;${escHtml(storung.id)}</p>
  </div>
  <div class="type-banner" style="background:${statusColor}20;color:${statusColor}">Neuer Status: <strong>${escHtml(status)}</strong></div>
  <div class="body">
    <p style="font-size:15px">Hallo ${escHtml(storung.melderName)},<br><br>der Status Ihrer Störungsmeldung wurde aktualisiert:</p>
    <p style="text-align:center;margin:20px 0"><span class="status-badge">${escHtml(status)}</span></p>
    <table>
      <tr><th>Fahrzeug</th><td>${escHtml(storung.fahrzeug)}</td></tr>
      <tr><th>Fehler</th><td>${escHtml(storung.fehlerBeschreibung)}</td></tr>
      <tr><th>Schweregrad</th><td>${escHtml(SCHWERE_LABEL[storung.schwere] || storung.schwere)}</td></tr>
      <tr><th>Neuer Status</th><td><strong>${escHtml(status)}</strong></td></tr>
      <tr><th>Geändert von</th><td><strong>${escHtml(changedBy || '—')}</strong></td></tr>
      <tr><th>Ticket-Nr.</th><td><code>${escHtml(storung.id)}</code></td></tr>
    </table>
    ${schwereChangeHtml}
    ${note ? `<div class="info-box" style="border-color:#2980b9;background:#eaf4fb;margin-top:10px">\uD83D\uDCAC <strong>Hinweis:</strong> ${escHtml(note)}</div>` : ''}
    ${abschlussHtml}
  </div>
  <div class="footer">Feuerwehr LZ Frechen &ndash; Störungsmelder</div>
</div>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Öffentliche Funktionen
// ══════════════════════════════════════════════════════════════════════════════

async function sendStorungMail(storung, abwesendeUsernames) {
  const empfaenger = await resolveEskalationsEmpfaenger(0, abwesendeUsernames || []);
  if (!empfaenger) { console.warn('[Mailer] Keine verf\u00fcgbaren Admins f\u00fcr neue St\u00f6rung.'); return; }
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  const klasse  = KLASSE_LABEL[storung.klasse]   || storung.klasse || 'KFZ';
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   empfaenger.email,
      subject: `[St\u00f6rung] ${storung.fahrzeug} | ${klasse} | ${schwere} \u2013 ${storung.fehlerBeschreibung.slice(0, 50)}`,
      html: buildAdminHtml(storung, { type: 'neu' }),
      text: `St\u00f6rung: ${storung.fahrzeug} (${klasse})\nMelder: ${storung.melderName}\nFehler: ${storung.fehlerBeschreibung}\nTicket: ${storung.id}`,
    });
    console.log(`[Mailer] Neue St\u00f6rung an: ${empfaenger.username} <${empfaenger.email}>`);
  } catch (err) { console.error('[Mailer] sendStorungMail FEHLER:', err.message); }
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
  } catch (err) { console.error('[Mailer] sendMelderBestaetigung FEHLER:', err.message); }
}

async function sendEskalationsMail(storung, stufe, abwesendeUsernames) {
  const empfaenger = await resolveEskalationsEmpfaenger(stufe, abwesendeUsernames || []);
  if (!empfaenger) { console.warn(`[Mailer] Eskalation Stufe ${stufe}: Keine Admins.`); return false; }
  const klasse  = KLASSE_LABEL[storung.klasse]  || storung.klasse || 'KFZ';
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   empfaenger.email,
      subject: `[\u26A0\uFE0F Eskalation ${stufe}] ${storung.fahrzeug} | ${klasse} | ${schwere} \u2013 ${storung.fehlerBeschreibung.slice(0, 45)}`,
      html: buildAdminHtml(storung, { type: 'eskalation', eskalationsStufe: stufe }),
      text: `Eskalation Stufe ${stufe}:\nFahrzeug: ${storung.fahrzeug}\nFehler: ${storung.fehlerBeschreibung}\nTicket: ${storung.id}`,
    });
    console.log(`[Mailer] Eskalation Stufe ${stufe} an: ${empfaenger.username} <${empfaenger.email}>`);
    return true;
  } catch (err) { console.error(`[Mailer] sendEskalationsMail Stufe ${stufe} FEHLER:`, err.message); return false; }
}

async function sendReminderMail(storung, reminderTo) {
  if (!reminderTo) { console.warn(`[Mailer] sendReminderMail: kein Empf\u00e4nger f\u00fcr Ticket ${storung.id}`); return; }
  const adminMail = resolveAdminMail(reminderTo) || (reminderTo.includes('@') ? reminderTo : null);
  if (!adminMail) { console.warn(`[Mailer] sendReminderMail: Kein Mail f\u00fcr '${reminderTo}'.`); return; }
  const klasse  = KLASSE_LABEL[storung.klasse]  || storung.klasse || 'KFZ';
  const schwere = SCHWERE_LABEL[storung.schwere] || storung.schwere;
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   adminMail,
      subject: `[\u23F0 Erinnerung] ${storung.fahrzeug} | ${klasse} | ${schwere} \u2013 ${storung.fehlerBeschreibung.slice(0, 45)}`,
      html: buildAdminHtml(storung, { type: 'erinnerung' }),
      text: `Erinnerung:\nFahrzeug: ${storung.fahrzeug}\nFehler: ${storung.fehlerBeschreibung}\nTicket: ${storung.id}`,
    });
    console.log(`[Mailer] Erinnerung an: ${reminderTo} <${adminMail}>`);
  } catch (err) { console.error('[Mailer] sendReminderMail FEHLER:', err.message); }
}

async function sendStatusMail(storung, changedBy, note) {
  const alterSchwere = storung._schwereGeaendert ? storung._alterSchwere : null;
  const status  = STATUS_LABEL[storung.status] || storung.status;
  const klasse  = KLASSE_LABEL[storung.klasse] || storung.klasse || 'KFZ';

  // 1. Admin der die Änderung vorgenommen hat
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
        html: buildAdminHtml(storung, { type: 'statuswechsel', changedBy, alterSchwere, note }),
        text: `Statuswechsel: ${storung.fahrzeug} (${klasse}) \u2192 ${status}\nGe\u00e4ndert von: ${changedBy}`,
      });
      console.log(`[Mailer] Status-Mail an Admin: ${changedBy} <${changedByMail}>`);
    } catch (err) { console.error('[Mailer] sendStatusMail Admin FEHLER:', err.message); }
  } else {
    console.warn(`[Mailer] sendStatusMail: Keine Mail f\u00fcr Admin '${changedBy}'.`);
  }

  // 2. Werkstatt bei 'bestaetigt'
  if (storung.status === 'bestaetigt') {
    const werkstattRecipients = getWerkstattRecipients(storung.klasse);
    if (werkstattRecipients.length) {
      try {
        await getTransport().sendMail({
          from: process.env.MAIL_FROM,
          to:   werkstattRecipients.join(', '),
          subject: `[Auftrag ${klasse}] ${storung.fahrzeug} \u2013 ${storung.fehlerBeschreibung.slice(0, 50)} | ${storung.id}`,
          html: buildAdminHtml(storung, { type: 'werkstatt', changedBy }),
          text: `Auftrag f\u00fcr ${klasse}-Werkstatt:\nFahrzeug: ${storung.fahrzeug}\nFehler: ${storung.fehlerBeschreibung}\nTicket: ${storung.id}\nFreigegeben von: ${changedBy}`,
        });
        console.log(`[Mailer] Werkstatt-Mail (${klasse}) an: ${werkstattRecipients.join(', ')}`);
      } catch (err) { console.error('[Mailer] sendStatusMail Werkstatt FEHLER:', err.message); }
    } else {
      console.warn(`[Mailer] Keine Werkstatt-Empf\u00e4nger f\u00fcr Klasse '${storung.klasse}'.`);
    }
  }

  // 3. Melder nur bei Zurückweisung
  const melderMail = extractMelderMail(storung.melderKontakt);
  if (!melderMail || storung.status !== 'zurueckgewiesen') return;
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM,
      to:   melderMail,
      subject: `\u274C Ihre St\u00f6rungsmeldung wurde zur\u00fcckgewiesen \u2013 Ticket ${storung.id}`,
      html: buildMelderStatusHtml(storung, note, changedBy, alterSchwere),
      text: `Hallo ${storung.melderName},\nIhr Ticket ${storung.id} wurde zur\u00fcckgewiesen.\nGe\u00e4ndert von: ${changedBy}`,
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
      html: buildAdminHtml(storung, { type: 'geloescht', changedBy: deletedBy, grund }),
      text: `Ticket gel\u00f6scht:\nFahrzeug: ${storung.fahrzeug}\nTicket: ${storung.id}\nGel\u00f6scht von: ${deletedBy}\nGrund: ${grund}`,
    });
    console.log(`[Mailer] Delete-Mail an alle Admins: ${empfaenger}`);
  } catch (err) { console.error('[Mailer] sendDeleteMail FEHLER:', err.message); }
}

module.exports = {
  sendStorungMail,
  sendMelderBestaetigung,
  sendEskalationsMail,
  sendReminderMail,
  sendStatusMail,
  sendDeleteMail,
  resolveAdminMail,
  getEskalationsListe,
};
