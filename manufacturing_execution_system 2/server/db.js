import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'mes.sqlite')

export function initDatabase(filename = process.env.MES_DB_PATH || DEFAULT_DB_PATH) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true })
  }

  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys = ON')
  if (filename !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
  }
  createSchema(db)
  seedDatabase(db)
  return db
}

export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      gender TEXT,
      photo_url TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit_id INTEGER NOT NULL REFERENCES units(id),
      reorder_level REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit_id INTEGER NOT NULL REFERENCES units(id),
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      address TEXT,
      gst TEXT,
      contact TEXT,
      email TEXT,
      contact_person TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bom_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      qty_per_unit REAL NOT NULL CHECK (qty_per_unit > 0),
      unit_id INTEGER REFERENCES units(id),
      UNIQUE(product_id, raw_material_id)
    );

    CREATE TABLE IF NOT EXISTS qc_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('RM', 'FG', 'FG_QA')),
      name TEXT NOT NULL,
      product_id INTEGER REFERENCES products(id),
      raw_material_id INTEGER REFERENCES raw_materials(id),
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS qc_parameters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES qc_templates(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('number', 'text', 'pass_fail', 'file')),
      min_value REAL,
      max_value REAL,
      required INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS rm_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      supplier TEXT NOT NULL,
      lot_number TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      quantity_unit_id INTEGER REFERENCES units(id),
      po_number TEXT,
      po_date TEXT,
      invoice_number TEXT,
      invoice_date TEXT,
      hsn_code TEXT,
      received_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_QC'
        CHECK (status IN ('PENDING_QC', 'PENDING_QA', 'PENDING_QC2', 'APPROVED', 'REJECTED', 'HOLD')),
      qc_by INTEGER REFERENCES users(id),
      qc_at TEXT,
      qa_by INTEGER REFERENCES users(id),
      qa_at TEXT,
      rework_notes TEXT,
      remarks TEXT,
      qc_remarks TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(material_id, lot_number)
    );

    CREATE TABLE IF NOT EXISTS rm_qc_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES rm_receipts(id) ON DELETE CASCADE,
      parameter_id INTEGER REFERENCES qc_parameters(id),
      value TEXT,
      passed INTEGER NOT NULL,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS production_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      target_qty REAL NOT NULL CHECK (target_qty > 0),
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'COMPLETED')),
      remarks TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL REFERENCES production_targets(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      planned_qty REAL NOT NULL CHECK (planned_qty > 0),
      plan_date TEXT NOT NULL,
      shift TEXT,
      batch_number TEXT,
      status TEXT NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'REQUESTED', 'IN_PRODUCTION', 'PRODUCED')),
      remarks TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER REFERENCES production_plans(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      requested_qty REAL NOT NULL CHECK (requested_qty > 0),
      source_team TEXT NOT NULL,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      notes TEXT,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING_RM_APPROVAL'
        CHECK (status IN ('PENDING_RM_APPROVAL', 'RM_APPROVED', 'RM_REJECTED', 'IN_PRODUCTION', 'PRODUCED')),
      created_by INTEGER REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT,
      approval_remarks TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rm_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES production_requests(id) ON DELETE CASCADE,
      material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      requested_qty REAL NOT NULL CHECK (requested_qty > 0),
      approved_qty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
    );

    CREATE TABLE IF NOT EXISTS rm_issue_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL REFERENCES rm_issues(id) ON DELETE CASCADE,
      receipt_id INTEGER NOT NULL REFERENCES rm_receipts(id),
      material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      quantity REAL NOT NULL CHECK (quantity > 0)
    );

    CREATE TABLE IF NOT EXISTS production_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES production_requests(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_produced REAL NOT NULL CHECK (quantity_produced > 0),
      shift TEXT NOT NULL,
      operator_id INTEGER REFERENCES employees(id),
      runner_waste_kg REAL NOT NULL DEFAULT 0,
      purge_waste_kg REAL NOT NULL DEFAULT 0,
      rejected_pieces INTEGER NOT NULL DEFAULT 0,
      testing_sample_qty INTEGER NOT NULL DEFAULT 0,
      team_members TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      run_minutes INTEGER,
      batch_code TEXT NOT NULL UNIQUE,
      remarks TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_consumption (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
      allocation_id INTEGER NOT NULL REFERENCES rm_issue_allocations(id),
      receipt_id INTEGER NOT NULL REFERENCES rm_receipts(id),
      material_id INTEGER NOT NULL REFERENCES raw_materials(id),
      planned_qty REAL NOT NULL,
      actual_qty REAL NOT NULL CHECK (actual_qty >= 0)
    );

    CREATE TABLE IF NOT EXISTS fg_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_run_id INTEGER NOT NULL UNIQUE REFERENCES production_runs(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_code TEXT NOT NULL UNIQUE,
      quantity REAL NOT NULL CHECK (quantity > 0),
      status TEXT NOT NULL DEFAULT 'QC_PENDING'
        CHECK (status IN ('QC_PENDING', 'QC_FAILED', 'QA_PENDING', 'QA_FAILED', 'READY_FOR_DISPATCH', 'PARTIAL_DISPATCH', 'DISPATCHED')),
      qc_by INTEGER REFERENCES users(id),
      qc_at TEXT,
      qa_by INTEGER REFERENCES users(id),
      qa_at TEXT,
      storage_location TEXT NOT NULL DEFAULT 'DAY_STORE',
      qc_remarks TEXT,
      qa_remarks TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fg_qc_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES fg_batches(id) ON DELETE CASCADE,
      parameter_id INTEGER REFERENCES qc_parameters(id),
      value TEXT,
      passed INTEGER NOT NULL,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS fg_qa_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES fg_batches(id) ON DELETE CASCADE,
      parameter_id INTEGER REFERENCES qc_parameters(id),
      value TEXT,
      passed INTEGER NOT NULL,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES fg_batches(id),
      customer TEXT NOT NULL,
      order_ref TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      transport_type TEXT NOT NULL DEFAULT 'OWN',
      driver_name TEXT,
      driver_phone TEXT,
      vehicle_no TEXT,
      courier_name TEXT,
      booking_lr TEXT,
      customer_email TEXT,
      remarks TEXT,
      approved_by INTEGER REFERENCES users(id),
      dispatched_by INTEGER REFERENCES users(id),
      shipped_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispatch_id INTEGER NOT NULL REFERENCES dispatches(id),
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comments TEXT,
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  ensureUserColumns(db)
  ensureProductionPlanningColumns(db)
  ensureProductionRunLoggingColumns(db)
  ensureQcTemplatesScope(db)
  ensureNewColumns(db)
  ensureRmReceiptColumns(db)

  db.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES ('schema_version', '4')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run()
}

function ensureRmReceiptColumns(db) {
  const columns = ['quantity_unit_id', 'po_number', 'po_date', 'invoice_number', 'invoice_date', 'hsn_code']
  for (const col of columns) {
    try {
      const type = col === 'quantity_unit_id' ? 'INTEGER REFERENCES units(id)' : 'TEXT'
      db.prepare(`ALTER TABLE rm_receipts ADD COLUMN ${col} ${type}`).run()
    } catch (e) {}
  }
}

function ensureUserColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name))
  if (!columns.has('deleted_at')) {
    db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT')
  }
}

function ensureProductionPlanningColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(production_requests)').all().map((column) => column.name))
  if (!columns.has('plan_id')) {
    db.exec('ALTER TABLE production_requests ADD COLUMN plan_id INTEGER REFERENCES production_plans(id) ON DELETE CASCADE')
  }

  const planCols = new Set(db.prepare('PRAGMA table_info(production_plans)').all().map(c => c.name))
  if (!planCols.has('shift')) db.exec('ALTER TABLE production_plans ADD COLUMN shift TEXT')
  if (!planCols.has('batch_number')) db.exec('ALTER TABLE production_plans ADD COLUMN batch_number TEXT')
}

function ensureProductionRunLoggingColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(production_runs)').all().map((column) => column.name))
  if (!columns.has('operator_id')) {
    db.exec('ALTER TABLE production_runs ADD COLUMN operator_id INTEGER REFERENCES employees(id)')
    db.exec('ALTER TABLE production_runs ADD COLUMN runner_waste_kg REAL NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE production_runs ADD COLUMN purge_waste_kg REAL NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE production_runs ADD COLUMN rejected_pieces INTEGER NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE production_runs ADD COLUMN testing_sample_qty INTEGER NOT NULL DEFAULT 0')
  }
}

function ensureNewColumns(db) {
  const rmReceiptsCols = new Set(db.prepare('PRAGMA table_info(rm_receipts)').all().map(c => c.name));
  if (!rmReceiptsCols.has('qa_by')) db.exec('ALTER TABLE rm_receipts ADD COLUMN qa_by INTEGER REFERENCES users(id)');
  if (!rmReceiptsCols.has('qa_at')) db.exec('ALTER TABLE rm_receipts ADD COLUMN qa_at TEXT');
  if (!rmReceiptsCols.has('rework_notes')) db.exec('ALTER TABLE rm_receipts ADD COLUMN rework_notes TEXT');
  if (!rmReceiptsCols.has('remarks')) db.exec('ALTER TABLE rm_receipts ADD COLUMN remarks TEXT');
  if (!rmReceiptsCols.has('qc_remarks')) db.exec('ALTER TABLE rm_receipts ADD COLUMN qc_remarks TEXT');

  const fgBatchesCols = new Set(db.prepare('PRAGMA table_info(fg_batches)').all().map(c => c.name));
  if (!fgBatchesCols.has('qa_by')) db.exec('ALTER TABLE fg_batches ADD COLUMN qa_by INTEGER REFERENCES users(id)');
  if (!fgBatchesCols.has('qa_at')) db.exec('ALTER TABLE fg_batches ADD COLUMN qa_at TEXT');
  if (!fgBatchesCols.has('storage_location')) db.exec("ALTER TABLE fg_batches ADD COLUMN storage_location TEXT NOT NULL DEFAULT 'DAY_STORE'");
  if (!fgBatchesCols.has('qc_remarks')) db.exec('ALTER TABLE fg_batches ADD COLUMN qc_remarks TEXT');
  if (!fgBatchesCols.has('qa_remarks')) db.exec('ALTER TABLE fg_batches ADD COLUMN qa_remarks TEXT');

  const prodReqCols = new Set(db.prepare('PRAGMA table_info(production_requests)').all().map(c => c.name));
  if (!prodReqCols.has('approved_by')) db.exec('ALTER TABLE production_requests ADD COLUMN approved_by INTEGER REFERENCES users(id)');
  if (!prodReqCols.has('approved_at')) db.exec('ALTER TABLE production_requests ADD COLUMN approved_at TEXT');
  if (!prodReqCols.has('approval_remarks')) db.exec('ALTER TABLE production_requests ADD COLUMN approval_remarks TEXT');

  const bomItemsCols = new Set(db.prepare('PRAGMA table_info(bom_items)').all().map(c => c.name));
  if (!bomItemsCols.has('unit_id')) db.exec('ALTER TABLE bom_items ADD COLUMN unit_id INTEGER REFERENCES units(id)');
}

function ensureQcTemplatesScope(db) {
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='qc_templates'").get()
  if (tableInfo && tableInfo.sql.includes("('RM', 'FG')") && !tableInfo.sql.includes('FG_QA')) {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    db.exec(`
      CREATE TABLE qc_templates_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL CHECK (scope IN ('RM', 'FG', 'FG_QA')),
        name TEXT NOT NULL,
        product_id INTEGER REFERENCES products(id),
        raw_material_id INTEGER REFERENCES raw_materials(id),
        active INTEGER NOT NULL DEFAULT 1
      )
    `)
    db.exec('INSERT INTO qc_templates_new SELECT * FROM qc_templates')
    db.exec('DROP TABLE qc_templates')
    db.exec('ALTER TABLE qc_templates_new RENAME TO qc_templates')
    db.exec('COMMIT')
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function seedDatabase(db) {
  const userRows = [
    ['admin', 'demo123', 'Asha Manager', 'admin'],
    ['rm.manager', 'demo123', 'Ravi RM Store', 'rm_store'],
    ['production', 'demo123', 'Meera Production', 'production'],
    ['qc.supervisor', 'demo123', 'Nikhil QC', 'qc'],
    ['qa.supervisor', 'demo123', 'Vikram QA', 'qa'],
    ['fg.manager', 'demo123', 'Isha FG Store', 'fg_store'],
    ['dispatch', 'demo123', 'Kabir Dispatch', 'dispatch'],
  ]

  const insertUser = db.prepare(`
    INSERT INTO users (username, password, name, role)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password = excluded.password,
      name = excluded.name,
      role = excluded.role,
      active = 1
    WHERE users.deleted_at IS NULL
  `)
  for (const row of userRows) insertUser.run(...row)

  const employeeRows = [
    ['EMP001', 'Arjun Kumar', 'Male', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Arjun'],
    ['EMP002', 'Priya Singh', 'Female', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Priya'],
    ['EMP003', 'Rahul Sharma', 'Male', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Rahul'],
  ]

  const insertEmployee = db.prepare(`
    INSERT INTO employees (emp_code, name, gender, photo_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(emp_code) DO UPDATE SET
      name = excluded.name,
      gender = excluded.gender,
      photo_url = excluded.photo_url
  `)
  for (const row of employeeRows) insertEmployee.run(...row)

  const unitRows = [
    ['KG', 'Kilogram'],
    ['LTR', 'Litre'],
    ['PCS', 'Pieces'],
    ['MTR', 'Metre'],
  ]
  const insertUnit = db.prepare(`
    INSERT INTO units (code, name)
    VALUES (?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name
  `)
  for (const row of unitRows) insertUnit.run(...row)

  const unitId = (code) => db.prepare('SELECT id FROM units WHERE code = ?').get(code).id
  const rawRows = [
    ['STC', 'Steel Coil', unitId('KG'), 200],
    ['CRS', 'Coating Resin', unitId('LTR'), 50],
    ['PKG', 'Packaging Set', unitId('PCS'), 100],
  ]
  const insertRaw = db.prepare(`
    INSERT INTO raw_materials (code, name, unit_id, reorder_level)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      unit_id = excluded.unit_id,
      reorder_level = excluded.reorder_level,
      active = 1
  `)
  for (const row of rawRows) insertRaw.run(...row)

  const supplierRows = [
    ['PolyChem Industries', '45 Industrial Estate, Phase 1, Mumbai, MH', '27AABCP1234D1Z5', '+91 98765 43210', 'sales@polychem.in', 'Rajesh Kumar'],
    ['Global Metals Corp', '102 Steel Park, Sector 4, Pune, MH', '27XYZPG9876E2Z1', '+91 87654 32109', 'info@globalmetals.com', 'Amit Shah'],
    ['Natura Packaging Ltd', 'Plot 18, Green Zone, Ahmedabad, GJ', '24QWERT5678F3Z9', '+91 76543 21098', 'supply@naturapackaging.com', 'Suresh Patel'],
    ['TechResins India', 'Block C, Tech Hub, Bengaluru, KA', '29ASDFG1234H4Z8', '+91 65432 10987', 'orders@techresins.in', 'Vikram Singh'],
    ['Apex Raw Materials', '99 Apex Tower, Okhla, New Delhi, DL', '07ZXCVB4321J5Z7', '+91 54321 09876', 'contact@apexraw.com', 'Neha Sharma']
  ]
  const insertSupplier = db.prepare(`
    INSERT INTO suppliers (name, address, gst, contact, email, contact_person)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      address = excluded.address,
      gst = excluded.gst,
      contact = excluded.contact,
      email = excluded.email,
      contact_person = excluded.contact_person,
      active = 1
  `)
  for (const row of supplierRows) insertSupplier.run(...row)

  const productRows = [
    ['RAIL', 'Precision Rail Assembly', unitId('PCS')],
    ['BRKT', 'Mounting Bracket Kit', unitId('PCS')],
  ]
  const insertProduct = db.prepare(`
    INSERT INTO products (code, name, unit_id)
    VALUES (?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      unit_id = excluded.unit_id,
      active = 1
  `)
  for (const row of productRows) insertProduct.run(...row)

  const productId = (code) => db.prepare('SELECT id FROM products WHERE code = ?').get(code).id
  const rawId = (code) => db.prepare('SELECT id FROM raw_materials WHERE code = ?').get(code).id
  const bomRows = [
    [productId('RAIL'), rawId('STC'), 2],
    [productId('RAIL'), rawId('CRS'), 0.25],
    [productId('RAIL'), rawId('PKG'), 1],
    [productId('BRKT'), rawId('STC'), 0.75],
    [productId('BRKT'), rawId('PKG'), 1],
  ]
  const insertBom = db.prepare(`
    INSERT INTO bom_items (product_id, raw_material_id, qty_per_unit)
    VALUES (?, ?, ?)
    ON CONFLICT(product_id, raw_material_id) DO UPDATE SET
      qty_per_unit = excluded.qty_per_unit
  `)
  for (const row of bomRows) insertBom.run(...row)

  ensureTemplate(db, {
    scope: 'RM',
    name: 'Incoming Raw Material QC',
    parameters: [
      ['Visual inspection', 'pass_fail', null, null],
      ['Moisture %', 'number', 0, 2],
      ['Supplier certificate', 'file', null, null],
    ],
  })
  ensureTemplate(db, {
    scope: 'FG',
    name: 'Precision Rail Final QC',
    productId: productId('RAIL'),
    parameters: [
      ['Length mm', 'number', 995, 1005],
      ['Surface finish', 'pass_fail', null, null],
      ['Batch label applied', 'pass_fail', null, null],
    ],
  })
  ensureTemplate(db, {
    scope: 'FG',
    name: 'Bracket Kit Final QC',
    productId: productId('BRKT'),
    parameters: [
      ['Hole spacing mm', 'number', 48, 52],
      ['Coating coverage', 'pass_fail', null, null],
      ['Packing count', 'number', 1, 1],
    ],
  })
  ensureTemplate(db, {
    scope: 'FG_QA',
    name: 'Precision Rail QA Review',
    productId: productId('RAIL'),
    parameters: [
      ['Final dimension audit', 'pass_fail', null, null],
      ['Packaging integrity', 'pass_fail', null, null],
    ],
  })
  ensureTemplate(db, {
    scope: 'FG_QA',
    name: 'Bracket Kit QA Review',
    productId: productId('BRKT'),
    parameters: [
      ['Box weight kg', 'number', 4.9, 5.1],
      ['Shipment label scan', 'pass_fail', null, null],
    ],
  })
}

function ensureTemplate(db, template) {
  const row = db.prepare(`
    SELECT id FROM qc_templates
    WHERE scope = ?
      AND name = ?
      AND COALESCE(product_id, 0) = COALESCE(?, 0)
      AND COALESCE(raw_material_id, 0) = COALESCE(?, 0)
  `).get(template.scope, template.name, template.productId ?? null, template.rawMaterialId ?? null)

  const templateId = row?.id ?? db.prepare(`
    INSERT INTO qc_templates (scope, name, product_id, raw_material_id)
    VALUES (?, ?, ?, ?)
  `).run(template.scope, template.name, template.productId ?? null, template.rawMaterialId ?? null).lastInsertRowid

  const existing = db.prepare('SELECT COUNT(*) AS count FROM qc_parameters WHERE template_id = ?').get(templateId)
  if (existing.count > 0) return

  const insertParam = db.prepare(`
    INSERT INTO qc_parameters (template_id, label, type, min_value, max_value)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const parameter of template.parameters) {
    insertParam.run(templateId, ...parameter)
  }
}
