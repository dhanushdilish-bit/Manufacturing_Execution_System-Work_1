import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const dbPath = path.join(process.cwd(), 'data', 'mes.sqlite')
if (!fs.existsSync(dbPath)) {
  console.log('No database found at', dbPath)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)

try {
  // Add customer_email to dispatches
  const columns = new Set(db.prepare('PRAGMA table_info(dispatches)').all().map((column) => column.name))
  if (!columns.has('customer_email')) {
    console.log('Adding customer_email to dispatches table...')
    db.exec(`ALTER TABLE dispatches ADD COLUMN customer_email TEXT`)
  } else {
    console.log('customer_email already exists in dispatches.')
  }

  // Create customer_feedback table
  console.log('Creating customer_feedback table...')
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispatch_id INTEGER NOT NULL REFERENCES dispatches(id),
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comments TEXT,
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  console.log('Migration completed successfully.')
} catch (error) {
  console.error('Migration failed:', error)
  process.exit(1)
} finally {
  db.close()
}
