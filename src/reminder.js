'use strict';
/**
 * reminder.js
 * Zwei Crons – beide laufen zur vollen Stunde:
 *
 * 1) Reminder-Cron (stündlich, zur vollen Stunde)
 *    Prüft fällige Erinnerungen aus stoerung_reminders (pro Admin).
 *    Jeder Admin erhält seine eigene Erinnerungsmail.
 *    Nach dem Versand wird nur der eigene Eintrag gelöscht.
 *
 * 2) Eskalations-Cron (stündlich, zur vollen Stunde)
 *    Prüft ob Tickets ohne Reaktion eskaliert werden müssen.
 */
const db     = require('./database');
const mailer = require('./mailer');

const ESKALATION_STUNDEN = parseInt(process.env.ESKALATION_STUNDEN || '24', 10);

function msUntilNextFullHour() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return next.getTime() - now.getTime();
}

// ── 1) Reminder ────────────────────────────────────────────────────────────────

async function checkReminder() {
  try {
    const faellig = await db.getDueReminders();
    if (!faellig.length) return;

    for (const row of faellig) {
      const full = await db.getStorungById(row.stoerungId);
      if (!full) {
        await db.clearUserReminder(row.stoerungId, row.username);
        continue;
      }

      await mailer.sendReminderMail(full, row.username);
      await db.clearUserReminder(full.id, row.username);
      console.log(`[Reminder] Erinnerung gesendet für Ticket ${full.id} an ${row.username}`);
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

// ── Gemeinsamer stündlicher Job ────────────────────────────────────────────────

async function runHourlyJobs() {
  await checkReminder();
  await checkEskalationen();
}

// ── Start ──────────────────────────────────────────────────────────────────────

function start() {
  const wartezeit = msUntilNextFullHour();
  const minuten   = Math.round(wartezeit / 60000);

  console.log(`[Reminder] Nächster Lauf in ${minuten} Min (zur vollen Stunde).`);

  // Beim ersten Start: sofort Eskalationen prüfen (laufende Tickets nicht verzögern)
  // Reminder werden NICHT sofort geprüft – Erinnerungen gelten erst ab nächster voller Stunde
  checkEskalationen();

  setTimeout(() => {
    runHourlyJobs();
    setInterval(runHourlyJobs, 60 * 60 * 1000);
    console.log(`[Reminder] Stündlicher Cron aktiv (Reminder + Eskalation zur vollen Stunde).`);
  }, wartezeit);

  console.log(`[Reminder] Eskalations-Schwelle: ${ESKALATION_STUNDEN}h`);
}

module.exports = { start };
