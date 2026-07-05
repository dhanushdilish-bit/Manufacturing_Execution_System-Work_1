import { initDatabase } from './db.js'

const db = initDatabase()

// Helper functions for easy querying
const rawId = (code) => db.prepare('SELECT id FROM raw_materials WHERE code = ?').get(code).id
const productId = (code) => db.prepare('SELECT id FROM products WHERE code = ?').get(code).id
const userId = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username).id

console.log('Clearing old workflow data...')
db.exec(`
  DELETE FROM dispatches;
  DELETE FROM fg_qc_results;
  DELETE FROM fg_batches;
  DELETE FROM production_consumption;
  DELETE FROM production_runs;
  DELETE FROM rm_issue_allocations;
  DELETE FROM rm_issues;
  DELETE FROM production_requests;
  DELETE FROM rm_qc_results;
  DELETE FROM rm_receipts;
`)

console.log('Seeding workflow data for presentation...')

// 1. Seed RM Receipts
const rmManager = userId('rm.manager')
const qcSupervisor = userId('qc.supervisor')

const insertReceipt = db.prepare(`
  INSERT INTO rm_receipts (material_id, supplier, lot_number, quantity, received_at, status, qc_by, qc_at, created_by)
  VALUES (?, ?, ?, ?, datetime('now', '-2 days'), ?, ?, datetime('now', '-1 days'), ?)
`)
// Seed some steel coils
insertReceipt.run(rawId('STC'), 'Global Steel', 'LOT-STC-101', 5000, 'APPROVED', qcSupervisor, rmManager)
insertReceipt.run(rawId('STC'), 'Global Steel', 'LOT-STC-102', 2000, 'PENDING_QC', null, rmManager)
// Seed some coating resin
insertReceipt.run(rawId('CRS'), 'ChemCorp', 'LOT-CRS-050', 500, 'APPROVED', qcSupervisor, rmManager)
// Seed some packaging
insertReceipt.run(rawId('PKG'), 'PackIt Inc', 'LOT-PKG-200', 10000, 'APPROVED', qcSupervisor, rmManager)

console.log(' - Added RM receipts')

// 2. Seed Production Request & Run
const productionUser = userId('production')
const adminUser = userId('admin')

const requestId = db.prepare(`
  INSERT INTO production_requests (product_id, requested_qty, source_team, priority, status, created_by, approved_by, approved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`).run(productId('RAIL'), 1000, 'Sales', 'HIGH', 'PRODUCED', productionUser, adminUser).lastInsertRowid

// 3. RM Issues and Allocations
const stcReceiptId = db.prepare("SELECT id FROM rm_receipts WHERE lot_number = 'LOT-STC-101'").get().id
const crsReceiptId = db.prepare("SELECT id FROM rm_receipts WHERE lot_number = 'LOT-CRS-050'").get().id
const pkgReceiptId = db.prepare("SELECT id FROM rm_receipts WHERE lot_number = 'LOT-PKG-200'").get().id

const insertIssue = db.prepare(`INSERT INTO rm_issues (request_id, material_id, requested_qty, approved_qty, status) VALUES (?, ?, ?, ?, 'APPROVED')`)
const issue1 = insertIssue.run(requestId, rawId('STC'), 2000, 2000).lastInsertRowid // 1000 * 2
const issue2 = insertIssue.run(requestId, rawId('CRS'), 250, 250).lastInsertRowid   // 1000 * 0.25
const issue3 = insertIssue.run(requestId, rawId('PKG'), 1000, 1000).lastInsertRowid // 1000 * 1

const insertAllocation = db.prepare(`INSERT INTO rm_issue_allocations (issue_id, receipt_id, material_id, quantity) VALUES (?, ?, ?, ?)`)
const alloc1 = insertAllocation.run(issue1, stcReceiptId, rawId('STC'), 2000).lastInsertRowid
const alloc2 = insertAllocation.run(issue2, crsReceiptId, rawId('CRS'), 250).lastInsertRowid
const alloc3 = insertAllocation.run(issue3, pkgReceiptId, rawId('PKG'), 1000).lastInsertRowid

// 4. Production Run and FG Batch
const runId = db.prepare(`
  INSERT INTO production_runs (request_id, product_id, quantity_produced, shift, team_members, started_at, ended_at, run_minutes, batch_code, created_by)
  VALUES (?, ?, ?, ?, ?, datetime('now', '-4 hours'), datetime('now', '-1 hours'), 180, ?, ?)
`).run(requestId, productId('RAIL'), 1000, 'Morning', 'Team Alpha', 'BATCH-20260627-RAIL-MORN-001', productionUser).lastInsertRowid

db.prepare(`
  INSERT INTO production_consumption (run_id, allocation_id, receipt_id, material_id, planned_qty, actual_qty)
  VALUES 
  (?, ?, ?, ?, 2000, 2000),
  (?, ?, ?, ?, 250, 250),
  (?, ?, ?, ?, 1000, 1000)
`).run(runId, alloc1, stcReceiptId, rawId('STC'), 
       runId, alloc2, crsReceiptId, rawId('CRS'), 
       runId, alloc3, pkgReceiptId, rawId('PKG'))

const batchId = db.prepare(`
  INSERT INTO fg_batches (production_run_id, product_id, batch_code, quantity, status, qc_by, qc_at, storage_location)
  VALUES (?, ?, ?, ?, 'FG_STORE', ?, datetime('now'), 'RACK-A1')
`).run(runId, productId('RAIL'), 'BATCH-20260627-RAIL-MORN-001', 1000, qcSupervisor).lastInsertRowid

console.log(' - Added Production Request, Run, and FG Batch')

// 5. Another Pending Production Request
db.prepare(`
  INSERT INTO production_requests (product_id, requested_qty, source_team, priority, status, created_by)
  VALUES (?, ?, ?, ?, 'PENDING_RM_APPROVAL', ?)
`).run(productId('BRKT'), 500, 'Inventory', 'NORMAL', productionUser)

const run2Id = db.prepare(`
  INSERT INTO production_runs (request_id, product_id, quantity_produced, shift, team_members, started_at, run_minutes, batch_code, created_by)
  VALUES (?, ?, ?, ?, ?, datetime('now', '-2 days'), 240, ?, ?)
`).run(requestId, productId('BRKT'), 500, 'Night', 'Team Beta', 'BATCH-20260626-BRKT-NIGHT-001', productionUser).lastInsertRowid

db.prepare(`
  INSERT INTO fg_batches (production_run_id, product_id, batch_code, quantity, status)
  VALUES (?, ?, ?, ?, 'DAY_STORE_QC_PENDING')
`).run(run2Id, productId('BRKT'), 'BATCH-20260626-BRKT-NIGHT-001', 500)

console.log(' - Added pending items')

// 6. Seed a dispatch
// Insert a dummy run for the old batch
db.prepare(`
  INSERT INTO production_runs (id, request_id, product_id, quantity_produced, shift, team_members, started_at, run_minutes, batch_code, created_by)
  VALUES (888, ?, ?, 200, 'Day', 'Old Team', datetime('now', '-3 days'), 120, 'BATCH-20260620-RAIL-DAY-001', ?)
`).run(requestId, productId('RAIL'), productionUser)

const oldBatchId = db.prepare(`
  INSERT INTO fg_batches (production_run_id, product_id, batch_code, quantity, status, storage_location)
  VALUES (888, ?, 'BATCH-20260620-RAIL-DAY-001', 200, 'DISPATCHED', 'DISPATCH_BAY')
`).run(productId('RAIL')).lastInsertRowid

db.prepare(`
  INSERT INTO dispatches (batch_id, customer, order_ref, quantity, vehicle_no, approved_by, dispatched_by, shipped_at)
  VALUES (?, 'Acme Corp', 'ORD-2026-991', 200, 'KA-01-AB-1234', ?, ?, datetime('now', '-1 days'))
`).run(oldBatchId, adminUser, userId('dispatch'))

console.log(' - Added dispatch records')

console.log('Done! Database seeded with workflow data.')
db.close()
