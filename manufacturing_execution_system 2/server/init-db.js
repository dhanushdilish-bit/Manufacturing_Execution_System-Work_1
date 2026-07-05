import { initDatabase } from './db.js'

const db = initDatabase()
const version = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value
const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count

console.log(`MES database ready. Schema version ${version}. Seeded users: ${users}.`)
db.close()
