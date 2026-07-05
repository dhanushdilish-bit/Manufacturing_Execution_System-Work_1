import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const dbPath = path.join(process.cwd(), 'data', 'mes.sqlite')
if (!fs.existsSync(dbPath)) {
  console.log('No DB found.')
  process.exit(1)
}

const db = new DatabaseSync(dbPath)

try {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('qa.supervisor')
  if (!existing) {
    db.prepare(`
      INSERT INTO users (username, password, name, role)
      VALUES (?, ?, ?, ?)
    `).run('qa.supervisor', 'demo123', 'Vikram QA', 'qa')
    console.log('QA user added successfully.')
  } else {
    console.log('QA user already exists.')
  }
} catch (error) {
  console.error('Failed to add QA user:', error)
} finally {
  db.close()
}
