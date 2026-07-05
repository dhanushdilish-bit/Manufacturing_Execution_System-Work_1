import type { WorkflowData } from './types'

export function getProductionTrend(workflow: WorkflowData) {
  const trend: Record<string, number> = {}
  const now = new Date()
  
  // Initialize last 7 days with 0
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    trend[d.toISOString().substring(0, 10)] = 0
  }

  workflow.productionRuns.forEach(run => {
    if (run.started_at) {
      const date = run.started_at.substring(0, 10)
      if (trend[date] !== undefined) {
        trend[date] += Number(run.quantity_produced) || 0
      } else {
        // If it's an older date, we could add it, but for a 7-day chart let's stick to initialized or add dynamically
        trend[date] = (trend[date] || 0) + (Number(run.quantity_produced) || 0)
      }
    }
  })

  // Sort and take last 7 or just map
  return Object.entries(trend)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([date, quantity]) => ({
      date: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      quantity: Math.round(quantity)
    }))
}

export function getQcYield(workflow: WorkflowData) {
  let passed = 0
  let failed = 0
  let pending = 0

  workflow.rmReceipts.forEach(receipt => {
    if (['APPROVED', 'PENDING_QA'].includes(receipt.status)) passed++
    else if (['PENDING_QC2', 'REJECTED', 'HOLD'].includes(receipt.status)) failed++
    else pending++
  })

  return [
    { name: 'Passed', value: passed, fill: '#10b981' },
    { name: 'Failed/Held', value: failed, fill: '#ef4444' },
    { name: 'Pending', value: pending, fill: '#f59e0b' }
  ].filter(item => item.value > 0)
}

export function getTargetVsActual(workflow: WorkflowData) {
  const activeTargets = workflow.productionTargets.filter(t => t.status === 'ACTIVE')
  
  return activeTargets.map(target => {
    // Sum production runs for this target's product
    const actual = workflow.productionRuns
      .filter(run => run.product_id === target.product_id)
      .reduce((sum, run) => sum + (Number(run.quantity_produced) || 0), 0)
      
    return {
      product: target.product_code,
      Target: Number(target.target_qty),
      Actual: actual
    }
  })
}

export function getWasteTrend(workflow: WorkflowData) {
  // Take the last 15 runs
  const recentRuns = [...workflow.productionRuns]
    .sort((a, b) => a.id - b.id)
    .slice(-15)

  return recentRuns.map(run => ({
    name: `Run #${run.id}`,
    'Runner Waste': Number(run.runner_waste_kg) || 0,
    'Purge Waste': Number(run.purge_waste_kg) || 0,
    'Rejected Pieces': Number(run.rejected_pieces) || 0,
  }))
}
