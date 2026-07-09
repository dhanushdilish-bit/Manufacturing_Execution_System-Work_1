import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'mes.sqlite');
const db = new DatabaseSync(dbPath);

const runs = db.prepare(`SELECT id, batch_code FROM production_runs WHERE batch_code LIKE 'BATCH-%'`).all();
let updated = 0;
for (const run of runs) {
  const parts = run.batch_code.split('-');
  if (parts.length === 5) { // BATCH, DATE, PRODUCT, SHIFT, SEQ
    const newCode = `TP-${parts[1]}-${parts[3]}-${parts[4]}`;
    db.prepare('UPDATE production_runs SET batch_code = ? WHERE id = ?').run(newCode, run.id);
    updated++;
  }
}
console.log(`Updated ${updated} batches.`);
