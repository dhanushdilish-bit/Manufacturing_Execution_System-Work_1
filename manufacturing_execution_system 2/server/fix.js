import { initDatabase } from './db.js'

const db = initDatabase()
db.prepare("DELETE FROM rm_qc_results WHERE parameter_id IN (SELECT id FROM qc_parameters WHERE label IN ('Visual inspection', 'Moisture % (0-2)'))").run()
db.prepare("DELETE FROM qc_parameters WHERE label IN ('Visual inspection', 'Moisture % (0-2)')").run()
console.log("Deleted!")
