# Snack Counter Automation — Design Document

**Author:** Muskan Vaish  
**Assignment:** Framsikt — Product Engineer, Phase 1  
**Date:** November 2026

---

## 1. The core flow

A refill moves through five states:

```
EMPTY → ASSIGNED → PURCHASED → REIMBURSEMENT_SUBMITTED → REIMBURSED
```

| Trigger | Who does it | What happens |
|---|---|---|
| Someone reports a box empty | Any employee | `Refill` record created; volunteer assigned; chat notification sent |
| Volunteer confirms purchase + submits receipt | Assigned volunteer | Spend logged against budget; HR claim created automatically |
| HR approves the claim | External HR system | Volunteer gets a "you've been reimbursed" chat notification |

If the assigned volunteer does not mark a purchase within **24 hours**, a scheduled job reassigns the refill to the next volunteer (round-robin).

---

## 2. Main parts and the data each keeps

### `SnackBox`
Tracks each physical box: `id`, `name`, `office`, `status` (`STOCKED` | `EMPTY`).

### `Volunteer`
One record per volunteer: `id`, `name`, `office`, `employeeId` (used by HR for payroll reimbursement).

### `Refill`
The central event record. Fields:

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Unique refill ID (`RF-NNNN`) |
| `boxId` | string | Which box was empty |
| `office` | Oslo \| Bengaluru | Determines currency and budget |
| `status` | RefillStatus | Current lifecycle stage |
| `assignedTo` | string? | Volunteer ID |
| `assignedAt` | Date? | Used to detect 24-hour timeout |
| `amount` | number? | Actual purchase amount |
| `currency` | NOK \| INR | Set from office at assignment |
| `hrClaimId` | string? | Reference to external HR claim |

### `BudgetService`
Keeps a `Map<"office:YYYY-MM", number>` of spend per office per month. Checks every potential assignment against the monthly cap before committing.

### `ChatService` (simulated)
Wraps the real chat API (Slack / Teams). Current stub logs all messages and stores them so tests can assert on them.

### `HRService` (simulated)
Wraps the external HR reimbursement API. Accepts `(employeeId, amount, currency, description, receiptImageUrl)`, returns a claim ID. Status transitions from `PENDING` → `APPROVED` / `REJECTED`.

---

## 3. How the problems are prevented

| Problem | Solution |
|---|---|
| **Box sits empty** | Reporting is immediate; system assigns and notifies in the same call. 24-hour reassignment ensures it never stalls. |
| **Two people buy the same box** | An in-memory lock (`assigningNow: Set<string>`) prevents concurrent assignment of the same refill. Idempotent `reportEmpty` returns the existing active refill if one already exists for a box. |
| **Same person always buys** | Round-robin volunteer selection, with the pointer persisted per office. |
| **Slow reimbursement** | HR claim is submitted automatically the moment the volunteer marks a purchase — zero manual steps. |
| **No spend visibility** | Every purchase is recorded in `BudgetService` with the month key. A `monthlyReport()` call returns a row per office in its native currency. |

---

## 4. Trade-offs

**Single-process in-memory locking** — The `assigningNow` Set prevents race conditions within one process. This is correct for a single-instance service. For horizontal scale, replace with a database row lock (`SELECT … FOR UPDATE`) or a Redis `SETNX` lock on the refill ID. I chose the simpler approach because the assignment spec doesn't mention multi-instance deployment and I wanted the solution to be self-contained.

**Estimated cost for budget check** — Before assignment, I use the top of the typical purchase range (1,200 NOK / 3,000 INR) as a conservative estimate, because we don't know the actual cost yet. This slightly over-guards the budget but prevents the system from assigning a refill it can't actually pay for. A leaner approach would let the volunteer name the price first, but that adds a conversational round-trip.

**Polling for HR approval** — `checkAndMarkReimbursed` is currently called explicitly (or on a timer). In production, the HR system would push a webhook on approval, which removes the polling delay. Webhook handling is straightforward to add: one HTTP endpoint that calls this method.

---

## 5. What I deliberately did not build

- **A UI or API layer** — the assignment asks for core logic; a REST or GraphQL layer would be a natural next step but adds noise for this evaluation.
- **Persistent storage** — data lives in memory. Adding PostgreSQL (a `refills` table, a `budget_spend` table) is the obvious production step.
- **Receipt image upload / storage** — the system accepts a URL; a real implementation would need an S3 or GCS bucket and a presigned URL flow.
- **Volunteer opt-out / holiday calendar** — the assignment doesn't mention this and adding it would bloat scope without illuminating reasoning.
- **Approval workflow within the app** — for who should be able to approve a refill, increase a budget cap, etc. Worth discussing but not part of the stated problem.

---

## 6. Running the code

```bash
# Prerequisites: Node ≥ 22, tsx installed globally
# (tsx and typescript are pre-installed in this environment)

# Demo run (shows full lifecycle)
tsx src/index.ts

# Tests (30 tests, 0 failures)
tsx --test tests/refill.test.ts
```
