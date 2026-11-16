// ─── Office & Currency ────────────────────────────────────────────────────────

export type Office = 'Oslo' | 'Bengaluru';
export type Currency = 'NOK' | 'INR';

export const OFFICE_CURRENCY: Record<Office, Currency> = {
  Oslo: 'NOK',
  Bengaluru: 'INR',
};

// ─── Monthly budgets (from assignment spec) ───────────────────────────────────

export const MONTHLY_BUDGET: Record<Office, number> = {
  Oslo: 6000,       // NOK
  Bengaluru: 15000, // INR
};

// Estimated max cost per purchase — used for the pre-assignment budget check.
// If the volunteer's actual spend exceeds this, it is still recorded (we can't
// reverse a purchase already made), but a warning is logged.
export const ESTIMATED_MAX_COST: Record<Office, number> = {
  Oslo: 1200,      // top of typical 300–1200 NOK range
  Bengaluru: 3000, // top of typical 500–3000 INR range
};

// ─── How long before we reassign an unresponded refill ────────────────────────

export const ASSIGNMENT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Snack box ────────────────────────────────────────────────────────────────

export type BoxStatus = 'STOCKED' | 'EMPTY';

export interface SnackBox {
  id: string;
  name: string;
  office: Office;
  status: BoxStatus;
}

// ─── Volunteer (the person who buys snacks) ───────────────────────────────────

export interface Volunteer {
  id: string;
  name: string;
  office: Office;
  employeeId: string; // used by HR system for reimbursement
}

// ─── Refill lifecycle ─────────────────────────────────────────────────────────
//
//   EMPTY → ASSIGNED → PURCHASED → REIMBURSEMENT_SUBMITTED → REIMBURSED
//                ↓
//          (timeout) → reassigned to next volunteer (back to ASSIGNED)
//
//   REIMBURSEMENT_SUBMITTED → HR_REJECTED (if HR rejects the claim)

export type RefillStatus =
  | 'EMPTY'                   // box reported empty, not yet assigned
  | 'ASSIGNED'                // volunteer committed to buy
  | 'PURCHASED'               // volunteer bought and submitted receipt
  | 'REIMBURSEMENT_SUBMITTED' // HR claim created, awaiting approval
  | 'REIMBURSED'              // HR approved, volunteer paid back
  | 'HR_REJECTED'             // HR rejected the claim — needs manual resolution
  | 'CANCELLED';              // budget exceeded or no volunteers available

export interface Refill {
  id: string;
  boxId: string;
  office: Office;
  status: RefillStatus;
  assignedTo?: string;        // Volunteer.id
  assignedAt?: Date;
  purchasedAt?: Date;
  amount?: number;
  currency?: Currency;
  receiptImageUrl?: string;
  hrClaimId?: string;
  overBudget?: boolean;       // true if actual purchase exceeded the monthly budget
  createdAt: Date;
  updatedAt: Date;
}

// ─── Budget tracking ──────────────────────────────────────────────────────────

export interface MonthlySpend {
  office: Office;
  month: string; // "YYYY-MM"
  spent: number;
  currency: Currency;
  limit: number;
  remaining: number;
}

// ─── HR Service interfaces ────────────────────────────────────────────────────

export type HRClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface HRClaim {
  id: string;
  employeeId: string;
  amount: number;
  currency: Currency;
  description: string;
  receiptImageUrl: string;
  status: HRClaimStatus;
  submittedAt: Date;
  resolvedAt?: Date;
  rejectionReason?: string;
}

// ─── Chat message ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  to: string; // Volunteer.id
  message: string;
  sentAt: Date;
}
