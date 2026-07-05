import { initDatabase } from './db.js'
import fs from 'fs'

const db = initDatabase()

const body = {
  request_id: '4', // I assume it's 4 based on the screenshot `#4 BRKT`
  quantity_produced: '500',
  shift: 'A',
  team_members: 'Dhanush',
  started_at: '2026-06-27T19:53',
  ended_at: ''
}

// Since createProductionRun is in app.js and not exported, I will copy its logic here to debug.
function testCreateRun(db, body, userId) {
  const requestId = Number(body.request_id)
  const quantityProduced = Number(body.quantity_produced)
  const shift = String(body.shift || '').trim()
  const teamMembers = String(body.team_members || '').trim()
  if (!requestId || !shift || !teamMembers) throw new Error('Request, shift, and team members are required')

  const request = db.prepare('SELECT * FROM production_requests WHERE id = ?').get(requestId)
  if (!request) throw new Error('Production request not found')
  if (request.status !== 'RM_APPROVED') throw new Error('Production can start only after RM approval')

  const allocations = db.prepare(`
    SELECT ria.*, ri.requested_qty
    FROM rm_issue_allocations ria
    JOIN rm_issues ri ON ri.id = ria.issue_id
    WHERE ri.request_id = ?
    ORDER BY ria.id
  `).all(requestId)
  if (allocations.length === 0) throw new Error('No approved RM allocations found')

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(request.product_id)
  const startedAt = body.started_at || new Date().toISOString()
  const endedAt = body.ended_at || null
  
  function calculateMinutes(startedAt, endedAt) {
    if (!endedAt) return null
    const start = new Date(startedAt).getTime()
    const end = new Date(endedAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
    return Math.round((end - start) / 60000)
  }
  
  const runMinutes = Number(body.run_minutes) || calculateMinutes(startedAt, endedAt)
  
  function formatDateCode(value) {
    const date = new Date(value)
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
    const yyyy = safeDate.getFullYear()
    const mm = String(safeDate.getMonth() + 1).padStart(2, '0')
    const dd = String(safeDate.getDate()).padStart(2, '0')
    return `${yyyy}${mm}${dd}`
  }
  function segment(value) {
    return String(value || 'NA').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'NA'
  }
  function generateBatchCode(db, productCode, shift, startedAt, productId) {
    const dateCode = formatDateCode(startedAt)
    const productSegment = segment(productCode)
    const shiftSegment = segment(shift)
    const prefix = `BATCH-${dateCode}-${productSegment}-${shiftSegment}-`
    let sequence = db.prepare(`
      SELECT COUNT(*) AS count
      FROM production_runs
      WHERE product_id = ? AND batch_code LIKE ?
    `).get(productId, `${prefix}%`).count + 1

    while (true) {
      const candidate = `${prefix}${String(sequence).padStart(3, '0')}`
      const existing = db.prepare('SELECT id FROM production_runs WHERE batch_code = ?').get(candidate)
      if (!existing) return candidate
      sequence += 1
    }
  }

  const batchCode = generateBatchCode(db, product.code, shift, startedAt, request.product_id)
  const consumptionOverrides = body.consumption ?? {}

  db.exec('BEGIN')
  try {
    const runId = db.prepare(`
      INSERT INTO production_runs
        (request_id, product_id, quantity_produced, shift, team_members, started_at, ended_at, run_minutes, batch_code, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requestId,
      request.product_id,
      quantityProduced,
      shift,
      teamMembers,
      startedAt,
      endedAt,
      runMinutes,
      batchCode,
      userId,
    ).lastInsertRowid

    const insertConsumption = db.prepare(`
      INSERT INTO production_consumption
        (run_id, allocation_id, receipt_id, material_id, planned_qty, actual_qty)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const allocation of allocations) {
      const override = consumptionOverrides[allocation.id] ?? consumptionOverrides[String(allocation.id)]
      const actualQty = override === undefined ? allocation.quantity : Number(override)
      if (!Number.isFinite(actualQty) || actualQty < 0 || actualQty > allocation.quantity + 0.000001) {
        throw new Error('Actual RM consumption cannot exceed approved issue quantity')
      }
      insertConsumption.run(runId, allocation.id, allocation.receipt_id, allocation.material_id, allocation.quantity, actualQty)
    }

    const batchId = db.prepare(`
      INSERT INTO fg_batches (production_run_id, product_id, batch_code, quantity)
      VALUES (?, ?, ?, ?)
    `).run(runId, request.product_id, batchCode, quantityProduced).lastInsertRowid

    db.prepare("UPDATE production_requests SET status = 'PRODUCED' WHERE id = ?").run(requestId)
    db.exec('COMMIT')
    return { runId, batchId }
  } catch(e) {
    db.exec('ROLLBACK')
    throw e
  }
}

try {
  // Let's first make sure request 4 is RM_APPROVED.
  db.prepare("INSERT OR IGNORE INTO production_requests (id, product_id, requested_qty, source_team, priority, status) VALUES (4, 1, 500, 'Sales', 'NORMAL', 'RM_APPROVED')").run()
  db.prepare("UPDATE production_requests SET status = 'RM_APPROVED' WHERE id = 4").run()
  // Ensure allocations exist for request 4
  const allocations = db.prepare('SELECT * FROM rm_issue_allocations JOIN rm_issues ON rm_issues.id = rm_issue_allocations.issue_id WHERE rm_issues.request_id = 4').all()
  if (allocations.length === 0) {
     console.log('No allocations. I will fake one.')
     db.prepare("INSERT OR IGNORE INTO raw_materials (id, code, name, unit_id) VALUES (1, 'TEST', 'Test', 1)").run()
     db.prepare("INSERT OR IGNORE INTO rm_receipts (id, material_id, supplier, lot_number, quantity, received_at) VALUES (1, 1, 'Sup', 'LOT1', 1000, '2026')").run()
     const issueId = db.prepare("INSERT INTO rm_issues (request_id, material_id, requested_qty, approved_qty, status) VALUES (4, 1, 500, 500, 'APPROVED')").run().lastInsertRowid
     db.prepare("INSERT INTO rm_issue_allocations (issue_id, receipt_id, material_id, quantity) VALUES (?, 1, 1, 500)").run(issueId)
  }

  const result = testCreateRun(db, body, 1)
  console.log('Success:', result)
} catch (e) {
  console.error('Failed:', e)
}
