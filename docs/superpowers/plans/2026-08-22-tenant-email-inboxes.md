# Tenant Email Inboxes — R1 (relay ingest + IMAP lane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a tenant a real shared email inbox inside ERP71 — receive, thread, read, assign and reply — **without ERP71 running a mail server**. Two ingestion lanes land on one data model: a provider relay that webhooks parsed mail at us (Lane A), and IMAP polling of a mailbox the tenant already owns (Lane B). Lark Mail is the reference provider for Lane B.

**Architecture:** Four new Prisma models — `TenantMailbox`, `EmailThread`, `EmailMessage`, `EmailAttachment` — all `tenant_id`-scoped. `TenantMailbox.kind` is the seam between lanes: `RELAY` mailboxes are addresses on a domain we control and arrive by webhook; `IMAP` mailboxes are the tenant's own and are polled on a cron. Both lanes normalise to one internal shape (`NormalisedMessage`) before a single provider-agnostic `MailIngestService` does threading, dedupe and persistence — so a third lane (Lark's `mail-v1` API, Microsoft Graph) is a new adapter, not a new pipeline. Outbound reuses the existing `EmailService`, which already resolves per-tenant sender identity from `TenantMessagingIdentity`. Bodies live in Postgres; attachments go to Cloudinary through the existing `AssetsService`.

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, `@nestjs/schedule`, `mailparser` (MIME → structured), `imapflow` (IMAP client), `nodemailer` (already present), Jest (`apps/backend`), Next.js 15 + Tailwind (`apps/frontend`).

**Why not host mail:** covered in "Rejected: self-hosted mail server" at the bottom. Short version — port 25 egress is filtered on most VPS hosts, a fresh IP has no sending reputation, and we would own spam filtering and blocklist delisting forever.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Additive only.** Production reconciles schema with `prisma db push --skip-generate --accept-data-loss` on container start (`apps/backend/Dockerfile`, the `CMD` line) and **never runs the migrations directory**. A non-additive change silently destroys data on the next restart. `prisma migrate diff` between `dev` and the branch must emit zero `DROP` and zero `ALTER COLUMN`.
- **Multi-tenancy.** Every business query filters on `tenant_id`. Cross-tenant ids return 404, never 403. The inbound webhook (Task 4) is the *one* deliberate exception to JWT-derived tenancy and is called out explicitly there.
- **Secrets are encrypted at rest.** IMAP/SMTP passwords and relay signing secrets go through `encryptValue()` / `decryptValue()` from `apps/backend/src/platform-settings/crypto.util.ts`. Never store, log, or return a plaintext secret — GET endpoints return the `SECRET_MASK` bullets, and a submitted `SECRET_MASK` means "unchanged" (the pattern `TenantMessagingIdentityService.update()` already uses for the WhatsApp token).
- **New permissions reach nobody by default.** `ROLE_DEFAULT_PERMISSIONS` is read only at tenant creation and role assignment. A permission added to `packages/shared-types/index.ts` grants nothing to any user who already exists until `sync:role-permissions` runs on container start — and the `OWNER` bypass in `StorePermissionGuard` hides that from whoever tests it. Task 2 covers this.
- **Nine locales.** `ar, bn, de, en, es, fr, hi, ms, ur`. `catalog.test.ts` compares key paths across all nine, so a `labelKey` added to `en` only fails the suite. `ar` and `ur` are RTL — see `docs/rtl-guidelines.md`.
- **Saved sidebar layouts are returned verbatim.** `resolveTenantSidebarLayout` does not merge new nodes into a layout a tenant has customised, and `addNavNodesToLayout` only inserts missing ids without reparenting. A tenant who customised their sidebar will not see a new Inbox entry. Same trap recorded at `TODO.md` for `admin.support`.
- **UI rules are non-negotiable.** `PageShell` + `PageHeader` on every `(app)` page, `ModalShell` for every modal, `blue-600` as the only accent, `formatBDT()` for money. Full spec: `docs/ui-design-guidelines.md`.
- **Test command:** `npm test --workspace=apps/backend -- <pattern>`. Full suite: `npm test --workspace=apps/backend`.
- **Baseline:** 3 known pre-existing backend typecheck errors in test files; 4 `test/*.spec.ts` integration suites fail without a live Postgres; `accounting/page.test.tsx` has one pre-existing frontend failure. All expected — do not chase them.
- **Commit style:** conventional commits, scope `mailbox`. Work on `dev`; never commit to `main`.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `apps/backend/src/mailbox/mailbox.module.ts` | Wiring |
| `apps/backend/src/mailbox/mailbox.dto.ts` | Request DTOs + sort/filter allowlists |
| `apps/backend/src/mailbox/mailbox.service.ts` | Mailbox CRUD, connection test, secret masking |
| `apps/backend/src/mailbox/mailbox.controller.ts` | Tenant routes + permission decorators |
| `apps/backend/src/mailbox/mail-ingest.service.ts` | Lane-agnostic: dedupe, threading, persistence |
| `apps/backend/src/mailbox/mail-normalise.ts` | MIME/provider payload → `NormalisedMessage` |
| `apps/backend/src/mailbox/threading.util.ts` | RFC 5322 `Message-ID` / `References` resolution |
| `apps/backend/src/mailbox/inbound-webhook.controller.ts` | Lane A: public, secret-verified relay endpoint |
| `apps/backend/src/mailbox/imap.client.ts` | Lane B: `imapflow` wrapper, one connect-fetch-close cycle |
| `apps/backend/src/mailbox/imap-poll.scheduler.ts` | Lane B: cron, tracked through `JobTrackerService` |
| `apps/backend/src/mailbox/*.spec.ts` | Unit tests per file above |
| `apps/frontend/src/app/(app)/inbox/page.tsx` | Thread list |
| `apps/frontend/src/app/(app)/inbox/[threadId]/page.tsx` | Thread reader + reply composer |
| `apps/frontend/src/app/(app)/settings/mailboxes/page.tsx` | Mailbox connect/manage screen |

**Modify:**

| Path | Change |
|---|---|
| `packages/database/prisma/schema.prisma` | The four models + `Tenant` back-relations |
| `packages/shared-types/index.ts` | 3 permissions + labels + groups + role defaults |
| `packages/shared-types/navigation.ts` | `inbox` module node + child links |
| `packages/database/prisma/sync-role-permissions.ts` | Grant the new permissions to existing roles |
| `apps/backend/src/app.module.ts` | Register `MailboxModule` |
| `apps/backend/src/email/email.service.ts` | Accept threading headers + `replyTo` override on send |
| `apps/backend/src/system-health/jobs/job-names.ts` | `MAILBOX_IMAP_POLL` + its expected-schedule row |
| `apps/frontend/src/lib/localization/messages/{ar,bn,de,en,es,fr,hi,ms,ur}/*.ts` | `sidebar.items.inbox*` + inbox UI strings |
| `docs/data-retention-policy.md` | Retention for message bodies and attachments |

---

## Task 1: Schema — the four models

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma delegates `db.tenantMailbox`, `db.emailThread`, `db.emailMessage`, `db.emailAttachment`. Every later task depends on these.

- [ ] **Step 1: Add the four models**

Append after `TenantMessagingIdentity` (around line 802), which is the closest neighbour conceptually — that model owns the *sending* identity, these own the mailbox.

```prisma
/// One connected mailbox. `kind` selects the ingestion lane: RELAY mail arrives
/// by webhook on a domain we control, IMAP mail is polled from a mailbox the
/// tenant already owns. A third lane (Lark mail-v1, Microsoft Graph) is a new
/// kind plus an adapter, not a new table.
model TenantMailbox {
  id        String @id @default(uuid())
  tenant_id String

  /// The address mail arrives at, lowercased on write. Unique per tenant.
  address      String
  display_name String?
  /// RELAY | IMAP
  kind         String  @default("RELAY")
  is_active    Boolean @default(true)

  /// RELAY only: the opaque token in the recipient address that resolves this
  /// mailbox without trusting the display portion. See threading/routing notes
  /// in the plan. Null for IMAP.
  routing_key  String? @unique

  /// IMAP only. Password is AES-256-GCM ciphertext from crypto.util — never plain.
  imap_host     String?
  imap_port     Int?
  imap_username String?
  imap_password String?
  imap_use_tls  Boolean @default(true)
  /// UIDVALIDITY + last seen UID, so a poll resumes instead of refetching. A
  /// changed UIDVALIDITY means the server renumbered and we must resync.
  imap_uid_validity String?
  imap_last_uid     Int?

  /// SMTP for outbound on this mailbox. Null falls back to the platform sender.
  smtp_host     String?
  smtp_port     Int?
  smtp_username String?
  smtp_password String?

  /// Null = last poll succeeded. Set to the operator-facing reason on failure,
  /// so the settings screen can say "your Lark admin may not have enabled
  /// third-party client access" instead of "authentication failed".
  last_error       String?
  last_polled_at   DateTime?
  created_at       DateTime  @default(now())
  updated_at       DateTime  @updatedAt

  tenant   Tenant        @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  threads  EmailThread[]
  messages EmailMessage[]

  @@unique([tenant_id, address])
  @@index([tenant_id, is_active])
  @@map("tenant_mailboxes")
}

/// A conversation. Threading is by RFC 5322 headers first (see threading.util),
/// with a normalised-subject + participant-overlap fallback for the many senders
/// that strip References.
model EmailThread {
  id         String @id @default(uuid())
  tenant_id  String
  mailbox_id String

  subject           String
  /// Subject with Re:/Fwd:/Fw: and list tags stripped — the fallback match key.
  normalised_subject String
  /// Lowercased addresses of everyone seen on the thread, for the fallback match.
  participants      String[]

  /// open | closed
  status       String    @default("open")
  assignee_id  String?
  is_read      Boolean   @default(false)
  message_count Int      @default(0)
  last_message_at DateTime

  /// What this conversation is about. This is the whole reason the inbox lives
  /// in the ERP rather than in Gmail — nullable because most mail links to
  /// nothing until somebody says otherwise.
  customer_id     String?
  lead_id         String?
  supplier_id     String?
  sales_order_id  String?

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  tenant   Tenant         @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  mailbox  TenantMailbox  @relation(fields: [mailbox_id], references: [id], onDelete: Cascade)
  messages EmailMessage[]

  @@index([tenant_id, status, last_message_at])
  @@index([tenant_id, mailbox_id, last_message_at])
  @@index([tenant_id, normalised_subject])
  @@index([tenant_id, customer_id])
  @@map("email_threads")
}

model EmailMessage {
  id         String @id @default(uuid())
  tenant_id  String
  thread_id  String
  mailbox_id String

  /// IN | OUT
  direction String

  /// RFC 5322 Message-ID including angle brackets. The dedupe key — providers
  /// retry webhooks and an IMAP resync refetches, so both lanes must be
  /// idempotent on this.
  message_id  String
  in_reply_to String?
  references  String[]

  from_address String
  from_name    String?
  to_addresses String[]
  cc_addresses String[]

  subject   String?
  body_html String?
  body_text String?
  /// First ~200 chars of text, for the thread list without loading bodies.
  snippet   String?

  /// Provider spam verdict where one exists. Never auto-delete on this — store
  /// it, filter the default view, let a human look.
  spam_score Float?

  sent_at    DateTime
  created_at DateTime @default(now())

  tenant      Tenant            @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  thread      EmailThread       @relation(fields: [thread_id], references: [id], onDelete: Cascade)
  mailbox     TenantMailbox     @relation(fields: [mailbox_id], references: [id], onDelete: Cascade)
  attachments EmailAttachment[]

  @@unique([mailbox_id, message_id])
  @@index([thread_id, sent_at])
  @@index([tenant_id, direction, sent_at])
  @@map("email_messages")
}

model EmailAttachment {
  id         String @id @default(uuid())
  tenant_id  String
  message_id String

  filename     String
  content_type String?
  size_bytes   Int
  /// Cloudinary public id + secure URL from AssetsService.
  storage_key  String?
  url          String?
  /// True when the file exceeded the cap and was dropped rather than stored —
  /// the UI shows the name greyed out instead of silently losing it.
  is_truncated Boolean @default(false)

  created_at DateTime @default(now())

  tenant  Tenant       @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  message EmailMessage @relation(fields: [message_id], references: [id], onDelete: Cascade)

  @@index([message_id])
  @@map("email_attachments")
}
```

- [ ] **Step 2: Add the back-relations on `Tenant`**

`tenant_mailboxes TenantMailbox[]`, `email_threads EmailThread[]`, `email_messages EmailMessage[]`, `email_attachments EmailAttachment[]`. Prisma will not validate without them.

- [ ] **Step 3: Verify additive-only**

Run `npx prisma validate` and `npx prisma migrate diff --from-schema-datamodel` against `dev`'s schema. Confirm zero `DROP`, zero `ALTER COLUMN`. Generate the client: `npm run db:generate --workspace=@erp71/database`.

**Verification:** `npx prisma validate` passes; the diff is additive; `db.tenantMailbox` typechecks in a scratch file.

---

## Task 2: Permissions

**Files:**
- Modify: `packages/shared-types/index.ts`, `packages/database/prisma/sync-role-permissions.ts`

**Interfaces:**
- Produces: `VIEW_INBOX`, `SEND_EMAIL`, `MANAGE_MAILBOXES`. Tasks 6, 7 and 9 gate on them.

- [ ] **Step 1: Add to the `StorePermission` const**

Append a group before the closing `} as const;`:

```ts
  // Email inbox
  VIEW_INBOX: "VIEW_INBOX",
  SEND_EMAIL: "SEND_EMAIL",
  // Separate from SEND_EMAIL on purpose: connecting a mailbox means handing
  // ERP71 credentials to the tenant's real mail account. That is an owner-level
  // action, not something a shop assistant who answers mail should hold.
  MANAGE_MAILBOXES: "MANAGE_MAILBOXES",
```

- [ ] **Step 2: Role defaults, labels, groups**

`OWNER` gets everything via `Object.values(StorePermission)` — no edit needed. Add `VIEW_INBOX` + `SEND_EMAIL` to `MANAGER`. Add all three to `STORE_PERMISSION_LABELS`. Add a new `STORE_PERMISSION_GROUPS` entry labelled `"Email Inbox"`.

- [ ] **Step 3: Extend `sync-role-permissions.ts`**

Add the new group so existing tenants' MANAGER roles pick up `VIEW_INBOX` + `SEND_EMAIL` on the next container start. Follow the existing grant-by-group / skip-if-partially-held shape so a re-run never undoes an owner's later edit.

**Verification:** `npm test --workspace=packages/shared-types`. Then confirm by hand that a non-owner MANAGER in a seeded tenant gains the permission after the sync — the `OWNER` bypass in `StorePermissionGuard` will mask a mistake here if you only test as an owner.

---

## Task 3: Normalisation + threading (lane-agnostic core)

**Files:**
- Create: `mail-normalise.ts`, `threading.util.ts`, `mail-ingest.service.ts` + specs

**Interfaces:**
- Consumes: Task 1 delegates.
- Produces: `NormalisedMessage`, `MailIngestService.ingest(mailbox, msg)`. Both lanes (Tasks 4, 5) call `ingest()` and nothing else.

- [ ] **Step 1: Define `NormalisedMessage`**

```ts
export interface NormalisedMessage {
  messageId: string;          // always angle-bracketed; synthesised if absent
  inReplyTo: string | null;
  references: string[];
  from: { address: string; name: string | null };
  to: string[];
  cc: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  sentAt: Date;
  spamScore: number | null;
  attachments: Array<{ filename: string; contentType: string | null; size: number; content: Buffer }>;
}
```

A message with no `Message-ID` is not rare enough to reject — synthesise a stable one from a hash of `(mailbox_id, from, subject, sentAt)` so dedupe still works on a retry.

- [ ] **Step 2: `threading.util.ts`**

`resolveThread()` in strict order:
1. Any id in `references` or `in_reply_to` matches an existing `EmailMessage.message_id` in this mailbox → that message's thread.
2. Fallback: same `normalised_subject` **and** at least one overlapping participant **and** last message within 30 days → that thread.
3. Otherwise a new thread.

Subject normalisation strips a repeating leading `Re:` / `RE:` / `Fwd:` / `Fw:` / `RE :` and a leading `[list-tag]`, collapses whitespace, lowercases. The fallback needs all three conditions: subject alone threads every "Invoice" from every customer into one conversation.

- [ ] **Step 3: `MailIngestService.ingest()`**

In one `$transaction`: upsert on `(mailbox_id, message_id)` and **return early if it already exists** — both lanes redeliver. Resolve the thread, create or update it (bump `last_message_at`, `message_count`, merge `participants`, set `is_read: false` on an inbound), create the message, hand attachments to Task 8.

**Verification:** unit tests for each threading branch, including a redelivery of the same `Message-ID` asserting exactly one `EmailMessage` row, and a same-subject-different-participants pair asserting two threads.

---

## Task 4: Lane A — inbound relay webhook

**Files:**
- Create: `inbound-webhook.controller.ts` + spec

**Interfaces:**
- Consumes: `MailIngestService.ingest()`.
- Produces: `POST /api/v1/mailbox/inbound/:provider`.

> **This endpoint is the one unauthenticated write path into tenant data in the whole codebase.** It cannot derive `tenantId` from a JWT because there is no JWT — it derives it from the recipient address. Treat every rule below as load-bearing.

- [ ] **Step 1: The route**

Model it on `billing.controller.ts`'s `@Post('webhooks/manual')` + `x-billing-webhook-secret` header. Exclude it from the JWT guard **and** from `TenantInterceptor`. Verify a shared secret from platform settings in constant time, plus the provider's own signature where it offers one.

- [ ] **Step 2: Resolve the mailbox from the recipient**

Look up `TenantMailbox` by `routing_key` parsed out of the recipient address. **An unknown recipient is a 404 — never a guess, never a fuzzy match, never "closest tenant".** `tenantId` comes from the resolved mailbox row and nowhere else. Log the rejected recipient at `warn` for operator debugging.

- [ ] **Step 3: Parse and ingest**

Providers differ: Brevo Inbound Parsing posts structured JSON; a Cloudflare Email Worker posts raw RFC-822 (parse with `mailparser`). Branch on `:provider`, normalise, call `ingest()`. Return 200 on a duplicate — a non-2xx makes the provider retry forever.

- [ ] **Step 4: Caps**

Reject a body over ~10 MB with 413 before parsing. Rate-limit per routing key.

**Verification:** spec covering a valid payload, a bad secret (401), an unknown recipient (404), a duplicate `Message-ID` (200, one row), and an oversized body (413). Assert the unknown-recipient case writes **nothing**.

---

## Task 5: Lane B — IMAP poll (Lark as reference)

**Files:**
- Create: `imap.client.ts`, `imap-poll.scheduler.ts` + specs
- Modify: `apps/backend/src/system-health/jobs/job-names.ts`

- [ ] **Step 1: `imap.client.ts`**

`imapflow`, one connect → fetch → close cycle per poll. **Do not use IMAP IDLE**: it holds a socket open per mailbox, and the backend is a single container. Fetch `UID > imap_last_uid`, cap at 100 messages per cycle, persist the new high-water UID. If `UIDVALIDITY` changed, reset `imap_last_uid` and resync from the last 30 days rather than refetching everything.

- [ ] **Step 2: Translate provider errors into operator-facing ones**

Store the result in `last_error`. This is the difference between a 5-minute fix and a support ticket:

| Symptom | `last_error` message |
|---|---|
| `AUTHENTICATIONFAILED` on a `larksuite.com` host | "Lark rejected the login. Check that your Lark admin has enabled third-party email client access, that IMAP is on for this user, and that you used a **generated password** — not your Lark account password." |
| `AUTHENTICATIONFAILED` elsewhere | "The mail server rejected these credentials. Most providers require an app-specific password rather than your account password." |
| Connection refused / timeout | "Could not reach {host}:{port}." |

- [ ] **Step 3: The scheduler**

`@Cron('*/5 * * * *')` wrapped in `jobTracker.track(JOB_NAMES.MAILBOX_IMAP_POLL, ...)`, matching `notifications.service.ts`. Iterate active `IMAP` mailboxes with bounded concurrency (4). **One mailbox failing must not abort the loop** — catch per mailbox, write `last_error`, continue. Add `MAILBOX_IMAP_POLL: 'mailbox.imap-poll'` to `JOB_NAMES` and its `maxIntervalMs` row.

**Lark reference settings** (confirmed against a working third-party config; re-verify against Lark's help centre before shipping, and note Feishu/mainland China uses different hosts):

| | Host | Port | Security |
|---|---|---|---|
| IMAP | `imap.larksuite.com` | 993 | SSL |
| SMTP | `smtp.larksuite.com` | 465 | SSL |

**Verification:** specs with a mocked `imapflow` covering resume-from-UID, a changed `UIDVALIDITY`, an auth failure writing `last_error` without throwing out of the loop, and one failing mailbox not blocking the next.

---

## Task 6: Mailbox CRUD + connection test

**Files:**
- Create: `mailbox.service.ts`, `mailbox.controller.ts`, `mailbox.dto.ts`, `mailbox.module.ts` + specs
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: CRUD** — list / create / update / delete, `MANAGE_MAILBOXES`-gated, `tenant_id`-scoped. Secrets in responses are `SECRET_MASK`; a submitted `SECRET_MASK` means unchanged. Reuse the exact pattern in `TenantMessagingIdentityService.update()`.
- [ ] **Step 2: `POST /mailbox/:id/test`** — connect, authenticate, disconnect; return `{ ok, error }` with the Task 5 Step 2 message. Nobody should discover a bad password five minutes later via a silent cron.
- [ ] **Step 3: Register `MailboxModule`** in `app.module.ts`.

**Verification:** specs asserting cross-tenant reads 404, that a `SECRET_MASK` submission leaves the stored ciphertext byte-identical, and that no endpoint ever returns a decrypted secret.

---

## Task 7: Outbound reply

**Files:**
- Modify: `apps/backend/src/email/email.service.ts`
- Modify: `mailbox.service.ts`, `mailbox.controller.ts`

- [ ] **Step 1: Threading headers on send** — extend `SendEmailOptions` with `inReplyTo`, `references`, `replyTo`. Thread the values through all three send paths (Resend, Brevo API, nodemailer SMTP). **Without these, every reply starts a new thread in the recipient's client.**
- [ ] **Step 2: `POST /mailbox/threads/:id/reply`** — `SEND_EMAIL`-gated. Pass `tenantId` so `TenantMessagingIdentity` stamps the tenant's sender. Persist the sent message as `direction: 'OUT'` in the same thread so the conversation reads as one.
- [ ] **Step 3: Reply-To for RELAY mailboxes** — when sending from a `RELAY` mailbox whose from-address is on the tenant's own domain, set `Reply-To` to the relay address. Otherwise replies go to a mailbox we never see. IMAP mailboxes need none of this: the tenant's own address already receives.

**Verification:** specs asserting the headers reach each transport, and that an OUT message lands in the originating thread rather than creating one.

---

## Task 8: Attachments

**Files:**
- Modify: `mail-ingest.service.ts`; consume `AssetsService`

- [ ] **Step 1:** Upload each attachment via the existing Cloudinary path, namespaced `mail/{tenantId}/{messageId}/`.
- [ ] **Step 2:** Cap at 10 MB per file and 25 MB per message. Over the cap, write the `EmailAttachment` row with `is_truncated: true` and no `storage_key` — the name still shows, greyed out. A silently vanished attachment is worse than a visible refusal.
- [ ] **Step 3:** An upload failure must not lose the message. Persist the message first, then upload; on failure mark `is_truncated` and log.

**Verification:** specs for the happy path, over-cap, and a failing upload still persisting the message.

---

## Task 9: Frontend — inbox UI

**Files:**
- Create: `(app)/inbox/page.tsx`, `(app)/inbox/[threadId]/page.tsx`, `(app)/settings/mailboxes/page.tsx`

- [ ] **Step 1: Thread list** — `PageShell` + `PageHeader`, unread in `font-medium`, filters for mailbox / status / assignee. `hideOnMobile` on secondary columns.
- [ ] **Step 2: Reader** — messages oldest-first, quoted-reply collapsing, attachment chips, assign + close actions, and the entity-link control (customer / lead / supplier / sales order) that justifies this living in the ERP.
- [ ] **Step 3: Composer** — in `ModalShell`, bottom sheet on mobile. Errors inline per field; success through the global `Toaster`.
- [ ] **Step 4: Mailbox settings** — connect form per lane, "Test connection" surfacing `last_error` verbatim, and a Lark preset that prefills the Task 5 hosts and links Lark's admin toggle.

**Untrusted content:** message bodies are attacker-controlled HTML. Sanitise server-side into a strict allowlist, strip `<script>`/`<style>`/event handlers, and render remote images only behind an explicit "show images" click — remote image loads are read receipts for spammers.

**Verification:** component tests per page; check 360px with no horizontal scroll, and both `ar` and `ur` mirrored.

---

## Task 10: Navigation + i18n

**Files:**
- Modify: `packages/shared-types/navigation.ts`, all nine locale catalogs

- [ ] **Step 1:** Add `inbox` (`kind: 'module'`, icon `Mail`, `moduleKey: 'inbox'`) plus `inbox.threads` and `inbox.settings` links; add them to the default tenant layout.
- [ ] **Step 2:** Add every `sidebar.*` and inbox UI key to **all nine** catalogs. English placeholders in the other eight fail no test but ship visibly broken — write real translations (`bn` matters most for this market).
- [ ] **Step 3:** Record in `TODO.md` that tenants with a customised sidebar will not see the Inbox node until they reset their layout, per the Global Constraints note.

**Verification:** `npm test --workspace=apps/frontend -- catalog` passes; `scripts/i18n-report.js` shows no regression.

---

## Deferred to R2

- **Lark `mail-v1` API lane.** Lark's Open Platform exposes `user_mailbox/message` list/get/send, drafts, `accessible_mailboxes` and a `public_mailbox` resource, with an official Node SDK (`@larksuiteoapi/node-sdk`). Two advantages over IMAP: authentication is a Lark app (App ID + Secret → `tenant_access_token`), so no per-user generated passwords; and **public mailboxes are first-class**, which is exactly the shared `sales@` shape an ERP inbox wants — over IMAP that means one account's password passed around. Deferred because it is a Lark-only connector needing an app registration, scope approvals and possibly a Marketplace review, and it only pays for itself once Lark tenants are a real segment. `TenantMailbox.kind` is the seam it slots into. **Unverified:** whether Lark fires a *new mail received* event — IM has `im.message.receive_v1`, no mail equivalent was found. Assume polling.
- Provider domain-authentication automation (SPF/DKIM/DMARC self-serve). Today `TenantMessagingIdentity` assumes an operator verified the sender by hand in Brevo. **This is the largest piece of hidden work in the whole feature** and it is deliberately out of R1: R1 tenants either use an address on a domain we already control (Lane A) or their own already-authenticated mailbox (Lane B) — neither needs tenant DNS changes.
- Full-text search, labels/folders, canned replies, signatures, read receipts.
- Retention enforcement. R1 adds the policy text; the purge cron is R2.

## Rejected: self-hosted mail server

Running Postfix/Dovecot or Mailcow on the VPS was considered and rejected. Port 25 egress is filtered or blocked on most hosts, a fresh VPS IP has no sending reputation and lands in spam by default, and we would permanently own spam filtering, mail backups, and blocklist delisting. Both lanes in this plan avoid it: Lane A rents deliverability from a relay, Lane B borrows the tenant's existing provider. For a tenant already on Lark, Lane B needs **no DNS change at all** — Lark already owns their MX and SPF/DKIM.
