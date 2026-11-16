# Snack Counter Automation

**Framsikt — Product Engineer, Phase 1 Assignment**  
**Author:** Muskan Vaish

Automates the snack counter refill and reimbursement lifecycle across Framsikt's Oslo and Bengaluru offices.

## Quick start

```bash
# Run the demo (full lifecycle walkthrough)
tsx src/index.ts

# Run all tests
tsx --test tests/refill.test.ts
```

Requires Node ≥ 22 and `tsx` installed globally (`npm install -g tsx`).

## Project structure

```
src/
  types.ts                  — all types & constants
  services/
    RefillService.ts        — core lifecycle (the brain)
    BudgetService.ts        — monthly budget tracking per office
    ChatService.ts          — simulated chat notifications
    HRService.ts            — simulated HR reimbursement system
  index.ts                  — demo run
tests/
  refill.test.ts            — 9 tests covering the 3 required rules
design-doc.md               — 2-page design document
```

## Tests

```
✓ Rule 1 — two volunteers cannot both commit to the same refill (2 tests)
✓ Rule 2 — a refill nobody completes is handed to someone else (2 tests)
✓ Rule 3 — budgets and totals are correct across both currencies (4 tests)
✓ Happy path — full refill lifecycle (1 test)

9 tests, 0 failures
```

See [design-doc.md](./design-doc.md) for the full design, trade-offs, and what was deliberately not built.
