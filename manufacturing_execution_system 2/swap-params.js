import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dbPath = path.join(process.cwd(), 'data', 'mes.sqlite');
try {
  const db = new DatabaseSync(dbPath);
  
  // Swap the labels and types for ID 2 and 3 (Supplier certificate and Moisture %)
  // ID 2 was Supplier certificate, ID 3 was Moisture %
  // We want ID 2 to be Moisture %, ID 3 to be Supplier certificate
  
  db.exec(`
    UPDATE qc_parameters 
    SET label = 'Moisture %', type = 'number', min_value = 0, max_value = 2
    WHERE id = 2 AND label = 'Supplier certificate';
  `);
  
  db.exec(`
    UPDATE qc_parameters 
    SET label = 'Supplier certificate', type = 'file', min_value = NULL, max_value = NULL
    WHERE id = 3 AND label = 'Moisture %';
  `);

  console.log("Database parameters swapped successfully.");
} catch (e) {
  console.error("Error updating database:", e);
}
