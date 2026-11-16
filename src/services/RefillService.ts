/**
 * RefillService — the core automation brain.
 *
 * Manages the full refill lifecycle:
 *   EMPTY → ASSIGNED → PURCHASED → REIMBURSEMENT_SUBMITTED → REIMBURSED
 *                                                           → HR_REJECTED
 *
 * Edge cases handled:
 *   - Duplicate reportEmpty for same box returns existing active refill
 *   - In-memory lock (assigningNow Set) prevents concurrent assignment of the same refill
 *   - Only 1 volunteer in office: timeout reassigns to same person (no infinite loop)
 *   - markPurchased rejects calls from non-assigned volunteer
 *   - markPurchased rejects amount ≤ 0
 *   - If actual purchase exceeds remaining monthly budget, it is recorded with a
 *     warning (can't reverse a purchase already made)
 *   - HR rejection transitions refill to HR_REJECTED and notifies volunteer
 *   - checkAndMarkReimbursed handles both APPROVED and REJECTED HR outcomes
 *
 * Design trade-offs:
 *   - In-memory locking is correct for single-process. For horizontal scale use
 *     a database row lock (SELECT … FOR UPDATE) or Redis SETNX.
 *   - Budget is checked pre-assignment using the typical maximum purchase cost.
 *     If the volunteer spends more, it is recorded with a warning.
 */

import {
  ASSIGNMENT_TIMEOUT_MS,
  ESTIMATED_MAX_COST,
  OFFICE_CURRENCY,
  Office,
  Refill,
  RefillStatus,
  SnackBox,
  Volunteer,
} from '../types.js';
import { BudgetService } from './BudgetService.js';
import { ChatService } from './ChatService.js';
import { HRService } from './HRService.js';

export class RefillService {
  private boxes: Map<string, SnackBox> = new Map();
  private volunteers: Map<string, Volunteer> = new Map();
  private refills: Map<string, Refill> = new Map();

  /**
   * Tracks which refill IDs are currently in the assignment phase.
   * Acts as a mutex: if two callers try to assign the same refill at once,
   * the second one finds the id already in this set and backs off.
   */
  private assigningNow: Set<string> = new Set();

  // Round-robin pointer per office
  private volunteerIndex: Record<Office, number> = { Oslo: 0, Bengaluru: 0 };

  private nextRefillId = 1;

  constructor(
    private readonly budget: BudgetService,
    private readonly chat: ChatService,
    private readonly hr: HRService,
  ) {}

  // ─── Setup helpers ──────────────────────────────────────────────────────────

  registerBox(box: SnackBox): void {
    this.boxes.set(box.id, box);
  }

  registerVolunteer(v: Volunteer): void {
    this.volunteers.set(v.id, v);
  }

  // ─── Step 1: Box reported empty ─────────────────────────────────────────────

  /**
   * Called when someone reports a box is empty.
   * Idempotent: if an active refill already exists for the box, returns it.
   * Creates a Refill record and immediately tries to assign a volunteer.
   */
  reportEmpty(boxId: string): Refill {
    const box = this.boxes.get(boxId);
    if (!box) throw new Error(`Unknown box: ${boxId}`);

    // Idempotency: return the existing active refill if one exists.
    const existing = this.getActiveRefillForBox(boxId);
    if (existing) {
      console.log(
        `[Refill] Box ${boxId} already has an active refill (${existing.id}) — returning it`,
      );
      return existing;
    }

    const id = `RF-${String(this.nextRefillId++).padStart(4, '0')}`;
    const now = new Date();
    const refill: Refill = {
      id,
      boxId,
      office: box.office,
      status: 'EMPTY',
      createdAt: now,
      updatedAt: now,
    };
    this.refills.set(id, refill);
    box.status = 'EMPTY';

    console.log(`[Refill] ${id} created for box "${box.name}" (${box.office})`);

    this.assignNextVolunteer(refill);
    return refill;
  }

  // ─── Step 2: Assign a volunteer ─────────────────────────────────────────────

  /**
   * Picks the next available volunteer for the refill's office.
   * Uses an in-memory lock to prevent concurrent assignment of the same refill.
   *
   * Returns true if assignment succeeded, false if blocked or cancelled.
   */
  assignNextVolunteer(refill: Refill): boolean {
    // ── Lock ──────────────────────────────────────────────────────────────────
    if (this.assigningNow.has(refill.id)) {
      console.log(
        `[Refill] ${refill.id} is already being assigned — concurrent call blocked`,
      );
      return false;
    }
    this.assigningNow.add(refill.id);

    try {
      const candidates = this.volunteersForOffice(refill.office);

      if (candidates.length === 0) {
        this.transition(refill, 'CANCELLED');
        console.log(
          `[Refill] ${refill.id} cancelled — no volunteers registered in ${refill.office}`,
        );
        return false;
      }

      // Budget check using estimated max cost (conservative).
      const estimatedCost = ESTIMATED_MAX_COST[refill.office];
      if (!this.budget.canAfford(refill.office, estimatedCost)) {
        this.transition(refill, 'CANCELLED');
        console.log(
          `[Refill] ${refill.id} cancelled — ${refill.office} budget exhausted`,
        );
        return false;
      }

      // Round-robin: pick next volunteer, wrapping around.
      // If only 1 volunteer and they timed out, they get reassigned to themselves.
      const idx = this.volunteerIndex[refill.office] % candidates.length;
      const volunteer = candidates[idx];
      this.volunteerIndex[refill.office] = (idx + 1) % candidates.length;

      refill.assignedTo = volunteer.id;
      refill.assignedAt = new Date();
      this.transition(refill, 'ASSIGNED');

      this.chat.sendMessage(
        volunteer.id,
        `Hi ${volunteer.name}! The "${this.boxes.get(refill.boxId)?.name}" snack box in ${refill.office} is empty. ` +
          `Could you buy it and submit your receipt? (Refill ID: ${refill.id})`,
      );

      console.log(`[Refill] ${refill.id} assigned to ${volunteer.name}`);
      return true;
    } finally {
      // ── Unlock ──────────────────────────────────────────────────────────────
      this.assigningNow.delete(refill.id);
    }
  }

  // ─── Step 3: Volunteer marks purchase done ──────────────────────────────────

  /**
   * Called when the assigned volunteer confirms purchase and provides receipt.
   *
   * Validates:
   *   - Only the assigned volunteer can call this
   *   - Amount must be > 0
   *   - Refill must be in ASSIGNED status
   *
   * Records actual spend even if it exceeds the remaining budget
   * (we can't reverse a purchase already made).
   */
  markPurchased(
    refillId: string,
    volunteerId: string,
    amount: number,
    receiptImageUrl: string,
  ): Refill {
    if (amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be greater than 0.`);
    }
    if (!receiptImageUrl || receiptImageUrl.trim() === '') {
      throw new Error(`Receipt image URL is required.`);
    }

    const refill = this.getRefillOrThrow(refillId);

    if (refill.status !== 'ASSIGNED') {
      throw new Error(
        `Cannot mark refill ${refillId} as purchased — current status is "${refill.status}". ` +
          `Only ASSIGNED refills can be marked as purchased.`,
      );
    }

    // Auth check: only the assigned volunteer can mark it purchased.
    if (refill.assignedTo !== volunteerId) {
      throw new Error(
        `Volunteer ${volunteerId} is not assigned to refill ${refillId}. ` +
          `Assigned to: ${refill.assignedTo}.`,
      );
    }

    const currency = OFFICE_CURRENCY[refill.office];

    // Check if actual spend exceeds remaining budget (can't block — purchase is done).
    const overBudget = !this.budget.canAfford(refill.office, amount);
    if (overBudget) {
      console.warn(
        `[Refill] ⚠️  ${refillId}: actual purchase (${amount} ${currency}) exceeds ` +
          `remaining monthly budget for ${refill.office}. Recording anyway.`,
      );
      refill.overBudget = true;
    }

    this.budget.recordSpend(refill.office, amount);

    refill.amount = amount;
    refill.currency = currency;
    refill.receiptImageUrl = receiptImageUrl;
    refill.purchasedAt = new Date();
    this.transition(refill, 'PURCHASED');

    // Mark box as stocked
    const box = this.boxes.get(refill.boxId);
    if (box) box.status = 'STOCKED';

    // Automatically submit reimbursement claim to HR
    this.submitReimbursement(refill);

    return refill;
  }

  // ─── Step 4: Submit HR reimbursement claim ───────────────────────────────────

  private submitReimbursement(refill: Refill): void {
    const volunteer = this.volunteers.get(refill.assignedTo!);
    if (!volunteer) throw new Error(`Volunteer not found for refill ${refill.id}`);

    const claimId = this.hr.submitClaim(
      volunteer.employeeId,
      refill.amount!,
      refill.currency!,
      `Snack box refill — ${this.boxes.get(refill.boxId)?.name} (${refill.office}) — Refill ${refill.id}`,
      refill.receiptImageUrl!,
    );

    refill.hrClaimId = claimId;
    this.transition(refill, 'REIMBURSEMENT_SUBMITTED');
  }

  // ─── Step 5: Poll HR outcome (approval or rejection) ────────────────────────

  /**
   * Check the HR claim and advance the refill to REIMBURSED or HR_REJECTED.
   * In production this would be triggered by an HR webhook, not polling.
   */
  checkAndMarkReimbursed(refillId: string): void {
    const refill = this.getRefillOrThrow(refillId);
    if (refill.status !== 'REIMBURSEMENT_SUBMITTED') return;

    const status = this.hr.getClaimStatus(refill.hrClaimId!);

    if (status === 'APPROVED') {
      this.transition(refill, 'REIMBURSED');
      this.chat.sendMessage(
        refill.assignedTo!,
        `Good news! Your reimbursement for refill ${refill.id} ` +
          `(${refill.amount} ${refill.currency}) has been approved by HR. 💰`,
      );
    } else if (status === 'REJECTED') {
      this.transition(refill, 'HR_REJECTED');
      const claim = this.hr.getClaim(refill.hrClaimId!);
      this.chat.sendMessage(
        refill.assignedTo!,
        `HR rejected your reimbursement claim for refill ${refill.id}. ` +
          `Reason: ${claim?.rejectionReason ?? 'not specified'}. ` +
          `Please contact the finance team to resolve this manually.`,
      );
      console.warn(
        `[Refill] ⚠️  ${refillId} HR_REJECTED — manual resolution required`,
      );
    }
    // PENDING: do nothing, check again later
  }

  // ─── Timeout / reassignment ─────────────────────────────────────────────────

  /**
   * Call on a schedule (e.g. every hour via cron).
   * Finds ASSIGNED refills past the 24-hour window and reassigns them.
   *
   * Edge case: if only 1 volunteer exists in the office, the same person gets
   * re-notified — there is no one else to pass it to.
   */
  checkAndReassignExpired(now?: Date): void {
    const cutoff = new Date((now ?? new Date()).getTime() - ASSIGNMENT_TIMEOUT_MS);

    for (const refill of this.refills.values()) {
      if (refill.status === 'ASSIGNED' && refill.assignedAt && refill.assignedAt < cutoff) {
        const prevVolunteer = refill.assignedTo!;
        const prevName = this.volunteers.get(prevVolunteer)?.name ?? prevVolunteer;

        console.log(
          `[Refill] ${refill.id} timed out — ${prevName} did not purchase within 24 h. Reassigning…`,
        );

        // Notify the previous volunteer that they've been relieved
        this.chat.sendMessage(
          prevVolunteer,
          `Your assignment for refill ${refill.id} has been reassigned ` +
            `because we didn't hear back within 24 hours. No worries!`,
        );

        // Reset to EMPTY so assignNextVolunteer can run fresh
        refill.status = 'EMPTY';
        refill.assignedTo = undefined;
        refill.assignedAt = undefined;

        this.assignNextVolunteer(refill);
      }
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  getRefill(refillId: string): Refill | undefined {
    return this.refills.get(refillId);
  }

  getAllRefills(): Refill[] {
    return [...this.refills.values()];
  }

  getRefillsByStatus(status: RefillStatus): Refill[] {
    return this.getAllRefills().filter((r) => r.status === status);
  }

  getActiveRefillForBox(boxId: string): Refill | undefined {
    const terminal: RefillStatus[] = ['REIMBURSED', 'HR_REJECTED', 'CANCELLED'];
    return this.getAllRefills().find(
      (r) => r.boxId === boxId && !terminal.includes(r.status),
    );
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private volunteersForOffice(office: Office): Volunteer[] {
    return [...this.volunteers.values()].filter((v) => v.office === office);
  }

  private transition(refill: Refill, status: RefillStatus): void {
    refill.status = status;
    refill.updatedAt = new Date();
  }

  private getRefillOrThrow(refillId: string): Refill {
    const r = this.refills.get(refillId);
    if (!r) throw new Error(`Unknown refill: ${refillId}`);
    return r;
  }
}
