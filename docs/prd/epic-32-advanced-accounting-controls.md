# Epic 32: Advanced Accounting Controls

### Epic Goal
Give accountants the closing-the-books controls that go beyond day-to-day voucher entry: locking finished periods, budgeting, cost-center scoping, fixed-asset depreciation, recurring postings, and bank reconciliation.

### Epic Description
These features extend Epic 30 (Financial Ledgers &amp; Core Accounting) but were built without their own PRD stories. Several are gated behind the `premiumAccountingAdvanced` plan feature; a few have real gaps worth tracking rather than papering over.

### Stories

1. **Story 1: Fiscal Period Lock/Unlock**
   * **Description:** An Owner/Accountant can lock a given month once bookkeeping is finalized, and unlock it later (Owner only). Periods for a fiscal year auto-generate on first access.
   * Status: Partial — lock state is fully recorded and displayed (`FiscalPeriod` model, `accounting/fiscal-periods/page.tsx`), but `is_locked` is not yet enforced anywhere — `createVoucher`/`updateVoucher`/`deleteVoucher` currently allow posting into a locked period.

2. **Story 2: Budgets &amp; Budget-vs-Actual**
   * **Description:** Per-account annual or monthly budget amounts (`AccountBudget`), compared against actual ledger activity for the period with variance in absolute and percentage terms. Gated behind `premiumAccountingAdvanced`.
   * Status: Done — `POST accounting/budgets`, `GET accounting/reports/budget-vs-actual`, `accounting/reports/budget-vs-actual/`.

3. **Story 3: Cost Centers &amp; Cost-Center P&amp;L**
   * **Description:** Voucher lines can be tagged with a `CostCenter` (department/branch/project); a scoped profit-and-loss report isolates only those tagged lines over a date range.
   * Status: Done — `GET/POST accounting/cost-centers`, `GET accounting/reports/cost-center-pl`, `accounting/cost-centers/page.tsx`.

4. **Story 4: Fixed Assets &amp; Depreciation**
   * **Description:** Tracks fixed assets (cost, residual value, useful life) and runs batch depreciation per period (straight-line or declining-balance), capped so accumulated depreciation never exceeds cost minus residual.
   * Status: Partial — `FixedAsset`/`AssetDepreciationEntry` models and the `run-depreciation` batch job work correctly, but no accounting voucher is actually posted for the depreciation (`voucher_id` stays null) — it updates the asset register without touching the general ledger.

5. **Story 5: Recurring Journals/Vouchers &amp; Voucher Templates**
   * **Description:** Two parallel scheduled-posting mechanisms — an older journal-specific one and a newer generic one covering any voucher type — both driven by frequency/next-due-date and manually triggered via a "post" action. Voucher templates are a separate, non-scheduled feature for pre-filling common line sets during manual entry.
   * Status: Done — `accounting/recurring-journals`, `accounting/recurring-vouchers`, `accounting/voucher-templates` (controllers + matching frontend pages).

6. **Story 6: Bank Reconciliation**
   * **Description:** Create a reconciliation session for a bank account, bulk-import statement lines (parsed client-side), auto-match them against ledger voucher lines by amount (±0.01) and date proximity (±2 days), manually reconcile any leftovers, and view a book-vs-statement balance report.
   * Status: Done — `accounting/bank-reconciliations*`, `accounting/reconciliation/page.tsx`.

### Notes
All stories reflect what's already implemented; this file only closes the documentation gap. Stories 1 and 4 flag real functional gaps (unenforced period locks, depreciation not posted to the GL) rather than claiming full completion — worth prioritizing as follow-up work, not just a docs fix.
