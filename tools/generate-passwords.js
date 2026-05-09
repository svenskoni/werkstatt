#!/usr/bin/env node
'use strict';
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ROUNDS = 12;
const users = [
  { key: 'USER_VIEW_PASS_HASH',  name: 'viewer  (Rolle: view)' },
  { key: 'USER_USER_PASS_HASH',  name: 'benutzer (Rolle: user)' },
  { key: 'USER_ADMIN_PASS_HASH', name: 'admin   (Rolle: admin)' }
];

async function askPassword(label) {
  return new Promise(resolve => rl.question(`Passwort für ${label}: `, resolve));
}

(async () => {
  console.log('\n🔐 Passwort-Hash-Generator (bcrypt, cost=' + ROUNDS + ')\n');
  const results = [];
  for (const u of users) {
    const pw = await askPassword(u.name);
    if (!pw || pw.length < 8) { console.error('  ✗ Zu kurz (min. 8 Zeichen)'); process.exit(1); }
    const hash = await bcrypt.hash(pw, ROUNDS);
    results.push({ key: u.key, hash });
    console.log(`  ✓ ${u.key}=${hash}\n`);
  }
  rl.close();
  console.log('\n── Für .env / Plesk Env-Vars ──────────────────────');
  results.forEach(r => console.log(r.key + '=' + r.hash));
  console.log('───────────────────────────────────────────────────\n');
})();