# Epic 06: Referral & Affiliate Commission Program

### Epic Goal
Grow paid tenant signups through a platform-run referral/affiliate program: platform admins onboard commission-earning affiliates who each get a referral code, new tenants can sign up through that code for a discount, and the affiliate gets a self-service view of what they've earned and been paid.

### Epic Description
This epic was implemented directly against production needs (2026-07-02 → 2026-07-04) without a prior PRD entry. It introduces a `Referee` entity (the codebase's name for the affiliate/referral partner — distinct from the `Tenant`/`User` they refer) with its own commission ledger, plus a scoped self-service login so affiliates can track their own earnings without touching any tenant's business data.

**Integration Points:**
* **Data Models:** `Referee`, `Commission` (PENDING → EARNED → PAID), `Payment` — migration `20260704160000_add_referral_commission_system`.
* **Signup:** referral code field on the signup form, pre-filled from `?ref=`/`?referral=` query params, validated live via `GET /auth/referral-code/:code`.
* **Billing:** the referee's configured signup discount is applied at checkout; a commission is recorded against the referee for the resulting tenant.
* **Auth:** `Referee.user_id` links a referee to an auto-provisioned `User` account guarded by `RefereeGuard`; a dedicated invite email (not the generic password-reset email) bootstraps their first login.

**Success Criteria:**
1. A platform admin can create/edit a referee with a unique referral code, commission rate, and signup discount.
2. A new tenant can sign up via a referral code (link or manual entry) and receive the configured discount.
3. A commission record is created per referred signup and moves PENDING → EARNED when that tenant's invoice is paid, and → PAID when an admin records a payout.
4. Platform admins can view a full per-referee ledger (referrals, commissions, payments) and record manual payments.
5. Referees can log in to a dedicated, scoped `/referrals` dashboard to see their code, signup link, balance due, commission history, and payment history.

### Stories

1. **Story 1: Referee & Commission Data Model**
   * **Description:** Add `Referee`, `Commission`, and `Payment` models with commission state machine (PENDING/EARNED/PAID) and Prisma migration.
   * Status: Done — `packages/database/prisma/schema.prisma`, migration `20260704160000_add_referral_commission_system`.

2. **Story 2: Platform Admin Referee Management**
   * **Description:** CRUD for referees (create/edit/list/detail, resend login invite) restricted to platform admins.
   * Status: Done — `apps/backend/src/referrals/referrals.controller.ts` (`/admin/referrals/referees*`), `apps/frontend/src/app/(app)/admin/referrals/`.

3. **Story 3: Referral Code Application at Signup**
   * **Description:** Signup form accepts a referral code (manual entry or `?ref=`/`?referral=` link), validates it live, and applies the referee's signup discount at checkout.
   * Status: Done — `apps/frontend/src/app/signup/page.tsx`, public `GET /auth/referral-code/:code` endpoint.

4. **Story 4: Commission Ledger & Payouts**
   * **Description:** Per-referee commission ledger and manual payment recording; commission listing/filtering across all referees.
   * Status: Done — `referrals.service.ts` (`getLedger`, `recordPayment`, `listCommissions`), `apps/frontend/src/components/admin/referrals/RefereePaymentModal.tsx`.

5. **Story 5: Referee Self-Service Portal**
   * **Description:** Auto-provisioned login linked to `Referee.user_id`, dedicated invite email, scoped `/referrals` dashboard (copy code/signup link, balance due, commissions, payments), workspace chooser integration for users who are also referees.
   * Status: Done — `referee.guard.ts`, `referee-portal.controller.ts`, `apps/frontend/src/app/(app)/referrals/page.tsx`.

### Commission rules (as built)

These were implicit in the code and are stated here because they are the questions
partners actually ask.

**The commission is one-shot, not a recurring revenue share.** Both the signup
discount and the commission are gated on the referral being `PENDING`. Concretely:

* The discount applies to the referred tenant's **first paid invoice only**. It
  disappears once the commission is earned, so renewals are charged full price.
* The commission is earned **once**, when that tenant's first subscription becomes
  `ACTIVE`. Renewals earn the partner nothing.
* The discount applies to the **plan price only** — add-ons are always charged in
  full.

Moving to a recurring revenue share would mean a commission row per billing period
rather than one per tenant, so it is a data-model change and not a config toggle.

**Commission state machine.**

| State | Set when | Notes |
|---|---|---|
| `PENDING` | The referred tenant signs up with the code | Snapshots `discount_pct`/`commission_pct` off the referee, so later rate changes never rewrite history |
| `EARNED` | That tenant's subscription first becomes `ACTIVE` | Partner is notified by email |
| `PAID` | A platform admin records a payout that settles it | Partner is notified by email |
| `REVERSED` | The tenant's payment is refunded or charged back | Terminal — see below |

**Reversal is terminal.** A refunded referral does not return to `PENDING`, because
the signup discount it granted was already consumed and re-earning would pay the
same commission twice. If the commission had already been paid out, the reversal is
flagged `reversed_after_paid` and the amount nets against the partner's next payout
through the ledger's `overpaid_amount`.

**A partner cannot use their own code.** Self-referral is rejected at signup, checked
both by linked account and by email address.

**Payouts are reconciled.** A recorded payment defaults to exactly what the selected
commissions are worth; a different figure requires an explicit `allow_partial`.

### Notes
All five stories above were already fully implemented in code before this epic doc was written (see `TODO.md` entries dated 2026-07-02 through 2026-07-04). This file exists to close the documentation gap — no functional changes accompany it.

The **Commission rules** section above was added on 2026-08-04 alongside the
referral hardening work; the reversal state, self-referral guard, payout
reconciliation and partner notifications described there were built at that time,
while the one-shot behaviour predates it and was simply undocumented.

**Known open item:** the commission is currently calculated on the plan's **list
price**, not on the discounted amount the tenant actually paid. With a 10% discount
and a 10% commission the platform collects 90% and pays out 10% of gross — an 11.1%
effective rate. Whether the base should be gross or net revenue is a policy decision
and is tracked in `TODO.md`.
