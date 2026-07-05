import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('./data/mes.sqlite')

function addColumn(table, column, definition) {
  try {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().find(c => c.name === column)
    if (!exists) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()
      console.log(`Added ${column} to ${table}`)
    } else {
      console.log(`${column} already exists in ${table}`)
    }
  } catch (error) {
    console.error(`Failed to add ${column} to ${table}:`, error.message)
  }
}

console.log('Starting migration for remarks...')

addColumn('rm_receipts', 'remarks', 'TEXT')
addColumn('rm_receipts', 'qc_remarks', 'TEXT')
addColumn('production_targets', 'remarks', 'TEXT')
addColumn('production_plans', 'remarks', 'TEXT')
addColumn('production_requests', 'remarks', 'TEXT')
addColumn('production_requests', 'approval_remarks', 'TEXT')
addColumn('production_runs', 'remarks', 'TEXT')
addColumn('fg_batches', 'qc_remarks', 'TEXT')
addColumn('fg_batches', 'qa_remarks', 'TEXT')
addColumn('dispatches', 'remarks', 'TEXT')

console.log('Migration complete.')
db.close()
