# Session Status

## Last updated: Session 1 (2026-05-20)

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

## Session 4 — HIGH: Testing
- [ ] #79 Verify 80% coverage threshold
- [ ] #80 E2E tests for critical paths
- [ ] #81 Integration tests for payment webhooks
- [ ] #82 POS load tests

## Session 5 — IMPORTANT: Marketing + Localization + Performance
- [ ] #83 Real marketing/landing page
- [ ] #85 Onboarding wizard
- [ ] #89 Bangla language support
- [ ] #90 BDT currency consistency
- [ ] #95 Redis caching
- [ ] #96 Cursor-based pagination

## Resume Instructions
Start by reading this file. Continue from the first unchecked item in the current session.
For the next fresh session: run `git log --oneline -5` to confirm last push, then continue.
