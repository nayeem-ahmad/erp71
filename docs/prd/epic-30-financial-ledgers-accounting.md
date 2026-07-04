# Epic 30: Financial Ledgers & Core Accounting

### Epic Goal
Implement a robust double-entry accounting system that tracks every monetary transaction within the business through standardized vouchers and ledgers.

### Epic Description
This epic is the financial core of the platform. It enables store owners to move beyond simple sales tracking to full financial management, including cash flow, bank reconciliations, and internal fund transfers.

**Standard Voucher Types:**
*   **Cash Payment / Receive:** For all transactions involving physical cash.
*   **Bank Payment / Receive:** For transactions via bank transfer or mobile wallets (bKash, etc.).
*   **Fund Transfer:** For internal movements between Cash and Bank accounts.
*   **Journal Voucher:** For general adjustments and non-cash/bank entries.

**Key Reports:**
*   **General Ledger:** A detailed transaction history for any specific account (e.g., "Cash in Hand"), showing a running balance.
*   **Journal Report:** A chronological list of all vouchers with their full multi-row details.

**Stories:**
1. **Story 1: Chart of Accounts (COA) Setup** - Interface to define Asset, Liability, Equity, Revenue, and Expense accounts.
2. **Story 2: Multi-Row Voucher Entry** - A standardized entry form where users can select accounts and enter debits/credits. Must ensure the voucher balances (Debits = Credits) before saving.
3. **Story 3: Automated Voucher Numbering** - Sequential, tenant-specific voucher numbers (e.g., CP-001, BR-052).
4. **Story 4: Real-time Ledger Generation** - API logic to calculate running balances for any account across a date range.
5. **Story 5: Journal Viewer** - A comprehensive list view of all vouchers with advanced filtering by type and date.

6. **Story 6: Voucher Attachments & Required Narration** - Every voucher can carry file attachments (receipts, invoices, bank slips) uploaded client-side and stored by URL reference (image/PDF/Word, 10MB limit); the backend requires a non-empty narration/description on every voucher before it will save. Status: Done — `VoucherAttachment` model, `apps/frontend/src/components/accounting/VoucherAttachments.tsx`, narration check in `validateVoucherDetails()`.

7. **Story 7: General-Purpose Loan/Advance Ledger** - A double-entry loan register for any counterparty (bank, owner, supplier, or informally an employee via free text) — not employee-specific despite overlapping with HR — with a `direction` (payable/receivable), interest rate (informational only), and automatic voucher posting through the same rule-based engine used for sales/purchase auto-posting. Status: Done — `apps/backend/src/loans/`, `apps/frontend/src/app/(app)/accounting/loans/page.tsx`.

**Scope Note:**
Cross-module auto-posting from Sales, Purchase, and Inventory events through configurable account mappings is covered in Epic 31. Fiscal period locking, budgets, cost centers, fixed assets, recurring vouchers, and bank reconciliation are covered in Epic 32. The extended report suite (P&L, balance sheet, trial balance, aging, VAT, ratios, cashbook/bankbook, GL export) is covered in Epic 33.
