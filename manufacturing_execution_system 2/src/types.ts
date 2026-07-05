export type User = {
  id: number
  username: string
  name: string
  role: string
  active?: number
}

export type Employee = {
  id: number
  emp_code: string
  name: string
  gender: string | null
  photo_url: string | null
  active: number
}

export type Unit = {
  id: number
  code: string
  name: string
}

export type Supplier = {
  id: number
  name: string
  address: string | null
  gst: string | null
  contact: string | null
  email: string | null
  contact_person: string | null
  active: number
}

export type RawMaterial = {
  id: number
  code: string
  name: string
  unit_id: number
  unit_code: string
  reorder_level: number
  active: number
}

export type Product = {
  id: number
  code: string
  name: string
  unit_id: number
  unit_code: string
  active: number
}

export type BomItem = {
  id: number
  product_id: number
  raw_material_id: number
  qty_per_unit: number
  product_code: string
  product_name: string
  material_code: string
  material_name: string
  unit_code: string
}

export type QcTemplate = {
  id: number
  scope: 'RM' | 'FG' | 'FG_QA'
  name: string
  product_id: number | null
  raw_material_id: number | null
  product_code?: string | null
  material_code?: string | null
  active: number
}

export type QcParameter = {
  id: number
  template_id: number
  label: string
  type: 'number' | 'text' | 'pass_fail' | 'file'
  min_value: number | null
  max_value: number | null
  required: number
  scope?: 'RM' | 'FG'
  template_name?: string
}

export type BootstrapData = {
  users: User[]
  units: Unit[]
  rawMaterials: RawMaterial[]
  products: Product[]
  bomItems: BomItem[]
  qcTemplates: QcTemplate[]
  qcParameters: QcParameter[]
  employees: Employee[]
  suppliers: Supplier[]
}

export type RmReceipt = {
  id: number
  material_id: number
  material_code: string
  material_name: string
  unit_code: string
  supplier: string
  lot_number: string
  quantity: number
  quantity_unit_id?: number | null
  quantity_unit_code?: string | null
  po_number?: string | null
  po_date?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  hsn_code?: string | null
  received_at: string
  status: string
  remarks?: string | null
  qc_remarks?: string | null
  qa_remarks?: string | null
  qc_by_name?: string
  qa_by_name?: string
  rework_notes?: string
  created_by_name?: string
}

export type ProductionTarget = {
  id: number
  product_id: number
  product_code: string
  product_name: string
  unit_code: string
  target_qty: number
  start_date?: string | null
  end_date?: string | null
  status: string
  remarks?: string | null
  created_by_name?: string
}

export type ProductionPlan = {
  id: number
  target_id: number
  product_id: number
  product_code: string
  product_name: string
  unit_code: string
  planned_qty: number
  plan_date: string
  status: string
  remarks?: string | null
  created_by_name?: string
}

export type ProductionRequest = {
  id: number
  plan_id?: number | null
  product_id: number
  product_code: string
  product_name: string
  unit_code: string
  requested_qty: number
  source_team: string
  priority: string
  due_date?: string | null
  notes?: string | null
  status: string
  remarks?: string | null
  approval_remarks?: string | null
  created_by_name?: string
  approved_by_name?: string
}

export type RmIssue = {
  id: number
  request_id: number
  material_id: number
  material_code: string
  material_name: string
  unit_code: string
  requested_qty: number
  approved_qty: number
  status: string
}

export type ProductionRun = {
  id: number
  request_id: number
  product_id: number
  product_code: string
  product_name: string
  quantity_produced: number
  shift: string
  operator_id?: number | null
  runner_waste_kg: number
  purge_waste_kg: number
  rejected_pieces: number
  testing_sample_qty: number
  team_members: string
  started_at: string
  ended_at: string | null
  run_minutes: number | null
  batch_code: string
  remarks?: string | null
  created_by_name?: string
}

export type FgBatch = {
  id: number
  production_run_id: number
  product_id: number
  product_code: string
  product_name: string
  unit_code: string
  batch_code: string
  quantity: number
  status: string
  remarks?: string | null
  qc_remarks?: string | null
  qa_remarks?: string | null
  qc_by_name?: string
  qa_by_name?: string
  storage_location: string
  dispatched_qty: number
  remaining_qty: number
}

export type Dispatch = {
  id: number
  batch_id: number
  batch_code: string
  product_code: string
  product_name: string
  customer: string
  customer_email?: string | null
  order_ref: string
  quantity: number
  transport_type: 'OWN' | 'COURIER'
  driver_name?: string | null
  driver_phone?: string | null
  vehicle_no?: string | null
  courier_name?: string | null
  booking_lr?: string | null
  shipped_at: string
  approved_by_name?: string
  dispatched_by_name?: string
  feedback_rating?: number | null
  feedback_comments?: string | null
  feedback_submitted_at?: string | null
  remarks?: string | null
}

export type WorkflowData = {
  rmReceipts: RmReceipt[]
  productionTargets: ProductionTarget[]
  productionPlans: ProductionPlan[]
  productionRequests: ProductionRequest[]
  rmIssues: RmIssue[]
  rmIssueAllocations: Array<Record<string, unknown>>
  productionRuns: ProductionRun[]
  fgBatches: FgBatch[]
  dispatches: Dispatch[]
}

export type DashboardSummary = {
  pendingRmQc: number
  approvedRmLots: number
  pendingRmApprovals: number
  pendingFgQc: number
  pendingFgQa: number
  readyFgBatches: number
  dispatchedOrders: number
  fgAvailableQty: number
}

export type TraceabilityResult = {
  batch: FgBatch & {
    shift: string
    team_members: string
    started_at: string
    run_minutes?: number | null
    source_team: string
    requested_qty: number
    rm_approved_by_name?: string
    fg_qc_by_name?: string
    fg_qa_by_name?: string
    run_remarks?: string | null
    request_remarks?: string | null
    request_approval_remarks?: string | null
  }
  rawMaterials: Array<Record<string, string | number | null>>
  fgQc: Array<Record<string, string | number | null>>
  dispatches: Dispatch[]
}
