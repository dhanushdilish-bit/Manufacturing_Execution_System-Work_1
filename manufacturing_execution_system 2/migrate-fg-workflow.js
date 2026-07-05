import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const dbPath = path.join(process.cwd(), 'data', 'mes.sqlite')
if (!fs.existsSync(dbPath)) {
  console.log('No DB found, skipping migration.')
  process.exit(0)
}

const db = new DatabaseSync(dbPath)

db.exec('PRAGMA foreign_keys = OFF')
db.exec('BEGIN TRANSACTION')

try {
  // Update qc_templates
  db.exec(`
    CREATE TABLE IF NOT EXISTS qc_templates_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('RM', 'FG', 'FG_QA')),
      name TEXT NOT NULL,
      product_id INTEGER REFERENCES products(id),
      raw_material_id INTEGER REFERENCES raw_materials(id),
      active INTEGER NOT NULL DEFAULT 1
    )
  `)
  db.exec('INSERT INTO qc_templates_new SELECT * FROM qc_templates')
  db.exec('DROP TABLE qc_templates')
  db.exec('ALTER TABLE qc_templates_new RENAME TO qc_templates')

  // Update fg_batches
  db.exec(`
    CREATE TABLE IF NOT EXISTS fg_batches_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_run_id INTEGER NOT NULL UNIQUE REFERENCES production_runs(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_code TEXT NOT NULL UNIQUE,
      quantity REAL NOT NULL CHECK (quantity > 0),
      status TEXT NOT NULL DEFAULT 'QC_PENDING'
        CHECK (status IN ('QC_PENDING', 'QC_FAILED', 'QA_PENDING', 'QA_FAILED', 'READY_FOR_DISPATCH', 'PARTIAL_DISPATCH', 'DISPATCHED')),
      qc_by INTEGER REFERENCES users(id),
      qc_at TEXT,
      qa_by INTEGER REFERENCES users(id),
      qa_at TEXT,
      storage_location TEXT NOT NULL DEFAULT 'DAY_STORE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Map old statuses to new statuses
  const batches = db.prepare('SELECT * FROM fg_batches').all()
  const insertBatch = db.prepare(`
    INSERT INTO fg_batches_new (id, production_run_id, product_id, batch_code, quantity, status, qc_by, qc_at, storage_location, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  for (const batch of batches) {
    let newStatus = batch.status
    if (batch.status === 'DAY_STORE_QC_PENDING') newStatus = 'QC_PENDING'
    else if (batch.status === 'FG_STORE') newStatus = 'READY_FOR_DISPATCH'
    
    insertBatch.run(
      batch.id,
      batch.production_run_id,
      batch.product_id,
      batch.batch_code,
      batch.quantity,
      newStatus,
      batch.qc_by,
      batch.qc_at,
      batch.storage_location,
      batch.created_at
    )
  }

  db.exec('DROP TABLE fg_batches')
  db.exec('ALTER TABLE fg_batches_new RENAME TO fg_batches')

  // Create fg_qa_results
  db.exec(`
    CREATE TABLE IF NOT EXISTS fg_qa_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES fg_batches(id) ON DELETE CASCADE,
      parameter_id INTEGER REFERENCES qc_parameters(id),
      value TEXT,
      passed INTEGER NOT NULL,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_by INTEGER REFERENCES users(id)
    )
  `)

  db.exec('COMMIT')
  console.log('Successfully migrated fg workflow schema.')
} catch (error) {
  db.exec('ROLLBACK')
  console.error('Migration failed:', error)
  process.exit(1)
} finally {
  db.exec('PRAGMA foreign_keys = ON')
  db.close()
}
