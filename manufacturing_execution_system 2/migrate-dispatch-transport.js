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
  // Check if columns exist
  const columns = new Set(db.prepare('PRAGMA table_info(dispatches)').all().map((column) => column.name))
  
  const newColumns = [
    { name: 'transport_type', type: "TEXT DEFAULT 'OWN'" },
    { name: 'driver_name', type: "TEXT" },
    { name: 'driver_phone', type: "TEXT" },
    { name: 'courier_name', type: "TEXT" },
    { name: 'booking_lr', type: "TEXT" },
  ]

  for (const col of newColumns) {
    if (!columns.has(col.name)) {
      console.log(`Adding ${col.name} to dispatches table...`)
      db.exec(`ALTER TABLE dispatches ADD COLUMN ${col.name} ${col.type}`)
    } else {
      console.log(`Column ${col.name} already exists.`)
    }
  }

  console.log('Migration completed successfully.')
} catch (error) {
  console.error('Migration failed:', error)
  process.exit(1)
} finally {
  db.close()
}
