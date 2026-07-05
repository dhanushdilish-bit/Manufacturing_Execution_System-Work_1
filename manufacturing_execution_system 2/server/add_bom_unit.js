import { initDatabase } from './db.js'

const db = initDatabase()
try {
  db.prepare('ALTER TABLE bom_items ADD COLUMN unit_id INTEGER REFERENCES units(id)').run()
  console.log('Added unit_id to bom_items')
} catch (e) {
  if (e.message.includes('duplicate column name')) {
    console.log('Column unit_id already exists on bom_items')
  } else {
    throw e
  }
}
