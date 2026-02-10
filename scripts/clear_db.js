#!/usr/bin/env node
/**
 * clear_db.js — Delete the SnapSort database with confirmation.
 *
 * Usage:  node scripts/clear_db.js
 *   (also invoked via `npm run clear:db`)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DB_DIR = path.join(__dirname, '..', 'backend', 'data');
const DB_FILES = ['snapsort.db', 'snapsort.db-wal', 'snapsort.db-shm'];

const existing = DB_FILES.map((f) => path.join(DB_DIR, f)).filter((p) => fs.existsSync(p));

if (existing.length === 0) {
  console.log('No database files found — nothing to delete.');
  process.exit(0);
}

console.log('\n⚠  This will permanently delete the SnapSort database:');
existing.forEach((f) => console.log(`   ${f}`));
console.log('\n   All jobs, photos, duplicates, and settings will be lost.');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('\nType "delete-db" to confirm: ', (answer) => {
  rl.close();
  if (answer.trim() !== 'delete-db') {
    console.log('Aborted — database was NOT deleted.');
    process.exit(1);
  }
  for (const f of existing) {
    fs.unlinkSync(f);
  }
  console.log('Database deleted successfully.');
});
