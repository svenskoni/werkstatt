'use strict';
/**
 * reminder.js – läuft jede Minute:
 *   1. Erinnerungen (Reminder) für Admins
 *   2. Eskalations-Prüfung für unbearbeitete Störungen
 */
const db     = require('./database');
const mailer = require('./mailer');

const ESKALATIONS_STUNDEN = parseInt(process.env.ESKALATION_STUNDEN || '24', 10);

async function checkReminders() {
  try {
    const due = await db.getDueReminders();
    for (const storung of due) {
      const to = storung.reminderTo;
      if (!to) { await db.clearReminder(storung.id); continue; }
      const full = await db.getStorungById(storung.id);
      full._alterSchwere     = null;
      full._schwereGeaendert = false;
      await mailer.sendReminderMail(full, to);
      console.log(`[Reminder] Erinnerung gesendet: ${storung.id} \u2192 ${to}`);
      await db.clearReminder(storung.id);
    }
  } catch (err) {
    console.error('[Reminder] Fehler:', err.message);
  }
}

async function checkEskalation() {
  try {
    const kette = mailer.getEskalationsKette();
    if (!kette.length) return; // keine Kette konfiguriert → kein Eskalations-Job

    const faellig = await db.getEskalationsFaellige(ESKALATIONS_STUNDEN);
    if (!faellig.length) return;

    const abwesend = await db.getAbwesendeAdmins();
    const abwesendeUsernames = abwesend.map(a => a.username);

    for (const s of faellig) {
      const naechsteStufe = (Number(s.eskalation_stufe) || 0) + 1;
      const empfaenger    = mailer.getEskalationsEmpfaenger(naechsteStufe - 1, abwesendeUsernames);

      if (!empfaenger) {
        console.warn(`[Eskalation] Keine verf\u00fcgbaren Admins mehr f\u00fcr Ticket ${s.id} (Stufe ${naechsteStufe})`);
        // Stufe trotzdem hochsetzen damit nicht ewig re-eskaliert wird
        await db.setEskalationsStufe(s.id, naechsteStufe);
        continue;
      }

      const full = await db.getStorungById(s.id);
      await mailer.sendEskalationsMail(full, empfaenger, naechsteStufe);
      await db.setEskalationsStufe(s.id, naechsteStufe);
      console.log(`[Eskalation] Stufe ${naechsteStufe} f\u00fcr ${s.id} \u2192 ${empfaenger.username}`);
    }
  } catch (err) {
    console.error('[Eskalation] Fehler:', err.message);
  }
}

function start() {
  checkReminders();
  checkEskalation();
  setInterval(checkReminders,  60 * 1000);
  setInterval(checkEskalation, 60 * 60 * 1000); // stündlich
  console.log('[Reminder] Reminder + Eskalations-Cron gestartet');
}

module.exports = { start };
