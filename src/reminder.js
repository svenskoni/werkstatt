'use strict';
/**
 * reminder.js – prüft jede Minute ob Erinnerungen fällig sind
 * und sendet die Status-Mail erneut an den zuständigen Admin.
 */
const db     = require('./database');
const mailer = require('./mailer');

async function checkReminders() {
  try {
    const due = await db.getDueReminders();
    for (const storung of due) {
      const to = storung.reminderTo;
      if (!to) { await db.clearReminder(storung.id); continue; }

      // Vollständiges Objekt laden (inkl. history/attachments)
      const full = await db.getStorungById(storung.id);
      full._alterSchwere     = null;
      full._schwereGeaendert = false;

      await mailer.sendReminderMail(full, to);
      console.log(`[Reminder] Erinnerung gesendet: ${storung.id} → ${to}`);

      // Reminder löschen damit er nicht nochmal feuert
      await db.clearReminder(storung.id);
    }
  } catch (err) {
    console.error('[Reminder] Fehler:', err.message);
  }
}

function start() {
  // Sofort prüfen, dann jede Minute
  checkReminders();
  setInterval(checkReminders, 60 * 1000);
  console.log('[Reminder] Reminder-Cron gestartet (60s Intervall)');
}

module.exports = { start };
