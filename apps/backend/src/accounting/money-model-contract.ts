/**
 * The census that makes a missing posting path fail loudly.
 *
 * POSTING_CONTRACT starts from the calls that EXIST, so a model that moves money
 * and never calls autoPostFromRules is invisible to it — that is exactly how
 * supplier payments, depreciation, salary, and cashier payouts each silently
 * skipped the ledger for months. This registry starts from the DATA MODEL, which
 * cannot hide: every model in schema.prisma with a `@db.Decimal` field must be
 * classified here, and money-model-contract.spec.ts fails the build if one is not.
 *
 * A new model with a money column therefore cannot merge until its author decides,
 * on the record, whether it posts (`postsVia`), legitimately does not (`exempt`),
 * or should but is not wired yet (`gap`). The `gap` entries double as a live,
 * test-enforced inventory of the remaining coverage work.
 *
 * WHEN YOU ADD A MODEL WITH A `@db.Decimal` FIELD, ADD IT HERE.
 */
export type MoneyModelEntry =
    // Rows of this model drive a posting through the named event type. For a
    // model whose money is a line/among many, `postsVia` marks the PARENT that
    // posts; the lines themselves are `exempt`.
    | { model: string; postsVia: string; note?: string }
    // This model's money legitimately never posts on its own. The reason is not
    // decoration — it is the argument a reviewer checks.
    | { model: string; exempt: string }
    // This model moves money that SHOULD reach the GL but does not yet. Tracked,
    // not hidden. Keep the TODO/spec reference current.
    | { model: string; gap: string };

export const MONEY_MODEL_CONTRACT: MoneyModelEntry[] = [
    // ── Posts a voucher ──────────────────────────────────────────────────────
    { model: 'Sale', postsVia: 'sale' },
    { model: 'SalesReturn', postsVia: 'sale_return' },
    { model: 'Purchase', postsVia: 'purchase' },
    { model: 'PurchaseOrder', postsVia: 'purchase', note: 'posts on receipt' },
    { model: 'PurchaseReturn', postsVia: 'purchase_return' },
    { model: 'ExpenseEntry', postsVia: 'expense' },
    { model: 'Loan', postsVia: 'loan_disbursement' },
    { model: 'LoanPayment', postsVia: 'loan_repayment' },
    { model: 'FundTransfer', postsVia: 'fund_transfer', note: 'inter-branch cash: initiate + receive legs, both through autoPostFromRules' },
    { model: 'AssetDepreciationEntry', postsVia: 'depreciation' },
    { model: 'CashTransaction', postsVia: 'cash_transaction', note: 'PAYOUT/LOAN post; DROP/OTHER post nothing by design' },
    { model: 'SalaryAccrual', postsVia: 'salary_accrual' },
    { model: 'SalaryPayment', postsVia: 'salary_payment' },
    { model: 'CustomerCreditTransaction', postsVia: 'customer_payment', note: 'PAYMENT/PAYOUT rows post; a CREDIT_SALE row mirrors the Sale, which posts' },
    { model: 'SupplierCreditTransaction', postsVia: 'supplier_payment', note: 'PAYMENT/PAYOUT rows post; a CREDIT_PURCHASE row mirrors the Purchase, which posts' },

    { model: 'FixedAsset', postsVia: 'asset_acquisition', note: 'acquisition posts Dr Fixed Assets / Cr <mode>; depreciation posts separately via AssetDepreciationEntry' },

    // ── Gaps: should post, not yet wired ─────────────────────────────────────
    { model: 'OrderDeposit', gap: 'Sales-order deposit takes customer cash but posts nothing; needs Customer Advances + the SalesOrder→Sale conversion. TODO Phase 4/5.' },

    // ── Exempt: line items (the parent posts the total) ──────────────────────
    { model: 'SaleItem', exempt: 'Line item of Sale, which posts the total.' },
    { model: 'SalesOrderItem', exempt: 'Line item of SalesOrder (a commitment, not yet a sale).' },
    { model: 'SalesReturnItem', exempt: 'Line item of SalesReturn, which posts the total.' },
    { model: 'PurchaseItem', exempt: 'Line item of Purchase, which posts the total.' },
    { model: 'PurchaseOrderItem', exempt: 'Line item of PurchaseOrder, which posts on receipt.' },
    { model: 'PurchaseReturnItem', exempt: 'Line item of PurchaseReturn, which posts the total.' },
    { model: 'PurchaseQuotationItem', exempt: 'Line item of a quotation — not an economic event.' },
    { model: 'QuotationItem', exempt: 'Line item of a quotation — not an economic event.' },
    { model: 'StorefrontOrderItem', exempt: 'Line item of a pending storefront order.' },
    { model: 'PriceListItem', exempt: 'Catalog pricing line, not a transaction.' },
    { model: 'InventoryShrinkageItem', exempt: 'Line item; periodic inventory posts nothing for stock loss.' },
    { model: 'ProductionJobCost', exempt: 'Cost line of a ProductionJob; periodic inventory reclassification.' },
    { model: 'PaymentRecord', exempt: 'Payment-method breakdown line of a Sale; the Sale posts.' },
    { model: 'SupplierPaymentAllocation', exempt: 'Allocation of a supplier payment to bills; the payment (SupplierCreditTransaction) posts.' },

    // ── Exempt: catalog / pricing / config (not a transaction) ───────────────
    { model: 'Product', exempt: 'Catalog price/vat config, not a transaction.' },
    { model: 'ProductPrice', exempt: 'Catalog price/cost, not a transaction.' },
    { model: 'PriceList', exempt: 'Pricing config.' },
    { model: 'DiscountCode', exempt: 'Discount config; the discount lands in the Sale total.' },
    { model: 'CustomerGroup', exempt: 'Default-discount config.' },
    { model: 'Customer', exempt: 'Config (credit_limit, discount) + denormalized due_balance/total_spent derived from the AR ledger.' },
    { model: 'Tenant', exempt: 'Tenant-level rate config (vat, loyalty).' },

    // ── Exempt: denormalized balance / cache ─────────────────────────────────
    { model: 'Supplier', exempt: 'Denormalized due_balance; the AP ledger (vouchers / SupplierCreditTransaction) is the source.' },
    { model: 'CashierSession', exempt: 'Till counts (opening/closing cash); individual CashTransactions post.' },

    // ── Exempt: periodic inventory (deliberately no journal) ─────────────────
    { model: 'InventoryMovement', exempt: 'Periodic inventory: stock is expensed at purchase, so a movement posts nothing.' },
    { model: 'ProductionJob', exempt: 'Manufacturing cost reclassification; periodic inventory, no new money.' },
    { model: 'ProductionWastage', exempt: 'Quantity, not money; periodic inventory.' },
    { model: 'BomComponent', exempt: 'Quantity, not money.' },

    // ── Exempt: accounting-internal (voucher building blocks) ────────────────
    { model: 'VoucherDetail', exempt: 'The voucher line itself — the RESULT of posting, not a source event. Carries the party dimension.' },
    { model: 'RecurringVoucherLine', exempt: 'Recurring-voucher template line; posts when the recurring voucher runs.' },
    { model: 'RecurringJournalLine', exempt: 'Recurring-journal template line.' },
    { model: 'VoucherTemplateLine', exempt: 'Voucher template line; a blueprint, not a transaction.' },
    { model: 'AccountBudget', exempt: 'Budget target for reporting, not a transaction.' },

    // ── Exempt: bank reconciliation (matches existing vouchers) ──────────────
    { model: 'BankReconciliation', exempt: 'Bank-rec statement balance; matches against existing vouchers, does not post.' },
    { model: 'BankStatementEntry', exempt: 'Imported statement line for matching, not a source transaction.' },

    // ── Exempt: quotations (not economic events) ─────────────────────────────
    { model: 'Quotation', exempt: 'Sales quotation — an offer, not an economic event.' },
    { model: 'PurchaseQuotation', exempt: 'Purchase quotation — an offer, not an economic event.' },

    // ── Exempt: order intake (not yet economic) ──────────────────────────────
    { model: 'SalesOrder', exempt: 'Order commitment; the money rides on OrderDeposit (a tracked gap), not here.' },
    { model: 'StorefrontOrder', exempt: 'Storefront order intake at status PENDING; becomes a Sale on fulfilment.' },

    // ── Exempt: employee/asset registers (posted elsewhere) ──────────────────
    { model: 'Employee', exempt: 'basic_salary is the pay rate (config); SalaryAccrual posts it monthly.' },

    // ── Exempt: platform billing / SaaS revenue (not the tenant GL) ──────────
    { model: 'BillingEvent', exempt: 'Platform SaaS billing, not a tenant ledger entry.' },
    { model: 'SubscriptionPlan', exempt: 'Platform plan catalog.' },
    { model: 'TenantSubscription', exempt: 'Platform subscription record.' },
    { model: 'AddonModule', exempt: 'Platform add-on catalog.' },
    { model: 'SmsPackage', exempt: 'Platform SMS-credit catalog.' },
    { model: 'Referee', exempt: 'Referral-program config (rates).' },
    { model: 'RefereePayment', exempt: 'Referral payout at the platform level, not the tenant GL.' },
    { model: 'ReferralSignup', exempt: 'Referral analytics/attribution.' },
    { model: 'CrmCampaign', exempt: 'Attributed-revenue analytics, not a ledger entry.' },
];
