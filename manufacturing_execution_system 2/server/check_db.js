import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'mes.sqlite');
const db = new DatabaseSync(dbPath);

console.log("PRODUCTION RUNS:");
console.log(db.prepare('SELECT id, batch_code FROM production_runs ORDER BY id DESC LIMIT 10').all());
console.log("\nFG BATCHES:");
console.log(db.prepare('SELECT id, production_run_id, batch_code FROM fg_batches ORDER BY id DESC LIMIT 10').all());
