import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createApp } from '../server/app.js'
import { initDatabase } from '../server/db.js'

let db
let server
let baseUrl
let adminToken

before(async () => {
  db = initDatabase(':memory:')
  const app = createApp(db)
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
  adminToken = await login('admin')
})

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  db.close()
})

beforeEach(() => {
  resetOperationalTables()
})

describe('MES workflow rules', () => {
  it('restricts user and role management to admin users', async () => {
    const rmStoreToken = await login('rm.manager')
    const forbidden = await api('/api/admin/users', { token: rmStoreToken })
    assert.equal(forbidden.status, 403)

    const created = await api('/api/admin/users', {
      method: 'POST',
      body: {
        username: 'line.lead',
        password: 'demo123',
        name: 'Line Lead',
        role: 'production',
        active: 1,
      },
    })
    assert.equal(created.status, 201)
    assert.equal(created.data.username, 'line.lead')
    assert.equal(created.data.role, 'production')
    assert.equal(created.data.password, undefined)

    await login('line.lead')

    const updated = await api(`/api/admin/users/${created.data.id}`, {
      method: 'PUT',
      body: {
        name: 'Line Lead QC',
        role: 'qc',
        active: 0,
        password: 'newpass',
      },
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.data.name, 'Line Lead QC')
    assert.equal(updated.data.role, 'qc')
    assert.equal(updated.data.active, 0)

    const inactiveLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'line.lead', password: 'newpass' }),
    })
    assert.equal(inactiveLogin.status, 401)

    const deleted = await api(`/api/admin/users/${created.data.id}`, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    assert.equal(deleted.data.deleted, true)

    const users = await api('/api/admin/users')
    assert.equal(users.status, 200)
    assert.equal(users.data.rows.some((user) => user.username === 'line.lead'), false)

    const deletedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'line.lead', password: 'newpass' }),
    })
    assert.equal(deletedLogin.status, 401)

    const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get()
    const blockedAdminUpdate = await api(`/api/admin/users/${admin.id}`, {
      method: 'PUT',
      body: { active: 0 },
    })
    assert.equal(blockedAdminUpdate.status, 400)
    assert.match(blockedAdminUpdate.data.error, /At least one active admin/)
  })

  it('keeps failed RM QC out of available RM stock', async () => {
    await receiveAndQc({ materialCode: 'STC', quantity: 20, lot: 'STC-BAD', passed: false })
    await receiveAndQc({ materialCode: 'CRS', quantity: 20, lot: 'CRS-GOOD', passed: true })
    await receiveAndQc({ materialCode: 'PKG', quantity: 20, lot: 'PKG-GOOD', passed: true })

    const request = await createProductionRequest(1)
    const approval = await api(`/api/production-requests/${request.id}/approve`, {
      method: 'POST',
      body: { approved: true },
    })

    assert.equal(approval.status, 409)
    assert.match(approval.data.error, /Insufficient approved RM/)

    const receipt = db.prepare("SELECT status FROM rm_receipts WHERE lot_number = 'STC-BAD'").get()
    assert.equal(receipt.status, 'REJECTED')
  })

  it('blocks production issue when RM has not been approved by QC', async () => {
    await receiveOnly({ materialCode: 'STC', quantity: 20, lot: 'STC-PENDING' })
    await receiveAndQc({ materialCode: 'CRS', quantity: 20, lot: 'CRS-GOOD', passed: true })
    await receiveAndQc({ materialCode: 'PKG', quantity: 20, lot: 'PKG-GOOD', passed: true })

    const request = await createProductionRequest(1)
    const approval = await api(`/api/production-requests/${request.id}/approve`, {
      method: 'POST',
      body: { approved: true },
    })

    assert.equal(approval.status, 409)
    assert.match(approval.data.error, /Insufficient approved RM/)
  })

  it('runs a complete batch, blocks over-consumption, blocks failed FG QC dispatch, and traces dispatch genealogy', async () => {
    await seedApprovedRailMaterials()
    const request = await createProductionRequest(10)
    await mustOk(`/api/production-requests/${request.id}/approve`, {
      method: 'POST',
      body: { approved: true },
    })

    const allocations = db.prepare(`
      SELECT ria.id, ria.quantity
      FROM rm_issue_allocations ria
      JOIN rm_issues ri ON ri.id = ria.issue_id
      WHERE ri.request_id = ?
    `).all(request.id)
    const excessiveConsumption = Object.fromEntries(allocations.map((row) => [row.id, row.quantity + 1]))

    const blockedRun = await api('/api/production-runs', {
      method: 'POST',
      body: {
        request_id: request.id,
        quantity_produced: 10,
        shift: 'A',
        team_members: 'Operator One',
        consumption: excessiveConsumption,
      },
    })
    assert.equal(blockedRun.status, 400)
    assert.match(blockedRun.data.error, /cannot exceed/)

    const run = await mustOk('/api/production-runs', {
      method: 'POST',
      body: {
        request_id: request.id,
        quantity_produced: 10,
        shift: 'A',
        team_members: 'Operator One, Operator Two',
        started_at: '2026-06-24T08:00',
        ended_at: '2026-06-24T10:00',
      },
    })
    assert.match(run.batch_code, /^BATCH-20260624-RAIL-A-\d{3}$/)

    const batchId = run.fg_batch.id
    const dispatchBeforeQc = await api('/api/dispatches', {
      method: 'POST',
      body: {
        batch_id: batchId,
        customer: 'Acme Works',
        order_ref: 'SO-FAIL',
        quantity: 1,
      },
    })
    assert.equal(dispatchBeforeQc.status, 400)

    await mustOk(`/api/fg-batches/${batchId}/qc`, {
      method: 'POST',
      body: { passed: false, results: [{ value: 'Bad finish', passed: false }] },
    })

    const dispatchFailedQc = await api('/api/dispatches', {
      method: 'POST',
      body: {
        batch_id: batchId,
        customer: 'Acme Works',
        order_ref: 'SO-FAIL-QC',
        quantity: 1,
      },
    })
    assert.equal(dispatchFailedQc.status, 400)

    await mustOk(`/api/fg-batches/${batchId}/qc`, {
      method: 'POST',
      body: {
        passed: true,
        results: [
          { value: '1000', passed: true },
          { value: 'Pass', passed: true },
        ],
      },
    })

    await mustOk(`/api/fg-batches/${batchId}/qa`, {
      method: 'POST',
      body: { passed: true, results: [{ value: 'Pass', passed: true }] },
    })

    const tooLargeDispatch = await api('/api/dispatches', {
      method: 'POST',
      body: {
        batch_id: batchId,
        customer: 'Acme Works',
        order_ref: 'SO-BIG',
        quantity: 11,
      },
    })
    assert.equal(tooLargeDispatch.status, 409)

    const dispatch = await mustOk('/api/dispatches', {
      method: 'POST',
      body: {
        batch_id: batchId,
        customer: 'Acme Works',
        order_ref: 'SO-1001',
        quantity: 10,
        vehicle_no: 'MH01AB1234',
      },
    })
    assert.equal(dispatch.order_ref, 'SO-1001')

    const trace = await mustOk(`/api/traceability/${run.batch_code}`)
    assert.equal(trace.batch.batch_code, run.batch_code)
    assert.equal(trace.rawMaterials.length, 3)
    assert.equal(trace.dispatches.length, 1)
    assert.equal(trace.dispatches[0].customer, 'Acme Works')
  })
})

async function login(username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo123' }),
  })
  const data = await response.json()
  assert.equal(response.status, 200)
  return data.token
}

async function api(path, options = {}) {
  const { token = adminToken, ...requestOptions } = options
  const response = await fetch(`${baseUrl}${path}`, {
    ...requestOptions,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...requestOptions.headers,
    },
    body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
  })
  const data = await response.json()
  return { status: response.status, data }
}

async function mustOk(path, options = {}) {
  const response = await api(path, options)
  assert.ok(response.status >= 200 && response.status < 300, response.data.error)
  return response.data
}

async function receiveOnly({ materialCode, quantity, lot }) {
  const material = db.prepare('SELECT id FROM raw_materials WHERE code = ?').get(materialCode)
  return mustOk('/api/rm-receipts', {
    method: 'POST',
    body: {
      material_id: material.id,
      supplier: 'Test Supplier',
      lot_number: lot,
      quantity,
      received_at: '2026-06-24T07:00',
    },
  })
}

async function receiveAndQc({ materialCode, quantity, lot, passed }) {
  const receipt = await receiveOnly({ materialCode, quantity, lot })
  await mustOk(`/api/rm-receipts/${receipt.id}/qc`, {
    method: 'POST',
    body: {
      passed,
      results: [{ value: passed ? 'Pass' : 'Fail', passed }],
    },
  })

  // A pass at first QC moves the lot to PENDING_QA, which QA then approves.
  // A fail moves it to PENDING_QC2, a second check which finally rejects it.
  if (passed) {
    return mustOk(`/api/rm-receipts/${receipt.id}/qa`, {
      method: 'POST',
      body: { passed: true, qa_remarks: 'QA approved' },
    })
  }
  return mustOk(`/api/rm-receipts/${receipt.id}/qc2`, {
    method: 'POST',
    body: { passed: false, rework_notes: 'Rejected at second QC check' },
  })
}

async function seedApprovedRailMaterials() {
  await receiveAndQc({ materialCode: 'STC', quantity: 100, lot: 'STC-GOOD', passed: true })
  await receiveAndQc({ materialCode: 'CRS', quantity: 100, lot: 'CRS-GOOD', passed: true })
  await receiveAndQc({ materialCode: 'PKG', quantity: 100, lot: 'PKG-GOOD', passed: true })
}

async function createProductionRequest(quantity) {
  const product = db.prepare("SELECT id FROM products WHERE code = 'RAIL'").get()
  const request = await mustOk('/api/production-requests', {
    method: 'POST',
    body: {
      product_id: product.id,
      requested_qty: quantity,
      source_team: 'Sales',
      priority: 'NORMAL',
    },
  })

  // Requests must clear QC and QA before they're eligible for RM approval.
  await mustOk(`/api/production-requests/${request.id}/qc`, {
    method: 'POST',
    body: { passed: true, remarks: 'QC ok' },
  })
  await mustOk(`/api/production-requests/${request.id}/qa`, {
    method: 'POST',
    body: { passed: true, remarks: 'QA ok' },
  })

  return request
}

function resetOperationalTables() {
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
}
