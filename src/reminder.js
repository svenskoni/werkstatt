'use strict';
/**
 * reminder.js
 * Eskalations-Cron: Prüft stündlich ob Tickets eskaliert werden müssen.
 *
 * Logik:
 * - Neues Ticket → Mail geht an Eskalation[0] (erster verfügbarer Admin)
 * - Nach ESKALATION_STUNDEN (Standard: 24h) ohne Reaktion (Status bleibt 'gesendet')
 *   → Mail an nächsten Admin in der Eskalationsliste
 * - Abwesende Admins (admin_urlaub-Tabelle) werden übersprungen
 * - Läuft bis alle Admins benachrichtigt wurden
 */
const db     = require('./database');
const mailer = require('./mailer');

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

function start() {
  // Eskalation: sofort + jede Stunde
  checkEskalationen();
  setInterval(checkEskalationen, 60 * 60 * 1000);

  console.log(`[Reminder] Eskalations-Cron gestartet (Intervall: 1h | Schwelle: ${ESKALATION_STUNDEN}h)`);
}

module.exports = { start };
