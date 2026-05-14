'use strict';
/**
 * reminder.js
 * – Prüft jede Minute ob Erinnerungen fällig sind
 * – Prüft stündlich ob Tickets eskaliert werden müssen
 */
const db     = require('./database');
const mailer = require('./mailer');

// ── Erinnerungs-Cron ──────────────────────────────────────────────────────────
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
      console.log(`[Reminder] Erinnerung gesendet: ${storung.id} → ${to}`);
      await db.clearReminder(storung.id);
    }
  } catch (err) {
    console.error('[Reminder] Fehler:', err.message);
  }
}

// ── Eskalations-Cron ──────────────────────────────────────────────────────────
/**
 * Eskalationsintervall in Stunden (Standard: 24h).
 * Kann per ENV überschrieben werden: ESKALATION_STUNDEN=8
 */
const ESKALATION_STUNDEN = parseInt(process.env.ESKALATION_STUNDEN || '24', 10);

async function checkEskalationen() {
  try {
    const liste = mailer.getEskalationsListe();
    if (!liste.length) return; // keine Eskalationsliste konfiguriert

    const faellig = await db.getEskalationsFaellige(ESKALATION_STUNDEN);
    if (!faellig.length) return;

    // Aktuell abwesende Admins laden
    const abwesende = await db.getAbwesendeAdmins();
    const abwesendeUsernames = abwesende.map(a => a.username);

    for (const row of faellig) {
      const full = await db.getStorungById(row.id);
      if (!full || full.status !== 'gesendet') continue;

      const naechsteStufe = (full.eskalation_stufe || 0) + 1;

      // Prüfen ob es noch einen Admin auf dieser Stufe gibt
      const sent = await mailer.sendEskalationsMail(full, naechsteStufe - 1, abwesendeUsernames);
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

// ── Start ─────────────────────────────────────────────────────────────────────
function start() {
  // Erinnerungen: sofort + jede Minute
  checkReminders();
  setInterval(checkReminders, 60 * 1000);

  // Eskalation: sofort + jede Stunde
  checkEskalationen();
  setInterval(checkEskalationen, 60 * 60 * 1000);

  console.log(`[Reminder] Cron gestartet (Erinnerungen: 60s | Eskalation: 1h, Schwelle: ${ESKALATION_STUNDEN}h)`);
}

module.exports = { start };
