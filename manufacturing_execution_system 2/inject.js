import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const db = new DatabaseSync(path.join(process.cwd(), 'data', 'mes.sqlite'))

const materials = [
  { id: 1, name: 'STC', qty: 1000000 },
  { id: 2, name: 'CRS', qty: 1000000 },
  { id: 3, name: 'PKG', qty: 1000000 }
]

db.exec('BEGIN')
const insert = db.prepare(`
  INSERT INTO rm_receipts (material_id, supplier, lot_number, quantity, received_at, status, created_by)
  VALUES (?, 'Auto Injector', ?, ?, ?, 'APPROVED', 1)
`)

for (const m of materials) {
  insert.run(m.id, `LOT-${m.name}-${Date.now()}`, m.qty, new Date().toISOString())
}
db.exec('COMMIT')
console.log('Successfully injected inventory')
