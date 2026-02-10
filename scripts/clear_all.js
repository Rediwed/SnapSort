#!/usr/bin/env node
/**
 * clear_all.js — Delete demo data, test data, and the database.
 *
 * Usage:  node scripts/clear_all.js
 *   (also invoked via `npm run clear:all`)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const targets = [
  { label: 'Demo data', path: path.join(__dirname, '..', 'demo_data') },
  { label: 'Test data', path: path.join(__dirname, '..', 'test_data') },
  { label: 'Database',  path: path.join(__dirname, '..', 'backend', 'data', 'snapsort.db') },
  { label: 'DB WAL',    path: path.join(__dirname, '..', 'backend', 'data', 'snapsort.db-wal') },
  { label: 'DB SHM',    path: path.join(__dirname, '..', 'backend', 'data', 'snapsort.db-shm') },
];

const existing = targets.filter((t) => fs.existsSync(t.path));

if (existing.length === 0) {
  console.log('Nothing to delete — all clean.');
  process.exit(0);
}

console.log('\n⚠  This will permanently delete:');
existing.forEach((t) => console.log(`   ${t.label}: ${t.path}`));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('\nType "delete-all" to confirm: ', (answer) => {
  rl.close();
  if (answer.trim() !== 'delete-all') {
    console.log('Aborted — nothing was deleted.');
    process.exit(1);
  }
  for (const t of existing) {
    const stat = fs.statSync(t.path);
    if (stat.isDirectory()) {
      fs.rmSync(t.path, { recursive: true, force: true });
    } else {
      fs.unlinkSync(t.path);
    }
    console.log(`   Deleted: ${t.label}`);
  }
  console.log('All cleared.');
});
