import {
  Activity,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FlaskConical,
  LogOut,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Printer,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
  XCircle,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { api, postJson, putJson } from './api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area
} from 'recharts'
import { getProductionTrend, getQcYield, getTargetVsActual, getWasteTrend } from './analytics'
import Swal from 'sweetalert2'
import type {

  BootstrapData,
  DashboardSummary,
  Dispatch,
  Employee,
  FgBatch,
  ProductionRequest,
  ProductionRun,
  QcParameter,
  RmReceipt,
  TraceabilityResult,
  User,
  WorkflowData,
  Role,
} from './types'
import { createColumnHelper } from '@tanstack/react-table'
import { AjaxTable } from './components/AjaxTable'
import './App.css'

type TabKey = 'dashboard' | 'rm' | 'production' | 'qc_dashboard' | 'qa_dashboard' | 'qc' | 'fg' | 'traceability' | 'users' | 'master'
type Notice = { type: 'success' | 'error'; message: string } | null
type QcDraft = Record<number, { value: string; passed: boolean }>

const emptyBootstrap: BootstrapData = {
  roles: [],
  users: [],
  units: [],
  rawMaterials: [],
  products: [],
  bomItems: [],
  qcTemplates: [],
  qcParameters: [],
  employees: [],
  suppliers: [],
}

const emptyWorkflow: WorkflowData = {
  rmReceipts: [],
  productionTargets: [],
  productionPlans: [],
  productionRequests: [],
  rmIssues: [],
  rmIssueAllocations: [],
  productionRuns: [],
  fgBatches: [],
  dispatches: [],
}

const emptySummary: DashboardSummary = {
  pendingRmQc: 0,
  approvedRmLots: 0,
  pendingRmApprovals: 0,
  pendingFgQc: 0,
  pendingFgQa: 0,
  readyFgBatches: 0,
  dispatchedOrders: 0,
  fgAvailableQty: 0,
}

const tabs: Array<{
  key: TabKey
  label: string
  icon: typeof Activity
  roles: string[]
}> = [
  { key: 'dashboard', label: 'Dashboard', icon: Activity, roles: ['all'] },
  { key: 'rm', label: 'RM Store', icon: Boxes, roles: ['admin', 'manager', 'rm_store', 'qc', 'qa'] },
  { key: 'production', label: 'Production', icon: Factory, roles: ['admin', 'manager', 'production', 'rm_store', 'production_head'] },
  { key: 'qc_dashboard', label: 'QC Dashboard', icon: FlaskConical, roles: ['admin', 'manager', 'qc'] },
  { key: 'qa_dashboard', label: 'QA Dashboard', icon: ClipboardCheck, roles: ['admin', 'manager', 'qa'] },
  { key: 'qc', label: 'Day Store', icon: Warehouse, roles: ['admin', 'manager', 'qc', 'qa', 'production', 'production_head'] },
  { key: 'fg', label: 'FG & Dispatch', icon: Truck, roles: ['admin', 'manager', 'fg_store', 'dispatch'] },
  { key: 'traceability', label: 'Traceability', icon: Search, roles: ['all'] },
  { key: 'users', label: 'Admin / Security', icon: ShieldCheck, roles: ['admin'] },
  { key: 'master', label: 'Master Data', icon: Settings, roles: ['admin', 'manager'] },
]


const dispatchHelper = createColumnHelper<Dispatch>()
const dispatchColumns = [
  dispatchHelper.accessor('shipped_at', {
    header: 'Date',
    cell: (info) => new Date(info.getValue()).toLocaleDateString(),
  }),
  dispatchHelper.accessor('order_ref', { header: 'P.O Number' }),
  dispatchHelper.accessor('batch_code', { header: 'Batch' }),
  dispatchHelper.accessor('customer', { header: 'Customer' }),
  dispatchHelper.accessor('customer_email', { header: 'Email', cell: (info) => info.getValue() || '-' }),
  dispatchHelper.accessor('quantity', { header: 'Qty', cell: (info) => fmtQty(Number(info.getValue())) }),
  dispatchHelper.accessor('transport_type', {
    header: 'Transport',
    cell: (info) => info.getValue() === 'COURIER' ? 'Courier' : 'Own',
  }),
  dispatchHelper.display({
    id: 'details',
    header: 'Details',
    cell: (info) => {
      const d = info.row.original
      if (d.transport_type === 'COURIER') {
        return <span style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>{d.courier_name} (LR: {d.booking_lr})</span>
      }
      return <span style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>{d.vehicle_no} ({d.driver_name}, {d.driver_phone})</span>
    }
  })
]

const batchHelper = createColumnHelper<FgBatch>()
const batchColumns = [
  batchHelper.accessor('batch_code', {
    header: 'Batch',
    cell: (info) => <strong>{info.getValue()}</strong>,
  }),
  batchHelper.accessor('product_code', {
    header: 'Product',
    cell: (info) => <>{info.row.original.product_code} - {info.row.original.product_name}</>,
  }),
  batchHelper.accessor('quantity', {
    header: 'Qty',
    cell: (info) => <>{fmtQty(Number(info.getValue()))} {info.row.original.unit_code}</>,
  }),
  batchHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  batchHelper.accessor('storage_location', {
    header: 'Location',
    cell: (info) => info.getValue() || '-',
  }),
]

const runHelper = createColumnHelper<ProductionRun>()
const runColumns = [
  runHelper.accessor('batch_code', { header: 'Batch' }),
  runHelper.accessor('product_code', { header: 'Product' }),
  runHelper.accessor('quantity_produced', { header: 'Qty', cell: (info) => fmtQty(Number(info.getValue())) }),
  runHelper.accessor('shift', { header: 'Shift' }),
]

const receiptHelper = createColumnHelper<RmReceipt>()
const receiptColumns = [
  receiptHelper.accessor('lot_number', { header: 'Lot' }),
  receiptHelper.accessor('material_code', {
    header: 'Material',
    cell: (info) => <>{info.row.original.material_code} - {info.row.original.material_name}</>,
  }),
  receiptHelper.accessor('supplier', { header: 'Supplier' }),
  receiptHelper.accessor('quantity', {
    header: 'Qty (Avail / Total)',
    cell: (info) => (
      <>
        {info.row.original.available_qty != null ? fmtQty(Number(info.row.original.available_qty)) : fmtQty(Number(info.getValue()))} / {fmtQty(Number(info.getValue()))} {info.row.original.unit_code}
      </>
    ),
  }),
  receiptHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  receiptHelper.accessor('qc_by_name', { header: 'QC By', cell: (info) => info.getValue() || '-' }),
  receiptHelper.accessor('qa_by_name', { header: 'QA By', cell: (info) => info.getValue() || '-' }),
]

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [login, setLogin] = useState({ username: 'admin', password: 'demo123' })
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [bootstrap, setBootstrap] = useState<BootstrapData>(emptyBootstrap)
  const [workflow, setWorkflow] = useState<WorkflowData>(emptyWorkflow)
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [printingRequest, setPrintingRequest] = useState<ProductionRequest | null>(null)
  const [traceQuery, setTraceQuery] = useState('')
  const [trace, setTrace] = useState<TraceabilityResult | null>(null)
  const [rmQcDrafts, setRmQcDrafts] = useState<Record<number, QcDraft>>({})
  const [fgQcDrafts, setFgQcDrafts] = useState<Record<number, QcDraft>>({})
  const [currentHash, setCurrentHash] = useState(window.location.hash)

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash)
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const [rmReceiptForm, setRmReceiptForm] = useState<Record<string, string>>({
    material_id: '',
    supplier: '',
    lot_number: '',
    quantity: '',
    quantity_unit_id: '',
    po_number: '',
    po_date: '',
    invoice_number: '',
    invoice_date: '',
    hsn_code: '',
  })
  const [targetForm, setTargetForm] = useState<Record<string, string>>({
    product_id: '',
    target_qty: '',
    start_date: '',
    end_date: '',
  })
  const [planForm, setPlanForm] = useState<Record<string, string>>({
    target_id: '',
    product_id: '',
    planned_qty: '',
    plan_date: toLocalInputValue(new Date()).split('T')[0],
    shift: 'A',
  })
  const [productionForm, setProductionForm] = useState<Record<string, string>>({
    plan_id: '',
    product_id: '',
    requested_qty: '',
    source_team: 'Production',
    priority: 'NORMAL',
    due_date: '',
    notes: '',
  })
  const [runForm, setRunForm] = useState<Record<string, any>>({
    request_id: '',
    emp_code: '',
    shift: 'A',
    started_at: toLocalInputValue(new Date()),
    ended_at: '',
    quantity_produced: '',
    runner_waste_kg: '',
    purge_waste_kg: '',
    rejected_pieces: '',
    testing_sample_qty: '',
    consumption: {},
  })
  const [dispatchForm, setDispatchForm] = useState<Record<string, string>>({
    batch_id: '',
    customer: '',
    order_ref: '',
    quantity: '',
    vehicle_no: '',
  })
  const [userForm, setUserForm] = useState<Record<string, string>>({
    username: '',
    password: '',
    name: '',
    role: 'production',
    active: '1',
  })
  const [employeeForm, setEmployeeForm] = useState<Record<string, string>>({
    emp_code: '',
    name: '',
    gender: 'Male',
    photo_url: '',
    active: '1',
  })
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [editingEmployeeCode, setEditingEmployeeCode] = useState<string | null>(null)

  const visibleTabs = useMemo(
    () => tabs.filter((tab) => {
      if (tab.roles.includes('all')) return true
      if (!user || !bootstrap?.roles) return false
      const roleDef = bootstrap.roles.find((r) => r.code === user.role)
      if (!roleDef) return false
      try {
        const perms = JSON.parse(roleDef.permissions)
        return perms.includes(tab.key)
      } catch {
        return false
      }
    }),
    [user, bootstrap],
  )

  useEffect(() => {
    const token = localStorage.getItem('mes-token')
    if (!token) return
    api<{ user: User }>('/api/me')
      .then(({ user: restoredUser }) => {
        setUser(restoredUser)
        return loadData()
      })
      .catch(() => localStorage.removeItem('mes-token'))
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [bootstrapData, workflowData, summaryData] = await Promise.all([
        api<BootstrapData>('/api/bootstrap'),
        api<WorkflowData>('/api/workflow'),
        api<DashboardSummary>('/api/dashboard/summary'),
      ])
      setBootstrap(bootstrapData)
      setWorkflow(workflowData)
      setSummary(summaryData)
    } catch (error) {
      showError(error)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    try {
      const result = await postJson<{ user: User; token: string }>('/api/auth/login', login)
      localStorage.setItem('mes-token', result.token)
      setUser(result.user)
      setNotice({ type: 'success', message: `Signed in as ${result.user.name}` })
      await loadData()
    } catch (error) {
      showError(error)
    }
  }

  function logout() {
    localStorage.removeItem('mes-token')
    setUser(null)
    setBootstrap(emptyBootstrap)
    setWorkflow(emptyWorkflow)
    setSummary(emptySummary)
    setTrace(null)
  }

  async function submitAction<T>(action: Promise<T>, message: string) {
    try {
      await action
      setNotice({ type: 'success', message })
      await loadData()
      return true
    } catch (error) {
      showError(error)
      return false
    }
  }

  function showError(error: unknown) {
    setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Something went wrong' })
  }

  function rmParametersForReceipt(receipt: RmReceipt) {
    const templateIds = bootstrap.qcTemplates
      .filter((template) => template.scope === 'RM' && (!template.raw_material_id || template.raw_material_id === receipt.material_id))
      .map((template) => template.id)
    return bootstrap.qcParameters.filter((parameter) => templateIds.includes(parameter.template_id))
  }

  function fgParametersForBatch(batch: FgBatch) {
    const templateIds = bootstrap.qcTemplates
      .filter((template) => template.scope === 'FG' && (!template.product_id || template.product_id === batch.product_id))
      .map((template) => template.id)
    return bootstrap.qcParameters.filter((parameter) => templateIds.includes(parameter.template_id))
  }

  function fgQaParametersForBatch(batch: FgBatch) {
    const templateIds = bootstrap.qcTemplates
      .filter((template) => template.scope === 'FG_QA' && (!template.product_id || template.product_id === batch.product_id))
      .map((template) => template.id)
    return bootstrap.qcParameters.filter((parameter) => templateIds.includes(parameter.template_id))
  }

  function getQcResults(parameters: QcParameter[], draft: QcDraft | undefined) {
    return parameters.map((parameter) => ({
      parameter_id: parameter.id,
      value: draft?.[parameter.id]?.value ?? '',
      passed: draft?.[parameter.id]?.passed ?? true,
    }))
  }

  async function traceBatch(event: FormEvent) {
    event.preventDefault()
    if (!traceQuery.trim()) return
    try {
      const result = await api<TraceabilityResult>(`/api/traceability/${encodeURIComponent(traceQuery.trim())}`)
      setTrace(result)
      setNotice({ type: 'success', message: `Loaded ${result.batch.batch_code}` })
    } catch (error) {
      setTrace(null)
      showError(error)
    }
  }

  if (currentHash.startsWith('#/feedback/')) {
    const dispatchId = currentHash.split('/')[2]
    return <CustomerFeedback dispatchId={Number(dispatchId)} />
  }

  if (currentHash.startsWith('#/public-trace/')) {
    const batchCode = decodeURIComponent(currentHash.split('/')[2] || '')
    return <PublicTraceability batchCode={batchCode} />
  }

  if (!user) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={handleLogin}>
          <div className="brand-mark">
            <Factory size={28} />
          </div>
          <h1>Manufacturing Execution System</h1>
          <label>
            Username
            <input value={login.username} onChange={(event) => setLogin({ ...login, username: event.target.value })} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={login.password}
              onChange={(event) => setLogin({ ...login, password: event.target.value })}
            />
          </label>
          <button className="primary-button" type="submit">
            <ShieldCheck size={18} />
            Sign in
          </button>
          <div className="seed-users">
            {['admin', 'rm.manager', 'production', 'production.head', 'qc.supervisor', 'qa.supervisor', 'fg.manager', 'dispatch'].map((name) => (
              <button key={name} type="button" onClick={() => setLogin({ username: name, password: 'demo123' })}>
                {name}
              </button>
            ))}
          </div>
          {notice && <NoticeBar notice={notice} />}
        </form>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="app-title">
          <Factory size={28} />
          <div>
            <strong>MES Control</strong>
            <span>{bootstrap?.roles?.find(r => r.code === user.role)?.name ?? user.role}</span>
          </div>
        </div>
        <nav>
          {visibleTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                className={activeTab === tab.key ? 'active' : ''}
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                title={tab.label}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <button type="button" onClick={loadData} title="Refresh">
            <RefreshCw size={18} />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
          <button type="button" onClick={logout} title="Sign out">
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Signed in</span>
            <h1>{user.name}</h1>
          </div>
          {notice && <NoticeBar notice={notice} />}
        </header>

        {activeTab === 'dashboard' && <Dashboard summary={summary} workflow={workflow} />}
        {activeTab === 'rm' && (
          <RmStore
            form={rmReceiptForm}
            setForm={setRmReceiptForm}
            bootstrap={bootstrap}
            receipts={workflow.rmReceipts}
            submitAction={submitAction}
          />
        )}
        {activeTab === 'production' && (
          <Production
            onPrintRequest={(req) => { setPrintingRequest(req); setTimeout(() => { window.print(); setTimeout(() => setPrintingRequest(null), 100) }, 100) }}
            targetForm={targetForm}
            setTargetForm={setTargetForm}
            planForm={planForm}
            setPlanForm={setPlanForm}
            requestForm={productionForm}
            setRequestForm={setProductionForm}
            runForm={runForm}
            setRunForm={setRunForm}
            bootstrap={bootstrap}
            workflow={workflow}
            submitAction={submitAction}
            userRole={user.role}
          />
        )}
        {activeTab === 'qc_dashboard' && (
          <QcDashboard
            workflow={workflow}
            submitAction={submitAction}
            rmIssues={workflow.rmIssues}
            batches={workflow.fgBatches}
            qcParametersForBatch={fgParametersForBatch}
            drafts={fgQcDrafts}
            setDrafts={setFgQcDrafts}
            getResults={getQcResults}
            rmReceipts={workflow.rmReceipts}
            rmParametersForReceipt={rmParametersForReceipt}
            rmDrafts={rmQcDrafts}
            setRmDrafts={setRmQcDrafts}
          />
        )}
        {activeTab === 'qa_dashboard' && (
          <QaDashboard
            workflow={workflow}
            submitAction={submitAction}
            rmIssues={workflow.rmIssues}
            batches={workflow.fgBatches}
            qaParametersForBatch={fgQaParametersForBatch}
            drafts={fgQcDrafts}
            setDrafts={setFgQcDrafts}
            getResults={getQcResults}
            rmReceipts={workflow.rmReceipts}
          />
        )}
        {activeTab === 'qc' && (
          <DayStore
            onPrintRequest={(req) => { setPrintingRequest(req); setTimeout(() => { window.print(); setTimeout(() => setPrintingRequest(null), 100) }, 100) }}
            productionRequests={workflow.productionRequests}
            rmIssues={workflow.rmIssues}
          />
        )}
        {activeTab === 'fg' && (
          <FgAndDispatch
            batches={workflow.fgBatches}
            form={dispatchForm}
            setForm={setDispatchForm}
            submitAction={submitAction}
          />
        )}
        {activeTab === 'traceability' && (
          <Traceability query={traceQuery} setQuery={setTraceQuery} trace={trace} onSubmit={traceBatch} />
        )}
        {activeTab === 'users' && (
          <div className="stack">
            <RoleManagement
              roles={bootstrap.roles}
              submitAction={submitAction}
            />
            <UserManagement
              users={bootstrap.users}
              roles={bootstrap.roles}
              currentUser={user}
              form={userForm}
              setForm={setUserForm}
              editingUserId={editingUserId}
              setEditingUserId={setEditingUserId}
              submitAction={submitAction}
            />
            <EmployeeManagement
              employees={bootstrap.employees}
              form={employeeForm}
              setForm={setEmployeeForm}
              editingEmployeeCode={editingEmployeeCode}
              setEditingEmployeeCode={setEditingEmployeeCode}
              submitAction={submitAction}
            />
          </div>
        )}
        {activeTab === 'master' && (
          <MasterData
            bootstrap={bootstrap}
            submitAction={submitAction}
          />
        )}
      </section>
      {printingRequest && <PrintTicket request={printingRequest} issues={workflow.rmIssues} />}
    </main>
  )
}

function NoticeBar({ notice }: { notice: NonNullable<Notice> }) {
  return <div className={`notice ${notice.type}`}>{notice.message}</div>
}

function Dashboard({ summary, workflow }: { summary: DashboardSummary; workflow: WorkflowData }) {
  const cards = [
    ['RM QC', summary.pendingRmQc, 'Pending'],
    ['RM Lots', summary.approvedRmLots, 'Approved'],
    ['RM Approval', summary.pendingRmApprovals, 'Requests'],
    ['Day Store', summary.pendingFgQc + summary.pendingFgQa, 'Batches'],
    ['FG Store', summary.readyFgBatches, 'Ready'],
    ['Dispatches', summary.dispatchedOrders, 'Orders'],
  ]

  return (
    <div className="stack">

      <section className="metric-grid">
        {cards.map(([label, value, suffix]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <em>{suffix}</em>
          </div>
        ))}
      </section>
      <div className="grid-two">
        <section className="panel">
          <PanelTitle icon={Activity} title="Production Trend (Last 7 Days)" />
          <div style={{ width: '100%', height: 300, marginTop: '1rem' }}>
            <ResponsiveContainer>
              <LineChart data={getProductionTrend(workflow)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" stroke="#888" />
                <YAxis stroke="#888" />
                <RechartsTooltip contentStyle={{ backgroundColor: '#1e1e24', border: 'none', borderRadius: '8px' }} />
                <Line type="monotone" dataKey="quantity" name="Produced Qty" stroke="#3b82f6" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={Activity} title="RM Quality Yield" />
          <div style={{ width: '100%', height: 300, marginTop: '1rem' }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={getQcYield(workflow)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} label>
                  {getQcYield(workflow).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ backgroundColor: '#1e1e24', border: 'none', borderRadius: '8px' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelTitle icon={Activity} title="Live Workflow" />
        <div className="flow-strip">
          <FlowNode label="RM Arrival" value={workflow.rmReceipts.length} />
          <FlowNode label="RM Approved" value={summary.approvedRmLots} />
          <FlowNode label="Production" value={workflow.productionRuns.length} />
          <FlowNode label="Day Store QC" value={summary.pendingFgQc + summary.pendingFgQa} />
          <FlowNode label="FG Store" value={summary.readyFgBatches} />
          <FlowNode label="Dispatch" value={workflow.dispatches.length} />
        </div>
      </section>
      
      <section className="panel">
        <PanelTitle icon={PackageCheck} title="Recent FG Batches" />
        <BatchTable batches={workflow.fgBatches.slice(0, 6)} />
      </section>
    </div>
  )
}

function RmStore({
  form,
  setForm,
  bootstrap,
  receipts,
  submitAction,
}: {
  form: Record<string, string>
  setForm: (value: Record<string, string>) => void
  bootstrap: BootstrapData
  receipts: RmReceipt[]
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
}) {
  const pending = receipts.filter((receipt) => receipt.status === 'PENDING_QC' || receipt.status === 'HOLD' || receipt.qc_remarks)
  const pendingQa = receipts.filter((receipt) => receipt.status === 'PENDING_QA' || receipt.qa_remarks)
  const pendingQc2 = receipts.filter((receipt) => receipt.status === 'PENDING_QC2' || receipt.rework_notes)

  const selectedMaterial = bootstrap.rawMaterials.find(m => m.id === Number(form.material_id))
  const selectedMaterialUnit = selectedMaterial?.unit_code

  return (
    <div className="grid-two">
      <section className="panel">
        <PanelTitle icon={Boxes} title="Raw Material Arrival" />
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault()
            submitAction(postJson('/api/rm-receipts', form), 'RM receipt recorded')
          }}
        >
          <label>
            Material
            <select value={form.material_id} onChange={(event) => setForm({ ...form, material_id: event.target.value })} required>
              <option value="">Select</option>
              {bootstrap.rawMaterials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.code} - {material.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supplier
            <select value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} required>
              <option value="">Select Supplier</option>
              {bootstrap.suppliers.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Lot number
            <input value={form.lot_number} onChange={(event) => setForm({ ...form, lot_number: event.target.value })} placeholder="Leave blank to auto-generate" />
          </label>
          <label>
            Quantity
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                min="0.001"
                step="0.001"
                type="number"
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                required
                style={{ flex: 1 }}
                placeholder="Amount"
              />
              <select
                value={form.quantity_unit_id || ''}
                onChange={(event) => setForm({ ...form, quantity_unit_id: event.target.value })}
                style={{ width: '100px' }}
              >
                <option value="">Default {selectedMaterialUnit ? `(${selectedMaterialUnit})` : ''}</option>
                {bootstrap.units.map(u => (
                  <option key={u.id} value={u.id}>{u.code}</option>
                ))}
              </select>
            </div>
          </label>
          <label>PO Number <input value={form.po_number || ''} onChange={(event) => setForm({ ...form, po_number: event.target.value })} /></label>
          <label>PO Date <input type="date" value={form.po_date || ''} onChange={(event) => setForm({ ...form, po_date: event.target.value })} /></label>
          <label>Invoice Number <input value={form.invoice_number || ''} onChange={(event) => setForm({ ...form, invoice_number: event.target.value })} /></label>
          <label>Invoice Date <input type="date" value={form.invoice_date || ''} onChange={(event) => setForm({ ...form, invoice_date: event.target.value })} /></label>
          <label>HSN Code <input value={form.hsn_code || ''} onChange={(event) => setForm({ ...form, hsn_code: event.target.value })} /></label>
          <label>
            Remarks (Optional)
            <input value={form.remarks || ''} onChange={(event) => setForm({ ...form, remarks: event.target.value })} />
          </label>
          {(() => {
            const selectedSupplier = bootstrap.suppliers.find((s) => s.name === form.supplier)
            if (!selectedSupplier) return null
            return (
              <div className="span-two detail" style={{ marginTop: '8px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                  <div><strong>Name:</strong> {selectedSupplier.name}</div>
                  <div><strong>Contact Person:</strong> {selectedSupplier.contact_person}</div>
                  <div><strong>Contact No:</strong> {selectedSupplier.contact}</div>
                  <div><strong>Email:</strong> {selectedSupplier.email}</div>
                  <div><strong>GST Number:</strong> {selectedSupplier.gst}</div>
                  <div style={{ gridColumn: '1 / -1' }}><strong>Address:</strong> {selectedSupplier.address}</div>
                </div>
              </div>
            )
          })()}
          <button className="primary-button" type="submit">
            <Plus size={18} />
            Add Receipt
          </button>
        </form>
      </section>

      <section className="panel">
        <PanelTitle icon={FlaskConical} title="Incoming QC Status" />
        <div className="queue-list">
          {pending.length === 0 && <div className="empty">No recent QC activity</div>}
          {pending.map((receipt) => (
            <article className="queue-item" key={receipt.id}>
              <div className="queue-heading">
                <strong>
                  {receipt.material_code} / {receipt.lot_number}
                </strong>
                <StatusBadge status={receipt.status} />
              </div>
              <span>{fmtQty(receipt.quantity)} {receipt.quantity_unit_code || receipt.unit_code} from {receipt.supplier}</span>
              {receipt.qc_remarks && (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--bg-muted)', borderRadius: '4px' }}>
                  <strong>QC Message:</strong> {receipt.qc_remarks}
                  {receipt.qc_by_name && <span> (by {receipt.qc_by_name})</span>}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={ClipboardCheck} title="QA Approval Status" />
        <div className="queue-list">
          {pendingQa.length === 0 && <div className="empty">No recent QA activity</div>}
          {pendingQa.map((receipt) => (
            <article className="queue-item" key={receipt.id}>
              <div className="queue-heading">
                <strong>
                  {receipt.material_code} / {receipt.lot_number}
                </strong>
                <StatusBadge status={receipt.status} />
              </div>
              <span>{fmtQty(receipt.quantity)} {receipt.unit_code} from {receipt.supplier}</span>
              {receipt.qa_remarks && (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--bg-muted)', borderRadius: '4px' }}>
                  <strong>QA Message:</strong> {receipt.qa_remarks}
                  {receipt.qa_by_name && <span> (by {receipt.qa_by_name})</span>}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={FlaskConical} title="QC 2 (Rework) Status" />
        <div className="queue-list">
          {pendingQc2.length === 0 && <div className="empty">No recent QC 2 items</div>}
          {pendingQc2.map((receipt) => (
            <article className="queue-item" key={receipt.id}>
              <div className="queue-heading">
                <strong>
                  {receipt.material_code} / {receipt.lot_number}
                </strong>
                <StatusBadge status={receipt.status} />
              </div>
              <span>{fmtQty(receipt.quantity)} {receipt.unit_code} from {receipt.supplier}</span>
              {receipt.rework_notes && (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--bg-muted)', borderRadius: '4px' }}>
                  <strong>Rework Notes:</strong> {receipt.rework_notes}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <PanelTitle icon={Boxes} title="RM Inventory Lots" />
        <AjaxTable resource="rm-receipts" columns={receiptColumns} />
      </section>
    </div>
  )
}

function QcDashboard({
  workflow,
  submitAction,
  rmIssues,
  batches,
  qcParametersForBatch,
  drafts,
  setDrafts,
  getResults,
  rmReceipts,
  rmParametersForReceipt,
  rmDrafts,
  setRmDrafts,
}: {
  workflow: WorkflowData
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
  rmIssues: WorkflowData['rmIssues']
  batches: FgBatch[]
  qcParametersForBatch: (batch: FgBatch) => QcParameter[]
  drafts: Record<number, QcDraft>
  setDrafts: (value: Record<number, QcDraft>) => void
  getResults: (parameters: QcParameter[], draft: QcDraft | undefined) => Array<{ parameter_id: number; value: string; passed: boolean }>
  rmReceipts: RmReceipt[]
  rmParametersForReceipt: (receipt: RmReceipt) => QcParameter[]
  rmDrafts: Record<number, QcDraft>
  setRmDrafts: (value: Record<number, QcDraft>) => void
}) {
  const pendingQc = workflow.productionRequests.filter((req) => req.status === 'PENDING_QC')
  const fgQcPending = batches.filter((batch) => batch.status === 'QC_PENDING' || batch.status === 'QC_FAILED')

  const rmPendingQc = rmReceipts.filter((receipt) => receipt.status === 'PENDING_QC' || receipt.status === 'HOLD')
  const rmPendingQc2 = rmReceipts.filter((receipt) => receipt.status === 'PENDING_QC2')
  
  const [remarks, setRemarks] = useState<Record<number, string>>({})
  const [qcRemarks, setQcRemarks] = useState<Record<number, string>>({})

  const [rmQcModes, setRmQcModes] = useState<Record<number, 'detailed' | 'simple'>>({})
  const [rmQcQuantities, setRmQcQuantities] = useState<Record<number, { accepted: number, rejected: number }>>({})
  const [rmQcRemarks, setRmQcRemarks] = useState<Record<number, string>>({})
  const [rmQc2Notes, setRmQc2Notes] = useState<Record<number, string>>({})

  function updateRmDraft(receiptId: number, parameterId: number, patch: Partial<{ value: string; passed: boolean }>) {
    setRmDrafts({
      ...rmDrafts,
      [receiptId]: {
        ...rmDrafts[receiptId],
        [parameterId]: {
          value: rmDrafts[receiptId]?.[parameterId]?.value ?? '',
          passed: rmDrafts[receiptId]?.[parameterId]?.passed ?? true,
          ...patch,
        },
      },
    })
  }

  function updateDraft(batchId: number, parameterId: number, patch: Partial<{ value: string; passed: boolean }>) {
    setDrafts({
      ...drafts,
      [batchId]: {
        ...drafts[batchId],
        [parameterId]: {
          value: drafts[batchId]?.[parameterId]?.value ?? '',
          passed: drafts[batchId]?.[parameterId]?.passed ?? true,
          ...patch,
        },
      },
    })
  }

  return (
    <div className="stack">
      <section className="panel">
        <PanelTitle icon={FlaskConical} title="Incoming RM QC" />
        <div className="queue-list">
          {rmPendingQc.length === 0 && <div className="empty">No pending RM QC</div>}
          {rmPendingQc.map((receipt) => {
            let parameters = rmParametersForReceipt(receipt)
            parameters = [...parameters].sort((a, b) => {
              const order: Record<string, number> = { 'Visual inspection': 1, 'Moisture %': 2, 'Supplier certificate': 3 }
              return (order[a.label] || 99) - (order[b.label] || 99)
            })

            const mode = rmQcModes[receipt.id] || 'detailed'
            const visibleParameters = mode === 'simple'
              ? parameters.filter((p) => p.label === 'Supplier certificate')
              : parameters

            return (
              <article className="queue-item" key={receipt.id}>
                <div className="queue-heading">
                  <strong>
                    {receipt.material_code} / {receipt.lot_number}
                  </strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <select
                      value={mode}
                      onChange={(e) => setRmQcModes({ ...rmQcModes, [receipt.id]: e.target.value as 'detailed' | 'simple' })}
                      style={{ width: 'auto', padding: '2px 8px', fontSize: '12px', minHeight: '26px' }}
                    >
                      <option value="detailed">Detailed QC</option>
                      <option value="simple">Simple QC</option>
                    </select>
                    <StatusBadge status={receipt.status} />
                  </div>
                </div>
                <span>{fmtQty(receipt.quantity)} {receipt.quantity_unit_code || receipt.unit_code} from {receipt.supplier}</span>
                <QcParameterInputs
                  parameters={visibleParameters}
                  draft={rmDrafts[receipt.id]}
                  onChange={(parameterId, patch) => updateRmDraft(receipt.id, parameterId, patch)}
                />
                <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                  <div className="grid-two" style={{ gap: '1rem', marginBottom: '0.5rem' }}>
                    <label>
                      Good / Accepted Qty
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={rmQcQuantities[receipt.id]?.accepted ?? receipt.quantity}
                        onChange={(e) => {
                          const accepted = Number(e.target.value)
                          const rejected = Math.max(0, receipt.quantity - accepted)
                          setRmQcQuantities({ ...rmQcQuantities, [receipt.id]: { accepted, rejected } })
                        }}
                      />
                    </label>
                    <label>
                      Damaged / Rejected Qty
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={rmQcQuantities[receipt.id]?.rejected ?? 0}
                        onChange={(e) => {
                          const rejected = Number(e.target.value)
                          const accepted = Math.max(0, receipt.quantity - rejected)
                          setRmQcQuantities({ ...rmQcQuantities, [receipt.id]: { accepted, rejected } })
                        }}
                      />
                    </label>
                  </div>
                  <label>
                    Remarks
                    <input
                      placeholder="Required on hold/reject..."
                      value={rmQcRemarks[receipt.id] || ''}
                      onChange={(e) => setRmQcRemarks({ ...rmQcRemarks, [receipt.id]: e.target.value })}
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => {
                      const accepted = rmQcQuantities[receipt.id]?.accepted ?? receipt.quantity
                      const rejected = rmQcQuantities[receipt.id]?.rejected ?? 0
                      const isRejected = accepted === 0
                      
                      submitAction(
                        postJson(`/api/rm-receipts/${receipt.id}/qc`, {
                          passed: !isRejected,
                          disposition: isRejected ? (mode === 'detailed' ? 'HOLD' : 'REJECTED') : undefined,
                          qc_remarks: rmQcRemarks[receipt.id],
                          accepted_qty: accepted,
                          rejected_qty: rejected,
                          results: getResults(visibleParameters, rmDrafts[receipt.id]),
                        }),
                        isRejected ? 'RM lot held/rejected' : 'RM lot approved',
                      )
                    }}
                  >
                    <CheckCircle2 size={16} />
                    Submit QC
                  </button>
                  {mode === 'detailed' && (
                    <button
                      type="button"
                      onClick={() => {
                        const accepted = rmQcQuantities[receipt.id]?.accepted ?? receipt.quantity
                        const rejected = rmQcQuantities[receipt.id]?.rejected ?? 0
                        
                        submitAction(
                          postJson(`/api/rm-receipts/${receipt.id}/qc`, {
                            passed: false,
                            disposition: 'HOLD',
                            qc_remarks: rmQcRemarks[receipt.id],
                            accepted_qty: accepted,
                            rejected_qty: rejected,
                            results: getResults(visibleParameters, rmDrafts[receipt.id]),
                          }),
                          'RM lot held',
                        )
                      }}
                    >
                      <ShieldCheck size={16} />
                      Hold
                    </button>
                  )}
                  <button
                    className="danger"
                    type="button"
                    onClick={() => {
                      if (!rmQcRemarks[receipt.id]?.trim()) {
                        alert('Remarks are required when rejecting.')
                        return
                      }
                      submitAction(
                        postJson(`/api/rm-receipts/${receipt.id}/qc`, {
                          passed: false,
                          qc_remarks: rmQcRemarks[receipt.id],
                          results: getResults(visibleParameters, rmDrafts[receipt.id]),
                        }),
                        'RM lot rejected',
                      )
                    }}
                  >
                    <XCircle size={16} />
                    Fail
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={FlaskConical} title="RM QC 2 (Rework)" />
        <div className="queue-list">
          {rmPendingQc2.length === 0 && <div className="empty">No pending QC 2 items</div>}
          {rmPendingQc2.map((receipt) => (
            <article className="queue-item" key={receipt.id}>
              <div className="queue-heading">
                <strong>
                  {receipt.material_code} / {receipt.lot_number}
                </strong>
                <StatusBadge status={receipt.status} />
              </div>
              <span>{fmtQty(receipt.quantity)} {receipt.unit_code} from {receipt.supplier}</span>
              <div className="form-grid" style={{ marginTop: '0.5rem' }}>
                <label>
                  Rework Notes
                  <input
                    value={rmQc2Notes[receipt.id] || ''}
                    onChange={(e) => setRmQc2Notes({ ...rmQc2Notes, [receipt.id]: e.target.value })}
                    placeholder="Enter rework details..."
                  />
                </label>
              </div>
              <div className="button-row" style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() =>
                    submitAction(
                      postJson(`/api/rm-receipts/${receipt.id}/qc2`, { passed: true, rework_notes: rmQc2Notes[receipt.id] }),
                      'RM lot rework approved (Sent to QA)',
                    )
                  }
                >
                  <CheckCircle2 size={16} />
                  Approve Rework
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={() =>
                    submitAction(
                      postJson(`/api/rm-receipts/${receipt.id}/qc2`, { passed: false, rework_notes: rmQc2Notes[receipt.id] }),
                      'RM lot final reject',
                    )
                  }
                >
                  <XCircle size={16} />
                  Final Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel wide">
        <PanelTitle icon={FlaskConical} title="QC Dashboard - Daily Material Requests" />
        <div className="queue-list">
          {pendingQc.length === 0 && <div className="empty">No material requests pending QC</div>}
          {pendingQc.map((request) => (
            <article className="queue-item" key={request.id}>
              <div className="queue-heading">
                <strong>{request.product_code} / {fmtQty(request.requested_qty)} {request.unit_code}</strong>
                <StatusBadge status={request.status} />
              </div>
              <small>Request #{request.id} by {request.source_team}</small>
              <IssueList request={request} issues={rmIssues} />
              <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                <label>
                  QC Remarks
                  <input
                    placeholder="Required on reject..."
                    value={remarks[request.id] || ''}
                    onChange={(e) => setRemarks({ ...remarks, [request.id]: e.target.value })}
                  />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() =>
                    submitAction(postJson(`/api/production-requests/${request.id}/qc`, { passed: true, remarks: remarks[request.id] }), 'Request passed QC')
                  }
                >
                  <CheckCircle2 size={16} />
                  Approve QC
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={() => {
                    if (!remarks[request.id]?.trim()) {
                      alert('Remarks are required when rejecting.')
                      return
                    }
                    submitAction(postJson(`/api/production-requests/${request.id}/qc`, { passed: false, remarks: remarks[request.id] }), 'Request rejected by QC')
                  }}
                >
                  <XCircle size={16} />
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={ClipboardCheck} title="FG QC Pending" />
        <div className="queue-list">
          {fgQcPending.length === 0 && <div className="empty">No batches pending QC</div>}
          {fgQcPending.map((batch) => {
            const parameters = qcParametersForBatch(batch)
            return (
              <article className="queue-item" key={batch.id}>
                <div className="queue-heading">
                  <strong>{batch.batch_code}</strong>
                  <StatusBadge status={batch.status} />
                </div>
                <span>{batch.product_code} - {fmtQty(batch.quantity)} {batch.unit_code}</span>
                <QcParameterInputs
                  parameters={parameters}
                  draft={drafts[batch.id]}
                  onChange={(parameterId, patch) => updateDraft(batch.id, parameterId, patch)}
                />
                <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                  <label>
                    Remarks
                    <input
                      placeholder="Required on fail..."
                      value={qcRemarks[batch.id] || ''}
                      onChange={(e) => setQcRemarks({ ...qcRemarks, [batch.id]: e.target.value })}
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() =>
                      submitAction(
                        postJson(`/api/fg-batches/${batch.id}/qc`, {
                          passed: true,
                          qc_remarks: qcRemarks[batch.id],
                          results: getResults(parameters, drafts[batch.id]),
                        }),
                        'FG batch passed QC (Sent to QA)',
                      )
                    }
                  >
                    <CheckCircle2 size={16} />
                    Sign Off
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => {
                      if (!qcRemarks[batch.id]?.trim()) {
                        alert('Remarks are required when failing QC.')
                        return
                      }
                      submitAction(
                        postJson(`/api/fg-batches/${batch.id}/qc`, {
                          passed: false,
                          qc_remarks: qcRemarks[batch.id],
                          results: getResults(parameters, drafts[batch.id]),
                        }),
                        'FG batch failed QC',
                      )
                    }}
                  >
                    <XCircle size={16} />
                    Fail QC
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function QaDashboard({
  workflow,
  submitAction,
  rmIssues,
  batches,
  qaParametersForBatch,
  drafts,
  setDrafts,
  getResults,
  rmReceipts,
}: {
  workflow: WorkflowData
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
  rmIssues: WorkflowData['rmIssues']
  batches: FgBatch[]
  qaParametersForBatch: (batch: FgBatch) => QcParameter[]
  drafts: Record<number, QcDraft>
  setDrafts: (value: Record<number, QcDraft>) => void
  getResults: (parameters: QcParameter[], draft: QcDraft | undefined) => Array<{ parameter_id: number; value: string; passed: boolean }>
  rmReceipts: RmReceipt[]
}) {
  const pendingQa = workflow.productionRequests.filter((req) => req.status === 'PENDING_QA')
  const fgQaPending = batches.filter((batch) => batch.status === 'QA_PENDING' || batch.status === 'QA_FAILED')
  
  const rmPendingQa = rmReceipts.filter((receipt) => receipt.status === 'PENDING_QA')

  const [remarks, setRemarks] = useState<Record<number, string>>({})
  const [qaRemarks, setQaRemarks] = useState<Record<number, string>>({})
  
  const [rmQaRemarks, setRmQaRemarks] = useState<Record<number, string>>({})

  function updateDraft(batchId: number, parameterId: number, patch: Partial<{ value: string; passed: boolean }>) {
    setDrafts({
      ...drafts,
      [batchId]: {
        ...drafts[batchId],
        [parameterId]: {
          value: drafts[batchId]?.[parameterId]?.value ?? '',
          passed: drafts[batchId]?.[parameterId]?.passed ?? true,
          ...patch,
        },
      },
    })
  }

  return (
    <div className="stack">

      <section className="panel">
        <PanelTitle icon={ClipboardCheck} title="RM QA Approval" />
        <div className="queue-list">
          {rmPendingQa.length === 0 && <div className="empty">No pending RM QA approvals</div>}
          {rmPendingQa.map((receipt) => (
            <article className="queue-item" key={receipt.id}>
              <div className="queue-heading">
                <strong>
                  {receipt.material_code} / {receipt.lot_number}
                </strong>
                <StatusBadge status={receipt.status} />
              </div>
              <span>{fmtQty(receipt.quantity)} {receipt.unit_code} from {receipt.supplier}</span>
              <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                <label>
                  Remarks
                  <input
                    placeholder="Required on reject..."
                    value={rmQaRemarks[receipt.id] || ''}
                    onChange={(e) => setRmQaRemarks({ ...rmQaRemarks, [receipt.id]: e.target.value })}
                  />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() =>
                    submitAction(
                      postJson(`/api/rm-receipts/${receipt.id}/qa`, { passed: true, qa_remarks: rmQaRemarks[receipt.id] }),
                      'RM lot QA approved',
                    )
                  }
                >
                  <CheckCircle2 size={16} />
                  Pass
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={() => {
                    if (!rmQaRemarks[receipt.id]?.trim()) {
                      alert('Remarks are required when rejecting.')
                      return
                    }
                    submitAction(
                      postJson(`/api/rm-receipts/${receipt.id}/qa`, { passed: false, qa_remarks: rmQaRemarks[receipt.id] }),
                      'RM lot QA rejected',
                    )
                  }}
                >
                  <XCircle size={16} />
                  Fail
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <PanelTitle icon={ClipboardCheck} title="QA Dashboard - Daily Material Requests" />
        <div className="queue-list">
          {pendingQa.length === 0 && <div className="empty">No material requests pending QA</div>}
          {pendingQa.map((request) => (
            <article className="queue-item" key={request.id}>
              <div className="queue-heading">
                <strong>{request.product_code} / {fmtQty(request.requested_qty)} {request.unit_code}</strong>
                <StatusBadge status={request.status} />
              </div>
              <small>Request #{request.id} by {request.source_team}</small>
              <IssueList request={request} issues={rmIssues} />
              <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                <label>
                  QA Remarks
                  <input
                    placeholder="Required on reject..."
                    value={remarks[request.id] || ''}
                    onChange={(e) => setRemarks({ ...remarks, [request.id]: e.target.value })}
                  />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() =>
                    submitAction(postJson(`/api/production-requests/${request.id}/qa`, { passed: true, remarks: remarks[request.id] }), 'Request passed QA')
                  }
                >
                  <CheckCircle2 size={16} />
                  Approve QA
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={() => {
                    if (!remarks[request.id]?.trim()) {
                      alert('Remarks are required when rejecting.')
                      return
                    }
                    submitAction(postJson(`/api/production-requests/${request.id}/qa`, { passed: false, remarks: remarks[request.id] }), 'Request rejected by QA')
                  }}
                >
                  <XCircle size={16} />
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <PanelTitle icon={ShieldCheck} title="FG QA Approval" />
        <div className="queue-list">
          {fgQaPending.length === 0 && <div className="empty">No batches pending QA</div>}
          {fgQaPending.map((batch) => {
            const parameters = qaParametersForBatch(batch)
            return (
              <article className="queue-item" key={batch.id}>
                <div className="queue-heading">
                  <strong>{batch.batch_code}</strong>
                  <StatusBadge status={batch.status} />
                </div>
                <span>{batch.product_code} - {fmtQty(batch.quantity)} {batch.unit_code}</span>
                <QcParameterInputs
                  parameters={parameters}
                  draft={drafts[batch.id]}
                  onChange={(parameterId, patch) => updateDraft(batch.id, parameterId, patch)}
                />
                <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                  <label>
                    Remarks
                    <input
                      placeholder="Required on reject..."
                      value={qaRemarks[batch.id] || ''}
                      onChange={(e) => setQaRemarks({ ...qaRemarks, [batch.id]: e.target.value })}
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() =>
                      submitAction(
                        postJson(`/api/fg-batches/${batch.id}/qa`, {
                          passed: true,
                          qa_remarks: qaRemarks[batch.id],
                          results: getResults(parameters, drafts[batch.id]),
                        }),
                        'FG batch QA passed (Ready for Dispatch)',
                      )
                    }
                  >
                    <CheckCircle2 size={16} />
                    Pass
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => {
                      if (!qaRemarks[batch.id]?.trim()) {
                        alert('Remarks are required when rejecting QA.')
                        return
                      }
                      submitAction(
                        postJson(`/api/fg-batches/${batch.id}/qa`, {
                          passed: false,
                          qa_remarks: qaRemarks[batch.id],
                          results: getResults(parameters, drafts[batch.id]),
                        }),
                        'FG batch failed QA',
                      )
                    }}
                  >
                    <XCircle size={16} />
                    Fail
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Production({
  onPrintRequest,
  targetForm,
  setTargetForm,
  planForm,
  setPlanForm,
  requestForm,
  setRequestForm,
  runForm,
  setRunForm,
  bootstrap,
  workflow,
  submitAction,
  userRole,
}: {
  onPrintRequest: (request: ProductionRequest) => void
  targetForm: Record<string, string>
  setTargetForm: (value: Record<string, string>) => void
  planForm: Record<string, string>
  setPlanForm: (value: Record<string, string>) => void
  requestForm: Record<string, string>
  setRequestForm: (value: Record<string, string>) => void
  runForm: Record<string, any>
  setRunForm: (value: Record<string, any>) => void
  bootstrap: BootstrapData
  workflow: WorkflowData
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
  userRole: string
}) {
  const [operator, setOperator] = useState<Employee | null>(null)
  const [operatorError, setOperatorError] = useState<string>('')
  const [approvalRemarks, setApprovalRemarks] = useState<Record<number, string>>({})

  useEffect(() => {
    if (runForm.emp_code && runForm.emp_code.length >= 3) {
      const timer = setTimeout(async () => {
        try {
          const emp = await api<Employee>(`/api/employees/${runForm.emp_code}`)
          setOperator(emp)
          setOperatorError('')
        } catch {
          setOperator(null)
          setOperatorError('Not found')
        }
      }, 500)
      return () => clearTimeout(timer)
    } else {
      setOperator(null)
      setOperatorError('')
    }
  }, [runForm.emp_code])

  const pendingApproval = workflow.productionRequests.filter((request) => ['PENDING_QC', 'PENDING_QA', 'PENDING_RM_APPROVAL'].includes(request.status))
  const approved = workflow.productionRequests.filter((request) => request.status === 'RM_APPROVED')
  const rejectedRequests = workflow.productionRequests.filter((request) => ['QC_REJECTED', 'QA_REJECTED'].includes(request.status))
  function getActualForTarget(targetId: number) {
    return workflow.productionRuns
      .filter((run) => {
        const req = workflow.productionRequests.find((r) => r.id === run.request_id)
        if (!req) return false
        const plan = workflow.productionPlans.find((p) => p.id === req.plan_id)
        if (!plan) return false
        return plan.target_id === targetId
      })
      .reduce((sum, run) => sum + (Number(run.quantity_produced) || 0), 0)
  }

  function getPlannedForTarget(targetId: number) {
    return workflow.productionPlans
      .filter((plan) => plan.target_id === targetId && plan.status !== 'CANCELLED')
      .reduce((sum, plan) => sum + (Number(plan.planned_qty) || 0), 0)
  }

  return (
    <div className="grid-two">
      {rejectedRequests.length > 0 && (
        <section className="panel span-two" style={{ border: '1px solid var(--danger)', backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
          <PanelTitle icon={XCircle} title="Rejected Material Requests" />
          <div className="queue-list" style={{ marginTop: '1rem' }}>
            {rejectedRequests.map((request) => (
              <article className="queue-item" key={request.id} style={{ borderColor: 'var(--danger)' }}>
                <div className="queue-heading">
                  <strong>{request.product_code} / {fmtQty(request.requested_qty)} {request.unit_code}</strong>
                  <StatusBadge status={request.status} />
                </div>
                <small>Requested by: {request.source_team}</small>
                <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
                  <strong>Rejection Remarks:</strong> {request.approval_remarks || 'No remarks provided.'}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {userRole !== 'production_head' && (
      <section className="panel span-two">
        <PanelTitle icon={Activity} title="Production Analytics" />
        <div className="grid-two">
          <div style={{ width: '100%', height: 300, marginTop: '1rem' }}>
            <h4 style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--text-muted)' }}>Target vs Actual Production</h4>
            <ResponsiveContainer>
              <BarChart data={getTargetVsActual(workflow)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="product" stroke="#888" />
                <YAxis stroke="#888" />
                <RechartsTooltip contentStyle={{ backgroundColor: '#1e1e24', border: 'none', borderRadius: '8px' }} />
                <Legend />
                <Bar dataKey="Target" fill="#8884d8" />
                <Bar dataKey="Actual" fill="#82ca9d" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div style={{ width: '100%', height: 300, marginTop: '1rem' }}>
            <h4 style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--text-muted)' }}>Recent Waste Trends (kg)</h4>
            <ResponsiveContainer>
              <AreaChart data={getWasteTrend(workflow)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="name" stroke="#888" />
                <YAxis stroke="#888" />
                <RechartsTooltip contentStyle={{ backgroundColor: '#1e1e24', border: 'none', borderRadius: '8px' }} />
                <Legend />
                <Area type="monotone" dataKey="Runner Waste" stackId="1" stroke="#f59e0b" fill="#f59e0b" />
                <Area type="monotone" dataKey="Purge Waste" stackId="1" stroke="#ef4444" fill="#ef4444" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
      )}
      {['admin', 'production'].includes(userRole) && (
        <section className="panel">
          <PanelTitle icon={Activity} title="Production Request" />
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault()
              submitAction(postJson('/api/production-targets', targetForm), 'Production target created')
            }}
          >
            <label>
              Product
              <select
                value={targetForm.product_id}
                onChange={(event) => setTargetForm({ ...targetForm, product_id: event.target.value })}
                required
              >
                <option value="">Select</option>
                {bootstrap.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.code} - {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target Qty
              <input
                min="1"
                step="1"
                type="number"
                value={targetForm.target_qty}
                onChange={(event) => setTargetForm({ ...targetForm, target_qty: event.target.value })}
                required
              />
            </label>
            <label>
              Start Date
              <input
                type="date"
                value={targetForm.start_date}
                onChange={(event) => setTargetForm({ ...targetForm, start_date: event.target.value })}
              />
            </label>
            <label>
              End Date
              <input
                type="date"
                value={targetForm.end_date}
                onChange={(event) => setTargetForm({ ...targetForm, end_date: event.target.value })}
              />
            </label>
            <label>
              Remarks
              <input value={targetForm.remarks || ''} onChange={(event) => setTargetForm({ ...targetForm, remarks: event.target.value })} />
            </label>
            <button className="primary-button span-two" type="submit">
              <Plus size={18} />
              Set Target
            </button>
          </form>
          <div className="queue-list" style={{ marginTop: '1rem' }}>
            {workflow.productionTargets.map((target) => {
              const actual = getActualForTarget(target.id)
              const remaining = Math.max(0, target.target_qty - actual)
              return (
                <article className="queue-item" key={target.id}>
                  <div className="queue-heading">
                    <strong>{target.product_code} / Total: {fmtQty(target.target_qty)} / Remaining: {fmtQty(remaining)} {target.unit_code}</strong>
                    <StatusBadge status={target.status} />
                  </div>
                  <small>By {target.created_by_name} {target.end_date ? `until ${target.end_date}` : ''}</small>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <section className="panel">
        <PanelTitle icon={Factory} title="Production Planning" />
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault()
            const target = workflow.productionTargets.find((t) => t.id === Number(planForm.target_id))
            const productId = target ? target.product_id : planForm.product_id

            const [yyyy, mm, dd] = (planForm.plan_date || '').split('-')
            const yy = yyyy ? yyyy.slice(-2) : ''
            const shift = planForm.shift || 'A'
            const batchNumber = `TP${dd || '00'}${mm || '00'}${yy || '00'}${shift}`

            submitAction(postJson('/api/production-plans', { ...planForm, shift, batch_number: batchNumber, product_id: productId }), 'Production plan created')
          }}
        >
          <label className="span-two">
            Target
            <select
              value={planForm.target_id}
              onChange={(event) => setPlanForm({ ...planForm, target_id: event.target.value })}
              required
            >
              <option value="">Select Target</option>
              {workflow.productionTargets.filter(t => t.status === 'ACTIVE').map((target) => {
                const planned = getPlannedForTarget(target.id)
                const remaining = Math.max(0, target.target_qty - planned)
                return (
                  <option key={target.id} value={target.id}>
                    #{target.id} {target.product_code} (Target: {fmtQty(target.target_qty)} | Remaining: {fmtQty(remaining)})
                  </option>
                )
              })}
            </select>
          </label>
          <label>
            Planned Qty
            <input
              min="1"
              step="1"
              type="number"
              value={planForm.planned_qty}
              onChange={(event) => setPlanForm({ ...planForm, planned_qty: event.target.value })}
              required
            />
          </label>
          <label>
            Plan Date
            <input
              type="date"
              value={planForm.plan_date}
              onChange={(event) => setPlanForm({ ...planForm, plan_date: event.target.value })}
              required
            />
          </label>
          <label>
            Planned Shift
            <select
              value={planForm.shift || 'A'}
              onChange={(event) => setPlanForm({ ...planForm, shift: event.target.value })}
              required
            >
              <option value="A">Shift A</option>
              <option value="B">Shift B</option>
              <option value="C">Shift C</option>
            </select>
          </label>
          <label>
            Remarks
            <input value={planForm.remarks || ''} onChange={(event) => setPlanForm({ ...planForm, remarks: event.target.value })} />
          </label>
          <button className="primary-button span-two" type="submit">
            <Plus size={18} />
            Create Plan
          </button>
        </form>
        <div className="queue-list" style={{ marginTop: '1rem' }}>
          {workflow.productionPlans.length === 0 && <div className="empty">No active plans</div>}
          {workflow.productionPlans.map((plan) => (
            <article className="queue-item" key={plan.id}>
              <div className="queue-heading">
                <strong>{plan.product_code} / {fmtQty(plan.planned_qty)} {plan.unit_code}</strong>
                <StatusBadge status={plan.status} />
              </div>
              <small>
                Date: {plan.plan_date}
                {plan.shift && ` | Shift: ${plan.shift}`}
                {plan.batch_number && ` | Batch: ${plan.batch_number}`}
              </small>
              {plan.status === 'PLANNED' && (
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => {
                      setRequestForm({
                        ...requestForm,
                        plan_id: String(plan.id),
                        product_id: String(plan.product_id),
                        requested_qty: String(plan.planned_qty),
                        source_team: 'Production',
                      })
                    }}
                  >
                    <Send size={16} />
                    Request Materials
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <PanelTitle icon={ClipboardCheck} title="Daily Material Request" />
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault()
            const success = await submitAction(postJson('/api/production-requests', requestForm), 'Production request submitted')
            if (success) {
              Swal.fire({
                title: 'Success!',
                text: 'Daily Material Request has been submitted successfully.',
                icon: 'success',
                confirmButtonText: 'OK'
              })
              setRequestForm({
                plan_id: '',
                product_id: '',
                requested_qty: '',
                source_team: 'Production',
                priority: 'NORMAL',
                remarks: '',
              })
            }
          }}
        >
          <label>
            Product
            <select
              value={requestForm.plan_id}
              onChange={(event) => {
                const planId = event.target.value
                const plan = workflow.productionPlans.find(p => p.id === Number(planId))
                setRequestForm({
                  ...requestForm,
                  plan_id: planId,
                  product_id: plan ? String(plan.product_id) : requestForm.product_id,
                  requested_qty: plan ? String(plan.planned_qty) : requestForm.requested_qty,
                })
              }}
            >
              <option value="">No Plan (Direct Request)</option>
              {workflow.productionPlans.filter(p => p.status === 'PLANNED').map((plan) => (
                <option key={plan.id} value={plan.id}>
                  Plan #{plan.id} - {plan.product_code} ({plan.plan_date})
                </option>
              ))}
            </select>
          </label>
          <label>
            Product
            <select
              value={requestForm.product_id}
              onChange={(event) => setRequestForm({ ...requestForm, product_id: event.target.value })}
              required
            >
              <option value="">Select</option>
              {bootstrap.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.code} - {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              min="1"
              step="1"
              type="number"
              value={requestForm.requested_qty}
              onChange={(event) => setRequestForm({ ...requestForm, requested_qty: event.target.value })}
              required
            />
          </label>
          <label>
            Source team
            <input value={requestForm.source_team} onChange={(event) => setRequestForm({ ...requestForm, source_team: event.target.value })} />
          </label>
          <label>
            Priority
            <select value={requestForm.priority} onChange={(event) => setRequestForm({ ...requestForm, priority: event.target.value })}>
              <option>NORMAL</option>
              <option>HIGH</option>
              <option>URGENT</option>
            </select>
          </label>
          <label className="span-two">
            Remarks
            <textarea value={requestForm.remarks || ''} onChange={(event) => setRequestForm({ ...requestForm, remarks: event.target.value })} />
          </label>
          <button className="primary-button" type="submit">
            <Plus size={18} />
            Submit Request
          </button>
        </form>
      </section>

      {userRole !== 'production_head' && (
        <section className="panel">
          <PanelTitle icon={ShieldCheck} title="RM Approval Queue" />
        <div className="queue-list">
          {pendingApproval.length === 0 && <div className="empty">No RM approvals pending</div>}
          {pendingApproval.map((request) => (
            <article className="queue-item" key={request.id}>
              <div className="queue-heading">
                <strong>{request.product_code} / {fmtQty(request.requested_qty)} {request.unit_code}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button type="button" onClick={() => onPrintRequest(request)} className="icon-button" title="Print PDF" style={{ padding: '4px', height: 'auto', width: 'auto', minHeight: 0 }}>
                    <Printer size={16} />
                  </button>
                  <StatusBadge status={request.status} />
                </div>
              </div>
              <IssueList request={request} issues={workflow.rmIssues} />
              <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                <label>
                  Approval Remarks
                  <input
                    placeholder="Required on reject..."
                    value={approvalRemarks[request.id] || ''}
                    onChange={(e) => setApprovalRemarks({ ...approvalRemarks, [request.id]: e.target.value })}
                  />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  disabled={request.status === 'PENDING_QC' || request.status === 'PENDING_QA'}
                  onClick={() =>
                    submitAction(postJson(`/api/production-requests/${request.id}/approve`, { approved: true, approval_remarks: approvalRemarks[request.id] }), 'RM issue approved')
                  }
                >
                  {request.status === 'PENDING_QC' ? (
                    <>⏳ Waiting for QC</>
                  ) : request.status === 'PENDING_QA' ? (
                    <>⏳ Waiting for QA</>
                  ) : (
                    <><CheckCircle2 size={16} /> Approve Issue</>
                  )}
                </button>
                <button
                  className="danger"
                  type="button"
                  disabled={request.status === 'PENDING_QC' || request.status === 'PENDING_QA'}
                  onClick={() => {
                    if (!approvalRemarks[request.id]?.trim()) {
                      alert('Remarks are required when rejecting.')
                      return
                    }
                    submitAction(postJson(`/api/production-requests/${request.id}/approve`, { approved: false, approval_remarks: approvalRemarks[request.id] }), 'RM issue rejected')
                  }}
                >
                  <XCircle size={16} />
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
        </section>
      )}

      {userRole !== 'production_head' && (
        <section className="panel">
          <PanelTitle icon={Factory} title="Production Run" />
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault()
            const success = await submitAction(postJson('/api/production-runs', runForm), 'Batch generated and moved to Day Store')
            if (success) {
              setRunForm({
                request_id: '',
                emp_code: '',
                shift: 'A',
                started_at: toLocalInputValue(new Date()),
                ended_at: '',
                quantity_produced: '',
                runner_waste_kg: '',
                purge_waste_kg: '',
                rejected_pieces: '',
                testing_sample_qty: '',
                consumption: {},
              })
              setOperator(null)
            }
          }}
        >
          <div className="detail-grid" style={{ gap: '1rem', background: 'var(--surface-sunken)', padding: '1rem', borderRadius: '8px' }}>
            <label className="span-two">
              Approved Request (Plan)
              <select value={runForm.request_id} onChange={(event) => setRunForm({ ...runForm, request_id: event.target.value })} required>
                <option value="">Select</option>
                {approved.map((request) => (
                  <option key={request.id} value={request.id}>
                    #{request.id} {request.product_code} - {fmtQty(request.requested_qty)} {request.unit_code}
                  </option>
                ))}
              </select>
            </label>
            
            <label>
              Shift
              <select value={runForm.shift} onChange={(event) => setRunForm({ ...runForm, shift: event.target.value })}>
                <option>A</option>
                <option>B</option>
                <option>C</option>
                <option>DAY</option>
                <option>NIGHT</option>
              </select>
            </label>
          </div>

          <fieldset style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <legend style={{ padding: '0 0.5rem', fontWeight: 'bold' }}>Operator Details</legend>
            <div className="form-grid">
              <label>
                Emp Code
                <input 
                  value={runForm.emp_code} 
                  onChange={(e) => setRunForm({ ...runForm, emp_code: e.target.value })} 
                  placeholder="e.g. EMP001"
                  list="employee-suggestions"
                  required 
                />
                <datalist id="employee-suggestions">
                  {bootstrap.employees.filter(e => e.active).map(emp => (
                    <option key={emp.emp_code} value={emp.emp_code}>
                      {emp.name} {emp.gender ? `(${emp.gender})` : ''}
                    </option>
                  ))}
                </datalist>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {operator ? (
                  <>
                    {operator.photo_url && <img src={operator.photo_url} alt="Profile" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />}
                    <div style={{ lineHeight: 1.2 }}>
                      <strong>{operator.name}</strong><br/>
                      <small style={{ color: 'var(--text-muted)' }}>{operator.gender}</small>
                    </div>
                  </>
                ) : (
                  <div style={{ color: operatorError ? 'var(--danger)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', height: '40px' }}>
                    {operatorError || 'Type code to load details...'}
                  </div>
                )}
              </div>
            </div>
          </fieldset>

          <fieldset style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <legend style={{ padding: '0 0.5rem', fontWeight: 'bold' }}>Time Details</legend>
            <div className="form-grid">
              <label>
                Start Date/Time
                <input
                  type="datetime-local"
                  value={runForm.started_at}
                  onChange={(event) => setRunForm({ ...runForm, started_at: event.target.value })}
                  required
                />
              </label>
              <label>
                End Date/Time
                <input type="datetime-local" value={runForm.ended_at} onChange={(event) => setRunForm({ ...runForm, ended_at: event.target.value })} required />
              </label>
            </div>
          </fieldset>

          <fieldset style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <legend style={{ padding: '0 0.5rem', fontWeight: 'bold' }}>Produced Quantity Breakdown</legend>
            <div className="form-grid">
              <label>
                Good Pieces Produced
                <input
                  min="1"
                  step="1"
                  type="number"
                  value={runForm.quantity_produced}
                  onChange={(event) => setRunForm({ ...runForm, quantity_produced: event.target.value })}
                  required
                />
              </label>
              <label>
                Runner Waste (kg)
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={runForm.runner_waste_kg}
                  onChange={(event) => setRunForm({ ...runForm, runner_waste_kg: event.target.value })}
                />
              </label>
              <label>
                Purge Waste (kg)
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={runForm.purge_waste_kg}
                  onChange={(event) => setRunForm({ ...runForm, purge_waste_kg: event.target.value })}
                />
              </label>
              <label>
                Rejected Pieces
                <input
                  min="0"
                  step="1"
                  type="number"
                  value={runForm.rejected_pieces}
                  onChange={(event) => setRunForm({ ...runForm, rejected_pieces: event.target.value })}
                />
              </label>
              <label>
                Testing Sample Qty
                <input
                  min="0"
                  step="1"
                  type="number"
                  value={runForm.testing_sample_qty}
                  onChange={(event) => setRunForm({ ...runForm, testing_sample_qty: event.target.value })}
                />
              </label>
            </div>
          </fieldset>

          {runForm.request_id && (
            <fieldset style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <legend style={{ padding: '0 0.5rem', fontWeight: 'bold' }}>Raw Materials Used</legend>
              <table style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Approved Qty</th>
                    <th>Actual Used</th>
                  </tr>
                </thead>
                <tbody>
                  {workflow.rmIssues
                    .filter((issue) => issue.request_id === Number(runForm.request_id) && issue.status === 'APPROVED')
                    .flatMap(issue => workflow.rmIssueAllocations.filter(a => (a as any).issue_id === issue.id))
                    .map(alloc => (
                      <tr key={(alloc as any).id}>
                        <td>{(alloc as any).material_code} - {(alloc as any).material_name} (Lot #{(alloc as any).lot_number})</td>
                        <td>{fmtQty((alloc as any).quantity)}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            max={(alloc as any).quantity}
                            value={runForm.consumption[(alloc as any).id] ?? (alloc as any).quantity}
                            onChange={(e) => setRunForm({
                              ...runForm,
                              consumption: {
                                ...runForm.consumption,
                                [(alloc as any).id]: e.target.value
                              }
                            })}
                            style={{ width: '120px' }}
                            required
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <small style={{ color: 'var(--text-muted)' }}>* By default, exact approved quantities are assumed consumed unless adjusted down.</small>
            </fieldset>
          )}

          <label>
            Remarks
            <textarea value={runForm.remarks || ''} onChange={(event) => setRunForm({ ...runForm, remarks: event.target.value })} />
          </label>

          <button className="primary-button" type="submit" disabled={!!runForm.emp_code && !operator}>
            <PackageCheck size={18} />
            Complete Run
          </button>
        </form>
      </section>
      )}

      {userRole !== 'production_head' && (
      <section className="panel wide">
        <PanelTitle icon={ClipboardCheck} title="Production History" />
        <AjaxTable resource="production-runs" columns={runColumns} />
      </section>
      )}
    </div>
  )
}

function DayStore({
  onPrintRequest,
  productionRequests,
  rmIssues,
}: {
  onPrintRequest: (request: ProductionRequest) => void
  productionRequests: ProductionRequest[]
  rmIssues: WorkflowData['rmIssues']
}) {
  const rmStaging = productionRequests.filter((req) => req.status === 'RM_APPROVED')

  return (
    <div className="grid-two">
      <section className="panel">
        <PanelTitle icon={Boxes} title="RM Staging (Temporary Store)" />
        <div className="queue-list">
          {rmStaging.length === 0 && <div className="empty">No raw materials in staging</div>}
          {rmStaging.map((request) => (
            <article className="queue-item" key={request.id}>
              <div className="queue-heading">
                <strong>{request.product_code} / {fmtQty(request.requested_qty)} {request.unit_code}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button type="button" onClick={() => onPrintRequest(request)} className="icon-button" title="Print PDF" style={{ padding: '4px', height: 'auto', width: 'auto', minHeight: 0 }}>
                    <Printer size={16} />
                  </button>
                  <StatusBadge status={request.status} />
                </div>
              </div>
              <small>Request #{request.id} • Due: {request.due_date || 'N/A'}</small>
              <IssueList request={request} issues={rmIssues} showStaged />
            </article>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <PanelTitle icon={PackageCheck} title="All Finished Batches" />
        <AjaxTable resource="fg-batches" columns={batchColumns} />
      </section>
    </div>
  )
}

function FgAndDispatch({
  batches,
  form,
  setForm,
  submitAction,
}: {
  batches: FgBatch[]
  form: Record<string, string>
  setForm: (value: Record<string, string>) => void
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
}) {
  const available = batches.filter((batch) => ['READY_FOR_DISPATCH', 'PARTIAL_DISPATCH'].includes(batch.status) && Number(batch.remaining_qty) > 0)
  const transportType = form.transport_type || 'OWN'
  const selectedBatch = available.find((b) => String(b.id) === form.batch_id)

  return (
    <div className="grid-two">
      <section className="panel">
        <PanelTitle icon={Send} title="Dispatch Release" />
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault()
            submitAction(postJson('/api/dispatches', { ...form, transport_type: transportType }), 'Dispatch logged')
          }}
        >
          <label className="span-two">
            FG batch
            <select value={form.batch_id} onChange={(event) => setForm({ ...form, batch_id: event.target.value })} required>
              <option value="">Select</option>
              {available.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batch_code} - {fmtQty(batch.remaining_qty)} {batch.unit_code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer
            <input value={form.customer || ''} onChange={(event) => setForm({ ...form, customer: event.target.value })} required />
          </label>
          <label>
            Customer Email
            <input type="email" value={form.customer_email || ''} onChange={(event) => setForm({ ...form, customer_email: event.target.value })} />
          </label>
          <label className="span-two">
            P.O Number
            <input value={form.order_ref || ''} onChange={(event) => setForm({ ...form, order_ref: event.target.value })} required />
          </label>
          <label>
            Dispatch Date
            <input
              type="date"
              value={form.shipped_at ? form.shipped_at.substring(0, 10) : ''}
              onChange={(event) => setForm({ ...form, shipped_at: event.target.value })}
              required
            />
          </label>
          <label>
            Quantity {selectedBatch ? `(${selectedBatch.unit_code})` : ''}
            <input
              min="0.001"
              step="0.001"
              type="number"
              value={form.quantity}
              onChange={(event) => setForm({ ...form, quantity: event.target.value })}
              required
            />
          </label>
          
          <label className="span-two">
            Transport Type
            <select value={transportType} onChange={(event) => setForm({ ...form, transport_type: event.target.value })}>
              <option value="OWN">Our own transportation</option>
              <option value="COURIER">Courier</option>
            </select>
          </label>

          {transportType === 'OWN' && (
            <>
              <label>
                Driver Name
                <input value={form.driver_name || ''} onChange={(event) => setForm({ ...form, driver_name: event.target.value })} required />
              </label>
              <label>
                Driver Phone
                <input value={form.driver_phone || ''} onChange={(event) => setForm({ ...form, driver_phone: event.target.value })} required />
              </label>
              <label>
                Vehicle Number
                <input value={form.vehicle_no || ''} onChange={(event) => setForm({ ...form, vehicle_no: event.target.value })} required />
              </label>
            </>
          )}

          {transportType === 'COURIER' && (
            <>
              <label>
                Courier Name
                <input value={form.courier_name || ''} onChange={(event) => setForm({ ...form, courier_name: event.target.value })} required />
              </label>
              <label>
                Booking / LR Number
                <input value={form.booking_lr || ''} onChange={(event) => setForm({ ...form, booking_lr: event.target.value })} required />
              </label>
            </>
          )}

          <label className="span-two">
            Remarks
            <textarea value={form.remarks || ''} onChange={(event) => setForm({ ...form, remarks: event.target.value })} />
          </label>

          <div className="span-two">
            <button className="primary-button" type="submit">
              <Truck size={18} />
              Release
            </button>
          </div>
        </form>
      </section>
      <section className="panel">
        <PanelTitle icon={PackageCheck} title="FG Store" />
        <BatchTable batches={batches.filter((batch) => ['READY_FOR_DISPATCH', 'PARTIAL_DISPATCH', 'DISPATCHED'].includes(batch.status))} />
      </section>
      <section className="panel wide">
        <PanelTitle icon={Truck} title="Dispatch Log" />
        <AjaxTable resource="dispatches" columns={dispatchColumns} />
      </section>
    </div>
  )
}

function Traceability({
  query,
  setQuery,
  trace,
  onSubmit,
}: {
  query: string
  setQuery: (value: string) => void
  trace: TraceabilityResult | null
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <div className="stack">
      <section className="panel">
        <PanelTitle icon={Search} title="Batch Traceability" />
        <form className="search-row" onSubmit={onSubmit}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="BATCH-YYYYMMDD-PRODUCT-SHIFT-SEQ" />
          <button className="primary-button" type="submit">
            <Search size={18} />
            Search
          </button>
        </form>
      </section>
      {trace && (
        <>
          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <PanelTitle icon={PackageCheck} title={trace.batch.batch_code} />
              <button 
                type="button" 
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}#/public-trace/${encodeURIComponent(trace.batch.batch_code)}`
                  navigator.clipboard.writeText(url)
                  alert('Customer link copied to clipboard!')
                }}
                style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                Copy Customer Link
              </button>
            </div>
            <div className="detail-grid">
              <Detail label="Product" value={`${trace.batch.product_code} - ${trace.batch.product_name}`} />
              <Detail label="Status" value={<StatusBadge status={trace.batch.status} />} />
              <Detail label="Produced" value={`${fmtQty(trace.batch.quantity)} units`} />
              <Detail label="Shift" value={trace.batch.shift} />
              <Detail label="Team" value={trace.batch.team_members} />
              <Detail label="RM Approval" value={trace.batch.rm_approved_by_name || '-'} />
              <Detail label="FG QC" value={trace.batch.fg_qc_by_name || '-'} />
              <Detail label="FG QA" value={trace.batch.fg_qa_by_name || '-'} />
              <Detail label="Source" value={trace.batch.source_team} />
              {trace.batch.remarks && <Detail label="Run Remarks" value={trace.batch.remarks} />}
              {trace.batch.qc_remarks && <Detail label="FG QC Remarks" value={trace.batch.qc_remarks} />}
              {trace.batch.qa_remarks && <Detail label="FG QA Remarks" value={trace.batch.qa_remarks} />}
            </div>
          </section>
          <section className="panel">
            <PanelTitle icon={Boxes} title="Raw Material Genealogy" />
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Lot</th>
                  <th>Supplier</th>
                  <th>Received At</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>RM QC</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {trace.rawMaterials.map((row, index) => (
                  <tr key={`${row.receipt_id}-${index}`}>
                    <td>{row.material_code} - {row.material_name}</td>
                    <td>{row.lot_number}</td>
                    <td>{row.supplier}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{row.received_at ? new Date(row.received_at as string).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                    <td>{fmtQty(row.planned_qty)}</td>
                    <td>{fmtQty(row.actual_qty)}</td>
                    <td>{row.rm_qc_by_name || '-'}</td>
                    <td>
                      <div className="stack" style={{ gap: '0.25rem', fontSize: '0.85em' }}>
                        {row.remarks && <div><strong>Receipt:</strong> {row.remarks}</div>}
                        {row.qc_remarks && <div><strong>QC:</strong> {row.qc_remarks}</div>}
                        {row.qa_remarks && <div><strong>QA:</strong> {row.qa_remarks}</div>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <PanelTitle icon={ClipboardCheck} title="FG QC Results" />
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Parameter</th>
                  <th>Value</th>
                  <th>Result</th>
                  <th>Checked By</th>
                </tr>
              </thead>
              <tbody>
                {trace.fgQc.map((row, index) => (
                  <tr key={`${row.parameter_id}-${index}`}>
                    <td>{row.stage || 'QC'}</td>
                    <td>{row.label || 'Manual check'}</td>
                    <td>{row.value || '-'}</td>
                    <td>{Number(row.passed) ? 'Pass' : 'Fail'}</td>
                    <td>{row.checked_by_name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <PanelTitle icon={Truck} title="Dispatch History" />
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>P.O Number</th>
                  <th>Customer</th>
                  <th>Qty</th>
                  <th>Transport</th>
                  <th>Details</th>
                  <th>Feedback</th>
                  <th>Approved By</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {trace.dispatches.map((dispatch) => (
                  <tr key={dispatch.id}>
                    <td>{new Date(dispatch.shipped_at).toLocaleDateString()}</td>
                    <td>{dispatch.order_ref}</td>
                    <td>{dispatch.customer}</td>
                    <td>{fmtQty(dispatch.quantity)}</td>
                    <td>{dispatch.transport_type === 'COURIER' ? 'Courier' : 'Own'}</td>
                    <td style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
                      {dispatch.transport_type === 'COURIER' ? (
                        <>{dispatch.courier_name} (LR: {dispatch.booking_lr})</>
                      ) : (
                        <>{dispatch.vehicle_no} ({dispatch.driver_name}, {dispatch.driver_phone})</>
                      )}
                    </td>
                    <td>
                      {dispatch.feedback_rating ? (
                        <div>
                          <div>
                            {'★'.repeat(dispatch.feedback_rating)}{'☆'.repeat(5 - dispatch.feedback_rating)}
                          </div>
                          {dispatch.feedback_comments && (
                            <div style={{ fontSize: '0.85em', color: 'var(--text-muted)', marginTop: '4px' }}>
                              "{dispatch.feedback_comments}"
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>Pending</span>
                      )}
                    </td>
                    <td>{dispatch.approved_by_name || '-'}</td>
                    <td style={{ fontSize: '0.85em' }}>{dispatch.remarks || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}

function UserManagement({
  users,
  roles,
  currentUser,
  form,
  setForm,
  editingUserId,
  setEditingUserId,
  submitAction,
}: {
  users: User[]
  roles: Role[]
  currentUser: User
  form: Record<string, string>
  setForm: (value: Record<string, string>) => void
  editingUserId: number | null
  setEditingUserId: (value: number | null) => void
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
}) {
  const isEditing = editingUserId !== null
  const editingSelf = editingUserId === currentUser.id

  function resetUserForm() {
    setEditingUserId(null)
    setForm({
      username: '',
      password: '',
      name: '',
      role: 'production',
      active: '1',
    })
  }

  function editUser(account: User) {
    setEditingUserId(account.id)
    setForm({
      username: account.username,
      password: '',
      name: account.name,
      role: account.role,
      active: String(account.active ?? 1),
    })
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault()
    const payload = cleanUserPayload(form, !isEditing)
    const saved = await submitAction(
      isEditing ? putJson(`/api/admin/users/${editingUserId}`, payload) : postJson('/api/admin/users', payload),
      isEditing ? 'User account updated' : 'User account created',
    )
    if (saved) resetUserForm()
  }

  async function deleteAccount(account: User) {
    if (account.id === currentUser.id) return
    const confirmed = window.confirm(`Delete user ${account.name}? This removes their login but keeps existing audit records.`)
    if (!confirmed) return

    const deleted = await submitAction(api(`/api/admin/users/${account.id}`, { method: 'DELETE' }), 'User account deleted')
    if (deleted && editingUserId === account.id) resetUserForm()
  }

  return (
    <div className="grid-two">
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title={isEditing ? 'Edit User' : 'Create User'} />
        <form className="form-grid" onSubmit={saveUser}>
          <TextInput label="Username" value={form.username} onChange={(value) => setForm({ ...form, username: value })} />
          <TextInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <TextInput
            label={isEditing ? 'New password' : 'Password'}
            type="password"
            value={form.password}
            onChange={(value) => setForm({ ...form, password: value })}
            required={!isEditing}
          />
          <SelectInput
            label="Role"
            value={form.role}
            onChange={(value) => setForm({ ...form, role: value })}
            options={roles.map(r => [r.code, r.name])}
            disabled={editingSelf}
          />
          <SelectInput
            label="Status"
            value={form.active}
            onChange={(value) => setForm({ ...form, active: value })}
            options={[
              ['1', 'Active'],
              ['0', 'Inactive'],
            ]}
            disabled={editingSelf}
          />
          <div className="button-row span-two">
            <button className="primary-button" type="submit">
              <Plus size={18} />
              {isEditing ? 'Update User' : 'Create User'}
            </button>
            {isEditing && (
              <button type="button" onClick={resetUserForm}>
                <XCircle size={16} />
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="panel wide">
        <PanelTitle icon={Settings} title="User Roles" />
        <table className="user-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((account) => (
              <tr key={account.id}>
                <td data-label="User">
                  <strong>{account.name}</strong>
                  <span className="table-muted">{account.username}</span>
                </td>
                <td data-label="Role">{roles.find(r => r.code === account.role)?.name ?? account.role}</td>
                <td data-label="Status">
                  <StatusBadge status={Number(account.active) ? 'ACTIVE' : 'INACTIVE'} />
                </td>
                <td data-label="Actions">
                  <div className="table-actions">
                    <button type="button" onClick={() => editUser(account)}>
                      <Settings size={16} />
                      Manage
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => deleteAccount(account)}
                      disabled={account.id === currentUser.id}
                      title={account.id === currentUser.id ? 'Current signed-in user cannot be deleted' : 'Delete user'}
                    >
                      <XCircle size={16} />
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function EmployeeManagement({
  employees,
  form,
  setForm,
  editingEmployeeCode,
  setEditingEmployeeCode,
  submitAction,
}: {
  employees: Employee[]
  form: Record<string, string>
  setForm: (value: Record<string, string>) => void
  editingEmployeeCode: string | null
  setEditingEmployeeCode: (value: string | null) => void
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
}) {
  const isEditing = editingEmployeeCode !== null

  function resetForm() {
    setEditingEmployeeCode(null)
    setForm({
      emp_code: '',
      name: '',
      gender: 'Male',
      photo_url: '',
      active: '1',
    })
  }

  function editEmployee(emp: Employee) {
    setEditingEmployeeCode(emp.emp_code)
    setForm({
      emp_code: emp.emp_code,
      name: emp.name,
      gender: emp.gender || 'Male',
      photo_url: emp.photo_url || '',
      active: String(emp.active ?? 1),
    })
  }

  async function saveEmployee(event: FormEvent) {
    event.preventDefault()
    const payload = {
      emp_code: form.emp_code.trim(),
      name: form.name.trim(),
      gender: form.gender,
      photo_url: form.photo_url.trim(),
      active: Number(form.active),
    }

    let url = '/api/master/employees'
    let method = postJson
    if (isEditing) {
      const emp = employees.find((e) => e.emp_code === editingEmployeeCode)
      if (emp) {
        url = `/api/master/employees/${emp.id}`
        method = putJson
      }
    }

    const saved = await submitAction(
      method(url, payload),
      isEditing ? 'Employee updated' : 'Employee created',
    )
    if (saved) resetForm()
  }

  return (
    <div className="grid-two">
      <section className="panel">
        <PanelTitle icon={Users} title={isEditing ? 'Edit Employee' : 'Create Employee'} />
        <form className="form-grid" onSubmit={saveEmployee}>
          <TextInput label="Emp Code" value={form.emp_code} onChange={(value) => setForm({ ...form, emp_code: value })} required={!isEditing} />
          <TextInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <SelectInput
            label="Gender"
            value={form.gender}
            onChange={(value) => setForm({ ...form, gender: value })}
            options={[
              ['Male', 'Male'],
              ['Female', 'Female'],
              ['Other', 'Other'],
            ]}
          />
          <label>
            Photo (Upload)
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    const reader = new FileReader()
                    reader.onload = (e) => {
                      setForm({ ...form, photo_url: e.target?.result as string })
                    }
                    reader.readAsDataURL(file)
                  }
                }}
              />
              {form.photo_url && (
                <img src={form.photo_url} alt="Preview" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
              )}
            </div>
          </label>
          <SelectInput
            label="Status"
            value={form.active}
            onChange={(value) => setForm({ ...form, active: value })}
            options={[
              ['1', 'Active'],
              ['0', 'Inactive'],
            ]}
          />
          <div className="button-row span-two">
            <button className="primary-button" type="submit">
              <Plus size={18} />
              {isEditing ? 'Update Employee' : 'Create Employee'}
            </button>
            {isEditing && (
              <button type="button" onClick={resetForm}>
                <XCircle size={16} />
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="panel wide">
        <PanelTitle icon={Settings} title="Shop Floor Employees" />
        <table className="user-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Gender</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td data-label="Code">{emp.emp_code}</td>
                <td data-label="Name">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {emp.photo_url ? (
                      <img src={emp.photo_url} alt={emp.name} style={{ width: 24, height: 24, borderRadius: '50%' }} />
                    ) : (
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#ccc' }} />
                    )}
                    {emp.name}
                  </div>
                </td>
                <td data-label="Gender">{emp.gender || '-'}</td>
                <td data-label="Status">
                  <span className={`status ${emp.active ? 'active' : 'inactive'}`}>
                    {emp.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td data-label="Actions">
                  <div className="button-row">
                    <button onClick={() => editEmployee(emp)} title="Edit">
                      <Settings size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function MasterSection({
  icon: Icon,
  title,
  resourcePath,
  data,
  columns,
  defaultForm,
  submitAction,
  children,
}: {
  icon: any
  title: string
  resourcePath: string
  data: any[]
  columns: { key: string; label: string; render?: (row: any) => ReactNode }[]
  defaultForm: Record<string, string>
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
  children: (form: Record<string, string>, setForm: (val: Record<string, string>) => void) => ReactNode
}) {
  const [form, setForm] = useState(defaultForm)
  const [editingId, setEditingId] = useState<number | null>(null)

  function onEdit(item: any) {
    setEditingId(item.id)
    const newForm = { ...defaultForm }
    for (const key in defaultForm) {
      newForm[key] = String(item[key] ?? '')
    }
    setForm(newForm)
  }

  async function onDelete(item: any) {
    if (!window.confirm(`Delete ${title}?`)) return
    const success = await submitAction(api(`${resourcePath}/${item.id}`, { method: 'DELETE' }), `${title} deleted`)
    if (success && editingId === item.id) {
      setEditingId(null)
      setForm(defaultForm)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const method = editingId ? putJson : postJson
    const url = editingId ? `${resourcePath}/${editingId}` : resourcePath
    const payload = title.includes('QC') ? cleanOptionalIds(form) : form
    const success = await submitAction(method(url, payload), `${title} saved`)
    if (success) {
      setEditingId(null)
      setForm(defaultForm)
    }
  }

  return (
    <section className="panel wide">
      <PanelTitle icon={Icon} title={title} />
      <div className="grid-two">
        <form className="form-grid" onSubmit={onSubmit}>
          {children(form, setForm)}
          <div className="button-row span-two">
            <button className="primary-button" type="submit">
              <Plus size={18} />
              {editingId ? 'Update' : 'Save'}
            </button>
            {editingId && (
               <button type="button" onClick={() => { setEditingId(null); setForm(defaultForm); }}>
                 <XCircle size={16} />
                 Cancel
               </button>
            )}
          </div>
        </form>
        <div style={{ overflowX: 'auto' }}>
          <table className="user-table">
            <thead>
              <tr>
                {columns.map(c => <th key={c.key}>{c.label}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map(item => (
                 <tr key={item.id}>
                   {columns.map(c => <td key={c.key} data-label={c.label}>{c.render ? c.render(item) : item[c.key]}</td>)}
                   <td data-label="Actions">
                     <div className="table-actions">
                       <button type="button" onClick={() => onEdit(item)}><Settings size={16}/></button>
                       <button type="button" className="danger" onClick={() => onDelete(item)}><XCircle size={16}/></button>
                     </div>
                   </td>
                 </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: '1rem' }}>No {title.toLowerCase()} found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function MasterData({
  bootstrap,
  submitAction,
}: {
  bootstrap: BootstrapData
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
}) {
  return (
    <div className="stack">
      <MasterSection
        icon={Truck}
        title="Supplier"
        resourcePath="/api/master/suppliers"
        data={bootstrap.suppliers}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'contact', label: 'Contact' },
          { key: 'email', label: 'Email' }
        ]}
        defaultForm={{ name: '', address: '', gst: '', contact: '', email: '', contact_person: '', active: '1' }}
        submitAction={submitAction}
      >
        {(form, setForm) => (
          <>
            <TextInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <TextInput label="Address" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
            <TextInput label="GST Number" value={form.gst} onChange={(value) => setForm({ ...form, gst: value })} />
            <TextInput label="Contact No" value={form.contact} onChange={(value) => setForm({ ...form, contact: value })} />
            <TextInput label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
            <TextInput label="Contact Person" value={form.contact_person} onChange={(value) => setForm({ ...form, contact_person: value })} />
          </>
        )}
      </MasterSection>

      <MasterSection
        icon={Boxes}
        title="Raw Material"
        resourcePath="/api/master/raw-materials"
        data={bootstrap.rawMaterials}
        columns={[
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'unit_code', label: 'Unit' }
        ]}
        defaultForm={{ code: '', name: '', unit_id: '', reorder_level: '0' }}
        submitAction={submitAction}
      >
        {(form, setForm) => (
          <>
            <TextInput label="HSN Code" value={form.code} onChange={(value) => setForm({ ...form, code: value })} />
            <TextInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <SelectInput
              label="Unit"
              value={form.unit_id}
              onChange={(value) => setForm({ ...form, unit_id: value })}
              options={bootstrap.units.map((unit) => [String(unit.id), unit.code])}
            />
          </>
        )}
      </MasterSection>

      <MasterSection
        icon={PackageCheck}
        title="Product"
        resourcePath="/api/master/products"
        data={bootstrap.products}
        columns={[
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'unit_code', label: 'Unit' }
        ]}
        defaultForm={{ code: '', name: '', unit_id: '' }}
        submitAction={submitAction}
      >
        {(form, setForm) => (
          <>
            <TextInput label="Code" value={form.code} onChange={(value) => setForm({ ...form, code: value })} />
            <TextInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <SelectInput
              label="Unit"
              value={form.unit_id}
              onChange={(value) => setForm({ ...form, unit_id: value })}
              options={bootstrap.units.map((unit) => [String(unit.id), unit.code])}
            />
          </>
        )}
      </MasterSection>

      <MasterSection
        icon={Factory}
        title="BOM / Recipe"
        resourcePath="/api/master/bom-items"
        data={bootstrap.bomItems}
        columns={[
          { key: 'product', label: 'Product', render: (row: any) => `${row.product_code} - ${row.product_name}` },
          { key: 'material', label: 'Material', render: (row: any) => `${row.material_code} - ${row.material_name}` },
          { key: 'qty', label: 'Qty / Unit', render: (row: any) => `${fmtQty(row.qty_per_unit)} ${row.unit_code}` }
        ]}
        defaultForm={{ product_id: '', raw_material_id: '', qty_per_unit: '', unit_id: '' }}
        submitAction={submitAction}
      >
        {(form, setForm) => (
          <>
            <SelectInput
              label="Product"
              value={form.product_id}
              onChange={(value) => setForm({ ...form, product_id: value })}
              options={bootstrap.products.map((product) => [String(product.id), product.code])}
            />
            <SelectInput
              label="Material"
              value={form.raw_material_id}
              onChange={(value) => setForm({ ...form, raw_material_id: value })}
              options={bootstrap.rawMaterials.map((material) => [String(material.id), material.code])}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <TextInput
                label="Qty"
                type="number"
                value={form.qty_per_unit}
                onChange={(value) => setForm({ ...form, qty_per_unit: value })}
              />
              <SelectInput
                label="Unit"
                value={form.unit_id || ''}
                onChange={(value) => setForm({ ...form, unit_id: value })}
                options={bootstrap.units.map((unit) => [String(unit.id), unit.code])}
                optional
              />
            </div>
          </>
        )}
      </MasterSection>

      <MasterSection
        icon={ClipboardCheck}
        title="QC Template"
        resourcePath="/api/master/qc-templates"
        data={bootstrap.qcTemplates}
        columns={[
          { key: 'scope', label: 'Scope' },
          { key: 'name', label: 'Name' },
          { key: 'product', label: 'Product', render: (row: any) => row.product_code || '-' },
          { key: 'material', label: 'Material', render: (row: any) => row.material_code || '-' }
        ]}
        defaultForm={{ scope: 'FG', name: '', product_id: '', raw_material_id: '' }}
        submitAction={submitAction}
      >
        {(form, setForm) => (
          <>
            <SelectInput
              label="Scope"
              value={form.scope}
              onChange={(value) => setForm({ ...form, scope: value })}
              options={[
                ['RM', 'RM'],
                ['FG', 'FG'],
              ]}
            />
            <TextInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <SelectInput
              label="Product"
              value={form.product_id}
              onChange={(value) => setForm({ ...form, product_id: value })}
              options={bootstrap.products.map((product) => [String(product.id), product.code])}
              optional
            />
            <SelectInput
              label="Material"
              value={form.raw_material_id}
              onChange={(value) => setForm({ ...form, raw_material_id: value })}
              options={bootstrap.rawMaterials.map((material) => [String(material.id), material.code])}
              optional
            />
          </>
        )}
      </MasterSection>

      <MasterSection
        icon={FlaskConical}
        title="QC Parameter"
        resourcePath="/api/master/qc-parameters"
        data={bootstrap.qcParameters}
        columns={[
          { key: 'template', label: 'Template', render: (row: any) => `${row.scope} - ${row.template_name}` },
          { key: 'label', label: 'Label' },
          { key: 'type', label: 'Type' },
          { key: 'range', label: 'Range', render: (row: any) => row.min_value || row.max_value ? `${row.min_value ?? '-'} to ${row.max_value ?? '-'}` : '-' }
        ]}
        defaultForm={{
          template_id: '',
          label: '',
          type: 'pass_fail',
          min_value: '',
          max_value: '',
        }}
        submitAction={submitAction}
      >
        {(form, setForm) => (
          <>
            <SelectInput
              label="Template"
              value={form.template_id}
              onChange={(value) => setForm({ ...form, template_id: value })}
              options={bootstrap.qcTemplates.map((template) => [String(template.id), `${template.scope} - ${template.name}`])}
            />
            <TextInput label="Label" value={form.label} onChange={(value) => setForm({ ...form, label: value })} />
            <SelectInput
              label="Type"
              value={form.type}
              onChange={(value) => setForm({ ...form, type: value })}
              options={[
                ['pass_fail', 'Pass / Fail'],
                ['number', 'Number'],
                ['text', 'Text'],
                ['file', 'File Attachment'],
              ]}
            />
            <TextInput label="Min" type="number" value={form.min_value} onChange={(value) => setForm({ ...form, min_value: value })} />
            <TextInput label="Max" type="number" value={form.max_value} onChange={(value) => setForm({ ...form, max_value: value })} />
          </>
        )}
      </MasterSection>
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  required = label !== 'Min' && label !== 'Max',
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  disabled?: boolean
}) {
  return (
    <label>
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} />
    </label>
  )
}

function SelectInput({
  label,
  value,
  onChange,
  options,
  optional = false,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[][]
  optional?: boolean
  disabled?: boolean
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} required={!optional} disabled={disabled}>
        <option value="">{optional ? 'Any' : 'Select'}</option>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

function QcParameterInputs({
  parameters,
  draft,
  onChange,
}: {
  parameters: QcParameter[]
  draft: QcDraft | undefined
  onChange: (parameterId: number, patch: Partial<{ value: string; passed: boolean }>) => void
}) {
  if (parameters.length === 0) return null
  return (
    <div className="qc-grid">
      {parameters.map((parameter) => (
        <label key={parameter.id}>
          <span>
            {parameter.label}
            {parameter.min_value !== null || parameter.max_value !== null ? ` (${parameter.min_value ?? '-'}-${parameter.max_value ?? '-'})` : ''}
          </span>
          {parameter.type === 'file' ? (
            <input
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  onChange(parameter.id, { value: file.name })
                }
              }}
            />
          ) : (
            <input
              type={parameter.type === 'number' ? 'number' : 'text'}
              value={draft?.[parameter.id]?.value ?? ''}
              onChange={(event) => onChange(parameter.id, { value: event.target.value })}
            />
          )}
          <input
            aria-label={`${parameter.label} passed`}
            checked={draft?.[parameter.id]?.passed ?? true}
            type="checkbox"
            onChange={(event) => onChange(parameter.id, { passed: event.target.checked })}
          />
        </label>
      ))}
    </div>
  )
}

function IssueList({ request, issues, showStaged }: { request: ProductionRequest; issues: WorkflowData['rmIssues']; showStaged?: boolean }) {
  const matching = issues.filter((issue) => issue.request_id === request.id)
  return (
    <ul className="compact-list">
      {matching.map((issue) => (
        <li key={issue.id}>
          {issue.material_code}: {showStaged && issue.staged_qty != null ? fmtQty(Number(issue.staged_qty)) : fmtQty(issue.requested_qty)} {issue.unit_code}
        </li>
      ))}
    </ul>
  )
}

function BatchTable({ batches }: { batches: FgBatch[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Batch</th>
          <th>Product</th>
          <th>Qty</th>
          <th>Remaining</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {batches.map((batch) => (
          <tr key={batch.id}>
            <td>{batch.batch_code}</td>
            <td>{batch.product_code} - {batch.product_name}</td>
            <td>{fmtQty(batch.quantity)} {batch.unit_code}</td>
            <td>{fmtQty(batch.remaining_qty)} {batch.unit_code}</td>
            <td><StatusBadge status={batch.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FlowNode({ label, value }: { label: string; value: number }) {
  return (
    <div className="flow-node">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function PanelTitle({ icon: Icon, title }: { icon: typeof Activity; title: string }) {
  return (
    <div className="panel-title">
      <Icon size={18} />
      <h2>{title}</h2>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status ${status.toLowerCase().replace(/_/g, '-')}`}>{status.replace(/_/g, ' ')}</span>
}

function fmtQty(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function cleanOptionalIds(form: Record<string, string>) {
  return Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value === '' ? null : value]))
}

function cleanUserPayload(form: Record<string, string>, passwordRequired: boolean) {
  const payload: Record<string, string | number> = {
    username: form.username.trim(),
    name: form.name.trim(),
    role: form.role,
    active: Number(form.active),
  }
  const password = form.password.trim()
  if (passwordRequired || password) payload.password = password
  return payload
}

function CustomerFeedback({ dispatchId }: { dispatchId: number }) {
  const [data, setData] = useState<{ dispatch: Dispatch; feedback: any } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rating, setRating] = useState(5)
  const [comments, setComments] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    fetch(`/api/feedback/${dispatchId}`)
      .then((res) => res.json().then((body) => (res.ok ? body : Promise.reject(body))))
      .then((res) => {
        setData(res)
        if (res.feedback) {
          setSubmitted(true)
        }
      })
      .catch((err) => setError(err.error || 'Failed to load'))
  }, [dispatchId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      const res = await fetch(`/api/feedback/${dispatchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comments }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setSubmitted(true)
    } catch (err: any) {
      setError(err.message)
    }
  }

  if (error) {
    return (
      <div className="login-shell">
        <div className="login-panel">
          <h1>Error</h1>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return <div className="login-shell">Loading...</div>

  return (
    <div className="login-shell">
      <div className="login-panel" style={{ maxWidth: '500px', width: '100%', padding: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Order Feedback</h1>
        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg-card)', borderRadius: '4px' }}>
          <Detail label="P.O Number" value={data.dispatch.order_ref} />
          <Detail label="Product" value={data.dispatch.product_name} />
          <Detail label="Batch Code" value={data.dispatch.batch_code} />
          <Detail label="Shipped" value={new Date(data.dispatch.shipped_at).toLocaleDateString()} />
        </div>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--success)' }}>
            <Activity size={48} style={{ margin: '0 auto 1rem' }} />
            <h2 style={{ marginBottom: '0.5rem' }}>Thank you!</h2>
            <p style={{ color: 'var(--text-muted)' }}>We have received your feedback.</p>
          </div>
        ) : (
          <form className="stack" onSubmit={handleSubmit}>
            <label>
              Rating (1-5 Stars)
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '2rem',
                      cursor: 'pointer',
                      color: star <= rating ? '#fbbf24' : 'var(--border-color)',
                      padding: 0,
                    }}
                  >
                    ★
                  </button>
                ))}
              </div>
            </label>
            <label>
              Comments
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                placeholder="Tell us about your experience..."
              />
            </label>
            <button className="primary-button" type="submit" style={{ width: '100%' }}>
              Submit Feedback
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function PublicTraceability({ batchCode }: { batchCode: string }) {
  const [trace, setTrace] = useState<TraceabilityResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/public/traceability/${encodeURIComponent(batchCode)}`)
      .then(res => res.json().then(data => ({ status: res.status, data })))
      .then(({ status, data }) => {
        if (status >= 400) {
          setError(data.error || 'Failed to load traceability data')
        } else {
          setTrace(data)
        }
      })
      .catch(err => setError(err.message))
  }, [batchCode])

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', color: 'var(--primary)' }}>
        <Factory size={32} />
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Customer Portal - Batch Traceability</h1>
      </header>

      {error && <div className="notice-bar error" style={{ padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>{error}</div>}

      {trace && (
        <div className="stack" style={{ gap: '1.5rem' }}>
          <section className="panel" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid var(--border)' }}>
            <PanelTitle icon={PackageCheck} title={trace.batch.batch_code} />
            <div className="detail-grid" style={{ gap: '1rem' }}>
              <Detail label="Product" value={`${trace.batch.product_code} - ${trace.batch.product_name}`} />
              <Detail label="Produced Quantity" value={`${fmtQty(trace.batch.quantity)} units`} />
              <Detail label="Shift" value={trace.batch.shift} />
            </div>
          </section>

          <section className="panel" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid var(--border)' }}>
            <PanelTitle icon={Boxes} title="Raw Material Genealogy" />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem' }}>Material</th>
                    <th style={{ padding: '0.75rem' }}>Lot</th>
                    <th style={{ padding: '0.75rem' }}>Quantity Used</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.rawMaterials.map((row, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem' }}>{row.material_code} - {row.material_name}</td>
                      <td style={{ padding: '0.75rem' }}>{row.lot_number}</td>
                      <td style={{ padding: '0.75rem' }}>{fmtQty(row.actual_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid var(--border)' }}>
            <PanelTitle icon={ClipboardCheck} title="Quality Control Results" />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem' }}>Stage</th>
                    <th style={{ padding: '0.75rem' }}>Parameter</th>
                    <th style={{ padding: '0.75rem' }}>Value</th>
                    <th style={{ padding: '0.75rem' }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.fgQc.map((row, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem' }}>{row.stage || 'QC'}</td>
                      <td style={{ padding: '0.75rem' }}>{row.label || 'Manual check'}</td>
                      <td style={{ padding: '0.75rem' }}>{row.value || '-'}</td>
                      <td style={{ padding: '0.75rem', color: Number(row.passed) ? 'var(--success)' : 'var(--danger)', fontWeight: 'bold' }}>
                        {Number(row.passed) ? 'Pass' : 'Fail'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function PrintTicket({ request, issues }: { request: ProductionRequest; issues: WorkflowData['rmIssues'] }) {
  const matching = issues.filter((issue) => issue.request_id === request.id)
  
  return (
    <div className="print-container">
      <div className="print-ticket">
        <div className="header">
          <h1>Material Request Ticket</h1>
          <p>MES System Generated</p>
        </div>
        
        <div className="details-grid">
          <div className="detail-item">
            <strong>Request ID</strong>
            {request.id}
          </div>
          <div className="detail-item">
            <strong>Date / Time</strong>
            {new Date().toLocaleString()}
          </div>
          <div className="detail-item">
            <strong>Target Product</strong>
            {request.product_code}
          </div>
          <div className="detail-item">
            <strong>Requested Qty</strong>
            {fmtQty(request.requested_qty)} {request.unit_code}
          </div>
          <div className="detail-item">
            <strong>Source Team</strong>
            {request.source_team || 'N/A'}
          </div>
          <div className="detail-item">
            <strong>Priority</strong>
            {request.priority}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Material Code</th>
              <th>Required Quantity</th>
              <th>Staged Quantity</th>
            </tr>
          </thead>
          <tbody>
            {matching.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: '20px' }}>No raw materials defined</td>
              </tr>
            )}
            {matching.map(issue => (
              <tr key={issue.id}>
                <td>{issue.material_code}</td>
                <td>{fmtQty(issue.requested_qty)} {issue.unit_code}</td>
                <td>{issue.staged_qty != null ? fmtQty(Number(issue.staged_qty)) : '0'} {issue.unit_code}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="signatures">
          <div className="sig-line">Requested By</div>
          <div className="sig-line">Approved By</div>
          <div className="sig-line">Issued By</div>
        </div>
      </div>
    </div>
  )
}

function RoleManagement({
  roles,
  submitAction,
}: {
  roles: Role[]
  submitAction: <T>(action: Promise<T>, message: string) => Promise<boolean>
}) {
  const [form, setForm] = useState({ code: '', name: '', permissions: [] as string[] })
  const [editingCode, setEditingCode] = useState<string | null>(null)

  const isEditing = editingCode !== null

  function resetForm() {
    setEditingCode(null)
    setForm({ code: '', name: '', permissions: [] })
  }

  function editRole(role: Role) {
    setEditingCode(role.code)
    try {
      setForm({ code: role.code, name: role.name, permissions: JSON.parse(role.permissions) })
    } catch {
      setForm({ code: role.code, name: role.name, permissions: [] })
    }
  }

  async function saveRole(event: FormEvent) {
    event.preventDefault()
    const payload = {
      code: form.code,
      name: form.name,
      permissions: JSON.stringify(form.permissions)
    }
    const saved = await submitAction(
      isEditing ? putJson(`/api/admin/roles/${editingCode}`, payload) : postJson('/api/admin/roles', payload),
      isEditing ? 'Role updated' : 'Role created',
    )
    if (saved) resetForm()
  }

  async function deleteRole(role: Role) {
    if (role.code === 'admin') return alert('Cannot delete the built-in admin role')
    const confirmed = window.confirm(`Delete role ${role.name}? This will fail if users are still assigned to it.`)
    if (!confirmed) return

    const deleted = await submitAction(api(`/api/admin/roles/${role.code}`, { method: 'DELETE' }), 'Role deleted')
    if (deleted && editingCode === role.code) resetForm()
  }

  const availablePermissions = tabs.map(t => ({ key: t.key, label: t.label }))

  return (
    <div className="grid-two">
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title={isEditing ? 'Edit Role' : 'Create Role'} />
        <form className="form-grid" onSubmit={saveRole}>
          <TextInput label="Role Code" value={form.code} onChange={(value) => setForm({ ...form, code: value })} required={!isEditing} disabled={isEditing} />
          <TextInput label="Role Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
          <div className="span-two">
            <strong>Permissions (Tabs)</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              {availablePermissions.map(p => (
                <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'normal' }}>
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(p.key)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setForm({ ...form, permissions: [...form.permissions, p.key] })
                      } else {
                        setForm({ ...form, permissions: form.permissions.filter(k => k !== p.key) })
                      }
                    }}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
          <div className="button-row span-two">
            <button className="primary-button" type="submit">
              {isEditing ? 'Update Role' : 'Create Role'}
            </button>
            {isEditing && (
              <button type="button" onClick={resetForm}>
                <XCircle size={16} />
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="panel wide">
        <PanelTitle icon={ShieldCheck} title="Role Definitions" />
        <table className="user-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Permissions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.code}>
                <td data-label="Code"><strong>{role.code}</strong></td>
                <td data-label="Name">{role.name}</td>
                <td data-label="Permissions" style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
                  {(() => {
                    try {
                      return JSON.parse(role.permissions).join(', ')
                    } catch {
                      return role.permissions
                    }
                  })()}
                </td>
                <td data-label="Actions">
                  <div className="table-actions">
                    <button onClick={() => editRole(role)} title="Edit">
                      <Settings size={16} />
                    </button>
                    {role.code !== 'admin' && (
                      <button className="danger" onClick={() => deleteRole(role)} title="Delete">
                        <XCircle size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

export default App
