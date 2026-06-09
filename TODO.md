# TODO

Track all work here. Check off items as they're completed. Add new items as they're identified.

---

## CRITICAL — Blocking commercial launch

### Security
- [ ] Remove `.env` from git history and rotate all exposed secrets (SUPABASE_SERVICE_ROLE_KEY, payment credentials)
- [x] Ensure `.env` is in `.gitignore` and never committed again
- [x] Add `helmet` middleware to NestJS app (CSP, HSTS, X-Frame-Options, etc.) — done 2026-05-12
- [x] Implement CSRF protection — Origin-header validation middleware; rejects state-changing requests from untrusted origins — done 2026-05-15
- [x] Deploy rate limiting — Upstash Redis is wired in `.env.example` but not used in code — done 2026-05-12
- [x] Add input sanitization (beyond class-validator) to prevent XSS at API boundary — done 2026-05-12
- [x] Audit all endpoints for missing auth guards — done 2026-05-12
- [ ] Implement audit logging table (who changed what, when — needed for billing disputes)

### Email & Notifications
- [x] Integrate email service (Resend) — done 2026-05-15
- [ ] Transactional emails: billing invoices, payment confirmations, payment failures
- [x] Onboarding welcome email — sent on signup — done 2026-05-15
- [x] Password reset flow (no email = no self-service account recovery) — POST /auth/forgot-password + POST /auth/reset-password — done 2026-05-15
- [ ] User invitation emails (tenant owner inviting staff)
- [ ] Low-stock / reorder point alert emails
- [ ] Subscription expiry warnings (7 days and 1 day before)
- [x] In-app notifications — Notification model, REST API (list/unread-count/mark-read/mark-all-read), bell icon with dropdown panel, 60s polling, hooks into low-stock and expiry crons — done 2026-05-29

### Infrastructure / Ops
- [ ] Upgrade Render plan (free tier has no SLA, cold starts, limited RAM)
- [ ] Set up staging environment (separate from prod)
- [ ] Configure automated database backups (daily minimum, point-in-time recovery)
- [ ] Verify PgBouncer connection pooling is correctly configured
- [ ] Configure Postgres backups on the VPS (volume snapshots or logical dumps)
- [ ] Point `app.nayeemahmad.com` and `api.nayeemahmad.com` DNS to the VPS before enabling live TLS cutover
- [x] Add `/health` endpoint with DB connectivity check for Render's health probe
- [x] Implement graceful shutdown in NestJS (SIGTERM → drain → exit)
- [ ] Write and test production deployment runbook

### Monitoring & Observability
- [ ] Integrate Sentry in backend and frontend
- [x] Add structured logging (Winston or Pino) — replace bare Logger.debug calls
- [ ] Set up uptime monitoring (BetterStack or similar)
- [ ] Configure alerts for: error rate spikes, payment webhook failures, DB connection exhaustion

### Billing & Payments
- [ ] Implement dunning management (define what happens after PAST_DUE — auto-cancel after N days)
- [ ] Build payment retry logic for failed transactions
- [ ] Add refund processing flow
- [ ] Test all payment webhooks end-to-end in staging (SSL Wireless, bKash, Nagad IPN)
- [ ] Add idempotency keys to webhook handlers (prevent duplicate processing on retry)
- [ ] Audit `SubscriptionAccessGuard` — verify it correctly gates all premium features
- [ ] Build billing portal page (tenants view invoices and billing history)

---

## HIGH PRIORITY — Ship within first 2 weeks of launch

### Auth & Account Management
- [x] Password reset flow (email-based expiring token) — done 2026-05-15
- [ ] Email verification on signup
- [x] Account lockout after N failed login attempts
- [ ] Session invalidation on password change
- [ ] Consider TOTP 2FA for OWNER role
- [x] Implement refresh token rotation

### API Hardening
- [ ] Add API versioning (`/api/v1/`) before any external integrations are built
- [ ] Standardize response envelope (`{ data, meta, error }`) across all endpoints
- [ ] Enforce pagination on all list endpoints (unbounded queries will kill DB under load)
- [x] Add Swagger/OpenAPI docs via `@nestjs/swagger` — done 2026-05-12
- [x] Add request ID header for distributed tracing — done 2026-05-12

### Data & Compliance
- [x] Implement soft deletes — deleted_at on Product, Customer, Supplier; services updated; migration 20260515000000 — done 2026-05-15
- [ ] Define and document data retention policy
- [ ] Encrypt sensitive fields at rest (NID, banking details if stored)
- [ ] GDPR/PDPA basics: privacy policy page, data deletion request flow, data export
- [ ] Terms of Service page
- [ ] Privacy Policy page

### Testing
- [ ] Verify 80% coverage threshold is actually met (no coverage reports in repo)
- [x] Fix 2 failing tests in warranty-claims service (TypeScript error: `warrantyClaim` model not recognized in transaction context) — regenerated Prisma client and added warranty-claims.service.spec.ts
- [ ] Add E2E tests for critical paths: signup → onboarding → POS sale → billing
- [ ] Investigate and clean up backend Jest open handles reported after E2E suite completion
- [ ] Clean up React `act(...)` warnings in login/signup page tests
- [ ] Add integration tests for payment webhook handlers
- [ ] Add load tests for POS endpoint (peak: multiple cashiers × multiple tenants)
- [x] Verify GitHub Actions CI actually runs tests on every push — CI now triggers on push/PR to main and dev

---

## IMPORTANT — First month after launch

### Marketing & Onboarding
- [ ] Build real marketing/landing page (current `page.tsx` is a placeholder)
- [ ] Pricing page with feature comparison table across all 4 tiers
- [ ] Onboarding wizard for new tenants (add store → add products → first sale)
- [ ] In-app contextual help / tooltips for complex features (COA, posting rules, stock takes)
- [ ] Demo/sandbox account for prospects to try before subscribing
- [ ] Video walkthroughs or screenshot tours of key workflows

### Localization
- [ ] Bangla (Bengali) language support — documented as market requirement in PRD, not built
- [ ] Migrate remaining frontend literal strings to localization catalogs (dashboard, auth, billing, POS, inventory, storefront, onboarding)
- [ ] Verify consistent BDT currency formatting throughout UI
- [ ] Date format localization (BD convention)
- [ ] Bangla number formatting option

### Accounting Reports
- [x] Profit & Loss account (income statement) — revenue vs expenses, net profit/loss for a date range — done 2026-05-29
- [x] Balance sheet — assets, liabilities, and equity snapshot at a given date — done 2026-05-29
- [x] Cashbook — cash receipts and payments ledger with running balance — done 2026-05-29
- [x] Bankbook — bank account receipts and payments ledger with running balance — done 2026-05-29

### Sales Reports
- [x] Product-wise sales summary — quantity sold, revenue, and margin per product for a selected period — done 2026-05-29
- [x] Customer-wise sales summary — total orders, revenue, and average order value per customer for a selected period — done 2026-05-29
- [x] Month-by-month sales metrics per customer — monthly breakdown of order count, revenue, and trend per customer — done 2026-05-29

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

---

## ROADMAP — Post-launch features

- [ ] E-commerce storefront (Standard/Premium tier feature per PRD)
- [ ] Manufacturing / BOM module (Premium tier)
- [ ] Delivery / fulfillment management
- [ ] Offline-capable POS (service worker + IndexedDB sync)
- [ ] Multi-branch consolidated reporting
- [ ] Third-party accounting exports (Tally/QuickBooks format)
- [ ] Public API + API key management for enterprise customers
- [ ] White-label option

---

## COMPLETED

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
