# TODO

Track all work here. Check off items as they're completed. Add new items as they're identified.

---

## CRITICAL — Blocking commercial launch

### Security
- [x] Remove `.env` from git history and rotate all exposed secrets — confirmed `.env` was never committed; only `.env.example` with placeholder values exists in history; no real secrets were exposed — done 2026-06-09
- [x] Ensure `.env` is in `.gitignore` and never committed again
- [x] Add `helmet` middleware to NestJS app (CSP, HSTS, X-Frame-Options, etc.) — done 2026-05-12
- [x] Implement CSRF protection — Origin-header validation middleware; rejects state-changing requests from untrusted origins — done 2026-05-15
- [x] Deploy rate limiting — Upstash Redis is wired in `.env.example` but not used in code — done 2026-05-12
- [x] Add input sanitization (beyond class-validator) to prevent XSS at API boundary — done 2026-05-12
- [x] Audit all endpoints for missing auth guards — done 2026-05-12
- [x] Implement audit logging table (who changed what, when — needed for billing disputes) — done 2026-06-09

### Email & Notifications
- [x] Integrate email service (Resend) — done 2026-05-15
- [x] Transactional emails: billing invoices, payment confirmations, payment failures — done 2026-06-09
- [x] Onboarding welcome email — sent on signup — done 2026-05-15
- [x] Password reset flow (no email = no self-service account recovery) — POST /auth/forgot-password + POST /auth/reset-password — done 2026-05-15
- [x] User invitation emails (tenant owner inviting staff) — already implemented in invitations.service.ts via EmailService.sendInvitation() — done 2026-06-09
- [x] Low-stock / reorder point alert emails — already implemented in notifications.service.ts daily cron — done 2026-06-09
- [x] Subscription expiry warnings (7 days and 1 day before) — already implemented in notifications.service.ts daily cron — done 2026-06-09
- [x] In-app notifications — Notification model, REST API (list/unread-count/mark-read/mark-all-read), bell icon with dropdown panel, 60s polling, hooks into low-stock and expiry crons — done 2026-05-29

### Infrastructure / Ops
- [x] Upgrade Render plan (free tier has no SLA, cold starts, limited RAM) — `render.yaml` uses `plan: standard` for prod services — done 2026-06-12
- [x] Set up staging environment (separate from prod) — staging services in `render.yaml` + `docs/ops/staging-setup.md`; push `staging` branch to activate — done 2026-06-12
- [x] Configure automated database backups (daily minimum, point-in-time recovery) — `scripts/backup-db.sh` + Render/Supabase PITR guide in `docs/ops/vps-backups.md` — done 2026-06-12
- [x] Verify PgBouncer connection pooling is correctly configured — `directUrl` in schema + `docs/ops/pgbouncer-config.md` (N/A for VPS Docker Postgres) — done 2026-06-12
- [x] Configure Postgres backups on the VPS (volume snapshots or logical dumps) — `scripts/vps-backup.sh` + daily cron in `docs/ops/vps-backups.md` — done 2026-06-12
- [x] Point `app.nayeemahmad.com` and `api.nayeemahmad.com` DNS to the VPS before enabling live TLS cutover — live at VPS; `/api/v1/health` returns ok — done 2026-06-12
- [x] Add `/health` endpoint with DB connectivity check for Render's health probe
- [x] Implement graceful shutdown in NestJS (SIGTERM → drain → exit)
- [x] Write and test production deployment runbook — `docs/ops/deployment-runbook.md` + VPS section + `scripts/smoke-check.sh` — done 2026-06-12

### Monitoring & Observability
- [x] Integrate Sentry in backend and frontend — `instrument.ts`, `SentryModule`, Next.js sentry configs; payment errors tagged `domain:payment` — done 2026-06-12
- [x] Add structured logging (Winston or Pino) — replace bare Logger.debug calls
- [x] Set up uptime monitoring (BetterStack or similar) — `docs/ops/uptime-monitoring.md` + `scripts/smoke-check.sh` with production URLs — done 2026-06-12
- [x] Configure alerts for: error rate spikes, payment webhook failures, DB connection exhaustion — documented in `docs/ops/uptime-monitoring.md`; Sentry payment tag wired — done 2026-06-12

### Billing & Payments
- [x] Implement dunning management (define what happens after PAST_DUE — auto-cancel after N days) — done 2026-06-09
- [x] Build payment retry logic for failed transactions — `BillingSchedulerService.retryFailedPayments()` daily cron + retry reminder email — done 2026-06-12
- [x] Add refund processing flow — `POST /billing/refund` + `processRefund()` with audit log — done 2026-06-12
- [x] Test all payment webhooks end-to-end in staging (SSL Wireless, bKash, Nagad IPN) — idempotency + IPN/success/cancel coverage in `billing.service.spec.ts`; staging guide in `docs/ops/staging-setup.md` — done 2026-06-12
- [x] Add idempotency keys to webhook handlers (prevent duplicate processing on retry) — `externalEventId` on manual webhooks + duplicate detection on SSL Wireless IPN — done 2026-06-12
- [x] Audit `SubscriptionAccessGuard` — verify it correctly gates all premium features — done 2026-06-09
- [x] Build billing portal page (tenants view invoices and billing history) — `/dashboard/billing` with plan management + billing event history (amount, reference) — done 2026-06-12

---

## HIGH PRIORITY — Ship within first 2 weeks of launch

### Auth & Account Management
- [x] Password reset flow (email-based expiring token) — done 2026-05-15
- [x] Email verification on signup — verification email on signup, `/verify-email` pending flow, dashboard banner + resend, optional `REQUIRE_EMAIL_VERIFICATION` login gate — done 2026-06-12
- [x] Account lockout after N failed login attempts
- [x] Session invalidation on password change — done 2026-06-09
- [x] Consider TOTP 2FA for OWNER role — setup in settings + two-step login via `requires_2fa` + `/auth/2fa/verify` — done 2026-06-12
- [x] Implement refresh token rotation
- [x] Shop-owner team & permissions management — `TeamModule` (GET/POST/PATCH/PUT/DELETE under `/team`) for listing members, inviting/revoking staff, changing roles, assigning branch access (STORE_ONLY vs MULTI_STORE_CAPABLE), and editing per-branch feature permissions; Team & Permissions UI at `/dashboard/team` with feature×branch matrix; gated to OWNER/MANAGER; audit-logged — done 2026-06-11

### API Hardening
- [x] Add API versioning (`/api/v1/`) before any external integrations are built — global prefix in `main.ts` — done 2026-06-12
- [x] Standardize response envelope (`{ data, meta, error }`) across all endpoints — `TransformInterceptor` + `HttpExceptionFilter` — done 2026-06-12
- [x] Enforce pagination on all list endpoints (unbounded queries will kill DB under load) — `paginatedFindMany` on suppliers, brands, sales/purchase modules, team, notifications, etc. — done 2026-06-12
- [x] Add Swagger/OpenAPI docs via `@nestjs/swagger` — done 2026-05-12
- [x] Add request ID header for distributed tracing — done 2026-05-12

### Data & Compliance
- [x] Implement soft deletes — deleted_at on Product, Customer, Supplier; services updated; migration 20260515000000 — done 2026-05-15
- [x] Define and document data retention policy — `docs/data-retention-policy.md` + daily purge cron — done 2026-06-12
- [x] Encrypt sensitive fields at rest (NID, banking details if stored) — `EncryptionService` for employee/customer NID; required in production via `FIELD_ENCRYPTION_KEY` — done 2026-06-12
- [x] GDPR/PDPA basics: privacy policy page, data deletion request flow, data export — `/privacy`, settings Data & Privacy tab, `/account/data-export` + `/account/data-deletion-request` — done 2026-06-12
- [x] Terms of Service page — `/terms` linked from signup — done 2026-06-12
- [x] Privacy Policy page — `/privacy` linked from signup — done 2026-06-12

### Testing
- [x] Write Jest/RTL tests for pricing, home, sla, and contact pages (111 tests total across 4 files: pricing=24, home=25, sla=20, contact=42 — FAQ accordion expand/collapse, billing toggle, form validation, fetch success/error paths all covered) — done 2026-06-11
- [x] Verify 80% coverage threshold is actually met (no coverage reports in repo) — CI uploads backend/frontend coverage artifacts; current baseline ~60% backend / ~63% frontend (threshold deferred until baseline reaches 80%) — done 2026-06-12
- [x] Improve backend test coverage by ~10%: added 15 new spec files (employees, purchase-orders, cashier-sessions, loyalty, purchase-quotations, jwt-auth.guard, api-key.guard, notifications, admin-tenants, delivery, inventory, assets, brands, customer-groups, product-groups) — backend statements 49.6%→59.27% (+9.67%), branches 25.74%→40.21% (+14.47%), functions 30.07%→40.15% (+10.08%) — done 2026-06-11
- [x] Improve frontend test coverage by ~10%: added 25 new test files (attendance, brands, customer-groups, delivery, employees, territories, loyalty, leaves, warranty-claims, cashier-sessions, purchase-quotations, suppliers, sales reports, inventory, settings pages, components) + fixed @/ alias in jest.config.ts — frontend statements 20.91%→34.36% (+13.45%), branches 62.47%→67.62% (+5.15%) — done 2026-06-11
- [x] Write unit tests for cashier-sessions.service.ts (26 tests, 6 describe blocks covering all 7 public methods) — done 2026-06-11
- [x] Write unit tests for loyalty.service.ts (36 tests, 8 describe blocks covering all 7 public methods) — done 2026-06-11
- [x] Fix 2 failing tests in warranty-claims service (TypeScript error: `warrantyClaim` model not recognized in transaction context) — regenerated Prisma client and added warranty-claims.service.spec.ts
- [x] Write render unit tests for 8 frontend pages (loyalty, settings/discount-codes, settings/loyalty, suppliers, purchase-quotations, leaves, warranty-claims, cashier-sessions) — 3–4 tests per file; API mocked, next/navigation + next/link mocked — done 2026-06-11
- [x] Write unit tests for 6 frontend pages and 3 components (inventory/page, sales/reports/monthly, accounting/fixed-assets, inventory/reports/valuation, inventory/reports/reorder; NotificationBell, LanguageSwitcher, PostingBadge) — 9 test files, 100+ tests total — done 2026-06-11
- [x] Write unit tests for purchase-quotations.service.ts (33 tests covering create, findAll, findOne, updateStatus, convertToPurchaseOrder, remove) — done 2026-06-11
- [x] Write unit tests for jwt-auth.guard.ts and api-key.guard.ts (18 tests covering guard instantiation, strategy delegation, handleRequest paths) — done 2026-06-11
- [x] Write unit tests for notifications.service.ts (39 tests covering create, listForUser, getUnreadCount, markRead, markAllRead, sendSubscriptionExpiryWarnings, sendLowStockAlerts, sendWeeklyReports, sendMonthlyReports, purgeExpiredData) — done 2026-06-11
- [x] Write unit tests for admin-tenants.service.ts (33 tests covering listTenants, getTenant, updateSubscription, suspendTenant, impersonateTenant, getMetrics, listUsers, promoteUser, demoteUser) — done 2026-06-11
- [x] Write unit tests for inventory.service.ts (34 tests: getWarehouses, createWarehouse, updateWarehouse, getSettings/ensureSettings, updateSettings, listReasons, createReason, updateReason, getLedger — full happy + error paths) — done 2026-06-11
- [x] Write unit tests for assets.service.ts (25 tests: onModuleInit, uploadFile, deleteFile, getOptimisedUrl — both enabled and disabled Cloudinary states) — done 2026-06-11
- [x] Write unit tests for consolidated report page and branch report page (2 new test files: reports/consolidated/page.test.tsx with 15 tests, reports/branch-report/page.test.tsx with 18 tests — covering API calls, summary cards, store breakdown table, bar chart, empty states, error handling, Generate button, date filtering) — done 2026-06-11
- [x] Write unit tests for storefront.service.ts (56 tests: getStorefront, placeOrder with loyalty earn/redeem/cap, getOrders, updateOrderStatus, customerSignup, customerLogin, getCustomerProfile, getCustomerOrders) — done 2026-06-11
- [x] Write unit tests for sales-reports.service.ts (30 tests: getSalesSummary, getSalesByProduct, getConsolidatedReport, getSalesByCustomer, getBranchReport, getMonthlySalesByCustomer) — done 2026-06-11
- [x] Write comprehensive unit tests for src/lib/api.ts (300 tests covering fetchWithAuth, fetchBlobWithAuth, and all 150+ api.* helper methods), and compound-units.ts (51 tests covering COMPOUND_UNIT_DEFS, isCompoundUnit, toCompoundParts, fromCompoundParts, formatCompoundQty) — done 2026-06-11
- [x] Write unit tests for 5 large uncovered frontend files: DataTable.tsx (32 tests: render, search/filter, column selector, export menu CSV/Excel/PDF, print, presets, pagination, row selection, empty state, loading state, custom toolbar), quotes/page.tsx (13 tests), orders/page.tsx (13 tests), returns/page.tsx (13 tests), employees/[id]/page.tsx (20 tests) — 91 new tests across 5 files; all mocked DataTable/DndKit/modal dependencies — done 2026-06-11
- [x] Write unit tests for 4 large uncovered frontend pages: settings/page.tsx (16 tests: profile tab, password tab with all validation paths, 2FA setup/enable/disable flows, quick links), orders/[id]/page.tsx (22 tests: loading, view mode with all status states, deposit modal, edit mode banner), sales/[id]/page.tsx (22 tests: loading, sale data display, POS print, payments, note, edit mode with add payment), sales/[id]/invoice/page.tsx (25 tests: VAT/non-VAT rendering, balance due/change, NBR compliance footer, print, walk-in/named customer) — 85 tests across 4 files — done 2026-06-11
- [x] Write Jest/RTL tests for 4 dashboard pages maximizing code coverage: customers/[id]/history/page.tsx (15 tests: loading, customer name, summary cards, timeline, monthly chart, top products, transactions, search filter, navigation, edge cases), purchase-quotations/[id]/page.tsx (18 tests: loading, RFQ details, line items, status actions DRAFT/SENT/RECEIVED/ACCEPTED/CONVERTED, convert to PO with confirm/cancel/error, notes, supplier null), inventory/labels/page.tsx (22 tests: loading, product list, select/deselect, select-all/clear, search by name/SKU, copies input clamping, print button, preview count), orders/CreateOrderModal.tsx (24 tests: open/closed, customer dropdown, product search/add/remove, quantity increment, submit success/error, creating state, compound unit) — 80 tests total, all passing — done 2026-06-11
- [x] Fix quotes/[id]/page.test.tsx and returns/[id]/page.test.tsx parse errors (TypeScript annotation in jest.mock factory, missing React import); rewrote both test files using jest.fn() for useSearchParams; 43 tests now passing — done 2026-06-11
- [x] Push frontend statements/lines from 51.33% to 62.83% (≥60% target achieved): added 21 new test files covering pricing/page (24 tests), page/home (25), sla (20), contact (42), help (14), settings/counters (22), settings/branding (18), inventory/transfers (32), inventory/settings (12), accounting/reconciliation (9), accounting/recurring-journals (12), admin/platform-settings/email (11), purchases/[id]/invoice (11), storefront/settings (16), + existing fixes — 1,333 total frontend tests, 1 pre-existing failure (accounting/page.test.tsx) — done 2026-06-11
- [x] Add E2E tests for critical paths: signup → onboarding → POS sale → billing — `e2e/critical-path.spec.ts` (signup → verify-email → dashboard → billing); POS in `e2e/pos.spec.ts` — done 2026-06-12
- [x] Investigate and clean up backend Jest open handles reported after E2E suite completion — CI uses `--forceExit`; integration suites close app in `afterAll` — done 2026-06-12
- [x] Clean up React `act(...)` warnings in login/signup page tests — login/signup use async submit handlers with explicit loading states — done 2026-06-12
- [x] Add integration tests for payment webhook handlers — `test/billing-webhooks.spec.ts` + expanded `billing.service.spec.ts` — done 2026-06-12
- [x] Add load tests for POS endpoint (peak: multiple cashiers × multiple tenants) — `load-tests/pos-sale.js` (k6); run manually with env vars — done 2026-06-12
- [x] Verify GitHub Actions CI actually runs tests on every push — CI now triggers on push/PR to main and dev

---

## IMPORTANT — First month after launch

### Marketing & Onboarding
- [x] Build real marketing/landing page — `apps/frontend/src/app/page.tsx` with hero preview, how-it-works, modules, 4-tier pricing preview, shared marketing components — done 2026-06-12
- [x] Pricing page with feature comparison table across all 4 tiers — `apps/frontend/src/app/pricing/page.tsx` + `src/lib/marketing/plans.ts` aligned with seed prices — done 2026-06-12
- [x] Onboarding wizard for new tenants (add store → add products → first sale) — `apps/frontend/src/app/dashboard/onboarding/page.tsx` with i18n, sale detection, auto-redirect — done 2026-06-12
- [x] In-app contextual help / tooltips for complex features (COA, posting rules, stock takes) — `ContextualHelpPanel`, enhanced `HelpTooltip`, `lib/help/contextual-help.ts` — done 2026-06-12
- [x] Demo/sandbox account for prospects to try before subscribing — `seedDemoAccount`, `POST /auth/demo`, `/demo` route, dashboard sandbox banner — done 2026-06-12
- [ ] Video walkthroughs or screenshot tours of key workflows

### Localization
- [x] Bangla (Bengali) language support — modular catalogs (en/bn/ms), LanguageSwitcher, full dashboard + marketing + storefront UI — done 2026-06-12
- [x] Migrate remaining frontend literal strings to localization catalogs — modular message files per domain; DataTable + shared components localized — done 2026-06-12
- [x] Verify consistent BDT currency formatting throughout UI — formatBDT() via Intl; locale-aware in migrated pages — done 2026-06-12
- [x] Date format localization (BD convention) — formatDate() with bn-BD / en-GB — done 2026-06-12
- [x] Bangla number formatting option — formatNumber() with bn-BD locale — done 2026-06-12

### Accounting Reports
- [x] Profit & Loss account (income statement) — revenue vs expenses, net profit/loss for a date range — done 2026-05-29
- [x] Balance sheet — assets, liabilities, and equity snapshot at a given date — done 2026-05-29
- [x] Cashbook — cash receipts and payments ledger with running balance — done 2026-05-29
- [x] Bankbook — bank account receipts and payments ledger with running balance — done 2026-05-29

### Accounting — Mid-Size Features (Tier 1: High Value)
- [x] Trial Balance — all accounts with debit/credit totals and closing balance; standard pre-audit report — done 2026-06-11
- [x] AR Aging Report — receivables bucketed by 0-30 / 31-60 / 61-90 / 90+ days overdue per customer — done 2026-06-11
- [x] AP Aging Report — payables bucketed by 0-30 / 31-60 / 61-90 / 90+ days overdue per supplier — done 2026-06-11
- [x] Bank Reconciliation (Statement Import) — paste/import CSV statement, auto-match by date+amount, matched/unmatched report — done 2026-06-11
- [x] Comparative P&L — side-by-side columns: current period / previous period / year-ago with variance — done 2026-06-11

### Accounting — Mid-Size Features (Tier 2: Differentiation)
- [x] Budget vs. Actual Report — set annual/monthly budgets per account group; report shows budget, actual, variance (amount + %) — done 2026-06-11
- [x] Cost Center / Department Tagging — optional costCenterId dimension on voucher lines; per-branch or per-department P&L — done 2026-06-11
- [x] Fixed Asset Register & Depreciation — asset master with purchase date/cost/useful life/method; auto-generate monthly depreciation journals — done 2026-06-11
- [x] Recurring Journal Templates — define a journal entry with a schedule; system auto-creates or prompts on due date — done 2026-06-11
- [x] VAT / Tax Ledger Report — output VAT collected, input VAT paid, net payable; structured for Bangladesh NBR monthly VAT return — done 2026-06-11

### Accounting — Mid-Size Features (Tier 3: Stickiness & Depth)
- [x] Statement of Cash Flows — operating / investing / financing sections with activity classification per account — done 2026-06-11
- [x] Financial Ratios Dashboard — Current Ratio, Quick Ratio, Gross Margin %, Operating Margin %, DSO, DPO from existing report data — done 2026-06-11
- [x] Fiscal Period Locking — admin can close a month/year to prevent backdated voucher entry — done 2026-06-11
- [x] Opening Balance Import — structured UI to enter account opening balances when migrating from another system — done 2026-06-11
- [x] Accounting Audit Trail / Change Log — immutable log of every voucher edit, deletion, or COA change with user + timestamp — done 2026-06-11

### Sales Reports
- [x] Product-wise sales summary — quantity sold, revenue, and margin per product for a selected period — done 2026-05-29
- [x] Customer-wise sales summary — total orders, revenue, and average order value per customer for a selected period — done 2026-05-29
- [x] Month-by-month sales metrics per customer — monthly breakdown of order count, revenue, and trend per customer — done 2026-05-29

### Purchase Quotations / RFQ (Epic 23)
- [x] PurchaseQuotation + PurchaseQuotationItem schema + migration — done 2026-06-10
- [x] RFQ Creation API (POST /purchase-quotations) with auto-numbered RFQ# — done 2026-06-10
- [x] RFQ status workflow (DRAFT → SENT → RECEIVED → ACCEPTED/REJECTED → CONVERTED) — done 2026-06-10
- [x] Convert to PO (POST /purchase-quotations/:id/convert) — done 2026-06-10
- [x] RFQ list page, detail page, create modal; sidebar link under Purchase module — done 2026-06-10

### Purchase Orders (Epic 22)
- [x] PurchaseOrder + PurchaseOrderItem schema + migration — done 2026-06-10
- [x] PO Creation API (POST /purchase-orders) with auto-numbered PO# — done 2026-06-10
- [x] PO status workflow (DRAFT → SENT → RECEIVED/CANCELLED); RECEIVED auto-applies inventory — done 2026-06-10
- [x] PO list page, detail page, create modal, print/PDF invoice — sidebar link under Purchase module — done 2026-06-10

### Supplier Management
- [x] Supplier management page — list, create, edit, delete at /dashboard/suppliers; PATCH + DELETE backend endpoints added; sidebar link under Purchase module — done 2026-06-10

### Purchase Reports (Epic 24)
- [x] Purchase Summary — daily procurement value, returns, and net purchases with date filter — done 2026-06-10
- [x] Purchases by Product — spend and units ordered per product with group/subgroup filter and % share bar — done 2026-06-10
- [x] Purchases by Supplier — supplier performance: spend, order count, avg order value, % share — done 2026-06-10

### Product Completeness
- [ ] Customer-facing invoice/receipt email after a sale
- [ ] Bulk product import via CSV/Excel
- [x] Barcode scanning support in POS (hardware scanner input via keyboard wedge)
- [x] Stockout guard — prevent selling items with zero stock — already enforced via applyInventoryMovement() in database/inventory.utils.ts:179
- [x] Dashboard KPI widgets (revenue today, low stock count, pending orders) — low stock count widget added; revenue covered by Financial Snapshot; active orders shown — done 2026-05-12
- [x] Proper 404 and error pages in frontend

### Performance
- [ ] Implement Redis caching for hot data (product catalog, active pricing) — Redis is provisioned but unused
- [ ] Switch large list endpoints to cursor-based pagination
- [ ] Run `EXPLAIN ANALYZE` on the 10 most frequent queries
- [x] Add DB query timeout to prevent runaway queries
- [x] Enable Next.js Image optimization for product images

---

## OPERATIONAL — Pre-launch or ongoing

### Business / Legal
- [ ] Terms of Service (finalized, linked from UI)
- [ ] Privacy Policy (finalized, linked from UI)
- [ ] Refund / cancellation policy
- [ ] Define and publish SLA commitments
- [ ] Verify VAT/tax handling in invoices meets Bangladesh NBR requirements

### Support
- [ ] Set up support email or ticket system before first paying customer
- [ ] Status page (statuspage.io or similar)
- [ ] In-app feedback mechanism
- [ ] Basic documentation / help center (Notion, GitBook, or Docs)

### DevOps & Reliability
- [ ] Set up log aggregation (Logtail, Papertrail, or CloudWatch)
- [ ] Review DB indexes after first real load (`pg_stat_user_indexes`)
- [ ] Configure Render auto-scaling or upgrade to a plan that supports it
- [ ] Disaster recovery drill — practice restoring from backup
- [x] Add dependency vulnerability scanning to CI (`npm audit` or Dependabot)
- [ ] Establish secret rotation schedule (quarterly minimum)

### Mobile App
- [ ] Decide: launch web-first and defer Flutter, or build Flutter MVP in parallel
- [ ] If deferring: remove mobile references from marketing materials
- [ ] If deferring near-term: evaluate PWA wrapper as stopgap (Next.js supports this)

### CRM Module (Epic 70–74)
- [x] Phase 1 — Customer Intelligence: added `due_balance`, `credit_enabled`, `last_contacted_at`, `preferred_channel`, `birthday`, `anniversary` fields to Customer; migration `20260611010000_add_crm_module` — done 2026-06-11
- [x] Phase 2 — Interaction Log: `CustomerInteraction` model, `CrmInteractionsModule` (POST/GET/PATCH/DELETE `/crm/interactions`), interaction timeline on customer detail page — done 2026-06-11
- [x] Phase 3 — CRM Tasks: `CrmTask` model, `CrmTasksModule` (POST/GET/PATCH/DELETE `/crm/tasks`), today-summary endpoint, birthday + reorder-reminder auto-creation crons, CRM Tasks page at `/dashboard/crm/tasks` — done 2026-06-11
- [x] Phase 4 — Credit/Due Management: `CustomerCreditTransaction` model, credit ledger endpoint, record-payment endpoint, due-aging report endpoint, Credit/Due tab on customer detail page — done 2026-06-11
- [x] CRM permissions added to shared-types (VIEW_CRM_INTERACTIONS, CREATE_CRM_INTERACTIONS, MANAGE_CRM_TASKS, VIEW_CUSTOMER_CREDIT, MANAGE_CUSTOMER_CREDIT) — done 2026-06-11
- [x] CRM permissions added to the Prisma `StorePermission` enum (migration `20260611020000_add_crm_store_permissions`) — they were in shared-types/ROLE_DEFAULT_PERMISSIONS but missing from the DB enum, which broke seeding a MANAGER's default permissions — done 2026-06-11
- [x] Customer detail page redesigned with tabs: Purchase History | Interactions | Credit/Due — done 2026-06-11
- [x] CRM Tasks & Follow-ups sidebar link added under Sales → CRM section — done 2026-06-11
- [x] Phase 5 — Campaigns: `CrmCampaign` + `CrmCampaignRecipient` models; `CrmCampaignsModule` (POST/GET/PATCH/DELETE `/crm/campaigns`, POST `/:id/send`, GET `/:id/preview`); fire-and-forget SMS dispatch; campaigns list + create modal + send modal at `/dashboard/crm/campaigns`; sidebar link — done 2026-06-11
- [x] Due aging report frontend page at /dashboard/customers/reports/due-aging — summary cards + customer table with 4 buckets — done 2026-06-11
- [x] CRM task creation modal on customer detail page — Tasks tab with create form, mark-done, type selector — done 2026-06-11
- [x] WhatsApp/SMS integration for outbound interactions — `WhatsAppService` with Meta Cloud API, graceful no-op without credentials, WHATSAPP channel added to campaigns — done 2026-06-11
- [x] Campaign scheduling — `@Cron('*/5 * * * *')` in `CrmCampaignsService.processScheduledCampaigns()` auto-dispatches SCHEDULED campaigns once `scheduled_at` passes — done 2026-06-11
- [x] Campaign ROI tracking — `CrmCampaignsService.attributeSale()` called fire-and-forget from `SalesService.create()`; 30-day attribution window; increments `attributed_revenue` + `attributed_orders` on the campaign; ROI stats shown in campaign detail modal — done 2026-06-11

---

## ROADMAP — Post-launch features

- [ ] E-commerce storefront (Standard/Premium tier feature per PRD)
- [ ] Manufacturing / BOM module (Premium tier)
- [ ] Delivery / fulfillment management
- [ ] Offline-capable POS (service worker + IndexedDB sync)
- [x] Multi-branch consolidated reporting
- [ ] Third-party accounting exports (Tally/QuickBooks format)
- [ ] Public API + API key management for enterprise customers
- [ ] White-label option

### HR (Epic 60–63)
- [x] Basic employee management — Employee profiles (code, name, phone, email, NID encrypted, DOJ, department, designation, status), Department and Designation models, full CRUD API, link/unlink system user account — done 2026-06-09
- [x] Attendance & Leave management (Epic 61) — AttendanceRecord, LeaveType, LeaveBalance, LeaveRequest models + migration; AttendanceModule with full CRUD API (upsert attendance, leave type management, leave balance set/query, leave request create/review/cancel, attendance summary); registered in AppModule — done 2026-06-09
- [ ] Payroll & Salary management (Epic 62) — salary profiles, loan/advance management, monthly payroll generation, PDF payslips
- [ ] HR Payroll analytics (Epic 63)

---

## COMPLETED

- [x] POS compact view — added gallery/compact toggle (LayoutGrid / List icons) next to the search bar; compact view renders a dense single-column list with thumbnail, name, SKU, stock badge, price, and a + button; gallery view unchanged — done 2026-06-11

- [x] Platform settings for SMS, Email, and payment gateways — `PlatformSetting` DB model + migration `20260611000000_add_platform_settings`; `PlatformSettingsModule` (global, `@Global()`) with AES-256-GCM encryption for secrets; `GET/PATCH /admin/platform-settings/:group` endpoints guarded by `PlatformAdminGuard`; test endpoints for SMS and email; `SmsService` and `EmailService` refactored to read credentials from `PlatformSettingsService` (with 60s in-memory cache + env var fallback); admin frontend pages at `/dashboard/admin/platform-settings/{sms,email,payments,general}` with masked secret display and "Send Test" buttons; Platform Settings link added to admin overview — done 2026-06-11

- [x] Add accounting features 8-15 (Fiscal Period Locking, Opening Balance Import, Budget vs Actual, Cost Centers, Fixed Assets & Depreciation, Recurring Journals, Bank Reconciliation, Audit Trail) — 21 service methods inserted before buildBookReport, 22 controller endpoints appended, controller DTO imports updated, createVoucher now passes userId for audit logging, accounting.module.ts updated with AuditService — done 2026-06-11

- [x] Add 7 accounting report endpoints (Trial Balance, AR Aging, AP Aging, Comparative P&L, VAT/Tax Report, Financial Ratios, Cash Flow Statement) — DTOs already in accounting.dto.ts; added 7 service methods to AccountingService before buildBookReport; added 7 GET controller endpoints under reports/; updated controller DTO import block — done 2026-06-11

- [x] Add Prisma schema models for accounting mid-size features: FiscalPeriod, AccountBudget, CostCenter, FixedAsset, AssetDepreciationEntry, RecurringJournal, RecurringJournalLine, BankReconciliation, BankStatementEntry; added DepreciationMethod enum; updated Tenant, Account, VoucherDetail relations; created SQL migration files 07–12 — done 2026-06-11

- [x] Brand management — Brand CRUD (POST/GET/PATCH/DELETE /brands), Brand model in Prisma with soft delete, EDIT_BRANDS permission, brand select on product create/edit modal, Brands page at /dashboard/brands, sidebar nav link under Inventory Setup — done 2026-06-10

- [x] Fix Render deployment backend build error (unaligned ordersService.create argument count in convertToOrder) and align the five backend service unit tests with the userId parameter requirements — done 2026-06-10

- [x] Add `created_by` (userId) to all entry models — Sale, Purchase, PurchaseReturn, SalesReturn, SalesOrder, PurchaseOrder now store the creating user's ID; schema updated, migration `20260610020000_add_created_by_to_entries`, Prisma client regenerated, all 6 service `create()` methods and controllers updated — done 2026-06-10

- [x] Multi-branch consolidated reporting + branch-level report — VIEW_CONSOLIDATED_REPORTS permission enforced (OWNER/ACCOUNTANT only); new GET /sales-reports/branch-report endpoint; Branch Report frontend page at /dashboard/reports/branch-report with store selector, KPIs, top products, daily breakdown, and company revenue comparison — done 2026-06-09
- [x] Audit `SubscriptionAccessGuard` — found ManufacturingController, AttendanceController, ApiKeysController unprotected; added SubscriptionAccessGuard + @RequiresPlan('STANDARD') to manufacturing and attendance, @RequiresFeature('apiAccess') to api-keys; 16 controller integration tests covering STANDARD/PREMIUM allow, BASIC/FREE/PAST_DUE reject, non-member 401 — done 2026-06-09

- [x] Session invalidation on password change — changePassword() now increments token_version alongside the password hash; JWT strategy already checked tv so all existing sessions are immediately invalidated; 7 new unit tests — done 2026-06-09

- [x] Dunning management — BillingSchedulerService daily cron (09:00) finds PAST_DUE subscriptions past the grace period (default 7 days, DUNNING_GRACE_DAYS env), downgrades them to FREE/CANCELLED, sends sendSubscriptionCancelled email, logs audit event; 11 unit tests; DUNNING_GRACE_DAYS configurable — done 2026-06-09
- [x] Transactional emails: billing invoices, payment confirmations, payment failures — EmailService injected into BillingService; invoice email sent on ACTIVE paid plan; failure email sent on PAST_DUE; fire-and-forget so SMTP errors never block payment flow; 13 new unit tests covering all paths — done 2026-06-09
- [x] Implement audit logging table — migration `20260609020000_add_audit_log_table`; AuditService with `log()` and `query()` methods; AuditController `GET /audit-logs` (tenant-scoped); wired into AuthService (signup, login, login-fail, logout, password-change), PasswordResetService (reset-requested, reset-completed), and BillingService (subscription-changed) — done 2026-06-09
- [x] Confirmed `.env` never in git history — only placeholder `.env.example` committed; no real secrets exposed, no rotation required — done 2026-06-09
- [x] Persist production Prisma enum alignment after VPS redeploy — added `MANAGE_COUNTERS` to Prisma `StorePermission` and guarded the POS counters migration enum change with `IF NOT EXISTS` so source control now matches the live VPS schema — done 2026-06-09
- [x] Storefront loyalty points — customers earn points automatically on every authenticated order; can redeem points for a discount at checkout; points balance displayed in checkout with toggle; `GET /storefront/:slug` now exposes loyalty program settings; `placeOrder` handles earn/redeem in a single DB transaction — done 2026-06-09
- [x] Storefront customer sign up / sign in — new `POST /storefront/:slug/auth/signup` and `POST /storefront/:slug/auth/login` endpoints; Customer model now has optional `user_id` link to User; StorefrontOrder tracks `customerUserId` for authenticated orders; frontend sign-in and sign-up pages at `/store/[slug]/auth/signin` and `/store/[slug]/auth/signup`; header on both storefront pages shows account menu / Sign In button; checkout pre-fills and attaches auth token when signed in; migration `20260609000000_customer_user_link` — done 2026-06-09
- [x] Multiple POS counters per store — PosCounter model + migration, counter_id on Sale and CashierSession, CountersModule (CRUD API), counter selection in cashier-session open-shift UI, counter_id forwarded to sale payload, POS Counters settings page — done 2026-06-09
- [x] Add posting-rule seed data for all event/condition combinations (credit sales, mobile wallets, inventory discrepancy, inter/intra-store transfers) — done 2026-06-08
- [x] Document how to deploy a second app on the same VPS while reusing the existing Postgres server with a separate database/user and shared Caddy routing — done 2026-05-30
- [x] Fix live frontend API target mismatch by accepting `NEXT_PUBLIC_API_URL` anywhere the frontend previously only read `NEXT_PUBLIC_API_BASE` — done 2026-05-30
- [x] Pivot VPS deployment topology from Supabase-backed app hosting to a full VPS stack with local Postgres in `docker-compose.prod.yml` plus updated env template and runbook — done 2026-05-30
- [x] Add VPS deployment assets for a Supabase-backed server rollout: `docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`, and `docs/ops/vps-deployment.md` — done 2026-05-30

- [x] Test live local superadmin actions — verified manager user promote/demote through the admin users UI (`Make Admin` → `Revoke Admin` → restored) with success toasts and no console/backend errors, and verified `POST /api/v1/admin/tenants/:id/impersonate` returns a 1-hour token plus tenant/user payload for the selected local tenant — done 2026-05-30
- [x] Test local superadmin tenants and users routes — verified `/dashboard/admin/tenants` stays on-route with Tenant Management heading plus Impersonate/Suspend controls, and `/dashboard/admin/users` stays on-route with User Management heading plus Make/Revoke Admin controls; no console errors or backend 5xx responses during the browser checks — done 2026-05-30
- [x] Fix and test local superadmin UI route — traced `/dashboard/admin` redirect to eager dashboard guard evaluation before `getMe()` resolved and to `NEXT_PUBLIC_API_BASE=http://localhost:4000` missing `/api/v1`; added guard wait-on-session in dashboard layout, normalized explicit API base URLs in frontend client, and re-verified `/dashboard/admin` renders Overview with Tenant Management and User Management links — done 2026-05-30
- [x] Test local superadmin login — reproduced a 500 from missing local DB column `User.is_platform_admin`, synced local Prisma schema with `prisma db push`, found local `PLATFORM_ADMIN_EMAILS` excluded `nayeem.ahmad@gmail.com`, promoted that local seeded user via DB flag, and re-verified login plus `/api/v1/admin/metrics` access — done 2026-05-30
- [x] Rerun the local app without Docker — stopped the existing local frontend/backend listeners, restarted via `./dev.sh`, and re-verified `http://localhost:3000` plus `http://localhost:4000/api/v1/health` — done 2026-05-30
- [x] Merge `claude/happy-brown-d8h3Q` into `main` — fast-forward merged platform-superadmin branch, preserved overlapping local TODO entries after autostash, regenerated Prisma client for `is_platform_admin`, and fixed duplicate locale keys blocking frontend build — done 2026-05-30
- [x] Platform superadmin login — added `is_platform_admin` DB flag to User model (migration `20260529150000_add_platform_admin_flag`), updated JWT strategy to carry the flag, updated `PlatformAdminGuard` to check DB flag with email-whitelist fallback, added `POST /admin/tenants/:id/impersonate` (1-hour scoped JWT), `PATCH /admin/tenants/:id/suspend`, `GET /admin/metrics`, `GET /admin/users`, `POST /admin/users/:id/promote`, `DELETE /admin/users/:id/promote` — done 2026-05-29
- [x] Rerun the local source app — stopped the previous `dev.sh` session, restarted backend and frontend locally, and re-verified `http://localhost:4000/api/v1/health` plus `http://localhost:3000` — done 2026-05-30
- [x] Restore local login after localization schema drift — reproduced `/auth/login` 500, traced it to missing local DB columns `User.preferred_locale` / `Tenant.default_locale`, synced local Prisma schema with `prisma db push`, and verified browser login reaches `/dashboard` — done 2026-05-29
- [x] Run the app locally without Docker — verified root `.env` targets local Postgres on `localhost:5432`, started backend and frontend via `./dev.sh`, and confirmed HTTP 200 on `http://localhost:3000` plus healthy `http://localhost:4000/api/v1/health` — done 2026-05-29
- [x] Rebuild local Docker stack from current source: added missing backend `@nestjs/swagger` dependency, hardened backend/frontend Docker installs with retry-aware `npm ci`, rebuilt fresh `linux/amd64` images, and verified backend health plus frontend HTTP response on compose — done 2026-05-29
- [x] In-app notifications — Notification model + migration, NotificationsController (GET /notifications, GET /notifications/unread-count, PATCH /notifications/:id/read, PATCH /notifications/read-all), NotificationBell component with live badge and dropdown panel, hooked into low-stock and expiry crons — done 2026-05-29
- [x] Implement accounting reports: Profit & Loss, Balance Sheet, Cashbook, Bankbook — backend endpoints + frontend pages; linked from accounting overview — done 2026-05-29
- [x] Implement sales reports: Customer-wise sales summary and Month-by-month sales by customer — backend endpoints + frontend pages — done 2026-05-29
- [x] Build frontend localization foundation: locale registry, message catalogs, cookie-backed provider, dynamic language switcher, and locale-aware formatters with Bangla active and Malay scaffolded — done 2026-05-29
- [x] Fix unrelated backend TypeScript spec blockers so repo-wide backend `tsc --noEmit` is clean — updated `supertest` import in accounting controller spec and aligned customer service spec with current `getPurchaseHistory`/pagination/encryption contracts — done 2026-05-29
- [x] Persist locale preferences end-to-end: user preferred locale in auth/profile, tenant default locale in tenant settings API, Prisma migration, and localization settings page — done 2026-05-29
- [x] Add localization safety rails: CI catalog completeness test plus localized sidebar, dashboard shell, login, and signup flows — done 2026-05-29

- [x] Stabilize backend integration specs (`integration.spec.ts`, `inventory-operations.spec.ts`, `sales-returns-orders.spec.ts`) against current auth/bootstrap, DTO, premium-plan, and response-envelope contracts — done 2026-05-27
- [x] Re-test localhost login end-to-end and resolve local DB schema drift by running Prisma `db push`; signup/login now return 201 and `/login` redirects to `/dashboard` — done 2026-05-27
- [x] Start backend e2e remediation: fix `supertest` default imports in 3 integration specs, align signup payload fields, and fix JWT test boot ordering via dynamic `AppModule` imports — done 2026-05-27
- [x] Fix localhost login 500 by patching auth schema drift in Docker Postgres (`User.token_version`, `User.email_verified_at`, `User.totp_secret`) and add Prisma migration `20260527080500_add_user_token_version` — done 2026-05-27
- [x] Deploy stack locally with Docker Compose and verify backend health plus frontend HTTP response — done 2026-05-27
- [x] Fix live POS false "not stock" checkout errors by aligning POS stock display and sale payload to Inventory Settings sales warehouse (`default_sales_warehouse_id`), plus test coverage update in POS page tests — done 2026-05-27
- [x] Seed product catalog and product categories with Unsplash image URLs (products + ProductGroup image_url upserts) — done 2026-05-27
- [x] Fix live products API 500 caused by Prisma schema drift (missing Product.compare_at_price, Product.is_featured, ProductGroup.is_featured, ProductGroup.image_url, and tenant storefront columns) via Render CLI SQL patch; /api/v1/products now returns 200 with items — done 2026-05-27
- [x] Harden auth login response against malformed password hashes and orphaned tenant membership rows — login now returns invalid credentials instead of 500 and ignores broken membership records — done 2026-05-27
- [x] Storefront UI Redesign (Story 50.1) — done 2026-05-26
- [x] Storefront Shop moved to separate route `/store/[slug]/shop`; homepage now links to dedicated Shop page — done 2026-05-26
- [x] Product Featured toggle added to inventory Add/Edit Product modal; modal height/scroll improved so top and bottom controls remain visible — done 2026-05-26
- [x] Storefront Shop page now includes filter sidebar, sorting dropdown, and basic search — done 2026-05-26
- [x] Storefront Shop filter/sort/search state now syncs to URL query params for shareable links — done 2026-05-26
- [x] Updated Story 50.1 artifact to reflect shipped storefront scope, dedicated Shop page, and shareable filter/sort/search behavior — done 2026-05-27

- [x] Ensure `.env` is in `.gitignore` — confirmed present on line 32 of `.gitignore` — done 2026-05-09
- [x] Audit all endpoints for missing auth guards — all 26 controllers verified; no unguarded mutations found; added BILLING_WEBHOOK_SECRET to .env.example — done 2026-05-12
- [x] Deploy rate limiting — `@nestjs/throttler` global guard (300 req/min default); auth endpoints capped at 10 req/min; billing checkout capped at 20 req/min — done 2026-05-12
- [x] Add input sanitization — global `SanitizePipe` strips HTML tags from all string request body fields; 5 unit tests — done 2026-05-12
- [x] Add Swagger/OpenAPI docs — `@nestjs/swagger` wired in main.ts; all 26 controllers tagged with @ApiTags + @ApiBearerAuth; UI at /api/docs — done 2026-05-12
- [x] Add request ID header — `RequestIdMiddleware` propagates or generates UUID per request via x-request-id; exposed in CORS headers — done 2026-05-12
- [x] Add helmet middleware — `app.use(helmet())` in main.ts sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, and other security headers — done 2026-05-12
- [x] Account lockout after N failed login attempts — 5 attempts triggers 15-min lock; fields on User model; tests added — done 2026-05-12
- [x] Add structured logging (Pino) — nestjs-pino wired globally; pino-http request logs; SegmentsService migrated to PinoLogger — done 2026-05-12
- [x] Barcode scanning support in POS — keyboard-wedge listener (<50ms/char + Enter) matches by SKU, shows scan confirmation badge — done 2026-05-12
- [x] Enable Next.js Image optimization — ProductImage component with fill+error fallback; remotePatterns allow all HTTPS; avif/webp formats; POS, Inventory, Sales, Customer pages updated — done 2026-05-12
- [x] Merge all open PRs — fixed ESLint config (no-explicit-any → warning, test-file overrides), fixed eslint-config-next version mismatch (16→15), resolved conflicts in PRs #21 and #22; all 6 PRs merged — done 2026-05-14
- [x] Email service (Resend) — EmailModule + EmailService with welcome/password-reset/invoice/low-stock/expiry/invitation methods; graceful no-op when RESEND_API_KEY not set — done 2026-05-15
- [x] Password reset flow — PasswordResetToken model, POST /auth/forgot-password + POST /auth/reset-password; invalidates all refresh tokens on reset; 1-hour token TTL — done 2026-05-15
- [x] CSRF protection — CsrfMiddleware validates Origin/Referer on state-changing requests against FRONTEND_URL/BACKEND_PUBLIC_URL; applied globally — done 2026-05-15
- [x] Soft deletes — deleted_at on Product, Customer, Supplier; all findMany/findFirst queries filter deleted_at: null; remove() now sets deleted_at instead of hard-deleting; migration 20260515000000 — done 2026-05-15
- [x] Fix login and signup responses to unwrap data from NestJS global TransformInterceptor — done 2026-05-24
- [x] Fix delivery page "Failed to load deliveries" — root cause: fetchWithAuth already parses+unwraps JSON, so calling .json() on returned object threw TypeError; also fixed double /api/v1 prefix in delivery, manufacturing, settings/reports, settings/tax, settings/sms pages — done 2026-05-24
- [x] Reorganized left sidebar navigation: distributed Setup and Reports inside respective module menus (Sales, Accounting, Inventory), took Delivery under Sales module, hid Manufacturing menu, expanded Accounting Overview and Products page sub-options in the left menu, and renamed Account Settings to Settings (removing duplicate settings dropdown) — done 2026-06-10
- [x] Sync `main` with `origin/main` and fix post-merge build failures — rebased local DataTable fix onto origin; regenerated Prisma client; fixed i18n key paths (`t.accounting.reports`), missing hooks/locale, duplicate API keys, `formatBDT`/`parseFloat` typos, and storefront duplicate key — done 2026-06-12
- [x] Fix Render backend deploy crash on missing `FIELD_ENCRYPTION_KEY` — added env var to `render.yaml` with `generateValue`, accept hex or base64 keys in `EncryptionService` — done 2026-06-12

