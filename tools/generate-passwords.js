#!/usr/bin/env node
'use strict';
const bcrypt   = require('bcryptjs');
const readline = require('readline');

const rl     = readline.createInterface({ input: process.stdin, output: process.stdout });
const ROUNDS = 12;

/**
 * Generiert bcrypt-Hashes für das aktuelle Auth-System:
 *   ADMIN_1_PASS_HASH, ADMIN_2_PASS_HASH, …  (beliebig viele Admins)
 *   CREW_PASS_HASH                            (gemeinsames Melder-Passwort)
 *
 * Verwendung: node tools/generate-passwords.js
 */

async function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function hashPassword(label, envKey) {
  const pw = await ask(`Passwort für ${label}: `);
  if (!pw || pw.length < 8) {
    console.error('  ✗ Zu kurz (min. 8 Zeichen)');
    process.exit(1);
  }
  const hash = await bcrypt.hash(pw, ROUNDS);
  console.log(`  ✓ ${envKey}=${hash}\n`);
  return { key: envKey, hash };
}

(async () => {
  console.log('\n🔐 Passwort-Hash-Generator (bcrypt, cost=' + ROUNDS + ')\n');

  const results = [];

  // Admins
  const countStr = await ask('Wie viele Admins sollen Hashes erhalten? ');
  const count = parseInt(countStr, 10);
  if (isNaN(count) || count < 1) { console.error('Ungültige Anzahl.'); process.exit(1); }

  for (let i = 1; i <= count; i++) {
    const nameKey = `ADMIN_${i}_NAME`;
    const hashKey = `ADMIN_${i}_PASS_HASH`;
    const name    = await ask(`Benutzername für Admin ${i} (${nameKey}): `);
    if (!name || name.trim().length < 2) { console.error('Name zu kurz.'); process.exit(1); }
    console.log(`  → ${nameKey}=${name.trim()}`);
    const r = await hashPassword(`Admin ${i} (${name.trim()})`, hashKey);
    results.push({ key: nameKey, hash: name.trim() }, r);
  }

  // Melder (Crew)
  const crew = await hashPassword('Melder (gemeinsames Passwort)', 'CREW_PASS_HASH');
  results.push(crew);

  rl.close();

  console.log('\n── Für .env / Plesk Env-Vars ──────────────────────');
  results.forEach(r => console.log(r.key + '=' + r.hash));
  console.log('───────────────────────────────────────────────────\n');
})();
