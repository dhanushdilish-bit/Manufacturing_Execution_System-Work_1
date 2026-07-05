import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const db = new DatabaseSync(path.join(process.cwd(), 'data', 'mes.sqlite'));

db.exec('BEGIN');

// Find the injected receipts
const injectedReceipts = db.prepare(`SELECT id FROM rm_receipts WHERE supplier = 'Auto Injector'`).all();
const injectedIds = injectedReceipts.map(r => r.id);

if (injectedIds.length > 0) {
  // Find all issues that were allocated from these receipts
  const allocatedIssues = db.prepare(`
    SELECT DISTINCT issue_id FROM rm_issue_allocations
    WHERE receipt_id IN (${injectedIds.join(',')})
  `).all();
  const issueIds = allocatedIssues.map(i => i.issue_id);

  if (issueIds.length > 0) {
    // Revert rm_issues to PENDING
    db.prepare(`
      UPDATE rm_issues SET status = 'PENDING'
      WHERE id IN (${issueIds.join(',')})
    `).run();

    // Revert the parent production requests to PENDING_RM_APPROVAL
    db.prepare(`
      UPDATE production_requests SET status = 'PENDING_RM_APPROVAL', approved_by = NULL, approved_at = NULL
      WHERE id IN (
        SELECT request_id FROM rm_issues WHERE id IN (${issueIds.join(',')})
      )
    `).run();
    
    // Delete allocations
    db.prepare(`
      DELETE FROM rm_issue_allocations
      WHERE receipt_id IN (${injectedIds.join(',')})
    `).run();
  }

  // Delete the receipts
  db.prepare(`DELETE FROM rm_receipts WHERE supplier = 'Auto Injector'`).run();
  
  console.log('Successfully reverted allocations and removed injected inventory.');
} else {
  console.log('No injected inventory found.');
}

db.exec('COMMIT');
