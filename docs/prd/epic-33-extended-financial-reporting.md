# Epic 33: Extended Financial Reporting Suite

### Epic Goal
Cover the standard financial statements and analysis reports a small business (and its accountant) needs beyond the general ledger and journal already covered by Epic 30.

### Epic Description
Epic 30 only names "General Ledger" and "Journal Report" as stories, but the accounting module ships a full report suite plus a chart-of-accounts data export for external accounting software.

### Stories

1. **Story 1: Core Financial Statements**
   * **Description:** Profit &amp; Loss, Balance Sheet, and Trial Balance reports generated from live ledger data.
   * Status: Done — `GET accounting/reports/profit-loss|balance-sheet|trial-balance`, `accounting/reports/pl|balance-sheet|trial-balance` (frontend).

2. **Story 2: Receivables &amp; Payables Aging**
   * **Description:** AR and AP aging reports bucketing outstanding balances by age.
   * Status: Done — `GET accounting/reports/ar-aging|ap-aging`, matching frontend pages.

3. **Story 3: Comparative &amp; Ratio Analysis**
   * **Description:** Period-over-period comparative P&amp;L and a financial-ratios report.
   * Status: Done — `GET accounting/reports/comparative-pl|financial-ratios`.

4. **Story 4: Tax &amp; Cash Reporting**
   * **Description:** VAT/tax report, cash-flow statement (premium-gated by `premiumAccountingAdvanced`), and cashbook/bankbook registers.
   * Status: Done — `GET accounting/reports/vat-tax|cash-flow|cashbook|bankbook`.

5. **Story 5: Chart-of-Accounts Export (Tally/QuickBooks)**
   * **Description:** Exports general-ledger data to Tally XML or QuickBooks IIF format for tenants migrating to or reconciling against third-party accounting software.
   * Status: Done — `GET accounting/export`.

### Notes
All five stories reflect what's already implemented; this file only closes the documentation gap — no functional changes accompany it.
