/**
 * HRService — simulated stand-in for the external HR / reimbursement system.
 *
 * In production this would call a real HR API.
 * Here it auto-generates claim IDs and exposes methods to simulate
 * approval and rejection so tests can drive both paths.
 */

import { Currency, HRClaim, HRClaimStatus } from '../types.js';

export class HRService {
  private claims: Map<string, HRClaim> = new Map();
  private nextId = 1;

  /**
   * Submit a reimbursement claim.
   * Returns the claim ID which the system stores so it can track approval later.
   */
  submitClaim(
    employeeId: string,
    amount: number,
    currency: Currency,
    description: string,
    receiptImageUrl: string,
  ): string {
    const id = `HR-${String(this.nextId++).padStart(4, '0')}`;
    const claim: HRClaim = {
      id,
      employeeId,
      amount,
      currency,
      description,
      receiptImageUrl,
      status: 'PENDING',
      submittedAt: new Date(),
    };
    this.claims.set(id, claim);
    console.log(
      `[HR] Claim ${id} submitted — ${amount} ${currency} for employee ${employeeId}`,
    );
    return id;
  }

  /**
   * Check the status of a previously submitted claim.
   */
  getClaimStatus(claimId: string): HRClaimStatus {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`Unknown HR claim: ${claimId}`);
    return claim.status;
  }

  /**
   * Simulate HR approval (in real life this happens asynchronously in 1–10 days).
   * Idempotent — approving an already-approved claim is a no-op.
   */
  approveClaim(claimId: string): void {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`Unknown HR claim: ${claimId}`);
    if (claim.status === 'APPROVED') return; // idempotent
    if (claim.status === 'REJECTED') {
      throw new Error(`Cannot approve claim ${claimId} — it has already been REJECTED`);
    }
    claim.status = 'APPROVED';
    claim.resolvedAt = new Date();
    console.log(`[HR] Claim ${claimId} APPROVED`);
  }

  /**
   * Simulate HR rejecting a claim (e.g. missing receipt, wrong amount).
   * Idempotent — rejecting an already-rejected claim is a no-op.
   */
  rejectClaim(claimId: string, reason: string): void {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`Unknown HR claim: ${claimId}`);
    if (claim.status === 'REJECTED') return; // idempotent
    if (claim.status === 'APPROVED') {
      throw new Error(`Cannot reject claim ${claimId} — it has already been APPROVED`);
    }
    claim.status = 'REJECTED';
    claim.rejectionReason = reason;
    claim.resolvedAt = new Date();
    console.log(`[HR] Claim ${claimId} REJECTED — ${reason}`);
  }

  /**
   * Return one claim by id.
   */
  getClaim(claimId: string): HRClaim | undefined {
    return this.claims.get(claimId);
  }

  /**
   * Return all claims (for testing / reporting).
   */
  getAllClaims(): HRClaim[] {
    return [...this.claims.values()];
  }

  /**
   * Clear all claims (useful between tests).
   */
  clear(): void {
    this.claims.clear();
    this.nextId = 1;
  }
}
