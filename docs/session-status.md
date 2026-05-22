# Session Status

## Last updated: Session 15 (2026-05-22)

## Completed
- feat(80-2,80-3): Customer segment evaluation & paginated purchase history
- feat(story-11-3): Warranty Serial Tracking & Claims MVP
- feat(accounting): Posting status on all accounting pages (Stories 31-1 through 31-5)

## Session 1 — CRITICAL: Security + Email
Working through GitHub issues in priority order. Issues marked ✅ are closed/done.

### Security
- [x] #43 CSRF protection — helmet + throttler added; JWT Bearer auth makes classic CSRF N/A
- [x] #44 Audit logging table — AuditLog model + AuditService/AuditModule (global)
- [x] #42/#121 .env in git history — **VERIFIED CLEAN** (only .env.example in history; .env is in .gitignore)

### Email
- [x] #45 Integrate email service — Resend (EmailService/EmailModule, falls back to log if no API key)
- [x] #48 Password reset flow — PasswordResetToken model + /auth/forgot-password + /auth/reset-password
- [x] #47 Onboarding welcome email — wired into auth.service.ts signup
- [x] #49 User invitation emails — UserInvitation model + InvitationsModule (/invitations/send + /invitations/accept)
- [x] #50 Low-stock / reorder point alert emails — daily cron at 07:00 in NotificationsService
- [x] #51 Subscription expiry warning emails — daily cron at 08:00 (1d + 7d before expiry)
- [x] #46 Transactional billing emails — EmailService.sendBillingInvoice + sendPaymentFailure (ready to wire into BillingModule)

**Pending action (user):** Add `RESEND_API_KEY` and `EMAIL_FROM` to production env vars.

## Session 2 — CRITICAL: Infrastructure + Monitoring
- [ ] #52 Upgrade Render plan — **USER ACTION**: Change `plan: free` → `standard` in render.yaml for backend/frontend, redeploy
- [x] #53 Staging environment — staging services added to render.yaml (deploy from `staging` branch)
- [x] #54 DB backups — scripts/backup-db.sh + docs/ops/deployment-runbook.md; **USER ACTION**: enable Supabase PITR in dashboard
- [x] #55 PgBouncer config — directUrl added to schema.prisma; docs/ops/pgbouncer-config.md
- [x] #56 Production deployment runbook — docs/ops/deployment-runbook.md
- [x] #57 Sentry — @sentry/nestjs in backend (instrument.ts), @sentry/nextjs in frontend (3 config files + global-error.tsx)
- [x] #58 Uptime monitoring — /health endpoint (db check + latency); docs/ops/uptime-monitoring.md (BetterStack setup guide)
- [x] #59 Alerts — Sentry alert rules documented, Render notifications guide, DB connection alert guide

**Pending user actions:**
1. Upgrade Render plan from `free` to `standard` (change in render.yaml, then redeploy)
2. Enable Supabase Point-in-Time Recovery: Dashboard → Database → Backups → Enable PITR
3. Set up BetterStack uptime monitor pointing at /health (see docs/ops/uptime-monitoring.md)
4. Set Sentry alert rules in Sentry dashboard (see docs/ops/uptime-monitoring.md)
5. Add SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT to Render env vars

## Session 3 — HIGH: Auth + API Hardening + Compliance ✅ (PR #200)
- [x] #67 Email verification on signup — EmailVerificationToken model, /auth/verify-email, /auth/resend-verification
- [x] #68 Session invalidation on password change — token_version in JWT; logout increments; password reset increments
- [x] #69 TOTP 2FA — native crypto RFC 6238; /auth/2fa/{setup,enable,disable,verify} endpoints
- [x] #70 API versioning — app.setGlobalPrefix('api/v1'); frontend API_BASE updated
- [x] #71 Response envelope — TransformInterceptor wraps { data: T }; fetchWithAuth unwraps transparently
- [x] #72 Pagination — PaginationDto + paginate(); products + customers paginated (default 20, max 100)
- [x] #73 Soft deletes — deleted_at on Product/Customer/Supplier; remove() soft-deletes; queries filter
- [x] #74 Data retention — daily cron purges expired tokens (>7d) + audit logs (>90d)
- [x] #75 Encryption utility — EncryptionService AES-256-GCM in CommonModule (no fields need it yet)
- [x] #76 GDPR basics — DELETE /account/data-deletion-request, GET /account/data-export, /privacy page

**Pending user actions:**
1. Set FIELD_ENCRYPTION_KEY in Render env (32 random bytes as hex)
2. Create frontend /verify-email page to call GET /api/v1/auth/verify-email?token=

## Session 4 — HIGH: Testing ✅
- [x] #79 Coverage threshold verified — jest.config.js fixed (collectCoverageFrom src/**/*.ts, coverageReporters text-summary+lcov+html); CI uploads lcov+html artifacts; frontend jest.config.ts updated similarly
- [x] #80 E2E tests (Playwright) — playwright.config.ts + e2e/{auth,pos,billing}.spec.ts; CI job (test-e2e) runs on main push or 'run-e2e' label
- [x] #81 Payment webhook integration tests — billing.service.spec.ts expanded (IPN, cancel, yearly cycle, role guard, confirm checkout, getSummary, cancelAtPeriodEnd, reference mismatch); billing.controller.spec.ts added (supertest)
- [x] #82 POS load tests — load-tests/pos-sale.js (k6): ramp 1→50 VUs, p95<2s threshold, multi-tenant scenario

## Session 5 — IMPORTANT: Marketing + Localization + Performance ✅ (PR #203, merged)
- [x] #83 Real marketing/landing page — full marketing page (hero, features, stats, testimonials, pricing, CTA, footer) targeting Bangladeshi retailers
- [x] #85 Onboarding wizard — 3-step wizard at /dashboard/onboarding (add product → open POS → done); persistent banner on dashboard home
- [x] #89 Bangla language support — I18nProvider context + useI18n() hook; translation files en/bn; LanguageSwitcher in dashboard header; persisted to localStorage
- [x] #90 BDT currency consistency — formatBDT() via Intl.NumberFormat (৳ symbol); mass-replaced all toFixed(2) across 40+ dashboard pages, modals, POS receipt printer
- [x] #95 Redis caching — @upstash/redis + RedisService + global CacheModule; products/sales findAll cached 60 s TTL; invalidated on create/update/remove; graceful no-op fallback
- [x] #96 Cursor-based pagination — CursorPaginationDto + cursorPaginate(); GET /products?cursor= and GET /sales?cursor= (both cursor + offset modes preserved); backend tests updated

## Session 6 — IMPORTANT: Product completeness + Localization ✅ (PR #205, merged)
- [x] #93 Customer receipt email — SalesService fires sendBillingInvoice() after tx commit; fire-and-forget; skips walk-ins/no-email customers
- [x] #94 Bulk CSV import — POST /api/v1/products/import (multer + RFC-4180 parser); upsert by SKU; inventory movement for stock_quantity; "Import CSV" button on inventory page
- [x] #91 Date format localization — formatDate(date, locale?) in format.ts (en-GB DD/MM/YYYY default, bn-BD for Bangla); replaced raw toLocaleDateString() in 20 pages
- [x] #92 Bangla number formatting — formatNumber(n, locale?) in format.ts using Intl.NumberFormat bn-BD
- [ ] #84 Pricing page — /pricing route with 4-tier comparison table (FREE/BASIC/STANDARD/PREMIUM) linked from landing page
- [ ] #86 In-app contextual help / tooltips — tooltip component for COA, posting rules, stock takes
- [ ] #87 Demo/sandbox account — seed script + demo login on landing page

## Session 7 — IMPORTANT: Marketing polish + UX ✅ (PR #206, merged)
- [x] #84 Pricing page — /pricing with 4-tier comparison table, monthly/yearly toggle, 14-feature matrix, FAQ, footer
- [x] #86 Contextual help / tooltips — HelpTooltip component; wired into COA, vouchers, stock takes, POS
- [x] #87 Demo sandbox — seed-demo.ts + POST /auth/demo + Try Demo button on login + landing page hero CTA
- [x] #186 Dependency vulnerability scanning — npm audit --audit-level=high CI job (non-blocking)

## Session 8 — UX gaps + legal pages ✅ (PR #208, merged)
- [x] #67 Email verification frontend page — /verify-email?token= with loading/success/error states
- [x] #77/#78 ToS + Privacy Policy — /terms (11 sections, BD law/NBR) + /privacy (9 sections, data retention details); footer + signup consent
- [x] Account settings — /dashboard/settings: Profile tab (PATCH /auth/me), Password tab (change-password with bcrypt), 2FA tab (QR setup, enable/disable); sidebar link added
- [x] #103 In-app feedback widget — FeedbackWidget: floating pill, slide-up card, Bug/Feature/General, POST /feedback; wired into dashboard layout

## Session 9 — Ops hardening + PWA + support ✅ (PR #209, merged)
- [x] #105 Structured logging — Winston + AsyncLocalStorage; CorrelationMiddleware injects x-request-id; AppLogger extends ConsoleLogger
- [x] #52 Render plan upgrade — render.yaml updated free → standard for all services
- [x] Public /status page — /status with real-time health tiles (API up/down, DB latency, 30s auto-refresh); linked from footer
- [x] PWA manifest — app/manifest.ts (Next.js App Router route); meta tags in layout
- [x] Support contact form — /contact page + POST /api/v1/contact (rate-limited 3/min); emails via EmailService

## Session 10 — Legal + DB + compliance ✅ (PR #210, merged)
- [x] /refund page — 7-section refund/cancellation policy (#98)
- [x] /sla page — SLA: 99.9% uptime, P1-P4 table, credit tiers (#99)
- [x] DB indexes — compound indexes on Sale/Product/Customer/AuditLog
- [x] NID encryption — EncryptionService AES-256-GCM; Customer.nid encrypted at rest (#75)

## Session 11 — Reporting + exports ✅ (PR #211, merged)
- [x] Tally/QuickBooks exports — GET /accounting/export?format=tally|quickbooks (#118)
- [x] Consolidated sales report — GET /sales-reports/consolidated; /dashboard/reports/consolidated page (#117)

## Session 12 — Public API + API key management ✅ (PR #212, merged)
- [x] ApiKey model + SHA-256 hash lookup; ApiKeyStrategy/Guard/CombinedAuthGuard (#119)
- [x] GET/POST/DELETE /api-keys; per-plan daily rate limits via Redis

## Session 13 — E-commerce storefront ✅ (PR #213, merged)
- [x] StorefrontOrder + StorefrontOrderItem models; storefront_slug/enabled/banner on Tenant (#113)
- [x] Public GET /storefront/:slug + POST /storefront/:slug/orders; protected order management
- [x] /store/[slug] public page; /dashboard/storefront orders + settings pages

## Session 14 — Offline POS ✅ (PR #214, merged)
- [x] Service worker (public/sw.js): network-first API, Background Sync 'pos-sync' (#116)
- [x] pos-db.ts IndexedDB wrapper; useOfflineSync hook; ServiceWorkerRegistrar component
- [x] POS page: offline banner, pending badge, product cache fallback, offline sale queuing

## Session 15 — White-label branding ✅ (PR #215, merged)
- [x] brand_primary_color/logo_url/favicon_url/business_name on Tenant (#120)
- [x] GET+PATCH /tenants/branding; BrandingProvider with CSS custom properties
- [x] /dashboard/settings/branding; sidebar shows tenant logo/name

## Session 16 — Delivery / fulfillment management (in progress)
- [ ] #115 Delivery / fulfillment module — delivery orders, driver assignment, status tracking

**Note:** Email system (#45–51), monitoring (#57–59), auth hardening (#67–69), API hardening (#70–72), compliance (#73–76), testing (#79–82) all completed in Sessions 1–4.

## Pending user actions (accumulated)
1. Add `RESEND_API_KEY` and `EMAIL_FROM` to production env vars (Resend dashboard → API keys)
2. Upgrade Render plan from `free` to `standard` in render.yaml → redeploy (#52)
3. Enable Supabase Point-in-Time Recovery: Dashboard → Database → Backups → Enable PITR (#54)
4. Set up BetterStack uptime monitor → /health endpoint (see docs/ops/uptime-monitoring.md) (#58)
5. Set Sentry alert rules in Sentry dashboard (see docs/ops/uptime-monitoring.md) (#59)
6. Add `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` to Render env vars (#57)
7. Set `FIELD_ENCRYPTION_KEY` in Render env (32 random bytes as hex) (#75)
8. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Render env vars (#95)
9. Create frontend /verify-email page to call GET /api/v1/auth/verify-email?token= (#67)

## Resume Instructions
Start by reading this file. Continue from the first unchecked item in the current session.
For the next fresh session: run `git log --oneline -5` to confirm last push, then continue.
