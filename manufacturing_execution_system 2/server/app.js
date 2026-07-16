import express from 'express'
import cors from 'cors'
import { initDatabase } from './db.js'
import * as dotenv from 'dotenv'
import nodemailer from 'nodemailer'

dotenv.config()

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

const ADMIN_ROLES = new Set(['admin', 'manager'])
// VALID_ROLES is now dynamically checked against the roles table in normalizeRole

export function createApp(db = initDatabase()) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body ?? {}
    const user = db.prepare(`
      SELECT id, username, name, role
      FROM users
      WHERE username = ? AND password = ? AND active = 1 AND deleted_at IS NULL
    `).get(username, password)

    if (!user) throw httpError(401, 'Invalid username or password')
    res.json({ user, token: `mes-local-${user.id}` })
  })

  app.get('/api/me', requireUser(db), (req, res) => {
    res.json({ user: req.user })
  })

  app.get('/api/bootstrap', requireUser(db), (req, res) => {
    res.json(getBootstrap(db, req.user))
  })

  app.get('/api/admin/users', requireUser(db), requireAdmin(), (_req, res) => {
    res.json({ rows: listUsers(db) })
  })

  app.post('/api/admin/users', requireUser(db), requireAdmin(), (req, res) => {
    const user = createUser(db, req.body ?? {})
    res.status(201).json(user)
  })

  app.put('/api/admin/users/:id', requireUser(db), requireAdmin(), (req, res) => {
    const user = updateUser(db, Number(req.params.id), req.body ?? {})
    res.json(user)
  })

  app.delete('/api/admin/users/:id', requireUser(db), requireAdmin(), (req, res) => {
    deleteUser(db, Number(req.params.id), req.user.id)
    res.json({ deleted: true })
  })

  app.get('/api/admin/roles', requireUser(db), requireAdmin(), (_req, res) => {
    res.json({ rows: listRoles(db) })
  })

  app.post('/api/admin/roles', requireUser(db), requireAdmin(), (req, res) => {
    const role = createRole(db, req.body ?? {})
    res.status(201).json(role)
  })

  app.put('/api/admin/roles/:code', requireUser(db), requireAdmin(), (req, res) => {
    const role = updateRole(db, req.params.code, req.body ?? {})
    res.json(role)
  })

  app.delete('/api/admin/roles/:code', requireUser(db), requireAdmin(), (req, res) => {
    deleteRole(db, req.params.code)
    res.json({ deleted: true })
  })


  app.get('/api/workflow', requireUser(db), (req, res) => {
    res.json(getWorkflow(db))
  })

  app.get('/api/dashboard/summary', requireUser(db), (req, res) => {
    res.json(getDashboard(db))
  })

  app.get('/api/employees/:code', requireUser(db), (req, res) => {
    const employee = db.prepare('SELECT * FROM employees WHERE UPPER(emp_code) = UPPER(?) AND active = 1').get(req.params.code)
    if (!employee) return res.status(404).json({ error: 'Employee not found' })
    res.json(employee)
  })

  app.get('/api/master/:resource', requireUser(db), (req, res) => {
    res.json({ rows: listResource(db, req.params.resource) })
  })

  app.post('/api/master/:resource', requireUser(db), requireRoles('admin', 'manager'), (req, res) => {
    const row = createResource(db, req.params.resource, req.body ?? {})
    res.status(201).json(row)
  })

  app.put('/api/master/:resource/:id', requireUser(db), requireRoles('admin', 'manager'), (req, res) => {
    const row = updateResource(db, req.params.resource, Number(req.params.id), req.body ?? {})
    res.json(row)
  })

  app.delete('/api/master/:resource/:id', requireUser(db), requireRoles('admin', 'manager'), (req, res) => {
    deleteResource(db, req.params.resource, Number(req.params.id))
    res.json({ deleted: true })
  })

  app.post('/api/rm-receipts', requireUser(db), requireRoles('admin', 'manager', 'rm_store'), (req, res) => {
    const receipt = createRmReceipt(db, req.body ?? {}, req.user.id)
    res.status(201).json(receipt)
  })

  app.post('/api/rm-receipts/:id/qc', requireUser(db), requireRoles('admin', 'manager', 'rm_store', 'qc'), (req, res) => {
    const receipt = qcRmReceipt(db, Number(req.params.id), req.body ?? {}, req.user.id)
    res.json(receipt)
  })

  app.post('/api/rm-receipts/:id/qa', requireUser(db), requireRoles('admin', 'manager', 'qa'), (req, res) => {
    const receipt = qaRmReceipt(db, Number(req.params.id), req.body ?? {}, req.user.id)
    res.json(receipt)
  })

  app.post('/api/rm-receipts/:id/qc2', requireUser(db), requireRoles('admin', 'manager', 'qc', 'qa'), (req, res) => {
    const receipt = qc2RmReceipt(db, Number(req.params.id), req.body ?? {}, req.user.id)
    res.json(receipt)
  })

  app.get('/api/daystore/available-rm', requireUser(db), (req, res) => {
    res.json(getDaystoreAvailableRm(db))
  })

  app.get('/api/daystore/inventory', requireUser(db), (req, res) => {
    res.json(getDaystoreInventory(db))
  })

  app.post('/api/daystore/transfer', requireUser(db), requireRoles('admin', 'manager', 'rm_store'), (req, res) => {
    const transfer = transferToDaystore(db, req.body ?? {}, req.user.id)
    res.status(201).json(transfer)
  })

  app.post('/api/production-targets', requireUser(db), requireRoles('admin', 'manager', 'production', 'production_head'), (req, res) => {
    const target = createProductionTarget(db, req.body ?? {}, req.user.id)
    res.status(201).json(target)
  })

  app.post('/api/production-plans', requireUser(db), requireRoles('admin', 'manager', 'production', 'production_head'), (req, res) => {
    const plan = createProductionPlan(db, req.body ?? {}, req.user.id)
    res.status(201).json(plan)
  })

  app.post('/api/production-requests', requireUser(db), requireRoles('admin', 'manager', 'production', 'production_head'), (req, res) => {
    const request = createProductionRequest(db, req.body ?? {}, req.user.id)
    res.status(201).json(request)
  })

  app.post('/api/production-requests/:id/approve', requireUser(db), requireRoles('admin', 'manager', 'rm_store'), (req, res) => {
    const request = approveProductionRequest(db, Number(req.params.id), req.body ?? {}, req.user.id)
    res.json(request)
  })

  app.post('/api/production-requests/:id/qc', requireUser(db), requireRoles('admin', 'manager', 'qc'), (req, res) => {
    const request = qcProductionRequest(db, Number(req.params.id), req.body ?? {}, req.user.id)
    res.json(request)
  })

  app.post('/api/production-requests/:id/qa', requireUser(db), requireRoles('admin', 'manager', 'qa'), (req, res) => {
    const request = qaProductionRequest(db, Number(req.params.id), req.body ?? {}, req.user.id)
    res.json(request)
  })

  app.post('/api/production-runs', requireUser(db), requireRoles('admin', 'manager', 'production'), (req, res) => {
    const run = createProductionRun(db, req.body ?? {}, req.user.id)
    res.status(201).json(run)
  })

  app.post('/api/fg-batches/:id/qc', requireUser(db), requireRoles('admin', 'manager', 'qc'), (req, res) => {
    const batch = qcFgBatch(db, Number(req.params.id), req.body ?? {}, req.user.id)
    res.json(batch)
  })

  app.post('/api/fg-batches/:id/qa', requireUser(db), requireRoles('admin', 'manager', 'qa'), (req, res) => {
    const batch = qaFgBatch(db, Number(req.params.id), req.body ?? {}, req.user.id)
    res.json(batch)
  })

  app.post('/api/dispatches', requireUser(db), requireRoles('admin', 'manager', 'fg_store', 'dispatch'), (req, res) => {
    const dispatch = createDispatch(db, req.body ?? {}, req.user.id)
    res.status(201).json(dispatch)
  })

  app.get('/api/feedback/:dispatch_id', (req, res) => {
    const dispatchId = Number(req.params.dispatch_id)
    let dispatch = db.prepare(`
      SELECT d.*, fb.batch_code, p.name AS product_name, p.code AS product_code
      FROM dispatches d 
      JOIN fg_batches fb ON fb.id = d.batch_id 
      JOIN products p ON p.id = fb.product_id 
      WHERE d.id = ?
    `).get(dispatchId)
    
    if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' })

    const siblings = db.prepare(`
      SELECT d.quantity
      FROM dispatches d
      WHERE d.customer = ? AND d.order_ref = ? AND d.shipped_at = ?
    `).all(dispatch.customer, dispatch.order_ref, dispatch.shipped_at)

    const totalQty = siblings.reduce((sum, sib) => sum + sib.quantity, 0)
    dispatch.quantity = totalQty
    dispatch.batch_code = dispatch.batch_code.replace(/[A-Za-z]$/, '')

    const existingFeedback = db.prepare('SELECT * FROM customer_feedback WHERE dispatch_id = ?').get(dispatchId)
    res.json({ dispatch, feedback: existingFeedback || null })
  })

  app.post('/api/feedback/:dispatch_id', (req, res) => {
    const dispatchId = Number(req.params.dispatch_id)
    const { rating, comments } = req.body ?? {}
    const r = Number(rating)
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' })
    
    const existing = db.prepare('SELECT id FROM customer_feedback WHERE dispatch_id = ?').get(dispatchId)
    if (existing) return res.status(409).json({ error: 'Feedback already submitted for this order' })
    
    const feedbackId = db.prepare(`
      INSERT INTO customer_feedback (dispatch_id, rating, comments)
      VALUES (?, ?, ?)
    `).run(dispatchId, r, comments || null).lastInsertRowid
    
    // Fetch dispatch details to send email
    const dispatch = db.prepare('SELECT d.order_ref, d.customer FROM dispatches d WHERE d.id = ?').get(dispatchId)
    if (dispatch && transporter) {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
      if (adminEmail) {
        transporter.sendMail({
          from: process.env.SMTP_USER,
          to: adminEmail,
          subject: `New Feedback Received - Order ${dispatch.order_ref}`,
          html: `<div style="font-family: sans-serif;">
            <h2 style="color: #0ea5e9;">New Customer Feedback</h2>
            <p><strong>Customer:</strong> ${dispatch.customer}</p>
            <p><strong>Order Ref:</strong> ${dispatch.order_ref}</p>
            <p><strong>Rating:</strong> ${r} / 5</p>
            <p><strong>Comments:</strong> ${comments || 'None'}</p>
          </div>`
        }).catch(err => console.error('Failed to send feedback email:', err))
      }
    }
    
    res.status(201).json({ success: true, id: feedbackId })
  })

  app.post('/api/dispatches/:id/complete', requireUser(db), requireRoles('admin', 'manager'), (req, res) => {
    const dispatchId = Number(req.params.id)
    
    const existing = db.prepare('SELECT id FROM customer_feedback WHERE dispatch_id = ?').get(dispatchId)
    if (existing) return res.status(409).json({ error: 'Feedback already submitted for this order' })

    const feedbackId = db.prepare(`
      INSERT INTO customer_feedback (dispatch_id, rating, comments)
      VALUES (?, ?, ?)
    `).run(dispatchId, 1, 'Manually marked as completed by Admin.').lastInsertRowid

    res.status(201).json({ success: true, id: feedbackId })
  })


  app.get('/api/table/:resource', requireUser(db), (req, res) => {
    try {
      const resource = req.params.resource
      const page = Math.max(1, parseInt(req.query.page) || 1)
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10))
      const offset = (page - 1) * limit
      const search = req.query.search || ''
      
      let baseSql = ''
      let countSql = ''
      let searchParams = []
      
      switch (resource) {
        case 'rm-receipts':
          baseSql = `
            SELECT rr.*, rm.code AS material_code, rm.name AS material_name, u.code AS unit_code,
                   qc.name AS qc_by_name, qa.name AS qa_by_name, creator.name AS created_by_name,
                   (COALESCE(rr.accepted_qty, rr.quantity) - COALESCE((
                     SELECT SUM(COALESCE(pc.actual_qty, ria.quantity))
                     FROM rm_issue_allocations ria
                     LEFT JOIN production_consumption pc ON pc.allocation_id = ria.id
                     WHERE ria.receipt_id = rr.id
                   ), 0)) AS available_qty
            FROM rm_receipts rr
            JOIN raw_materials rm ON rm.id = rr.material_id
            JOIN units u ON u.id = rm.unit_id
            LEFT JOIN users qc ON qc.id = rr.qc_by
            LEFT JOIN users qa ON qa.id = rr.qa_by
            LEFT JOIN users creator ON creator.id = rr.created_by
          `
          countSql = `
            SELECT COUNT(*) AS count
            FROM rm_receipts rr
            JOIN raw_materials rm ON rm.id = rr.material_id
          `
          if (search) {
            const condition = ` WHERE (rr.lot_number LIKE ? OR rm.name LIKE ? OR rm.code LIKE ? OR rr.supplier LIKE ? OR rr.status LIKE ?)`
            baseSql += condition
            countSql += condition
            const like = `%${search}%`
            searchParams = [like, like, like, like, like]
          }
          break
        
        case 'production-runs':
          baseSql = `
            SELECT prun.*, p.code AS product_code, p.name AS product_name, creator.name AS created_by_name
            FROM production_runs prun
            JOIN products p ON p.id = prun.product_id
            LEFT JOIN users creator ON creator.id = prun.created_by
          `
          countSql = `
            SELECT COUNT(*) AS count
            FROM production_runs prun
            JOIN products p ON p.id = prun.product_id
          `
          if (search) {
            const condition = ` WHERE (prun.batch_code LIKE ? OR p.name LIKE ? OR p.code LIKE ? OR prun.shift LIKE ?)`
            baseSql += condition
            countSql += condition
            const like = `%${search}%`
            searchParams = [like, like, like, like]
          }
          break

        case 'fg-batches':
          baseSql = `
            SELECT fb.*, p.code AS product_code, p.name AS product_name, u.code AS unit_code,
                   qc.name AS qc_by_name,
                   prun.started_at, prun.shift, prun.machine_no, prun.quantity_produced, prun.rejected_pieces, prun.testing_sample_qty,
                   emp.name AS operator_name, emp.emp_code AS operator_code,
                   COALESCE((SELECT SUM(quantity) FROM dispatches WHERE batch_id = fb.id), 0) AS dispatched_qty,
                   fb.quantity - COALESCE((SELECT SUM(quantity) FROM dispatches WHERE batch_id = fb.id), 0) AS remaining_qty
            FROM fg_batches fb
            JOIN products p ON p.id = fb.product_id
            JOIN units u ON u.id = p.unit_id
            LEFT JOIN production_runs prun ON prun.id = fb.production_run_id
            LEFT JOIN employees emp ON emp.id = prun.operator_id
            LEFT JOIN users qc ON qc.id = fb.qc_by
          `
          countSql = `
            SELECT COUNT(*) AS count
            FROM fg_batches fb
            JOIN products p ON p.id = fb.product_id
          `
          if (search) {
            const condition = ` WHERE (fb.batch_code LIKE ? OR p.name LIKE ? OR p.code LIKE ? OR fb.status LIKE ? OR fb.storage_location LIKE ?)`
            baseSql += condition
            countSql += condition
            const like = `%${search}%`
            searchParams = [like, like, like, like, like]
          }
          break

        case 'dispatches':
          baseSql = `
            SELECT d.*, fb.batch_code, p.code AS product_code, p.name AS product_name,
                   approver.name AS approved_by_name, dispatcher.name AS dispatched_by_name
            FROM dispatches d
            JOIN fg_batches fb ON fb.id = d.batch_id
            JOIN products p ON p.id = fb.product_id
            LEFT JOIN users approver ON approver.id = d.approved_by
            LEFT JOIN users dispatcher ON dispatcher.id = d.dispatched_by
          `
          countSql = `
            SELECT COUNT(*) AS count
            FROM (
              SELECT 1
              FROM dispatches d
              JOIN fg_batches fb ON fb.id = d.batch_id
              JOIN products p ON p.id = fb.product_id
          `
          if (search) {
            const condition = ` WHERE (d.order_ref LIKE ? OR d.customer LIKE ? OR fb.batch_code LIKE ? OR p.name LIKE ?)`
            baseSql += condition
            countSql += condition
            const like = `%${search}%`
            searchParams = [like, like, like, like]
          }
          const groupBy = ` GROUP BY d.customer, d.order_ref, d.shipped_at, RTRIM(fb.batch_code, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')`
          baseSql += groupBy
          countSql += groupBy + `) AS sub`
          break

        default:
          return res.status(400).json({ error: 'Unknown resource' })
      }

      baseSql += ` ORDER BY id DESC LIMIT ? OFFSET ?`
      
      const rows = db.prepare(baseSql).all(...searchParams, limit, offset)
      const totalRows = db.prepare(countSql).get(...searchParams).count
      const totalPages = Math.ceil(totalRows / limit)

      res.json({ data: rows, totalRows, totalPages, page, limit })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/public/traceability/:batchCode', (req, res) => {
    const result = getTraceability(db, req.params.batchCode)
    
    // Sanitize data for public customer view
    result.batch.team_members = undefined
    result.batch.rm_approved_by_name = undefined
    result.batch.fg_qc_by_name = undefined
    result.batch.fg_qa_by_name = undefined
    result.batch.remarks = undefined
    result.batch.qc_remarks = undefined
    result.batch.qa_remarks = undefined
    result.batch.source_team = undefined

    result.rawMaterials = result.rawMaterials.map(rm => ({
      ...rm,
      supplier: undefined,
      rm_qc_by_name: undefined,
      remarks: undefined,
      qc_remarks: undefined,
      qa_remarks: undefined
    }))

    result.fgQc = result.fgQc.map(qc => ({
      ...qc,
      checked_by_name: undefined
    }))

    res.json(result)
  })

  app.get('/api/traceability/:batchCode', requireUser(db), (req, res) => {
    res.json(getTraceability(db, req.params.batchCode))
  })

  app.use((err, _req, res, _next) => {
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: err.message || 'Unexpected server error' })
  })

  return app
}

function requireUser(db) {
  return (req, _res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const id = token.startsWith('mes-local-') ? Number(token.slice('mes-local-'.length)) : 0
    const user = id
      ? db.prepare('SELECT id, username, name, role FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(id)
      : null
    if (!user) return next(httpError(401, 'Login required'))
    req.user = user
    next()
  }
}

function requireRoles(...roles) {
  const allowed = new Set(roles)
  return (req, _res, next) => {
    if (ADMIN_ROLES.has(req.user.role) || allowed.has(req.user.role)) return next()
    next(httpError(403, `${roles.join(', ')} can perform this action`))
  }
}

function requireAdmin() {
  return (req, _res, next) => {
    if (req.user.role === 'admin') return next()
    next(httpError(403, 'Only admin users can manage users and roles'))
  }
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function mustNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw httpError(400, `${label} must be greater than zero`)
  return number
}

function nowIso() {
  return new Date().toISOString()
}

function inTransaction(db, work) {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function getBootstrap(db, user) {
  return {
    roles: listRoles(db),
    users: user.role === 'admin' ? listUsers(db) : [],
    units: listResource(db, 'units'),
    rawMaterials: listResource(db, 'raw-materials'),
    products: listResource(db, 'products'),
    bomItems: listResource(db, 'bom-items'),
    qcTemplates: listResource(db, 'qc-templates'),
    qcParameters: listResource(db, 'qc-parameters'),
    employees: listResource(db, 'employees'),
    suppliers: listResource(db, 'suppliers'),
    customers: listResource(db, 'customers'),
  }
}

function getWorkflow(db) {
  return {
    rmReceipts: db.prepare(`
      SELECT rr.*, rm.code AS material_code, rm.name AS material_name, u.code AS unit_code,
             ru.code AS quantity_unit_code,
             qc.name AS qc_by_name, qa.name AS qa_by_name, creator.name AS created_by_name
      FROM rm_receipts rr
      JOIN raw_materials rm ON rm.id = rr.material_id
      JOIN units u ON u.id = rm.unit_id
      LEFT JOIN units ru ON ru.id = rr.quantity_unit_id
      LEFT JOIN users qc ON qc.id = rr.qc_by
      LEFT JOIN users qa ON qa.id = rr.qa_by
      LEFT JOIN users creator ON creator.id = rr.created_by
      ORDER BY rr.id DESC
    `).all(),
    productionTargets: db.prepare(`
      SELECT pt.*, p.code AS product_code, p.name AS product_name, u.code AS unit_code,
             creator.name AS created_by_name
      FROM production_targets pt
      JOIN products p ON p.id = pt.product_id
      JOIN units u ON u.id = p.unit_id
      LEFT JOIN users creator ON creator.id = pt.created_by
      ORDER BY pt.id DESC
    `).all(),
    productionPlans: db.prepare(`
      SELECT pp.*, p.code AS product_code, p.name AS product_name, u.code AS unit_code,
             creator.name AS created_by_name
      FROM production_plans pp
      JOIN products p ON p.id = pp.product_id
      JOIN units u ON u.id = p.unit_id
      LEFT JOIN users creator ON creator.id = pp.created_by
      ORDER BY pp.id DESC
    `).all(),
    productionRequests: db.prepare(`
      SELECT pr.*, p.code AS product_code, p.name AS product_name, u.code AS unit_code,
             creator.name AS created_by_name, approver.name AS approved_by_name
      FROM production_requests pr
      JOIN products p ON p.id = pr.product_id
      JOIN units u ON u.id = p.unit_id
      LEFT JOIN users creator ON creator.id = pr.created_by
      LEFT JOIN users approver ON approver.id = pr.approved_by
      ORDER BY pr.id DESC
    `).all(),
    rmIssues: db.prepare(`
      SELECT ri.*, rm.code AS material_code, rm.name AS material_name, u.code AS unit_code,
             (ri.approved_qty - COALESCE((
               SELECT SUM(pc.actual_qty) 
               FROM production_consumption pc 
               JOIN rm_issue_allocations ria ON ria.id = pc.allocation_id 
               WHERE ria.issue_id = ri.id
             ), 0)) AS staged_qty
      FROM rm_issues ri
      JOIN raw_materials rm ON rm.id = ri.material_id
      JOIN units u ON u.id = rm.unit_id
      ORDER BY ri.id
    `).all(),
    rmIssueAllocations: db.prepare(`
      SELECT ria.*, rr.lot_number, rm.code AS material_code, rm.name AS material_name
      FROM rm_issue_allocations ria
      JOIN rm_receipts rr ON rr.id = ria.receipt_id
      JOIN raw_materials rm ON rm.id = ria.material_id
      ORDER BY ria.id
    `).all(),
    productionRuns: db.prepare(`
      SELECT prun.*, p.code AS product_code, p.name AS product_name, creator.name AS created_by_name
      FROM production_runs prun
      JOIN products p ON p.id = prun.product_id
      LEFT JOIN users creator ON creator.id = prun.created_by
      ORDER BY prun.id DESC
    `).all(),
    fgBatches: listFgBatches(db),
    dispatches: db.prepare(`
      SELECT d.*, fb.batch_code, p.code AS product_code, p.name AS product_name,
             approver.name AS approved_by_name, dispatcher.name AS dispatched_by_name
      FROM dispatches d
      JOIN fg_batches fb ON fb.id = d.batch_id
      JOIN products p ON p.id = fb.product_id
      LEFT JOIN users approver ON approver.id = d.approved_by
      LEFT JOIN users dispatcher ON dispatcher.id = d.dispatched_by
      ORDER BY d.id DESC
    `).all(),
    daystoreAvailableRm: getDaystoreAvailableRm(db),
    daystoreInventory: getDaystoreInventory(db)
  }
}

function listFgBatches(db) {
  return db.prepare(`
    SELECT fb.*, p.code AS product_code, p.name AS product_name, u.code AS unit_code,
           qc.name AS qc_by_name,
           prun.started_at, prun.shift, prun.machine_no, prun.quantity_produced, prun.rejected_pieces, prun.testing_sample_qty,
           emp.name AS operator_name, emp.emp_code AS operator_code,
           COALESCE(SUM(d.quantity), 0) AS dispatched_qty,
           fb.quantity - COALESCE(SUM(d.quantity), 0) AS remaining_qty
    FROM fg_batches fb
    JOIN products p ON p.id = fb.product_id
    JOIN units u ON u.id = p.unit_id
    LEFT JOIN production_runs prun ON prun.id = fb.production_run_id
    LEFT JOIN employees emp ON emp.id = prun.operator_id
    LEFT JOIN users qc ON qc.id = fb.qc_by
    LEFT JOIN dispatches d ON d.batch_id = fb.id
    GROUP BY fb.id, prun.id, emp.id
    ORDER BY fb.id DESC
  `).all()
}

function getDashboard(db) {
  const one = (sql) => db.prepare(sql).get()
  return {
    pendingRmQc: one("SELECT COUNT(*) AS count FROM rm_receipts WHERE status = 'PENDING_QC'").count,
    approvedRmLots: one("SELECT COUNT(*) AS count FROM rm_receipts WHERE status = 'APPROVED'").count,
    pendingRmApprovals: one("SELECT COUNT(*) AS count FROM production_requests WHERE status = 'PENDING_RM_APPROVAL'").count,
    pendingFgQc: one("SELECT COUNT(*) AS count FROM fg_batches WHERE status = 'QC_PENDING'").count,
    pendingFgQa: one("SELECT COUNT(*) AS count FROM fg_batches WHERE status = 'QA_PENDING'").count,
    readyFgBatches: one("SELECT COUNT(*) AS count FROM fg_batches WHERE status IN ('READY_FOR_DISPATCH', 'PARTIAL_DISPATCH')").count,
    dispatchedOrders: one('SELECT COUNT(*) AS count FROM dispatches').count,
    fgAvailableQty: one(`
      SELECT COALESCE(SUM(fb.quantity), 0) - COALESCE((SELECT SUM(quantity) FROM dispatches), 0) AS qty
      FROM fg_batches fb
      WHERE fb.status IN ('READY_FOR_DISPATCH', 'PARTIAL_DISPATCH', 'DISPATCHED')
    `).qty,
  }
}

const RESOURCE_MAP = {
  suppliers: {
    table: 'suppliers',
    fields: ['name', 'address', 'gst', 'contact', 'email', 'contact_person', 'active'],
    list: 'SELECT * FROM suppliers ORDER BY name',
  },
  customers: {
    table: 'customers',
    fields: ['name', 'address', 'gst', 'contact', 'email', 'contact_person', 'active'],
    list: 'SELECT * FROM customers ORDER BY name',
  },
  units: {
    table: 'units',
    fields: ['code', 'name'],
    list: 'SELECT * FROM units ORDER BY code',
  },
  employees: {
    table: 'employees',
    fields: ['emp_code', 'name', 'gender', 'photo_url', 'active'],
    list: 'SELECT * FROM employees ORDER BY emp_code',
  },
  'raw-materials': {
    table: 'raw_materials',
    fields: ['code', 'name', 'unit_id', 'reorder_level', 'active'],
    list: `
      SELECT rm.*, u.code AS unit_code
      FROM raw_materials rm
      JOIN units u ON u.id = rm.unit_id
      ORDER BY rm.code
    `,
  },
  products: {
    table: 'products',
    fields: ['code', 'name', 'unit_id', 'active'],
    list: `
      SELECT p.*, u.code AS unit_code
      FROM products p
      JOIN units u ON u.id = p.unit_id
      ORDER BY p.code
    `,
  },
  'bom-items': {
    table: 'bom_items',
    fields: ['product_id', 'raw_material_id', 'qty_per_unit', 'unit_id'],
    list: `
      SELECT bi.*, p.code AS product_code, p.name AS product_name,
             rm.code AS material_code, rm.name AS material_name, 
             COALESCE(bu.code, u.code) AS unit_code
      FROM bom_items bi
      JOIN products p ON p.id = bi.product_id
      JOIN raw_materials rm ON rm.id = bi.raw_material_id
      JOIN units u ON u.id = rm.unit_id
      LEFT JOIN units bu ON bu.id = bi.unit_id
      ORDER BY p.code, rm.code
    `,
  },
  'qc-templates': {
    table: 'qc_templates',
    fields: ['scope', 'name', 'product_id', 'raw_material_id', 'active'],
    list: `
      SELECT qt.*, p.code AS product_code, rm.code AS material_code
      FROM qc_templates qt
      LEFT JOIN products p ON p.id = qt.product_id
      LEFT JOIN raw_materials rm ON rm.id = qt.raw_material_id
      ORDER BY qt.scope, qt.name
    `,
  },
  'qc-parameters': {
    table: 'qc_parameters',
    fields: ['template_id', 'label', 'type', 'min_value', 'max_value', 'required'],
    list: `
      SELECT qp.*, qt.scope, qt.name AS template_name
      FROM qc_parameters qp
      JOIN qc_templates qt ON qt.id = qp.template_id
      ORDER BY qt.scope, qt.name, qp.id
    `,
  },
}

function listResource(db, resource) {
  const config = RESOURCE_MAP[resource]
  if (!config) throw httpError(404, 'Unknown master-data resource')
  return db.prepare(config.list).all()
}

function createResource(db, resource, body) {
  const config = RESOURCE_MAP[resource]
  if (!config) throw httpError(404, 'Unknown master-data resource')
  const fields = config.fields.filter((field) => Object.hasOwn(body, field))
  if (fields.length === 0) throw httpError(400, 'No fields supplied')
  const placeholders = fields.map(() => '?').join(', ')
  const result = db.prepare(`
    INSERT INTO ${config.table} (${fields.join(', ')})
    VALUES (${placeholders})
  `).run(...fields.map((field) => normalizeValue(body[field])))
  return db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(result.lastInsertRowid)
}

function updateResource(db, resource, id, body) {
  const config = RESOURCE_MAP[resource]
  if (!config) throw httpError(404, 'Unknown master-data resource')
  const fields = config.fields.filter((field) => Object.hasOwn(body, field))
  if (fields.length === 0) throw httpError(400, 'No fields supplied')
  db.prepare(`
    UPDATE ${config.table}
    SET ${fields.map((field) => `${field} = ?`).join(', ')}
    WHERE id = ?
  `).run(...fields.map((field) => normalizeValue(body[field])), id)
  return db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id)
}

function deleteResource(db, resource, id) {
  const config = RESOURCE_MAP[resource]
  if (!config) throw httpError(404, 'Unknown master-data resource')
  db.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(id)
}

function normalizeValue(value) {
  if (value === '') return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value ?? null
}

function listRoles(db) {
  return db.prepare("SELECT * FROM roles ORDER BY name").all()
}

function createRole(db, body) {
  if (!body.code || !body.name) throw httpError(400, 'Code and name are required')
  try {
    db.prepare('INSERT INTO roles (code, name, permissions) VALUES (?, ?, ?)').run(
      body.code,
      body.name,
      body.permissions || '[]'
    )
    return db.prepare('SELECT * FROM roles WHERE code = ?').get(body.code)
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw httpError(400, 'Role code already exists')
    throw e
  }
}

function updateRole(db, code, body) {
  if (!body.name) throw httpError(400, 'Name is required')
  const info = db.prepare('UPDATE roles SET name = ?, permissions = ? WHERE code = ?').run(
    body.name,
    body.permissions || '[]',
    code
  )
  if (info.changes === 0) throw httpError(404, 'Role not found')
  return db.prepare('SELECT * FROM roles WHERE code = ?').get(code)
}

function deleteRole(db, code) {
  if (db.prepare('SELECT 1 FROM users WHERE role = ? AND deleted_at IS NULL').get(code)) {
    throw httpError(400, 'Cannot delete role assigned to active users')
  }
  const info = db.prepare('DELETE FROM roles WHERE code = ?').run(code)
  if (info.changes === 0) throw httpError(404, 'Role not found')
}

function listUsers(db) {
  return db.prepare(`
    SELECT id, username, name, role, active
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY active DESC, role, name
  `).all()
}

function createUser(db, body) {
  const username = normalizeUsername(body.username)
  const password = normalizePassword(body.password, true)
  const name = normalizeRequiredString(body.name, 'Name')
  const role = normalizeRole(db, body.role)
  const active = normalizeActive(body.active, 1)

  const existing = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username)
  if (existing) throw httpError(409, 'Username already exists')

  const result = db.prepare(`
    INSERT INTO users (username, password, name, role, active)
    VALUES (?, ?, ?, ?, ?)
  `).run(username, password, name, role, active)
  return getUser(db, result.lastInsertRowid)
}

function updateUser(db, id, body) {
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'User id is required')
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id)
  if (!existing) throw httpError(404, 'User not found')

  const updates = []
  const values = []
  let nextRole = existing.role
  let nextActive = existing.active

  if (Object.hasOwn(body, 'username')) {
    const username = normalizeUsername(body.username)
    const duplicate = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?').get(username, id)
    if (duplicate) throw httpError(409, 'Username already exists')
    updates.push('username = ?')
    values.push(username)
  }

  if (Object.hasOwn(body, 'password') && String(body.password ?? '').trim() !== '') {
    updates.push('password = ?')
    values.push(normalizePassword(body.password, false))
  }

  if (Object.hasOwn(body, 'name')) {
    updates.push('name = ?')
    values.push(normalizeRequiredString(body.name, 'Name'))
  }

  if (Object.hasOwn(body, 'role')) {
    nextRole = normalizeRole(db, body.role)
    updates.push('role = ?')
    values.push(nextRole)
  }

  if (Object.hasOwn(body, 'active')) {
    nextActive = normalizeActive(body.active, existing.active)
    updates.push('active = ?')
    values.push(nextActive)
  }

  assertActiveAdminRemains(db, id, nextRole, nextActive)
  if (updates.length === 0) return getUser(db, id)

  db.prepare(`
    UPDATE users
    SET ${updates.join(', ')}
    WHERE id = ?
  `).run(...values, id)
  return getUser(db, id)
}

function getUser(db, id) {
  return db.prepare('SELECT id, username, name, role, active FROM users WHERE id = ? AND deleted_at IS NULL').get(id)
}

function deleteUser(db, id, currentUserId) {
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'User id is required')
  if (id === currentUserId) throw httpError(400, 'Sign in as another admin before deleting your own account')

  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id)
  if (!existing) throw httpError(404, 'User not found')

  assertActiveAdminRemains(db, id, existing.role, 0)
  db.prepare(`
    UPDATE users
    SET active = 0, deleted_at = ?
    WHERE id = ?
  `).run(nowIso(), id)
}

function normalizeUsername(value) {
  const username = String(value ?? '').trim()
  if (!username) throw httpError(400, 'Username is required')
  if (!/^[a-z0-9._-]{3,40}$/i.test(username)) {
    throw httpError(400, 'Username must be 3-40 characters and use letters, numbers, dot, underscore, or dash')
  }
  return username
}

function normalizePassword(value, required) {
  const password = String(value ?? '').trim()
  if (!password && required) throw httpError(400, 'Password is required')
  if (password && password.length < 4) throw httpError(400, 'Password must be at least 4 characters')
  return password
}

function normalizeRequiredString(value, label) {
  const text = String(value ?? '').trim()
  if (!text) throw httpError(400, `${label} is required`)
  return text
}

function normalizeRole(db, value) {
  const role = String(value ?? '').trim()
  const exists = db.prepare('SELECT 1 FROM roles WHERE code = ?').get(role)
  if (!exists) throw httpError(400, 'Selected role is not valid')
  return role
}

function normalizeActive(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (value === true || value === 1 || value === '1' || value === 'true') return 1
  if (value === false || value === 0 || value === '0' || value === 'false') return 0
  throw httpError(400, 'Active must be true or false')
}

function assertActiveAdminRemains(db, userId, nextRole, nextActive) {
  if (nextRole === 'admin' && Number(nextActive) === 1) return
  const otherAdmins = db.prepare(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE id <> ? AND role = 'admin' AND active = 1 AND deleted_at IS NULL
  `).get(userId).count
  if (otherAdmins === 0) throw httpError(400, 'At least one active admin user is required')
}

function createRmReceipt(db, body, userId) {
  const materialId = Number(body.material_id)
  const quantity = mustNumber(body.quantity, 'Receipt quantity')
  const quantityUnitId = body.quantity_unit_id ? Number(body.quantity_unit_id) : null
  const supplier = String(body.supplier || '').trim()
  const lotNumber = String(body.lot_number || '').trim() || `AUTO-${Date.now()}`
  const poNumber = String(body.po_number || '').trim() || null
  const poDate = String(body.po_date || '').trim() || null
  const invoiceNumber = String(body.invoice_number || '').trim() || null
  const invoiceDate = String(body.invoice_date || '').trim() || null
  const hsnCode = String(body.hsn_code || '').trim() || null

  if (!materialId || !supplier) throw httpError(400, 'Material and supplier are required')

  const result = db.prepare(`
    INSERT INTO rm_receipts (material_id, supplier, lot_number, quantity, quantity_unit_id, po_number, po_date, invoice_number, invoice_date, hsn_code, received_at, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(materialId, supplier, lotNumber, quantity, quantityUnitId, poNumber, poDate, invoiceNumber, invoiceDate, hsnCode, body.received_at || nowIso(), body.remarks || null, userId)
  return getRmReceipt(db, result.lastInsertRowid)
}

function getRmReceipt(db, id) {
  return db.prepare(`
    SELECT rr.*, rm.code AS material_code, rm.name AS material_name, u.code AS quantity_unit_code
    FROM rm_receipts rr
    JOIN raw_materials rm ON rm.id = rr.material_id
    LEFT JOIN units u ON u.id = rr.quantity_unit_id
    WHERE rr.id = ?
  `).get(id)
}

function qcRmReceipt(db, receiptId, body, userId) {
  const receipt = db.prepare('SELECT * FROM rm_receipts WHERE id = ?').get(receiptId)
  if (!receipt) throw httpError(404, 'RM receipt not found')
  if (!['PENDING_QC', 'HOLD'].includes(receipt.status)) throw httpError(400, 'Only pending or held receipts can be QC checked')

  return inTransaction(db, () => {
    db.prepare('DELETE FROM rm_qc_results WHERE receipt_id = ?').run(receiptId)
    const insertResult = db.prepare(`
      INSERT INTO rm_qc_results (receipt_id, parameter_id, value, passed, checked_by)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const result of body.results ?? []) {
      insertResult.run(receiptId, result.parameter_id ?? null, String(result.value ?? ''), result.passed ? 1 : 0, userId)
    }
    const resultsPassed = (body.results ?? []).every((result) => result.passed !== false)
    const passed = Boolean(body.passed) && resultsPassed
    const failedStatus = body.disposition === 'HOLD' ? 'HOLD' : 'PENDING_QC2'
    
    const acceptedQty = Number(body.accepted_qty ?? receipt.quantity)
    const rejectedQty = Number(body.rejected_qty ?? 0)
    if (Math.abs(acceptedQty + rejectedQty - receipt.quantity) > 0.0001) {
      throw httpError(400, 'Accepted and rejected quantities must sum to the total receipt quantity')
    }

    db.prepare(`
      UPDATE rm_receipts
      SET status = ?, qc_by = ?, qc_at = ?, qc_remarks = ?, accepted_qty = ?, rejected_qty = ?
      WHERE id = ?
    `).run(passed ? 'PENDING_QA' : failedStatus, userId, nowIso(), body.qc_remarks || null, acceptedQty, rejectedQty, receiptId)
    return getRmReceipt(db, receiptId)
  })
}

function qaRmReceipt(db, receiptId, body, userId) {
  const receipt = db.prepare('SELECT * FROM rm_receipts WHERE id = ?').get(receiptId)
  if (!receipt) throw httpError(404, 'RM receipt not found')
  if (receipt.status !== 'PENDING_QA') throw httpError(400, 'Only PENDING_QA receipts can be QA checked')

  return inTransaction(db, () => {
    const passed = Boolean(body.passed)
    const failedStatus = body.disposition === 'HOLD' ? 'HOLD' : 'PENDING_QC2'
    db.prepare(`
      UPDATE rm_receipts
      SET status = ?, qa_by = ?, qa_at = ?, remarks = ?
      WHERE id = ?
    `).run(passed ? 'APPROVED' : failedStatus, userId, nowIso(), body.qa_remarks || null, receiptId)
    return getRmReceipt(db, receiptId)
  })
}

function qc2RmReceipt(db, receiptId, body, userId) {
  const receipt = db.prepare('SELECT * FROM rm_receipts WHERE id = ?').get(receiptId)
  if (!receipt) throw httpError(404, 'RM receipt not found')
  if (receipt.status !== 'PENDING_QC2') throw httpError(400, 'Only PENDING_QC2 receipts can be QC 2 checked')

  return inTransaction(db, () => {
    const passed = Boolean(body.passed)
    const reworkNotes = body.rework_notes ? String(body.rework_notes) : null
    const newStatus = passed ? 'PENDING_QA' : 'REJECTED'
    db.prepare(`
      UPDATE rm_receipts
      SET status = ?, rework_notes = ?
      WHERE id = ?
    `).run(newStatus, reworkNotes, receiptId)
    return getRmReceipt(db, receiptId)
  })
}

function createProductionTarget(db, body, userId) {
  const productId = Number(body.product_id)
  const targetQty = mustNumber(body.target_qty, 'Target quantity')
  if (!productId) throw httpError(400, 'Product is required')

  const targetId = db.prepare(`
    INSERT INTO production_targets (product_id, target_qty, start_date, end_date, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(productId, targetQty, body.start_date || null, body.end_date || null, body.remarks || null, userId).lastInsertRowid

  return db.prepare('SELECT * FROM production_targets WHERE id = ?').get(targetId)
}

function createProductionPlan(db, body, userId) {
  const targetId = Number(body.target_id)
  const productId = Number(body.product_id)
  const plannedQty = mustNumber(body.planned_qty, 'Planned quantity')
  const planDate = String(body.plan_date || '').trim()
  const shift = String(body.shift || 'A').trim()
  const batchNumber = String(body.batch_number || '').trim()
  const machineNo = String(body.machine_no || '').trim()
  if (!targetId || !productId || !planDate) throw httpError(400, 'Target, Product, and Plan Date are required')

  const planId = db.prepare(`
    INSERT INTO production_plans (target_id, product_id, planned_qty, plan_date, shift, batch_number, machine_no, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(targetId, productId, plannedQty, planDate, shift, batchNumber, machineNo || null, body.remarks || null, userId).lastInsertRowid

  return db.prepare('SELECT * FROM production_plans WHERE id = ?').get(planId)
}

function createProductionRequest(db, body, userId) {
  const productId = Number(body.product_id)
  const requestedQty = mustNumber(body.requested_qty, 'Requested quantity')
  const sourceTeam = String(body.source_team || '').trim()
  const planId = body.plan_id ? Number(body.plan_id) : null
  if (!productId || !sourceTeam) throw httpError(400, 'Product and source team are required')

  const bom = db.prepare('SELECT * FROM bom_items WHERE product_id = ? ORDER BY id').all(productId)
  if (bom.length === 0) throw httpError(400, 'Selected product needs at least one BOM item')

  return inTransaction(db, () => {
    const requestId = db.prepare(`
      INSERT INTO production_requests
        (plan_id, product_id, requested_qty, source_team, due_date, priority, notes, remarks, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      planId,
      productId,
      requestedQty,
      sourceTeam,
      body.due_date || null,
      body.priority || 'NORMAL',
      body.notes || null,
      body.remarks || null,
      userId,
    ).lastInsertRowid

    const insertIssue = db.prepare(`
      INSERT INTO rm_issues (request_id, material_id, requested_qty)
      VALUES (?, ?, ?)
    `)
    for (const item of bom) {
      insertIssue.run(requestId, item.raw_material_id, item.qty_per_unit * requestedQty)
    }

    return getProductionRequest(db, requestId)
  })
}

function getProductionRequest(db, id) {
  return db.prepare(`
    SELECT pr.*, p.code AS product_code, p.name AS product_name
    FROM production_requests pr
    JOIN products p ON p.id = pr.product_id
    WHERE pr.id = ?
  `).get(id)
}

function qcProductionRequest(db, requestId, body, userId) {
  const request = db.prepare('SELECT * FROM production_requests WHERE id = ?').get(requestId)
  if (!request) throw httpError(404, 'Production request not found')
  if (request.status !== 'PENDING_QC') throw httpError(400, 'Only pending QC requests can be checked')

  if (body.passed === false) {
    if (!body.remarks) throw httpError(400, 'Remarks required for rejection')
    db.prepare(`
      UPDATE production_requests
      SET status = 'QC_REJECTED', approved_by = ?, approved_at = ?, approval_remarks = ?
      WHERE id = ?
    `).run(userId, nowIso(), body.remarks, requestId)
  } else {
    db.prepare(`
      UPDATE production_requests
      SET status = 'PENDING_QA'
      WHERE id = ?
    `).run(requestId)
  }
  return getProductionRequest(db, requestId)
}

function qaProductionRequest(db, requestId, body, userId) {
  const request = db.prepare('SELECT * FROM production_requests WHERE id = ?').get(requestId)
  if (!request) throw httpError(404, 'Production request not found')
  if (request.status !== 'PENDING_QA') throw httpError(400, 'Only pending QA requests can be checked')

  if (body.passed === false) {
    if (!body.remarks) throw httpError(400, 'Remarks required for rejection')
    db.prepare(`
      UPDATE production_requests
      SET status = 'QA_REJECTED', approved_by = ?, approved_at = ?, approval_remarks = ?
      WHERE id = ?
    `).run(userId, nowIso(), body.remarks, requestId)
  } else {
    db.prepare(`
      UPDATE production_requests
      SET status = 'PENDING_RM_APPROVAL'
      WHERE id = ?
    `).run(requestId)
  }
  return getProductionRequest(db, requestId)
}

function approveProductionRequest(db, requestId, body, userId) {
  const request = db.prepare('SELECT * FROM production_requests WHERE id = ?').get(requestId)
  if (!request) throw httpError(404, 'Production request not found')
  if (request.status !== 'PENDING_RM_APPROVAL') throw httpError(400, 'Only pending RM requests can be approved')

  if (body.approved === false) {
    db.prepare(`
      UPDATE production_requests
      SET status = 'RM_REJECTED', approved_by = ?, approved_at = ?, approval_remarks = ?
      WHERE id = ?
    `).run(userId, nowIso(), body.approval_remarks || null, requestId)
    db.prepare("UPDATE rm_issues SET status = 'REJECTED' WHERE request_id = ?").run(requestId)
    return getProductionRequest(db, requestId)
  }

  const issues = db.prepare('SELECT * FROM rm_issues WHERE request_id = ? ORDER BY id').all(requestId)
  return inTransaction(db, () => {
    for (const issue of issues) {
      allocateIssue(db, issue)
    }
    db.prepare(`
      UPDATE production_requests
      SET status = 'RM_APPROVED', approved_by = ?, approved_at = ?, approval_remarks = ?
      WHERE id = ?
    `).run(userId, nowIso(), body.approval_remarks || null, requestId)
    return getProductionRequest(db, requestId)
  })
}

function allocateIssue(db, issue) {
  const availableLots = db.prepare(`
    SELECT rr.id, COALESCE(rr.accepted_qty, rr.quantity) - COALESCE(SUM(COALESCE(pc.actual_qty, ria.quantity)), 0) AS available_qty
    FROM rm_receipts rr
    LEFT JOIN rm_issue_allocations ria ON ria.receipt_id = rr.id
    LEFT JOIN production_consumption pc ON pc.allocation_id = ria.id
    WHERE rr.material_id = ? AND rr.status = 'APPROVED'
    GROUP BY rr.id
    HAVING available_qty > 0
    ORDER BY rr.received_at, rr.id
  `).all(issue.material_id)

  const totalAvailable = availableLots.reduce((sum, lot) => sum + Number(lot.available_qty), 0)
  if (totalAvailable + 0.000001 < issue.requested_qty) {
    const material = db.prepare('SELECT code, name FROM raw_materials WHERE id = ?').get(issue.material_id)
    throw httpError(409, `Insufficient approved RM for ${material.code} - ${material.name}`)
  }

  let remaining = issue.requested_qty
  const insertAllocation = db.prepare(`
    INSERT INTO rm_issue_allocations (issue_id, receipt_id, material_id, quantity)
    VALUES (?, ?, ?, ?)
  `)
  for (const lot of availableLots) {
    if (remaining <= 0) break
    const qty = Math.min(remaining, Number(lot.available_qty))
    insertAllocation.run(issue.id, lot.id, issue.material_id, qty)
    remaining -= qty
  }
  db.prepare(`
    UPDATE rm_issues
    SET status = 'APPROVED', approved_qty = ?
    WHERE id = ?
  `).run(issue.requested_qty, issue.id)
}

function createProductionRun(db, body, userId) {
  const requestId = Number(body.request_id)
  const quantityProduced = mustNumber(body.quantity_produced, 'Produced quantity')
  const shift = String(body.shift || '').trim()
  const machineNo = String(body.machine_no || '').trim()
  const teamMembers = String(body.team_members || '').trim()
  const empCode = String(body.emp_code || '').trim()
  
  if (!requestId || !shift) throw httpError(400, 'Request and shift are required')

  let operatorId = null
  if (empCode) {
    const emp = db.prepare('SELECT id FROM employees WHERE UPPER(emp_code) = UPPER(?)').get(empCode)
    if (!emp) throw httpError(400, 'Invalid Employee Code')
    operatorId = emp.id
  }

  const runnerWaste = Number(body.runner_waste_kg) || 0
  const purgeWaste = Number(body.purge_waste_kg) || 0
  const rejectedPieces = Number(body.rejected_pieces) || 0
  const testingSample = Number(body.testing_sample_qty) || 0

  const request = db.prepare('SELECT * FROM production_requests WHERE id = ?').get(requestId)
  if (!request) throw httpError(404, 'Production request not found')
  if (request.status !== 'RM_APPROVED') throw httpError(400, 'Production can start only after RM approval')

  const existingRun = db.prepare('SELECT id FROM production_runs WHERE request_id = ? AND shift = ?').get(requestId, shift)
  if (existingRun) {
    throw httpError(400, `A production run has already been recorded for Request #${requestId} in Shift ${shift}. Only one batch per shift is allowed.`)
  }

  const allocations = db.prepare(`
    SELECT ria.*, ri.requested_qty
    FROM rm_issue_allocations ria
    JOIN rm_issues ri ON ri.id = ria.issue_id
    WHERE ri.request_id = ?
    ORDER BY ria.id
  `).all(requestId)
  if (allocations.length === 0) throw httpError(400, 'No approved RM allocations found')

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(request.product_id)
  const startedAt = body.started_at || nowIso()
  const endedAt = body.ended_at || null
  const runMinutes = Number(body.run_minutes) || calculateMinutes(startedAt, endedAt)
  
  let batchCode = null;
  if (request.plan_id) {
    const plan = db.prepare('SELECT batch_number FROM production_plans WHERE id = ?').get(request.plan_id);
    if (plan && plan.batch_number) batchCode = plan.batch_number;
  }
  if (!batchCode) {
    batchCode = generateBatchCode(db, product.code, shift, startedAt, request.product_id);
  }

  const consumptionOverrides = body.consumption ?? {}

  return inTransaction(db, () => {
    const runId = db.prepare(`
      INSERT INTO production_runs
        (request_id, product_id, quantity_produced, shift, operator_id, machine_no, runner_waste_kg, purge_waste_kg, rejected_pieces, testing_sample_qty, team_members, started_at, ended_at, run_minutes, batch_code, remarks, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requestId,
      request.product_id,
      quantityProduced,
      shift,
      operatorId,
      machineNo || null,
      runnerWaste,
      purgeWaste,
      rejectedPieces,
      testingSample,
      teamMembers,
      startedAt,
      endedAt,
      runMinutes,
      batchCode,
      body.remarks || null,
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
        throw httpError(400, 'Actual RM consumption cannot exceed approved issue quantity')
      }
      insertConsumption.run(runId, allocation.id, allocation.receipt_id, allocation.material_id, allocation.quantity, actualQty)
    }

    const batchId = db.prepare(`
      INSERT INTO fg_batches (production_run_id, product_id, batch_code, quantity)
      VALUES (?, ?, ?, ?)
    `).run(runId, request.product_id, batchCode, quantityProduced).lastInsertRowid

    db.prepare("UPDATE production_requests SET status = 'PRODUCED' WHERE id = ?").run(requestId)

    return {
      ...db.prepare('SELECT * FROM production_runs WHERE id = ?').get(runId),
      fg_batch: db.prepare('SELECT * FROM fg_batches WHERE id = ?').get(batchId),
    }
  })
}

function calculateMinutes(startedAt, endedAt) {
  if (!endedAt) return null
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return Math.round((end - start) / 60000)
}

function generateBatchCode(db, productCode, shift, startedAt, productId) {
  const dateCode = formatDateCode(startedAt)
  const shiftSegment = segment(shift)
  const prefix = `TP-${dateCode}-${shiftSegment}-`

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

function qcFgBatch(db, batchId, body, userId) {
  const batch = db.prepare('SELECT * FROM fg_batches WHERE id = ?').get(batchId)
  if (!batch) throw httpError(404, 'FG batch not found')
  if (!['QC_PENDING', 'QC_FAILED'].includes(batch.status)) {
    throw httpError(400, 'Only pending batches can receive FG QC')
  }

  return inTransaction(db, () => {
    db.prepare('DELETE FROM fg_qc_results WHERE batch_id = ?').run(batchId)
    const insertResult = db.prepare(`
      INSERT INTO fg_qc_results (batch_id, parameter_id, value, passed, checked_by)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const result of body.results ?? []) {
      insertResult.run(batchId, result.parameter_id ?? null, String(result.value ?? ''), result.passed ? 1 : 0, userId)
    }
    const resultsPassed = (body.results ?? []).every((result) => result.passed !== false)
    const passed = Boolean(body.passed) && resultsPassed
    db.prepare(`
      UPDATE fg_batches
      SET status = ?, qc_by = ?, qc_at = ?, storage_location = ?, qc_remarks = ?
      WHERE id = ?
    `).run(passed ? 'QA_PENDING' : 'QC_FAILED', userId, nowIso(), passed ? 'QA_STORE' : 'DAY_STORE', body.qc_remarks || null, batchId)
    return db.prepare('SELECT * FROM fg_batches WHERE id = ?').get(batchId)
  })
}

function qaFgBatch(db, batchId, body, userId) {
  const batch = db.prepare('SELECT * FROM fg_batches WHERE id = ?').get(batchId)
  if (!batch) throw httpError(404, 'FG batch not found')
  if (!['QA_PENDING', 'QA_FAILED'].includes(batch.status)) {
    throw httpError(400, 'Only QA pending batches can receive QA')
  }

  return inTransaction(db, () => {
    db.prepare('DELETE FROM fg_qa_results WHERE batch_id = ?').run(batchId)
    const insertResult = db.prepare(`
      INSERT INTO fg_qa_results (batch_id, parameter_id, value, passed, checked_by)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const result of body.results ?? []) {
      insertResult.run(batchId, result.parameter_id ?? null, String(result.value ?? ''), result.passed ? 1 : 0, userId)
    }
    const resultsPassed = (body.results ?? []).every((result) => result.passed !== false)
    const passed = Boolean(body.passed) && resultsPassed
    db.prepare(`
      UPDATE fg_batches
      SET status = ?, qa_by = ?, qa_at = ?, storage_location = ?, qa_remarks = ?
      WHERE id = ?
    `).run(passed ? 'READY_FOR_DISPATCH' : 'QA_FAILED', userId, nowIso(), passed ? 'FG_STORE' : 'QA_STORE', body.qa_remarks || null, batchId)
    return db.prepare('SELECT * FROM fg_batches WHERE id = ?').get(batchId)
  })
}

function createDispatch(db, body, userId) {
  const customer = String(body.customer || '').trim()
  const orderRef = String(body.order_ref || '').trim()
  const inputBatches = Array.isArray(body.batches) ? body.batches : []
  
  if (!customer || !orderRef || inputBatches.length === 0) throw httpError(400, 'Customer, order reference, and at least one batch are required')

  const transportType = String(body.transport_type || 'OWN').trim()
  const driverName = String(body.driver_name || '').trim() || null
  const driverPhone = String(body.driver_phone || '').trim() || null
  const courierName = String(body.courier_name || '').trim() || null
  const bookingLr = String(body.booking_lr || '').trim() || null
  const customerEmail = String(body.customer_email || '').trim() || null

  const dispatchesToCreate = [];
  const allAvailableBatches = db.prepare(`SELECT * FROM fg_batches WHERE status IN ('READY_FOR_DISPATCH', 'PARTIAL_DISPATCH') ORDER BY id ASC`).all()

  for (const item of inputBatches) {
    const baseBatchCode = String(item.base_batch_code).trim();
    const quantity = mustNumber(item.quantity, `Dispatch quantity for ${baseBatchCode}`);
    
    const batches = allAvailableBatches.filter(b => b.batch_code === baseBatchCode || (b.batch_code.startsWith(baseBatchCode) && b.batch_code.length === baseBatchCode.length + 1 && /[A-Za-z]/.test(b.batch_code.slice(-1))));
    
    if (batches.length === 0) throw httpError(404, `No matching FG batches found for ${baseBatchCode}`);
    
    let remainingNeeded = quantity;
    for (const batch of batches) {
      if (remainingNeeded <= 0) break;
      const batchRemaining = getFgRemaining(db, batch.id);
      if (batchRemaining > 0) {
        const take = Math.min(batchRemaining, remainingNeeded);
        dispatchesToCreate.push({ batch, take });
        remainingNeeded -= take;
      }
    }
    
    if (remainingNeeded > 0.000001) throw httpError(409, `Dispatch quantity exceeds available stock for ${baseBatchCode}`);
  }

  return inTransaction(db, () => {
    let lastDispatchId = null;
    let dispatchRecords = [];

    for (const d of dispatchesToCreate) {
      lastDispatchId = db.prepare(`
        INSERT INTO dispatches
          (batch_id, customer, order_ref, quantity, vehicle_no, transport_type, driver_name, driver_phone, courier_name, booking_lr, customer_email, remarks, approved_by, dispatched_by, shipped_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        d.batch.id,
        customer,
        orderRef,
        d.take,
        body.vehicle_no || null,
        transportType,
        driverName,
        driverPhone,
        courierName,
        bookingLr,
        customerEmail,
        body.remarks || null,
        userId,
        userId,
        body.shipped_at || nowIso()
      ).lastInsertRowid

      const updatedRemaining = getFgRemaining(db, d.batch.id)
      db.prepare(`
        UPDATE fg_batches
        SET status = ?
        WHERE id = ?
      `).run(updatedRemaining <= 0.000001 ? 'DISPATCHED' : 'PARTIAL_DISPATCH', d.batch.id)

      dispatchRecords.push(db.prepare('SELECT * FROM dispatches WHERE id = ?').get(lastDispatchId))
    }

    if (customerEmail && process.env.SMTP_USER && dispatchesToCreate.length > 0) {
      const mainBatch = dispatchesToCreate[0].batch;
      const product = db.prepare('SELECT p.name, u.code FROM products p JOIN units u ON u.id = p.unit_id WHERE p.id = ?').get(mainBatch.product_id)
      const productName = product.name
      const unitCode = product.code
      const transportDetails = transportType === 'COURIER' 
        ? `Courier: ${courierName || '-'} (LR: ${bookingLr || '-'})`
        : `Vehicle: ${body.vehicle_no || '-'} (Driver: ${driverName || '-'}, Phone: ${driverPhone || '-'})`
        
      const feedbackUrl = `https://startling-relocate-deviation.ngrok-free.dev/#/feedback/${lastDispatchId}`
      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #0ea5e9;">Your Order has been Dispatched!</h2>
          <p>Dear ${customer},</p>
          <p>Your order (Ref: <strong>${orderRef}</strong>) has been shipped.</p>
          
          <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="margin-bottom: 8px;"><strong>Product:</strong> ${productName}</li>
              <li style="margin-bottom: 8px;"><strong>Batch Group:</strong> ${baseBatchCode}</li>
              <li style="margin-bottom: 8px;"><strong>Total Quantity:</strong> ${quantity} ${unitCode}</li>
              <li><strong>Transport:</strong> ${transportDetails}</li>
            </ul>
          </div>

          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 25px 0;" />
          <p style="font-size: 14px; color: #334155; margin-bottom: 15px;">For more details of the Batch, click the link below.</p>
          <a href="https://startling-relocate-deviation.ngrok-free.dev/#/public-trace/${encodeURIComponent(mainBatch.batch_code)}" style="display: inline-block; background: #0ea5e9; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-bottom: 10px;">Traceability</a>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 25px 0;" />

          <p>We value your feedback. Please let us know how we did by clicking the link below:</p>
          <p style="margin-top: 20px;">
            <a href="${feedbackUrl}" style="display: inline-block; padding: 12px 20px; background: #0ea5e9; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Provide Feedback</a>
          </p>
        </div>
      `

      transporter.sendMail({
        from: process.env.SMTP_USER,
        to: customerEmail,
        subject: `Dispatch Notification - Order ${orderRef}`,
        html: emailHtml,
      }).then(() => console.log('Email sent successfully to', customerEmail))
        .catch(err => console.error('Error sending email:', err))
    }

    return dispatchRecords.length > 0 ? dispatchRecords[0] : null
  })
}
function getFgRemaining(db, batchId) {
  const row = db.prepare(`
    SELECT fb.quantity - COALESCE(SUM(d.quantity), 0) AS remaining_qty
    FROM fg_batches fb
    LEFT JOIN dispatches d ON d.batch_id = fb.id
    WHERE fb.id = ?
    GROUP BY fb.id
  `).get(batchId)
  return Number(row?.remaining_qty ?? 0)
}

function getTraceability(db, batchCode) {
  // Try to find matching batches (either exact match, or base code match)
  const batches = db.prepare(`
    SELECT fb.*, p.code AS product_code, p.name AS product_name, prun.shift, prun.team_members,
           prun.started_at, prun.ended_at, prun.run_minutes, prun.remarks AS run_remarks, 
           req.source_team, req.requested_qty, req.approved_at, req.remarks AS request_remarks, req.approval_remarks AS request_approval_remarks,
           approver.name AS rm_approved_by_name, qc.name AS fg_qc_by_name, qa.name AS fg_qa_by_name,
           emp.emp_code AS operator_code
    FROM fg_batches fb
    JOIN products p ON p.id = fb.product_id
    JOIN production_runs prun ON prun.id = fb.production_run_id
    JOIN production_requests req ON req.id = prun.request_id
    LEFT JOIN employees emp ON emp.id = prun.operator_id
    LEFT JOIN users approver ON approver.id = req.approved_by
    LEFT JOIN users qc ON qc.id = fb.qc_by
    LEFT JOIN users qa ON qa.id = fb.qa_by
    WHERE fb.batch_code = ? OR fb.batch_code LIKE ?
    ORDER BY fb.id ASC
  `).all(batchCode, batchCode + '_')

  if (batches.length === 0) throw httpError(404, 'Batch code not found')

  // Aggregate batch data
  const mainBatch = { ...batches[0] }
  mainBatch.batch_code = batchCode; // use requested base code
  
  if (batches.length > 1) {
    mainBatch.quantity = batches.reduce((sum, b) => sum + Number(b.quantity), 0)
    mainBatch.shift = Array.from(new Set(batches.map(b => b.shift))).join(', ')
    mainBatch.team_members = Array.from(new Set(batches.map(b => b.team_members))).join(' | ')
    mainBatch.operator_code = Array.from(new Set(batches.map(b => b.operator_code).filter(Boolean))).join(', ')
    mainBatch.run_remarks = Array.from(new Set(batches.map(b => b.run_remarks).filter(Boolean))).join(' | ')
    mainBatch.qc_remarks = Array.from(new Set(batches.map(b => b.qc_remarks).filter(Boolean))).join(' | ')
    mainBatch.qa_remarks = Array.from(new Set(batches.map(b => b.qa_remarks).filter(Boolean))).join(' | ')
  }

  let rawMaterials = []
  let fgQc = []
  let dispatches = []

  for (const b of batches) {
    const rms = db.prepare(`
      SELECT pc.*, rr.lot_number, rr.supplier, rr.received_at, rr.qc_at, rr.remarks AS receipt_remarks, rr.qc_remarks AS receipt_qc_remarks,
             rm.code AS material_code, rm.name AS material_name,
             qc.name AS rm_qc_by_name
      FROM production_consumption pc
      JOIN rm_receipts rr ON rr.id = pc.receipt_id
      JOIN raw_materials rm ON rm.id = pc.material_id
      LEFT JOIN users qc ON qc.id = rr.qc_by
      WHERE pc.run_id = ?
    `).all(b.production_run_id)
    rawMaterials.push(...rms)

    const qcqa = db.prepare(`
      SELECT r.value, r.passed, r.checked_at, p.label, p.type, p.min_value, p.max_value, u.name AS checked_by_name, 'QC' AS stage
      FROM fg_qc_results r
      JOIN qc_parameters p ON p.id = r.parameter_id
      LEFT JOIN users u ON u.id = r.checked_by
      WHERE r.batch_id = ?
      UNION ALL
      SELECT r.value, r.passed, r.checked_at, p.label, p.type, p.min_value, p.max_value, u.name AS checked_by_name, 'QA' AS stage
      FROM fg_qa_results r
      JOIN qc_parameters p ON p.id = r.parameter_id
      LEFT JOIN users u ON u.id = r.checked_by
      WHERE r.batch_id = ?
      ORDER BY checked_at DESC
    `).all(b.id, b.id)
    fgQc.push(...qcqa)

    const disps = db.prepare(`
      SELECT d.*, approver.name AS approved_by_name, dispatcher.name AS dispatched_by_name,
             cf.rating AS feedback_rating, cf.comments AS feedback_comments, cf.submitted_at AS feedback_submitted_at
      FROM dispatches d
      LEFT JOIN users approver ON approver.id = d.approved_by
      LEFT JOIN users dispatcher ON dispatcher.id = d.dispatched_by
      LEFT JOIN customer_feedback cf ON cf.dispatch_id = d.id
      WHERE d.batch_id = ?
      ORDER BY d.id
    `).all(b.id)
    dispatches.push(...disps)
  }

  // Deduplicate raw materials by lot_number
  const rmMap = new Map()
  for (const rm of rawMaterials) {
    if (!rmMap.has(rm.lot_number)) {
      rmMap.set(rm.lot_number, rm)
    } else {
      rmMap.get(rm.lot_number).quantity += Number(rm.quantity)
    }
  }
  rawMaterials = Array.from(rmMap.values()).sort((a, b) => a.material_code.localeCompare(b.material_code))

  return { batch: mainBatch, rawMaterials, fgQc, dispatches }
}
function getDaystoreAvailableRm(db) {
  return db.prepare(`
    SELECT 
      rr.*, 
      rm.code as material_code, 
      rm.name as material_name, 
      u.code as unit_code,
      rr.accepted_qty - IFNULL((SELECT SUM(quantity) FROM rm_issue_allocations WHERE receipt_id = rr.id), 0) - IFNULL((SELECT SUM(quantity) FROM daystore_inventory WHERE receipt_id = rr.id), 0) as available_qty
    FROM rm_receipts rr
    JOIN raw_materials rm ON rm.id = rr.material_id
    JOIN units u ON u.id = rm.unit_id
    WHERE rr.status = 'APPROVED'
  `).all().filter(r => r.available_qty > 0)
}

function getDaystoreInventory(db) {
  return db.prepare(`
    SELECT 
      di.receipt_id,
      di.material_id,
      rm.code as material_code,
      rm.name as material_name,
      u.code as unit_code,
      rr.lot_number,
      rr.supplier,
      SUM(di.quantity) as total_transferred,
      SUM(di.quantity) - IFNULL((SELECT SUM(actual_qty) FROM production_consumption WHERE receipt_id = di.receipt_id AND daystore_inventory_id IS NOT NULL), 0) as available_qty
    FROM daystore_inventory di
    JOIN raw_materials rm ON rm.id = di.material_id
    JOIN units u ON u.id = rm.unit_id
    JOIN rm_receipts rr ON rr.id = di.receipt_id
    GROUP BY di.receipt_id, di.material_id, rm.code, rm.name, u.code, rr.lot_number, rr.supplier
  `).all().filter(r => r.available_qty > 0)
}

function transferToDaystore(db, body, userId) {
  if (!body.receipt_id || !body.quantity) throw httpError(400, 'Receipt ID and quantity are required')
  return inTransaction(db, () => {
    const receipt = db.prepare('SELECT * FROM rm_receipts WHERE id = ?').get(body.receipt_id)
    if (!receipt || receipt.status !== 'APPROVED') throw httpError(400, 'Invalid receipt or not approved')
    
    const allocated = db.prepare('SELECT SUM(quantity) as total FROM rm_issue_allocations WHERE receipt_id = ?').get(body.receipt_id).total || 0
    const transferred = db.prepare('SELECT SUM(quantity) as total FROM daystore_inventory WHERE receipt_id = ?').get(body.receipt_id).total || 0
    
    const available = receipt.accepted_qty - allocated - transferred
    if (body.quantity > available) throw httpError(400, 'Transfer quantity exceeds available quantity')
    
    const info = db.prepare(`
      INSERT INTO daystore_inventory (receipt_id, material_id, quantity, moved_by)
      VALUES (?, ?, ?, ?)
    `).run(body.receipt_id, receipt.material_id, body.quantity, userId)
    
    return { id: info.lastInsertRowid, receipt_id: body.receipt_id, quantity: body.quantity }
  })
}
