'use strict';
/**
 * reminder.js
 * Zwei Crons:
 *
 * 1) Reminder-Cron (alle 5 Min)
 *    Prüft fällige Erinnerungen (reminderAt <= jetzt) und schickt dem
 *    gespeicherten Admin die gleiche Admin-Mail nochmal – Betreff: [Erinnerung]
 *
 * 2) Eskalations-Cron (stündlich)
 *    Prüft ob Tickets ohne Reaktion eskaliert werden müssen.
 *    - Stufe 0 → nach ESKALATION_STUNDEN → Mail an Eskalation[0] (nächster nach Erstempfänger)
 *    - Stufe N → nach ESKALATION_STUNDEN → Mail an Eskalation[N]
 *    - Abwesende Admins werden übersprungen
 */
const db     = require('./database');
const mailer = require('./mailer');

const ESKALATION_STUNDEN = parseInt(process.env.ESKALATION_STUNDEN || '24', 10);

// ── 1) Reminder ────────────────────────────────────────────────────────────────

async function checkReminder() {
  try {
    const faellig = await db.getDueReminders();
    if (!faellig.length) return;

    for (const row of faellig) {
      const full = await db.getStorungById(row.id);
      if (!full) { await db.clearReminder(row.id); continue; }

      await mailer.sendReminderMail(full, row.reminderTo);
      await db.clearReminder(full.id);
      console.log(`[Reminder] Erinnerung gesendet für Ticket ${full.id} an ${row.reminderTo}`);
    }
  } catch (err) {
    console.error('[Reminder] Fehler:', err.message);
  }
}

// ── 2) Eskalation ──────────────────────────────────────────────────────────────

async function checkEskalationen() {
  try {
    const liste = mailer.getEskalationsListe();
    if (!liste.length) return;

    const faellig = await db.getEskalationsFaellige(ESKALATION_STUNDEN);
    if (!faellig.length) return;

    const abwesende = await db.getAbwesendeAdmins();
    const abwesendeUsernames = abwesende.map(a => a.username);

    for (const row of faellig) {
      const full = await db.getStorungById(row.id);
      if (!full || full.status !== 'gesendet') continue;

      // naechsteStufe direkt als Index übergeben (kein -1 mehr)
      const naechsteStufe = (full.eskalation_stufe || 0) + 1;

      const sent = await mailer.sendEskalationsMail(full, naechsteStufe, abwesendeUsernames);
      if (sent) {
        await db.setEskalationsStufe(full.id, naechsteStufe);
        console.log(`[Eskalation] Ticket ${full.id} → Stufe ${naechsteStufe}`);
      } else {
        console.warn(`[Eskalation] Ticket ${full.id}: Keine weiteren Admins verfügbar (Stufe ${naechsteStufe}).`);
      }
    }
  } catch (err) {
    console.error('[Eskalation] Fehler:', err.message);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────────

function start() {
  // Reminder: sofort + alle 5 Minuten
  checkReminder();
  setInterval(checkReminder, 5 * 60 * 1000);

  // Eskalation: sofort + jede Stunde
  checkEskalationen();
  setInterval(checkEskalationen, 60 * 60 * 1000);

  console.log(`[Reminder] Reminder-Cron gestartet (Intervall: 5min)`);
  console.log(`[Reminder] Eskalations-Cron gestartet (Intervall: 1h | Schwelle: ${ESKALATION_STUNDEN}h)`);
}

module.exports = { start };
