/**
 * index.ts — Demo run showing the full snack counter lifecycle.
 *
 * Run with: tsx src/index.ts
 */

import { BudgetService } from './services/BudgetService.js';
import { ChatService } from './services/ChatService.js';
import { HRService } from './services/HRService.js';
import { RefillService } from './services/RefillService.js';

// ─── Bootstrap services ───────────────────────────────────────────────────────

const budget = new BudgetService();
const chat = new ChatService();
const hr = new HRService();
const refillService = new RefillService(budget, chat, hr);

// ─── Register boxes ───────────────────────────────────────────────────────────

refillService.registerBox({ id: 'box-oslo-1', name: 'Chips & Nuts', office: 'Oslo', status: 'STOCKED' });
refillService.registerBox({ id: 'box-oslo-2', name: 'Chocolate Bar', office: 'Oslo', status: 'STOCKED' });
refillService.registerBox({ id: 'box-blr-1', name: 'Namkeen Mix', office: 'Bengaluru', status: 'STOCKED' });

// ─── Register volunteers ──────────────────────────────────────────────────────

refillService.registerVolunteer({ id: 'v-1', name: 'Erik',   office: 'Oslo',      employeeId: 'EMP-101' });
refillService.registerVolunteer({ id: 'v-2', name: 'Ingrid', office: 'Oslo',      employeeId: 'EMP-102' });
refillService.registerVolunteer({ id: 'v-3', name: 'Priya',  office: 'Bengaluru', employeeId: 'EMP-201' });
refillService.registerVolunteer({ id: 'v-4', name: 'Rahul',  office: 'Bengaluru', employeeId: 'EMP-202' });

// ─── Simulate the lifecycle ───────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════');
console.log(' SNACK COUNTER AUTOMATION — demo run');
console.log('═══════════════════════════════════════════════════\n');

// 1. Someone reports the Oslo chips box is empty
console.log('--- Step 1: Oslo box reported empty ---');
const refill = refillService.reportEmpty('box-oslo-1');
console.log(`Refill created: ${refill.id}, status: ${refill.status}\n`);

// 2. Erik (the assigned volunteer) buys the snacks and submits the receipt
console.log('--- Step 2: Volunteer purchases snacks ---');
const purchased = refillService.markPurchased(refill.id, refill.assignedTo!, 850, 'https://receipts.example.com/r-001.jpg');
console.log(`Refill ${purchased.id} status: ${purchased.status}, amount: ${purchased.amount} ${purchased.currency}\n`);

// 3. HR approves the claim
console.log('--- Step 3: HR approves reimbursement ---');
hr.approveClaim(purchased.hrClaimId!);
refillService.checkAndMarkReimbursed(purchased.id);
console.log(`Refill ${purchased.id} final status: ${refillService.getRefill(purchased.id)?.status}\n`);

// 4. Monthly spending report
console.log('--- Step 4: Monthly spending report ---');
const report = budget.monthlyReport();
for (const row of report) {
  console.log(
    `  ${row.office}: ${row.spent} / ${row.limit} ${row.currency} spent (${row.remaining} remaining)`,
  );
}

// 5. Show all chat messages sent
console.log('\n--- Chat messages sent ---');
for (const msg of chat.getMessages()) {
  console.log(`  [${msg.to}] ${msg.message}`);
}
