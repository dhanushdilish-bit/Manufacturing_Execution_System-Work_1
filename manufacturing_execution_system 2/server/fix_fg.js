import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'mes.sqlite');
const db = new DatabaseSync(dbPath);

const batches = db.prepare(`
  SELECT fb.id, pr.batch_code AS new_code 
  FROM fg_batches fb
  JOIN production_runs pr ON pr.id = fb.production_run_id
  WHERE fb.batch_code != pr.batch_code
`).all();

let updated = 0;
for (const b of batches) {
  try {
    db.prepare('UPDATE fg_batches SET batch_code = ? WHERE id = ?').run(b.new_code, b.id);
    updated++;
  } catch (e) {
    console.error(`Error updating fg_batch ${b.id} to ${b.new_code}:`, e.message);
  }
}
console.log(`Updated ${updated} fg_batches.`);
