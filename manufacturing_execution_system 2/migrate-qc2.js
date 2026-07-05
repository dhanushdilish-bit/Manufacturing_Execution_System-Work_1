import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dbPath = path.join(process.cwd(), 'data', 'mes.sqlite');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA foreign_keys=off;

  BEGIN TRANSACTION;

  CREATE TABLE IF NOT EXISTS _rm_receipts_qc2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES raw_materials(id),
    supplier TEXT NOT NULL,
    lot_number TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_QC'
      CHECK (status IN ('PENDING_QC', 'PENDING_QA', 'PENDING_QC2', 'APPROVED', 'REJECTED', 'HOLD')),
    qc_by INTEGER REFERENCES users(id),
    qc_at TEXT,
    qa_by INTEGER REFERENCES users(id),
    qa_at TEXT,
    rework_notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(material_id, lot_number)
  );

  INSERT INTO _rm_receipts_qc2 (
    id, material_id, supplier, lot_number, quantity, received_at, status, qc_by, qc_at, qa_by, qa_at, created_by, created_at
  )
  SELECT
    id, material_id, supplier, lot_number, quantity, received_at, status, qc_by, qc_at, qa_by, qa_at, created_by, created_at
  FROM rm_receipts;

  DROP TABLE rm_receipts;
  ALTER TABLE _rm_receipts_qc2 RENAME TO rm_receipts;

  COMMIT;

  PRAGMA foreign_keys=on;
`);

console.log('Successfully migrated rm_receipts table to include PENDING_QC2 and rework_notes.');
