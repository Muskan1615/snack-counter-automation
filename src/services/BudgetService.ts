/**
 * BudgetService — tracks monthly snack spend per office.
 *
 * Rules (from assignment spec):
 *   - Oslo budget: 6,000 NOK / month
 *   - Bengaluru budget: 15,000 INR / month
 *   - Management wants one monthly cross-office report
 *
 * Edge cases handled:
 *   - Spend that exactly equals the remaining budget is ALLOWED (≤, not <)
 *   - `recordSpend` accepts an overBudget flag for cases where the volunteer
 *     already bought more than estimated (we can't reverse a purchase).
 *   - Each office's budget is fully independent — NOK and INR do not mix.
 */

import {
  Currency,
  MONTHLY_BUDGET,
  MonthlySpend,
  OFFICE_CURRENCY,
  Office,
} from '../types.js';

export class BudgetService {
  // key: "Office:YYYY-MM"
  private spendMap: Map<string, number> = new Map();

  private key(office: Office, month: string): string {
    return `${office}:${month}`;
  }

  currentMonth(): string {
    return new Date().toISOString().slice(0, 7); // "YYYY-MM"
  }

  /**
   * Check whether a purchase of `amount` can be made without exceeding the
   * monthly budget for the given office.
   *
   * Boundary: spent + amount <= limit  (exactly at limit is allowed).
   */
  canAfford(office: Office, amount: number, month?: string): boolean {
    if (amount <= 0) throw new Error(`Invalid amount: ${amount}. Must be > 0`);
    const m = month ?? this.currentMonth();
    const spent = this.spendMap.get(this.key(office, m)) ?? 0;
    return spent + amount <= MONTHLY_BUDGET[office];
  }

  /**
   * Record spend after a successful purchase.
   * Always records — even if the actual amount exceeds the budget — because
   * we can't un-buy snacks. The caller is responsible for logging a warning.
   */
  recordSpend(office: Office, amount: number, month?: string): void {
    if (amount <= 0) throw new Error(`Invalid amount: ${amount}. Must be > 0`);
    const m = month ?? this.currentMonth();
    const k = this.key(office, m);
    const prev = this.spendMap.get(k) ?? 0;
    this.spendMap.set(k, prev + amount);
    const currency: Currency = OFFICE_CURRENCY[office];
    const newTotal = prev + amount;
    const limit = MONTHLY_BUDGET[office];
    const marker = newTotal > limit ? ' ⚠️  OVER BUDGET' : '';
    console.log(
      `[Budget] ${office} ${m}: ${newTotal} / ${limit} ${currency} spent${marker}`,
    );
  }

  /**
   * Get current spend details for one office in the given month.
   */
  getSpend(office: Office, month?: string): MonthlySpend {
    const m = month ?? this.currentMonth();
    const spent = this.spendMap.get(this.key(office, m)) ?? 0;
    const limit = MONTHLY_BUDGET[office];
    return {
      office,
      month: m,
      spent,
      currency: OFFICE_CURRENCY[office],
      limit,
      remaining: limit - spent,
    };
  }

  /**
   * Monthly cross-office report (management requirement).
   * Returns one row per office for the given month.
   */
  monthlyReport(month?: string): MonthlySpend[] {
    const m = month ?? this.currentMonth();
    const offices: Office[] = ['Oslo', 'Bengaluru'];
    return offices.map((office) => this.getSpend(office, m));
  }

  /**
   * Reset all spend data (useful between tests).
   */
  clear(): void {
    this.spendMap.clear();
  }
}
