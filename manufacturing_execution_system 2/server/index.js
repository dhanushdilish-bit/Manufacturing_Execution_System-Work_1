import { createApp } from './app.js'
import { initDatabase } from './db.js'

const port = Number(process.env.PORT || 4174)
const db = initDatabase()
const app = createApp(db)

app.listen(port, '127.0.0.1', () => {
  console.log(`MES API listening on http://127.0.0.1:${port}`)
})
