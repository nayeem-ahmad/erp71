# Mobile app for tenant admins — plan

Status: **proposed, 2026-10-07.** Nothing here is built. Written in answer to
"make a plan for the Top Picks", the five mobile features proposed for tenant
admins:

1. Live business pulse (home screen)
2. One-tap approvals inbox
3. Smart push alerts
4. Cashier shift and cash-drawer monitor
5. Ask-your-business AI chat (voice-enabled)

The short version:

> **An admin opens the app to glance, approve and get alerted, not to do data
> entry. So the app is a thin client over endpoints that already exist, plus
> three new backend pieces: device tokens with FCM delivery, a read-only
> approvals inbox that adapts the existing flows, and one compact "pulse"
> endpoint.**

---

## 1. What already exists

### 1.1 Mobile (`apps/mobile`)

- Flutter 3.47.5, Riverpod, go_router, `flutter_secure_storage`, `http`.
- Google sign-in, two-factor, a **workspace switcher**
  (`features/workspace/workspace_screens.dart`) and sign-out per session.
- One feature area: CRM, behind a four-tab `NavigationBar`
  (`features/home/home_shell.dart`: Overview, Leads, Activities, Contacts).
- Widget tests run the whole app at 360 × 780 against an in-memory backend
  (`test/support/fake_backend.dart`).

### 1.2 Backend the features can reuse

| Feature | Existing endpoint or service | What's missing |
|---|---|---|
| Pulse | `GET sales/dashboard/overview`, `GET sales/dashboard/trends` (branch-scoped via `resolveStoreId`), plus the purchase, inventory and accounting dashboards | One compact payload; the web overview carries full product and category tables, too heavy for a phone glance |
| Approvals | Eleven tenant-scoped bespoke flows (`docs/approval-workflow-plan.md` §1): vouchers, leave, expense claims, warehouse transfers, product demands, CRM activities, payroll, overtime, stock take, warranty, fund transfers | A single inbox. The approval engine is **proposed, not built** |
| Alerts | `Notification` model plus `NotificationsService.create()`; daily `@Cron` jobs for low stock and subscription expiry; `AnomalyDetectionService` (SQL outliers: sold below cost, duplicate invoice, backdated entry…) | Any push delivery. Nothing uses FCM, and the backend checks Firebase *phone* ID tokens by hand against JWKS (`auth/firebase-token.service.ts`), not with `firebase-admin` |
| Cashier monitor | `GET cashier-sessions/open`, `store/:storeId/open`, `:sessionId/summary`, `:sessionId/cash-transactions` | A cross-branch "who's on shift now" view and a close event to hook alerts onto |
| AI chat | `POST ai/chat` (non-streaming, 20/min throttle, credit-metered), `GET ai/chat/tools`, conversations; `parse-voice-entry`/`parse-voice-sale` | Nothing for a first version. Streaming is a later nicety |

---

## 2. Cross-cutting decisions

**2.1 Navigation.** The app stops being "the CRM app". The bottom bar becomes
**Home · Approvals · Alerts · More**. CRM moves under *More* (alongside Cashiers,
Ask AI and Settings) for people who have both; someone holding only CRM
permissions still lands on today's CRM home. Each tab shows only when the
signed-in person holds the permission behind it. `features/crm/access.dart` is
the pattern to generalize into `core/access.dart`.

**2.2 Permissions are the backend's, never the app's.** Every new endpoint uses
the same `@RequireAnyStorePermission` plus `branchScope.resolveStoreId` pair the
sales dashboard uses. The app hides what the person can't use but never treats
hiding as a check. A branch-limited manager sees their branches only; an owner
sees `all`.

**2.3 Offline: read-only cache.** Pulse, the approvals list and alerts are
cached (last response plus fetch time) and shown with a "as of 10:42" stamp when
the network is gone. Actions (approve, reject) **never queue offline**: an
approval acted on minutes later, after someone else already decided, is worse
than a clear "you're offline" message.

**2.4 Money and time.** Amounts are formatted the way `formatBDT()` does it, in
`core/format/format.dart`, and always ৳. "Today" is the tenant's day in
`tenant.timezone`, computed by the backend. The app never computes a business
day from the phone's clock.

**2.5 Tests.** Every screen gets a widget test against `fake_backend.dart` at
360 px, as the CRM screens do today. Every new backend endpoint gets a service
spec covering tenant scoping and branch scoping.

---

## 3. Feature plans

### 3.1 Live business pulse

**What the admin sees:** today's net sales, transactions, average basket, gross
margin, and the tender split (cash / bKash / Nagad / card / bank), each compared
with yesterday and the same weekday last week. Below that: cash in hand across
open drawers, receivables due and overdue, payables due this week, and a 7-day
sparkline. A branch picker sits at the top, with *All branches* first for owners.
Pull to refresh.

**Backend:** a new `GET mobile/pulse?storeId=` in a small `MobileModule` that
composes the existing services rather than re-querying:

- Sales figures come from `SalesDashboardService`. Use its window helpers and
  call it for three windows: today, yesterday, and the same weekday last week.
- The tender split groups `SalePayment`. It must follow whatever
  `docs/dynamic-payment-methods-plan.md` settles on: classify through
  `classifyPaymentMode`, never by raw type strings.
  The ~3,800 legacy `CASH`/`BKASH` rows are why.
- Cash in hand is the sum of open `CashierSession` expected cash.
- Receivables and payables come from the existing customer and supplier
  balance queries the accounting dashboard uses.

Return pre-computed deltas so the app does no arithmetic. Target < 300 ms; cache
per (tenant, store) for 60 s.

**Home-screen widget:** today's sales with its delta, using `home_widget`.
This is a follow-up, not v1: widgets refresh on the OS's schedule, not ours,
and need their own auth story.

**Size:** S backend · M mobile.

### 3.2 Approvals inbox

**The problem:** the parameter-driven approval engine
(`docs/approval-workflow-plan.md`) is not built. Its own Phase 5 lists
"approve-from-notification on mobile". Waiting for that would hold back the
most valuable feature by several phases.

**The approach:** ship an **inbox adapter** now, shaped like the engine's
eventual output so the swap is internal:

```
GET  approvals/inbox?storeId=          → [{ kind, id, title, amount, requested_by,
                                            requested_at, store, summary_lines[], link }]
POST approvals/:kind/:id/approve        { note? }
POST approvals/:kind/:id/reject         { reason }
```

- Each `kind` is a small provider class with three methods: list pending, apply
  approve, and apply reject. Each delegates to the module's **existing** approve
  and reject service method, so permission checks, audit rows and side effects
  (posting a voucher, deducting leave) stay exactly where they are.
- The providers are registered in a map, which is the same seam the engine's
  §5 "integration seam" describes. When the engine lands, the voucher provider
  becomes "read `ApprovalRequest`s" and nothing on the phone changes.
- v1 kinds, in priority order: **expense claims, leave requests, vouchers,
  product demands, warehouse transfers, payroll runs.** Every one has an
  `approved_by` column and an existing approve path.
- **Left out, with reasons:**
  - Overtime and warranty have no permission guard today (engine plan §1),
    and adding a phone path to an unguarded approval widens the hole.
  - Fund transfers have no approval state at all.
  - CRM activity approvals are high volume and low value, so they wait.

**Mobile:**
- A list grouped by kind, with a count badge on the tab.
- A detail sheet with the lines that matter (amount, who, why, attachments).
- Approve, or reject with a required reason.
- **Biometric confirm** (`local_auth`) for amounts at or above a per-tenant
  threshold (default ৳50,000).
- After acting, the row disappears with an undo snackbar *before* the request
  is sent. There is no undo after.

**Concurrency:** two admins acting on the same item is expected. Every provider's
apply step must be a conditional update (`WHERE status = 'PENDING'`). The
loser gets `409 Already decided by <name>`, and the app shows that, not an
error.

**Size:** M backend (6 providers, mostly glue, with real specs) · M mobile.

### 3.3 Smart push alerts

**Delivery infrastructure (prerequisite for 3.2 badges and all of 3.3):**

- New `DeviceToken` model: `id`, `user_id`, `tenant_id` (nullable for
  pre-workspace), `token` unique, `platform`, `app_version`, `last_seen_at`.
  Prisma migration, scoped as usual.
- `POST me/devices` registers or refreshes a token; `DELETE me/devices/:token`.
  Sign-out deletes the device's token *before* the refresh token is revoked.
  The existing `POST /auth/logout/session` path is where this goes.
- `PushService` sends through **FCM HTTP v1** with a service-account JSON in
  `.env.production`. Use `google-auth-library` for the OAuth token rather than
  pulling in all of `firebase-admin`. It handles tokens that come back
  `UNREGISTERED` by deleting them.
- **Hook point:** `NotificationsService.create()` gains an optional push. Every
  in-app notification can also push, so the bell list and the phone never
  disagree. A row is written first and the push is best-effort after it.
- Mobile uses `firebase_messaging`. A tap deep-links through go_router using the
  notification's `link`, mapped to a mobile route where one exists and falling
  back to the Alerts tab.

**Which alerts (v1):**

| Alert | Source | Trigger |
|---|---|---|
| Approval waiting | 3.2 providers | On submit, to everyone who can approve it |
| Cash shortfall at drawer close | `CashierSessionsService.close()` | `counted − expected` beyond tolerance (default ৳500) |
| Big sale / big refund / void | Sales + sales-returns services | Above a per-tenant threshold |
| Discount above limit | Sales service | Line or bill discount above a % threshold |
| Low stock | existing `@Cron('0 13 * * *')` job | Already writes `Notification` rows, now also pushes |
| New storefront enquiry | `storefront-enquiries` | On create |
| Anomalies digest | `AnomalyDetectionService` | Daily, top 5 by taka at stake, one push |
| Subscription expiring / payment failed | billing scheduler | Already exists, now pushes |

**Settings:**
- `AlertPreference` (user × alert type) controls on or off and push or in-app
  only.
- Each user sets quiet hours (default 22:00–08:00 tenant time). During quiet
  hours, pushes are held and delivered as one summary at the end.
- Tenant-level thresholds live on a `MobileAlertSettings` row, editable on the
  web settings page and in the app.

**Volume guard:** the same alert type for the same entity is collapsed within
10 minutes. A tenant-wide cap is 30 pushes per user per day, after which they
roll into the digest. A shop that fires 200 "low stock" pushes on day one gets
the app uninstalled.

**Size:** M backend (infra) + S per alert · S mobile.

### 3.4 Cashier shift and cash-drawer monitor

**What the admin sees:** a list of open sessions across the branches they can
see: cashier, counter, opened at, sales so far, and expected cash. Tap one for
`:sessionId/summary` and its cash transactions (pay-ins, pay-outs). A
"Closed today" section shows expected vs counted with the variance coloured
emerald, amber or red.

**Backend:**
- One new `GET cashier-sessions/overview?storeId=` returns open and today-closed
  sessions across the caller's branches. Today, `store/:storeId/open` is one
  branch at a time, which would be N calls for an owner.
- The rest exists. The multi-cashier till work (TODO.md, 2026-09-16) is what
  this reads.

**Hook for 3.3:** the shortfall alert fires inside `close()`.

**Size:** S backend · S mobile.

### 3.5 Ask-your-business AI chat

**What the admin sees:** a chat screen with suggestion chips ("Today vs
yesterday", "Who owes me most?", "What's running low?", "Anything unusual this
week?"). A mic button records speech, sends it for speech-to-text, and puts
the text in the box for review; it is never sent straight away. The app writes
the reply out as text and shows a "used N credits" footer.

**Backend:** none for v1. `POST ai/chat` already does tenant-scoped tool use,
conversation history and credit metering. `GET ai/chat/tools` drives the empty
state, exactly as on web.

**Speech-to-text:** on-device (`speech_to_text`, which supports `bn-BD` and
`en-US`) for v1. It's free, private and good enough for short questions. Pass
`locale` through so the reply comes back in the same language.

**Later:** streaming the response (SSE) is a backend change that also benefits
web, and should be done once for both.

**Size:** — backend · S mobile.

---

## 4. Phases

| Phase | Ships | Depends on |
|---|---|---|
| **0 — Shell** | New bottom nav + `core/access.dart`; CRM moved under *More*; biometric app lock (`local_auth`, opt-in, on resume after 5 min) | — |
| **1 — Glance** | 3.1 Pulse (`mobile/pulse`, home screen) · 3.4 Cashier monitor | 0 |
| **2 — Push infra** | `DeviceToken`, `PushService` (FCM v1), `NotificationsService.create()` pushes, existing low-stock + billing alerts now reach phones, Alerts tab | Firebase project + FCM service account in prod env; iOS APNs key |
| **3 — Approvals** | 3.2 inbox adapter with expense claims, leave, vouchers first; then product demands, warehouse transfers, payroll; "approval waiting" push | 2 (for the push only — the inbox itself can ship after 0) |
| **4 — Smart alerts** | Shortfall, big sale/refund/void, discount, enquiry, anomaly digest; preferences, quiet hours, volume guard | 2, 1 (shortfall) |
| **5 — Ask AI** | 3.5 chat screen + on-device voice | 0 |

Phase 5 is independent and small, so it can be done in parallel by anyone
whenever there is capacity. Phases 1 and 3 are where the value is. Phase 2 is
the only one with an ops dependency, so the Firebase and APNs setup should start
on day one.

---

## 5. What will bite

- **Approval double-decisions.** Covered in 3.2. Write the conditional-update
  spec for every provider; it's the bug that will reach production otherwise.
- **The tender split is only as right as payment classification.** Until
  Phase 2 of the dynamic payment methods plan lands, bKash taken on sale entry
  posts as `Mobile Wallet` → bank (TODO.md). The pulse must say "Mobile
  wallet" rather than guessing bKash vs Nagad for those rows.
- **Branch scope on pushes.** An alert for branch B must only go to people who
  can see branch B. Resolve recipients via the same branch-access check the
  endpoints use, not "every admin in the tenant".
- **Tokens outliving sessions.** A phone signed out remotely, or whose session
  is revoked, must stop receiving pushes. Delete the device token on session
  revocation, not only on in-app sign-out.
- **iOS.** Push needs an APNs key uploaded to Firebase, and Google sign-in's
  iOS client values are still unfilled (README). iOS is effectively Phase 2+.
- **Notification copy is in two languages.** `Notification.title`/`body` are
  stored rendered. Render them in the recipient's `preferred_locale` at create
  time, as the email jobs do.

---

## 6. Out of scope

- Data entry on mobile (sales, purchases, POS). The web POS is already
  mobile-responsive and a second POS is a second product.
- Building the approval engine itself. This plan adapts to it and does not
  replace `docs/approval-workflow-plan.md`.
- Offline actions (see 2.3).
- Home-screen widget, multi-business "add a workspace" (TODO.md), receivables
  collection, barcode stock check, attendance. These are the second-tier
  proposals and get their own plan.
