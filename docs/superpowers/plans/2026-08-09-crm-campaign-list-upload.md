# CRM Campaign List Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a CRM user create an email campaign from an uploaded CSV/Excel file where every row carries its own recipient, subject and message, and schedule it for a future date and time.

**Architecture:** Extend `CrmCampaign` with a `recipient_source` (`SEGMENT` | `UPLOAD`) and `body_format` (`TEXT` | `HTML`), and relax `CrmCampaignRecipient` so it can hold a raw email plus its own subject/message instead of requiring a `Customer`. Uploaded rows are validated by one shared validator used by both the browser preview and the server, resolved against Customer → Lead → CrmContact (creating a contact when nothing matches), and stored as `PENDING` recipients at create time. Sending becomes a restartable batch drain owned by a new `CampaignDispatchService`, so the existing 5-minute cron both fires due scheduled campaigns and pushes in-flight ones forward.

**Tech Stack:** NestJS 11 + Prisma 5 (Postgres) on the backend, Next.js 15 + React + Tailwind on the frontend, Jest for both, papaparse/xlsx for browser-side file parsing, `@erp71/shared-types` for code shared across apps.

## Global Constraints

- Branch is `feat/crm-campaign-list-upload`, already created from `origin/dev`. Do not commit to `main` or `dev`.
- Max **1,000** valid rows per uploaded file. Larger files are rejected whole.
- Batch size is **200** recipients per drain pass.
- Uploaded-list campaigns are **EMAIL only**. `recipient_source: 'UPLOAD'` with any other channel is a `400`.
- Scheduled times are **Asia/Dhaka (UTC+6, no DST)**. The frontend stamps `+06:00`; the backend never guesses a zone.
- All new UI uses `PageShell`/`PageHeader`, `ModalShell`, and `@/components/ui` primitives. Accent is `blue-600`. Semantic colours: emerald = success, amber = warning, red/`danger` = error. No arbitrary hex, no `rounded-2xl`/`rounded-3xl`, `text-sm`/`text-xs` body, `min-h-touch` on tappable controls.
- All user-visible strings go through the i18n catalog and must be added to **all three** locales (`en`, `bn`, `ms`) in the same commit — `apps/frontend/src/lib/localization/messages/catalog.test.ts` fails otherwise.
- Money via `formatBDT()`; never a literal `$`.
- Notifications go through the global `toast` store; validation errors render inline.
- Backend tests: `npm test -w @erp71/backend`. Frontend tests: `npm test -w @erp71/frontend`. Shared-types tests: `npm test -w @erp71/shared-types` (the runner is added in Task 1). Backend and frontend jest configs map `@erp71/shared-types` straight to source, so tests never need a package build.
- `packages/shared-types` had **no test runner at all** before this plan — its two existing test files (`phone.test.ts`, `subscription-plans.test.ts`, 23 tests) matched neither app's jest config and had never run. Task 1 adds the runner; those 23 tests must pass alongside the new ones.
- The **frontend dev server and local production build** resolve `@erp71/shared-types` through `dist`, which is git-ignored (`.gitignore:22`) — so after changing that package run `npm run build -w @erp71/shared-types` locally. Nothing to commit; the frontend Dockerfile rebuilds the package during the image build.
- Do not run `prisma migrate dev` — the local database has no `_prisma_migrations` table. Commit the migration folder and apply the SQL directly, then `npm run generate -w @erp71/database`.
- Update `TODO.md` when the plan is complete (see Task 12).

---

## File Structure

**Created**

| File | Responsibility |
| ---- | -------------- |
| `packages/shared-types/campaign-rows.ts` | Row shape, the 1,000-row cap, and the one validator both apps call |
| `packages/shared-types/campaign-rows.test.ts` | Validator tests |
| `packages/shared-types/jest.config.js` | The runner this package has been missing |
| `packages/database/prisma/migrations/20260809120000_crm_campaign_upload_lists/migration.sql` | Schema migration |
| `apps/backend/src/crm-campaigns/campaign-body.util.ts` | Turning a stored message into email HTML per `body_format` |
| `apps/backend/src/crm-campaigns/campaign-body.util.spec.ts` | Body rendering tests |
| `apps/backend/src/crm-campaigns/campaign-recipients.service.ts` | Resolving uploaded rows and segments into `CrmCampaignRecipient` rows |
| `apps/backend/src/crm-campaigns/campaign-recipients.service.spec.ts` | Resolution tests |
| `apps/backend/src/crm-campaigns/campaign-dispatch.service.ts` | Queueing, the batch drain, completion, and the cron |
| `apps/backend/src/crm-campaigns/campaign-dispatch.service.spec.ts` | Drain and cron tests |
| `apps/frontend/src/lib/spreadsheet.ts` | `parseSpreadsheetFile` — the CSV/XLSX parser, extracted so two callers share it |
| `apps/frontend/src/lib/spreadsheet.test.ts` | Parser tests |
| `apps/frontend/src/lib/schedule-time.ts` | Dhaka wall-clock ⇄ ISO instant conversion |
| `apps/frontend/src/lib/schedule-time.test.ts` | Conversion tests |
| `apps/frontend/src/app/(app)/crm/campaigns/upload-recipients.tsx` | The upload → map → preview step rendered inside the create modal |

**Modified**

| File | Change |
| ---- | ------ |
| `packages/shared-types/index.ts` | Re-export `campaign-rows` |
| `packages/shared-types/package.json` | `test` script and jest devDependencies |
| `packages/database/prisma/schema.prisma` | `CrmCampaign` and `CrmCampaignRecipient` columns; back-relations on `Lead` and `CrmContact` |
| `apps/backend/src/crm-campaigns/crm-campaigns.dto.ts` | `recipient_source`, `body_format`, `rows[]`, optional `message` |
| `apps/backend/src/crm-campaigns/crm-campaigns.service.ts` | Upload-aware `create`, `cancel`, live progress in `findOne`, `send` delegates to dispatch; the old inline dispatcher and cron move out |
| `apps/backend/src/crm-campaigns/crm-campaigns.service.spec.ts` | Tests for the changed service |
| `apps/backend/src/crm-campaigns/crm-campaigns.controller.ts` | `POST :id/cancel` |
| `apps/backend/src/crm-campaigns/crm-campaigns.module.ts` | Register the two new services |
| `apps/frontend/src/components/import-dialog.tsx` | Use the extracted parser |
| `apps/frontend/src/lib/api.ts` | `cancelCrmCampaign` |
| `apps/frontend/src/app/(app)/crm/campaigns/page.tsx` | Source toggle, upload branch, body format, Dhaka scheduling, recipients table, cancel/reschedule |
| `apps/frontend/src/lib/localization/messages/{en,bn,ms}/crmHr.ts` | New `crmCampaigns` strings |
| `TODO.md` | Mark the feature done |

---

## Task 1: Shared row validator

The single source of truth for what a valid uploaded row is. Both the browser preview and the server call it, so the preview can never disagree with the result.

**Files:**
- Create: `packages/shared-types/campaign-rows.ts`
- Create: `packages/shared-types/campaign-rows.test.ts`
- Create: `packages/shared-types/jest.config.js`
- Modify: `packages/shared-types/index.ts`
- Modify: `packages/shared-types/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `CAMPAIGN_UPLOAD_MAX_ROWS: 1000`, `RawCampaignRow`, `ValidCampaignRow`, `CampaignRowIssue`, `CampaignRowsResult`, `validateCampaignRows(raw: RawCampaignRow[]): CampaignRowsResult`. Tasks 4 and 10 both call `validateCampaignRows`.

- [ ] **Step 0: Give the package a test runner**

`packages/shared-types` has never had one — `phone.test.ts` and `subscription-plans.test.ts` match neither app's jest config, so their 23 tests have never run. Wire them up first, so the tests you write next actually execute.

Create `packages/shared-types/jest.config.js`:

```js
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '.',
    testRegex: '.*\\.test\\.ts$',
    transform: {
        '^.+\\.ts$': ['ts-jest', { diagnostics: { warnOnly: true } }],
    },
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
```

In `packages/shared-types/package.json`, add a `test` script beside `build`:

```json
    "test": "jest",
```

and add the two runners to `devDependencies`:

```json
    "jest": "^30.2.0",
    "ts-jest": "^29.4.6",
```

Run: `npm install` from the repo root, then `npm test -w @erp71/shared-types`
Expected: `Tests: 23 passed, 23 total` across 2 suites. Root `npm test` now picks this workspace up through its existing `--if-present` loop.

If any of the 23 pre-existing tests fails, stop and report it — that is a pre-existing bug this plan did not cause, and the human decides whether to fix it here.

- [ ] **Step 1: Write the failing test**

Create `packages/shared-types/campaign-rows.test.ts`:

```ts
import { validateCampaignRows, CAMPAIGN_UPLOAD_MAX_ROWS } from './campaign-rows';

const row = (over: Record<string, string> = {}) => ({
    email: 'rahim@example.com',
    name: 'Rahim Uddin',
    subject: 'Eid offer',
    message: 'Hello',
    ...over,
});

describe('validateCampaignRows', () => {
    it('accepts a well-formed row and normalises the email', () => {
        const result = validateCampaignRows([row({ email: '  Rahim@Example.COM ' })]);
        expect(result.fileError).toBeNull();
        expect(result.issues).toEqual([]);
        expect(result.rows).toEqual([
            { email: 'rahim@example.com', name: 'Rahim Uddin', subject: 'Eid offer', message: 'Hello' },
        ]);
    });

    it('falls back to the email local part when the name is blank', () => {
        const result = validateCampaignRows([row({ name: '   ' })]);
        expect(result.rows[0].name).toBe('rahim');
    });

    it('rejects a row with no email', () => {
        const result = validateCampaignRows([row({ email: '' })]);
        expect(result.rows).toEqual([]);
        expect(result.issues).toEqual([{ line: 1, email: '', reason: 'Email is required.' }]);
    });

    it('rejects a malformed email', () => {
        const result = validateCampaignRows([row({ email: 'not-an-email' })]);
        expect(result.issues).toEqual([
            { line: 1, email: 'not-an-email', reason: 'Not a valid email address.' },
        ]);
    });

    it('rejects a blank subject and a blank message', () => {
        const result = validateCampaignRows([
            row({ email: 'a@example.com', subject: '' }),
            row({ email: 'b@example.com', message: '  ' }),
        ]);
        expect(result.issues).toEqual([
            { line: 1, email: 'a@example.com', reason: 'Subject is required.' },
            { line: 2, email: 'b@example.com', reason: 'Message is required.' },
        ]);
    });

    it('keeps the first of a repeated email and reports the rest, ignoring case', () => {
        const result = validateCampaignRows([
            row({ subject: 'First' }),
            row({ email: 'RAHIM@example.com', subject: 'Second' }),
        ]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].subject).toBe('First');
        expect(result.issues).toEqual([
            { line: 2, email: 'RAHIM@example.com', reason: 'Duplicate of an earlier row.' },
        ]);
    });

    it('rejects an empty file', () => {
        expect(validateCampaignRows([]).fileError).toBe('The file has no data rows.');
    });

    it('rejects a file over the row cap', () => {
        const many = Array.from({ length: CAMPAIGN_UPLOAD_MAX_ROWS + 1 }, (_, i) =>
            row({ email: `p${i}@example.com` }),
        );
        const result = validateCampaignRows(many);
        expect(result.fileError).toBe(
            'A campaign can have at most 1,000 recipients; this file has 1001.',
        );
        expect(result.rows).toEqual([]);
    });

    it('rejects a file whose every row failed validation', () => {
        const result = validateCampaignRows([row({ email: '' })]);
        expect(result.fileError).toBe('No valid rows found in this file.');
    });

    it('treats missing keys the same as blank cells', () => {
        const result = validateCampaignRows([{ email: 'a@example.com', subject: 'Hi', message: 'Yo' }]);
        expect(result.rows[0].name).toBe('a');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @erp71/shared-types -- campaign-rows`
Expected: FAIL — `Cannot find module './campaign-rows'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared-types/campaign-rows.ts`:

```ts
/** The most recipients one uploaded campaign may carry. */
export const CAMPAIGN_UPLOAD_MAX_ROWS = 1000;

/** A row straight out of the spreadsheet, before any checking. */
export interface RawCampaignRow {
    email?: string | null;
    name?: string | null;
    subject?: string | null;
    message?: string | null;
}

/** A row that passed every check, normalised and ready to store. */
export interface ValidCampaignRow {
    /** Trimmed and lower-cased — this is the address that gets emailed. */
    email: string;
    /** The Name cell, or the email local part when that cell was blank. */
    name: string;
    subject: string;
    message: string;
}

export interface CampaignRowIssue {
    /** 1-based data row number; the header row is not counted. */
    line: number;
    /** The email cell exactly as given, so the user can find the row. */
    email: string;
    reason: string;
}

export interface CampaignRowsResult {
    rows: ValidCampaignRow[];
    issues: CampaignRowIssue[];
    /** Set when the whole file is unusable; `rows` is then empty. */
    fileError: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/**
 * Checks are ordered: email present, email well-formed, subject, message,
 * then duplicate. A row is reported against the first rule it breaks, so a
 * row never produces two issues.
 */
export function validateCampaignRows(raw: RawCampaignRow[]): CampaignRowsResult {
    if (raw.length === 0) {
        return { rows: [], issues: [], fileError: 'The file has no data rows.' };
    }

    const rows: ValidCampaignRow[] = [];
    const issues: CampaignRowIssue[] = [];
    const seen = new Set<string>();

    raw.forEach((entry, index) => {
        const line = index + 1;
        const rawEmail = clean(entry.email);
        const subject = clean(entry.subject);
        const message = clean(entry.message);
        const email = rawEmail.toLowerCase();

        if (!rawEmail) {
            issues.push({ line, email: rawEmail, reason: 'Email is required.' });
            return;
        }
        if (!EMAIL_PATTERN.test(rawEmail)) {
            issues.push({ line, email: rawEmail, reason: 'Not a valid email address.' });
            return;
        }
        if (!subject) {
            issues.push({ line, email: rawEmail, reason: 'Subject is required.' });
            return;
        }
        if (!message) {
            issues.push({ line, email: rawEmail, reason: 'Message is required.' });
            return;
        }
        if (seen.has(email)) {
            issues.push({ line, email: rawEmail, reason: 'Duplicate of an earlier row.' });
            return;
        }

        seen.add(email);
        rows.push({
            email,
            name: clean(entry.name) || email.split('@')[0],
            subject,
            message,
        });
    });

    if (rows.length > CAMPAIGN_UPLOAD_MAX_ROWS) {
        return {
            rows: [],
            issues,
            fileError: `A campaign can have at most ${CAMPAIGN_UPLOAD_MAX_ROWS.toLocaleString('en-US')} recipients; this file has ${rows.length}.`,
        };
    }
    if (rows.length === 0) {
        return { rows: [], issues, fileError: 'No valid rows found in this file.' };
    }

    return { rows, issues, fileError: null };
}
```

Add to the end of `packages/shared-types/index.ts`:

```ts
export * from './campaign-rows';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @erp71/shared-types`
Expected: PASS — 3 suites, 33 tests (the 10 new ones plus the 23 that were previously orphaned).

- [ ] **Step 5: Rebuild the package so the frontend build can see it**

Run: `npm run build -w @erp71/shared-types`
Expected: exits 0 and `packages/shared-types/dist/campaign-rows.js` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types package-lock.json
git commit -m "feat(crm): shared validator for uploaded campaign rows

Also gives packages/shared-types the jest runner it never had, so its two
existing test files stop being dead weight."
```

---

## Task 2: Schema and migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`CrmCampaign` at 2256, `CrmCampaignRecipient` at 2286, `Lead` at 1914, `CrmContact` at 2048)
- Create: `packages/database/prisma/migrations/20260809120000_crm_campaign_upload_lists/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma client fields `CrmCampaign.recipient_source`, `CrmCampaign.body_format`, nullable `CrmCampaign.message`; `CrmCampaignRecipient.{email,name,subject,message,lead_id,contact_id}` and nullable `{customer_id,phone}`. Every later backend task depends on these.

- [ ] **Step 1: Edit the Prisma schema**

Replace the `CrmCampaign` model body's `subject`/`message` lines and add two columns, so the model reads:

```prisma
model CrmCampaign {
  id                 String    @id @default(uuid())
  tenant_id          String
  name               String
  description        String?
  status             String    @default("DRAFT")
  channel            String // SMS | WHATSAPP | EMAIL
  /// SEGMENT resolves recipients from the customer base at send time.
  /// UPLOAD carries its own recipient rows, written when the campaign is created.
  recipient_source   String    @default("SEGMENT")
  /// TEXT escapes the message and turns newlines into breaks; HTML sends it as-is.
  body_format        String    @default("TEXT")
  target_segment     String? // VIP | At-Risk | Regular | New | ALL
  target_group_id    String?
  subject            String? // required for EMAIL channel with recipient_source SEGMENT
  /// Null for UPLOAD campaigns, where every recipient carries its own message.
  message            String?
  scheduled_at       DateTime?
  sent_at            DateTime?
  recipient_count    Int       @default(0)
  delivered_count    Int       @default(0)
  failed_count       Int       @default(0)
  attributed_revenue Decimal   @default(0) @db.Decimal(12, 2)
  attributed_orders  Int       @default(0)
  created_by         String?
  created_at         DateTime  @default(now())
  updated_at         DateTime  @updatedAt

  tenant     Tenant                 @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  creator    User?                  @relation("CampaignCreator", fields: [created_by], references: [id])
  recipients CrmCampaignRecipient[]

  @@index([tenant_id, status])
  @@index([tenant_id, created_at])
}
```

Replace `CrmCampaignRecipient` entirely with:

```prisma
model CrmCampaignRecipient {
  id          String    @id @default(uuid())
  campaign_id String
  /// All three links are optional: an uploaded address may match a customer, a
  /// lead, a contact, or none of them. At most one is set.
  customer_id String?
  lead_id     String?
  contact_id  String?
  /// Null on SMS/WhatsApp segment campaigns, which reach people by phone.
  phone       String?
  /// The address actually emailed. Null on SMS/WhatsApp segment campaigns.
  email       String?
  name        String?
  /// Set only on UPLOAD campaigns; segment campaigns fall back to the campaign's own.
  subject     String?
  message     String?
  status      String    @default("PENDING")
  sent_at     DateTime?
  error       String?

  campaign CrmCampaign @relation(fields: [campaign_id], references: [id], onDelete: Cascade)
  customer Customer?   @relation(fields: [customer_id], references: [id], onDelete: Cascade)
  lead     Lead?       @relation(fields: [lead_id], references: [id], onDelete: SetNull)
  contact  CrmContact? @relation(fields: [contact_id], references: [id], onDelete: SetNull)

  @@unique([campaign_id, customer_id])
  @@unique([campaign_id, email])
  @@index([campaign_id, status])
  @@index([lead_id])
  @@index([contact_id])
}
```

In `model Lead`, add to the relation block (after `projects Project[]`):

```prisma
  campaignRecipients CrmCampaignRecipient[]
```

In `model CrmContact`, add to the relation block (after `attachments CrmContactAttachment[]`):

```prisma
  campaignRecipients CrmCampaignRecipient[]
```

- [ ] **Step 2: Verify the schema parses**

Run: `npx prisma validate --schema packages/database/prisma/schema.prisma`
Expected: `The schema at ... is valid 🚀`

- [ ] **Step 3: Write the migration SQL**

Create `packages/database/prisma/migrations/20260809120000_crm_campaign_upload_lists/migration.sql`:

```sql
ALTER TABLE "CrmCampaign" ADD COLUMN "recipient_source" TEXT NOT NULL DEFAULT 'SEGMENT';
ALTER TABLE "CrmCampaign" ADD COLUMN "body_format" TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE "CrmCampaign" ALTER COLUMN "message" DROP NOT NULL;

ALTER TABLE "CrmCampaignRecipient" ALTER COLUMN "customer_id" DROP NOT NULL;
ALTER TABLE "CrmCampaignRecipient" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "lead_id" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "contact_id" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "email" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "name" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "subject" TEXT;
ALTER TABLE "CrmCampaignRecipient" ADD COLUMN "message" TEXT;

CREATE UNIQUE INDEX "CrmCampaignRecipient_campaign_id_email_key" ON "CrmCampaignRecipient"("campaign_id", "email");
CREATE INDEX "CrmCampaignRecipient_lead_id_idx" ON "CrmCampaignRecipient"("lead_id");
CREATE INDEX "CrmCampaignRecipient_contact_id_idx" ON "CrmCampaignRecipient"("contact_id");

ALTER TABLE "CrmCampaignRecipient" ADD CONSTRAINT "CrmCampaignRecipient_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmCampaignRecipient" ADD CONSTRAINT "CrmCampaignRecipient_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply the SQL to the local database**

The local Postgres runs on port **5434**, not the 5432 in `.env`. Do not use `prisma migrate dev` — there is no `_prisma_migrations` table locally.

```bash
docker exec -i erp71-db-1 psql -U postgres -d erp71 \
  < packages/database/prisma/migrations/20260809120000_crm_campaign_upload_lists/migration.sql
```

Expected: a run of `ALTER TABLE` / `CREATE INDEX` acknowledgements, no `ERROR`.

If the local database is too drifted to accept it, note that in the commit message and carry on — the migration file is what ships.

- [ ] **Step 5: Regenerate the Prisma client**

Run: `npm run generate -w @erp71/database`
Expected: `Generated Prisma Client`.

- [ ] **Step 6: Verify the backend still compiles**

Run: `npm run build -w @erp71/backend`
Expected: exits 0. `crm-campaigns.service.ts` still compiles because every new column is optional and `message` is only read, not written as non-null.

If `message` being nullable produces a type error at `campaign.message` in `send()`, fix it there with `campaign.message ?? ''` — Task 5 replaces that code path anyway.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260809120000_crm_campaign_upload_lists
git commit -m "feat(crm): schema for uploaded campaign recipient lists"
```

---

## Task 3: Email body rendering

**Files:**
- Create: `apps/backend/src/crm-campaigns/campaign-body.util.ts`
- Create: `apps/backend/src/crm-campaigns/campaign-body.util.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `renderCampaignBody(message: string, format: string | null | undefined): string`. Task 5's dispatcher calls it.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/crm-campaigns/campaign-body.util.spec.ts`:

```ts
import { renderCampaignBody } from './campaign-body.util';

describe('renderCampaignBody', () => {
    it('escapes HTML and converts newlines when the format is TEXT', () => {
        expect(renderCampaignBody('Hi <b>you</b>\nBye & thanks', 'TEXT')).toBe(
            'Hi &lt;b&gt;you&lt;/b&gt;<br>Bye &amp; thanks',
        );
    });

    it('escapes quotes so an address cannot break out of an attribute', () => {
        expect(renderCampaignBody(`He said "hi" to O'Brien`, 'TEXT')).toBe(
            'He said &quot;hi&quot; to O&#39;Brien',
        );
    });

    it('normalises CRLF to a single break', () => {
        expect(renderCampaignBody('one\r\ntwo', 'TEXT')).toBe('one<br>two');
    });

    it('passes the message through untouched when the format is HTML', () => {
        expect(renderCampaignBody('<p>Hi <b>you</b></p>', 'HTML')).toBe('<p>Hi <b>you</b></p>');
    });

    it('treats an unknown or missing format as TEXT', () => {
        expect(renderCampaignBody('a & b', null)).toBe('a &amp; b');
        expect(renderCampaignBody('a & b', 'WHATEVER')).toBe('a &amp; b');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @erp71/backend -- campaign-body`
Expected: FAIL — `Cannot find module './campaign-body.util'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/crm-campaigns/campaign-body.util.ts`:

```ts
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Turns a stored campaign message into the HTML body of an email.
 *
 * TEXT is the default and the safe one: the message came out of a spreadsheet
 * cell, so a stray `<` or `&` must not be able to break the email or inject
 * markup. HTML is opt-in, for senders who deliberately wrote markup.
 */
export function renderCampaignBody(message: string, format: string | null | undefined): string {
    if (format === 'HTML') return message;
    return escapeHtml(message).replace(/\r\n|\r|\n/g, '<br>');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @erp71/backend -- campaign-body`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-campaigns/campaign-body.util.ts apps/backend/src/crm-campaigns/campaign-body.util.spec.ts
git commit -m "feat(crm): render campaign bodies as escaped text or raw HTML"
```

---

## Task 4: Recipient resolution service

Turns validated upload rows into `CrmCampaignRecipient` records, and moves the existing segment resolution out of the main service so both live together.

**Files:**
- Create: `apps/backend/src/crm-campaigns/campaign-recipients.service.ts`
- Create: `apps/backend/src/crm-campaigns/campaign-recipients.service.spec.ts`
- Modify: `apps/backend/src/crm-campaigns/crm-campaigns.module.ts`

**Interfaces:**
- Consumes: `ValidCampaignRow` from `@erp71/shared-types` (Task 1); the Prisma columns from Task 2.
- Produces: class `CampaignRecipientsService` with
  - `writeUploadedRecipients(tenantId: string, campaignId: string, rows: ValidCampaignRow[], userId: string | null): Promise<number>` — returns the number of recipients written
  - `resolveTargetCustomers(tenantId: string, targetSegment: string | null, targetGroupId: string | null): Promise<Array<{ id: string; name: string; phone: string | null; email: string | null }>>`
  - `writeSegmentRecipients(tenantId: string, campaignId: string, targetSegment: string | null, targetGroupId: string | null): Promise<number>`

  Tasks 5 and 6 call all three.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/crm-campaigns/campaign-recipients.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { DatabaseService } from '../database/database.service';

const ROW = { email: 'rahim@example.com', name: 'Rahim Uddin', subject: 'Hi', message: 'Hello' };

describe('CampaignRecipientsService', () => {
    let service: CampaignRecipientsService;
    let db: any;

    beforeEach(async () => {
        db = {
            customer: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
            lead: { findFirst: jest.fn().mockResolvedValue(null) },
            crmContact: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
            crmCampaignRecipient: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CampaignRecipientsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();
        service = module.get(CampaignRecipientsService);
    });

    describe('writeUploadedRecipients()', () => {
        it('links a row to a matching customer and uses the customer name', async () => {
            db.customer.findFirst.mockResolvedValueOnce({ id: 'cus-1', name: 'Rahim Real', phone: '017' });

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.lead.findFirst).not.toHaveBeenCalled();
            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [
                        expect.objectContaining({
                            campaign_id: 'camp-1',
                            customer_id: 'cus-1',
                            lead_id: null,
                            contact_id: null,
                            email: 'rahim@example.com',
                            name: 'Rahim Real',
                            phone: '017',
                            subject: 'Hi',
                            message: 'Hello',
                            status: 'PENDING',
                        }),
                    ],
                }),
            );
        });

        it('falls back to a lead when no customer matches', async () => {
            db.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', name: 'Rahim Lead', mobile: '018' });

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.findFirst).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [expect.objectContaining({ lead_id: 'lead-1', customer_id: null, name: 'Rahim Lead' })],
                }),
            );
        });

        it('falls back to an existing contact when no customer or lead matches', async () => {
            db.crmContact.findFirst.mockResolvedValueOnce({ id: 'con-1', name: 'Rahim Contact', mobile: null });

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.create).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [expect.objectContaining({ contact_id: 'con-1', name: 'Rahim Contact' })],
                }),
            );
        });

        it('creates a contact when nothing matches, tagged as an import', async () => {
            db.crmContact.create.mockResolvedValueOnce({ id: 'con-new', name: 'Rahim Uddin' });

            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], 'user-1');

            expect(db.crmContact.create).toHaveBeenCalledWith({
                data: {
                    tenant_id: 't1',
                    name: 'Rahim Uddin',
                    email: 'rahim@example.com',
                    capture_source: 'IMPORT',
                    created_by: 'user-1',
                },
            });
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [expect.objectContaining({ contact_id: 'con-new', name: 'Rahim Uddin' })],
                }),
            );
        });

        it('matches on email case-insensitively and scoped to the tenant', async () => {
            await service.writeUploadedRecipients('t1', 'camp-1', [ROW], null);

            expect(db.customer.findFirst).toHaveBeenCalledWith({
                where: {
                    tenant_id: 't1',
                    deleted_at: null,
                    email: { equals: 'rahim@example.com', mode: 'insensitive' },
                },
                select: { id: true, name: true, phone: true },
            });
        });

        it('returns the number of recipients written', async () => {
            db.crmCampaignRecipient.createMany.mockResolvedValueOnce({ count: 1 });
            await expect(service.writeUploadedRecipients('t1', 'camp-1', [ROW], null)).resolves.toBe(1);
        });
    });

    describe('writeSegmentRecipients()', () => {
        it('writes one PENDING recipient per targeted customer', async () => {
            db.customer.findMany.mockResolvedValueOnce([
                { id: 'c1', name: 'A', phone: '017', email: 'a@example.com' },
                { id: 'c2', name: 'B', phone: '018', email: null },
            ]);
            db.crmCampaignRecipient.createMany.mockResolvedValueOnce({ count: 2 });

            const written = await service.writeSegmentRecipients('t1', 'camp-1', 'VIP', null);

            expect(written).toBe(2);
            expect(db.crmCampaignRecipient.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [
                        expect.objectContaining({ customer_id: 'c1', phone: '017', email: 'a@example.com' }),
                        expect.objectContaining({ customer_id: 'c2', phone: '018', email: null }),
                    ],
                    skipDuplicates: true,
                }),
            );
        });

        it('narrows by segment and group', async () => {
            db.customer.findMany.mockResolvedValueOnce([]);
            await service.writeSegmentRecipients('t1', 'camp-1', 'VIP', 'grp-1');
            expect(db.customer.findMany).toHaveBeenCalledWith({
                where: {
                    tenant_id: 't1',
                    deleted_at: null,
                    phone: { not: null },
                    segment_category: 'VIP',
                    customer_group_id: 'grp-1',
                },
                select: { id: true, name: true, phone: true, email: true },
            });
        });

        it('does not narrow by segment when the segment is ALL', async () => {
            db.customer.findMany.mockResolvedValueOnce([]);
            await service.writeSegmentRecipients('t1', 'camp-1', 'ALL', null);
            expect(db.customer.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', deleted_at: null, phone: { not: null } },
                select: { id: true, name: true, phone: true, email: true },
            });
        });

        it('writes nothing and returns 0 when no customer is targeted', async () => {
            db.customer.findMany.mockResolvedValueOnce([]);
            await expect(service.writeSegmentRecipients('t1', 'camp-1', 'VIP', null)).resolves.toBe(0);
            expect(db.crmCampaignRecipient.createMany).not.toHaveBeenCalled();
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @erp71/backend -- campaign-recipients`
Expected: FAIL — `Cannot find module './campaign-recipients.service'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/crm-campaigns/campaign-recipients.service.ts`:

```ts
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { ValidCampaignRow } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';

interface ResolvedParty {
    customer_id: string | null;
    lead_id: string | null;
    contact_id: string | null;
    name: string;
    phone: string | null;
}

@Injectable()
export class CampaignRecipientsService {
    constructor(private db: DatabaseService) {}

    /**
     * Writes one PENDING recipient per uploaded row.
     *
     * Each address is resolved against customers, then leads, then contacts;
     * the first match wins and lends its real name. Nothing matching creates a
     * contact, so the list the user uploaded ends up in the address book —
     * and a second upload of the same file matches those contacts rather than
     * duplicating them, which matters because contacts dedupe on mobile and
     * these have none.
     */
    async writeUploadedRecipients(
        tenantId: string,
        campaignId: string,
        rows: ValidCampaignRow[],
        userId: string | null,
    ): Promise<number> {
        const data = [];
        for (const row of rows) {
            const party = await this.resolveParty(tenantId, row, userId);
            data.push({
                id: randomUUID(),
                campaign_id: campaignId,
                customer_id: party.customer_id,
                lead_id: party.lead_id,
                contact_id: party.contact_id,
                phone: party.phone,
                email: row.email,
                name: party.name,
                subject: row.subject,
                message: row.message,
                status: 'PENDING',
            });
        }

        const result = await this.db.crmCampaignRecipient.createMany({ data, skipDuplicates: true });
        return result.count;
    }

    /** The customers a SEGMENT campaign targets. Used for the pre-send preview too. */
    async resolveTargetCustomers(tenantId: string, targetSegment: string | null, targetGroupId: string | null) {
        // Every segment channel reaches people by phone, so customers without
        // one are never eligible, whatever the channel.
        const where: any = { tenant_id: tenantId, deleted_at: null, phone: { not: null } };
        if (targetSegment && targetSegment !== 'ALL') where.segment_category = targetSegment;
        if (targetGroupId) where.customer_group_id = targetGroupId;

        return this.db.customer.findMany({
            where,
            select: { id: true, name: true, phone: true, email: true },
        });
    }

    async writeSegmentRecipients(
        tenantId: string,
        campaignId: string,
        targetSegment: string | null,
        targetGroupId: string | null,
    ): Promise<number> {
        const customers = await this.resolveTargetCustomers(tenantId, targetSegment, targetGroupId);
        if (customers.length === 0) return 0;

        const result = await this.db.crmCampaignRecipient.createMany({
            data: customers.map((c) => ({
                id: randomUUID(),
                campaign_id: campaignId,
                customer_id: c.id,
                lead_id: null,
                contact_id: null,
                phone: c.phone,
                email: c.email,
                name: c.name,
                subject: null,
                message: null,
                status: 'PENDING',
            })),
            skipDuplicates: true,
        });
        return result.count;
    }

    private async resolveParty(
        tenantId: string,
        row: ValidCampaignRow,
        userId: string | null,
    ): Promise<ResolvedParty> {
        const email = { equals: row.email, mode: 'insensitive' as const };

        const customer = await this.db.customer.findFirst({
            where: { tenant_id: tenantId, deleted_at: null, email },
            select: { id: true, name: true, phone: true },
        });
        if (customer) {
            return {
                customer_id: customer.id,
                lead_id: null,
                contact_id: null,
                name: customer.name,
                phone: customer.phone ?? null,
            };
        }

        const lead = await this.db.lead.findFirst({
            where: { tenant_id: tenantId, email },
            select: { id: true, name: true, mobile: true },
        });
        if (lead) {
            return {
                customer_id: null,
                lead_id: lead.id,
                contact_id: null,
                name: lead.name,
                phone: lead.mobile ?? null,
            };
        }

        const contact = await this.db.crmContact.findFirst({
            where: { tenant_id: tenantId, email },
            select: { id: true, name: true, mobile: true },
        });
        if (contact) {
            return {
                customer_id: null,
                lead_id: null,
                contact_id: contact.id,
                name: contact.name,
                phone: contact.mobile ?? null,
            };
        }

        const created = await this.db.crmContact.create({
            data: {
                tenant_id: tenantId,
                name: row.name,
                email: row.email,
                capture_source: 'IMPORT',
                created_by: userId,
            },
        });
        return {
            customer_id: null,
            lead_id: null,
            contact_id: created.id,
            name: row.name,
            phone: null,
        };
    }
}
```

- [ ] **Step 4: Register the service**

Replace `apps/backend/src/crm-campaigns/crm-campaigns.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { CrmCampaignsController } from './crm-campaigns.controller';
import { CrmCampaignsService } from './crm-campaigns.service';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CrmCampaignsController],
    providers: [CrmCampaignsService, CampaignRecipientsService],
    exports: [CrmCampaignsService],
})
export class CrmCampaignsModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @erp71/backend -- campaign-recipients`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/crm-campaigns/campaign-recipients.service.ts apps/backend/src/crm-campaigns/campaign-recipients.service.spec.ts apps/backend/src/crm-campaigns/crm-campaigns.module.ts
git commit -m "feat(crm): resolve uploaded campaign rows to customers, leads or contacts"
```

---

## Task 5: Batch dispatch service

Replaces the fire-and-forget send loop with a restartable drain, and takes over the cron.

**Files:**
- Create: `apps/backend/src/crm-campaigns/campaign-dispatch.service.ts`
- Create: `apps/backend/src/crm-campaigns/campaign-dispatch.service.spec.ts`
- Modify: `apps/backend/src/crm-campaigns/crm-campaigns.module.ts`

**Interfaces:**
- Consumes: `CampaignRecipientsService.writeSegmentRecipients` (Task 4), `renderCampaignBody` (Task 3), the Prisma columns from Task 2.
- Produces: class `CampaignDispatchService` with
  - `CAMPAIGN_BATCH_SIZE = 200` (exported const)
  - `queue(tenantId: string, campaignId: string): Promise<{ queued: number }>`
  - `drainCampaign(campaignId: string): Promise<void>`
  - `processCampaigns(): Promise<void>` (the `@Cron('*/5 * * * *')` entry point)

  Task 6's `CrmCampaignsService.send()` calls `queue`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/crm-campaigns/campaign-dispatch.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CampaignDispatchService, CAMPAIGN_BATCH_SIZE } from './campaign-dispatch.service';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

const emailCampaign = (over: Record<string, unknown> = {}) => ({
    id: 'camp-1',
    tenant_id: 't1',
    status: 'SENDING',
    channel: 'EMAIL',
    recipient_source: 'UPLOAD',
    body_format: 'TEXT',
    subject: null,
    message: null,
    target_segment: 'ALL',
    target_group_id: null,
    ...over,
});

describe('CampaignDispatchService', () => {
    let service: CampaignDispatchService;
    let db: any;
    let sms: any;
    let whatsapp: any;
    let email: any;
    let recipients: any;

    beforeEach(async () => {
        db = {
            crmCampaign: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn().mockResolvedValue({}),
            },
            crmCampaignRecipient: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                update: jest.fn().mockResolvedValue({}),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };
        sms = { sendSms: jest.fn().mockResolvedValue({ sent: true }) };
        whatsapp = { sendMessage: jest.fn().mockResolvedValue(undefined) };
        email = { sendCustom: jest.fn().mockResolvedValue(undefined) };
        recipients = { writeSegmentRecipients: jest.fn().mockResolvedValue(0) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CampaignDispatchService,
                { provide: DatabaseService, useValue: db },
                { provide: CampaignRecipientsService, useValue: recipients },
                { provide: SmsService, useValue: sms },
                { provide: WhatsAppService, useValue: whatsapp },
                { provide: EmailService, useValue: email },
                { provide: AppLogger, useValue: { log: jest.fn(), error: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: jest.fn((_n, fn) => fn()) } },
            ],
        }).compile();

        service = module.get(CampaignDispatchService);
    });

    describe('queue()', () => {
        it('materialises segment recipients then marks the campaign SENDING', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce(
                emailCampaign({ recipient_source: 'SEGMENT', status: 'DRAFT', message: 'Hi', subject: 'S' }),
            );
            recipients.writeSegmentRecipients.mockResolvedValueOnce(3);

            const result = await service.queue('t1', 'camp-1');

            expect(recipients.writeSegmentRecipients).toHaveBeenCalledWith('t1', 'camp-1', 'ALL', null);
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { status: 'SENDING', recipient_count: 3 },
            });
            expect(result).toEqual({ queued: 3 });
        });

        it('does not materialise anything for an UPLOAD campaign', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce(emailCampaign({ status: 'DRAFT' }));
            db.crmCampaignRecipient.count.mockResolvedValueOnce(5);

            const result = await service.queue('t1', 'camp-1');

            expect(recipients.writeSegmentRecipients).not.toHaveBeenCalled();
            expect(result).toEqual({ queued: 5 });
        });

        it('rejects a campaign with no eligible recipients', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce(
                emailCampaign({ recipient_source: 'SEGMENT', status: 'DRAFT' }),
            );
            recipients.writeSegmentRecipients.mockResolvedValueOnce(0);

            await expect(service.queue('t1', 'camp-1')).rejects.toThrow(BadRequestException);
            expect(db.crmCampaign.update).not.toHaveBeenCalled();
        });

        it('rejects a campaign that is not DRAFT or SCHEDULED', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce(emailCampaign({ status: 'COMPLETED' }));
            await expect(service.queue('t1', 'camp-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('drainCampaign()', () => {
        const pending = (id: string, over: Record<string, unknown> = {}) => ({
            id,
            email: `${id}@example.com`,
            phone: '01700000000',
            subject: 'Row subject',
            message: 'Row message',
            ...over,
        });

        it('claims a batch before sending so an overlapping pass cannot double-send', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1'), pending('r2')]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 2 });

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { campaign_id: 'camp-1', status: 'PENDING' },
                    take: CAMPAIGN_BATCH_SIZE,
                }),
            );
            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { id: { in: ['r1', 'r2'] }, status: 'PENDING' },
                data: { status: 'SENDING' },
            });
            expect(email.sendCustom).toHaveBeenCalledTimes(2);
        });

        it('sends nothing when another pass already claimed the batch', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1')]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 0 });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).not.toHaveBeenCalled();
        });

        it('sends the row subject and the rendered row message', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([
                pending('r1', { message: 'Line 1\nLine <2>' }),
            ]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).toHaveBeenCalledWith(
                'r1@example.com',
                'Row subject',
                'Line 1<br>Line &lt;2&gt;',
                { tenantId: 't1' },
            );
        });

        it('falls back to the campaign subject and message for a segment recipient', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(
                emailCampaign({ recipient_source: 'SEGMENT', subject: 'Camp subject', message: 'Camp body' }),
            );
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([
                pending('r1', { subject: null, message: null }),
            ]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).toHaveBeenCalledWith(
                'r1@example.com',
                'Camp subject',
                'Camp body',
                { tenantId: 't1' },
            );
        });

        it('marks a recipient FAILED with the reason when the send throws', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1')]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });
            email.sendCustom.mockRejectedValueOnce(new Error('SMTP down'));

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { status: 'FAILED', error: 'Error: SMTP down' },
            });
        });

        it('fails a row with no email rather than sending nowhere', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1', { email: null })]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });

            await service.drainCampaign('camp-1');

            expect(email.sendCustom).not.toHaveBeenCalled();
            expect(db.crmCampaignRecipient.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { status: 'FAILED', error: 'Error: Recipient has no email address' },
            });
        });

        it('completes the campaign with its counts once nothing is pending', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([]);
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([
                { status: 'SENT', _count: { _all: 7 } },
                { status: 'FAILED', _count: { _all: 2 } },
            ]);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: {
                    status: 'COMPLETED',
                    sent_at: expect.any(Date),
                    delivered_count: 7,
                    failed_count: 2,
                },
            });
        });

        it('completes straight away when the batch was the last one', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([pending('r1')]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([{ status: 'SENT', _count: { _all: 1 } }]);

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: {
                    status: 'COMPLETED',
                    sent_at: expect.any(Date),
                    delivered_count: 1,
                    failed_count: 0,
                },
            });
        });

        it('leaves a full batch SENDING so the next pass picks up the rest', async () => {
            const full = Array.from({ length: CAMPAIGN_BATCH_SIZE }, (_, i) => pending(`r${i}`));
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign());
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce(full);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: full.length });

            await service.drainCampaign('camp-1');

            expect(db.crmCampaign.update).not.toHaveBeenCalled();
        });

        it('stops without sending when the campaign is no longer SENDING', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(emailCampaign({ status: 'CANCELLED' }));

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.findMany).not.toHaveBeenCalled();
            expect(email.sendCustom).not.toHaveBeenCalled();
        });

        it('routes an SMS campaign through the SMS service', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(
                emailCampaign({ channel: 'SMS', recipient_source: 'SEGMENT', message: 'Camp body' }),
            );
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([
                pending('r1', { subject: null, message: null }),
            ]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });

            await service.drainCampaign('camp-1');

            expect(sms.sendSms).toHaveBeenCalledWith('01700000000', 'Camp body', {
                tenantId: 't1',
                purpose: 'CRM campaign',
            });
        });

        it('fails an SMS recipient when there are no credits', async () => {
            db.crmCampaign.findFirst.mockResolvedValue(
                emailCampaign({ channel: 'SMS', recipient_source: 'SEGMENT', message: 'Camp body' }),
            );
            db.crmCampaignRecipient.findMany.mockResolvedValueOnce([
                pending('r1', { subject: null, message: null }),
            ]);
            db.crmCampaignRecipient.updateMany.mockResolvedValueOnce({ count: 1 });
            sms.sendSms.mockResolvedValueOnce({ sent: false });

            await service.drainCampaign('camp-1');

            expect(db.crmCampaignRecipient.update).toHaveBeenCalledWith({
                where: { id: 'r1' },
                data: { status: 'FAILED', error: 'Error: Insufficient SMS credits' },
            });
        });
    });

    describe('processCampaigns()', () => {
        it('queues every campaign whose scheduled time has passed, then drains what is sending', async () => {
            db.crmCampaign.findMany
                .mockResolvedValueOnce([{ id: 'due-1', tenant_id: 't1' }])
                .mockResolvedValueOnce([{ id: 'sending-1', tenant_id: 't1' }]);
            jest.spyOn(service, 'queue').mockResolvedValue({ queued: 1 });
            jest.spyOn(service, 'drainCampaign').mockResolvedValue(undefined);

            await service.processCampaigns();

            expect(service.queue).toHaveBeenCalledWith('t1', 'due-1');
            expect(service.drainCampaign).toHaveBeenCalledWith('sending-1');
        });

        it('keeps going when one campaign throws', async () => {
            db.crmCampaign.findMany
                .mockResolvedValueOnce([{ id: 'bad', tenant_id: 't1' }, { id: 'good', tenant_id: 't1' }])
                .mockResolvedValueOnce([]);
            jest.spyOn(service, 'queue')
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValueOnce({ queued: 1 });

            await expect(service.processCampaigns()).resolves.toBeUndefined();
            expect(service.queue).toHaveBeenCalledTimes(2);
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @erp71/backend -- campaign-dispatch`
Expected: FAIL — `Cannot find module './campaign-dispatch.service'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/crm-campaigns/campaign-dispatch.service.ts`:

```ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { renderCampaignBody } from './campaign-body.util';

/** How many recipients one drain pass sends before yielding. */
export const CAMPAIGN_BATCH_SIZE = 200;

interface PendingRecipient {
    id: string;
    email: string | null;
    phone: string | null;
    subject: string | null;
    message: string | null;
}

/**
 * Sending is a drain, not a loop: a campaign is marked SENDING and its
 * recipients are worked through a batch at a time. A restart mid-send resumes
 * on the next cron tick instead of stranding the campaign forever, and a large
 * uploaded list is paced rather than fired at the provider all at once.
 */
@Injectable()
export class CampaignDispatchService {
    constructor(
        private db: DatabaseService,
        private recipients: CampaignRecipientsService,
        private sms: SmsService,
        private whatsapp: WhatsAppService,
        private email: EmailService,
        private readonly logger: AppLogger,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /**
     * Moves a campaign into SENDING and starts the first pass. SEGMENT
     * campaigns resolve their recipients here; UPLOAD campaigns already have
     * theirs from when they were created.
     */
    async queue(tenantId: string, campaignId: string): Promise<{ queued: number }> {
        const campaign = await this.db.crmCampaign.findFirst({
            where: { id: campaignId, tenant_id: tenantId },
        });
        if (!campaign) throw new NotFoundException('Campaign not found');
        if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
            throw new BadRequestException(`Campaign is ${campaign.status} and cannot be sent`);
        }

        const queued =
            campaign.recipient_source === 'UPLOAD'
                ? await this.db.crmCampaignRecipient.count({ where: { campaign_id: campaignId } })
                : await this.recipients.writeSegmentRecipients(
                      tenantId,
                      campaignId,
                      campaign.target_segment,
                      campaign.target_group_id,
                  );

        if (queued === 0) throw new BadRequestException('No eligible recipients found');

        await this.db.crmCampaign.update({
            where: { id: campaignId },
            data: { status: 'SENDING', recipient_count: queued },
        });

        // Small campaigns should not wait for the next tick.
        void this.drainCampaign(campaignId).catch((err) =>
            this.logger.error(`Campaign ${campaignId} drain error: ${err}`),
        );

        return { queued };
    }

    /** One pass: claim up to CAMPAIGN_BATCH_SIZE pending recipients and send them. */
    async drainCampaign(campaignId: string): Promise<void> {
        const campaign = await this.db.crmCampaign.findFirst({ where: { id: campaignId } });
        if (!campaign || campaign.status !== 'SENDING') return;

        const batch: PendingRecipient[] = await this.db.crmCampaignRecipient.findMany({
            where: { campaign_id: campaignId, status: 'PENDING' },
            select: { id: true, email: true, phone: true, subject: true, message: true },
            take: CAMPAIGN_BATCH_SIZE,
        });

        if (batch.length === 0) {
            await this.complete(campaignId);
            return;
        }

        // Claim before sending. A concurrent pass that reads the same rows will
        // update zero of them and back off, so nobody is emailed twice.
        const claimed = await this.db.crmCampaignRecipient.updateMany({
            where: { id: { in: batch.map((r) => r.id) }, status: 'PENDING' },
            data: { status: 'SENDING' },
        });
        if (claimed.count === 0) return;

        for (const recipient of batch) {
            try {
                await this.deliver(campaign, recipient);
                await this.db.crmCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: { status: 'SENT', sent_at: new Date() },
                });
            } catch (err) {
                await this.db.crmCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: { status: 'FAILED', error: String(err) },
                });
            }
        }

        // A short batch was the last one. Finishing here rather than waiting for
        // the next tick is what keeps a small campaign from sitting on SENDING
        // for five minutes after its last email has already gone.
        if (batch.length < CAMPAIGN_BATCH_SIZE) {
            await this.complete(campaignId);
        }
    }

    /** Cron: fire due scheduled campaigns, then push in-flight ones forward. */
    @Cron('*/5 * * * *')
    async processScheduledCampaigns(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.CRM_CAMPAIGNS, () => this.processCampaigns());
    }

    async processCampaigns(): Promise<void> {
        const due = await this.db.crmCampaign.findMany({
            where: { status: 'SCHEDULED', scheduled_at: { lte: new Date() } },
            select: { id: true, tenant_id: true },
        });
        for (const campaign of due) {
            try {
                await this.queue(campaign.tenant_id, campaign.id);
            } catch (err) {
                this.logger.error(`Scheduled campaign ${campaign.id} dispatch failed: ${err}`);
            }
        }

        const inFlight = await this.db.crmCampaign.findMany({
            where: { status: 'SENDING' },
            select: { id: true },
        });
        for (const campaign of inFlight) {
            try {
                await this.drainCampaign(campaign.id);
            } catch (err) {
                this.logger.error(`Campaign ${campaign.id} drain failed: ${err}`);
            }
        }
    }

    private async deliver(campaign: any, recipient: PendingRecipient): Promise<void> {
        const message = recipient.message ?? campaign.message ?? '';
        const subject = recipient.subject ?? campaign.subject ?? '';

        if (campaign.channel === 'SMS') {
            if (!recipient.phone) throw new Error('Recipient has no phone number');
            const result = await this.sms.sendSms(recipient.phone, message, {
                tenantId: campaign.tenant_id,
                purpose: 'CRM campaign',
            });
            if (!result.sent) throw new Error('Insufficient SMS credits');
            return;
        }

        if (campaign.channel === 'WHATSAPP') {
            if (!recipient.phone) throw new Error('Recipient has no phone number');
            await this.whatsapp.sendMessage(recipient.phone, message, { tenantId: campaign.tenant_id });
            return;
        }

        if (!recipient.email) throw new Error('Recipient has no email address');
        await this.email.sendCustom(
            recipient.email,
            subject,
            renderCampaignBody(message, campaign.body_format),
            { tenantId: campaign.tenant_id },
        );
    }

    private async complete(campaignId: string): Promise<void> {
        const grouped = await this.db.crmCampaignRecipient.groupBy({
            by: ['status'],
            where: { campaign_id: campaignId },
            _count: { _all: true },
        });
        const countOf = (status: string) =>
            grouped.find((g: any) => g.status === status)?._count?._all ?? 0;

        await this.db.crmCampaign.update({
            where: { id: campaignId },
            data: {
                status: 'COMPLETED',
                sent_at: new Date(),
                delivered_count: countOf('SENT'),
                failed_count: countOf('FAILED'),
            },
        });
        this.logger.log(
            `Campaign ${campaignId} completed: ${countOf('SENT')} sent, ${countOf('FAILED')} failed`,
        );
    }
}
```

- [ ] **Step 4: Register the service**

In `apps/backend/src/crm-campaigns/crm-campaigns.module.ts`, add the import and put `CampaignDispatchService` in `providers`:

```ts
import { CampaignDispatchService } from './campaign-dispatch.service';
```

```ts
    providers: [CrmCampaignsService, CampaignRecipientsService, CampaignDispatchService],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @erp71/backend -- campaign-dispatch`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/crm-campaigns/campaign-dispatch.service.ts apps/backend/src/crm-campaigns/campaign-dispatch.service.spec.ts apps/backend/src/crm-campaigns/crm-campaigns.module.ts
git commit -m "feat(crm): restartable batch drain for campaign sending"
```

---

## Task 6: Upload-aware campaign service and API

Rewires `CrmCampaignsService` onto the new pieces: create accepts uploads, send delegates, findOne reports live progress, and cancel exists.

**Files:**
- Modify: `apps/backend/src/crm-campaigns/crm-campaigns.dto.ts`
- Modify: `apps/backend/src/crm-campaigns/crm-campaigns.service.ts`
- Modify: `apps/backend/src/crm-campaigns/crm-campaigns.service.spec.ts`
- Modify: `apps/backend/src/crm-campaigns/crm-campaigns.controller.ts`

**Interfaces:**
- Consumes: `validateCampaignRows` (Task 1), `CampaignRecipientsService` (Task 4), `CampaignDispatchService.queue` (Task 5).
- Produces: `CrmCampaignsService.cancel(tenantId, id)`, `findOne` returning `{ ...campaign, progress: { total, sent, failed, pending } }`, and `POST /crm/campaigns/:id/cancel`.

- [ ] **Step 1: Write the failing tests**

Append these `describe` blocks inside the top-level `describe('CrmCampaignsService', ...)` in `apps/backend/src/crm-campaigns/crm-campaigns.service.spec.ts`, and extend the existing `beforeEach` mocks. Replace the whole `beforeEach` block and the `dispatchCampaign` describe (the inline dispatcher no longer exists — its coverage moved to `campaign-dispatch.service.spec.ts`) with:

```ts
    beforeEach(async () => {
        db = {
            crmCampaign: {
                create: jest.fn().mockResolvedValue({ id: 'camp-1' }),
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                update: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
            crmCampaignRecipient: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };
        recipients = { writeUploadedRecipients: jest.fn().mockResolvedValue(0), resolveTargetCustomers: jest.fn().mockResolvedValue([]) };
        dispatch = { queue: jest.fn().mockResolvedValue({ queued: 0 }) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmCampaignsService,
                { provide: DatabaseService, useValue: db },
                { provide: CampaignRecipientsService, useValue: recipients },
                { provide: CampaignDispatchService, useValue: dispatch },
                { provide: AppLogger, useValue: { log: jest.fn(), error: jest.fn() } },
            ],
        }).compile();

        service = module.get<CrmCampaignsService>(CrmCampaignsService);
    });

    describe('create() — uploaded lists', () => {
        const uploadDto = (over: Record<string, unknown> = {}) => ({
            name: 'Eid blast',
            channel: 'EMAIL',
            recipient_source: 'UPLOAD',
            body_format: 'TEXT',
            rows: [{ email: 'a@example.com', name: 'A', subject: 'Hi', message: 'Hello' }],
            ...over,
        });

        it('creates the campaign and writes its recipients', async () => {
            recipients.writeUploadedRecipients.mockResolvedValueOnce(1);

            await service.create('t1', 'u1', uploadDto() as any);

            expect(db.crmCampaign.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        recipient_source: 'UPLOAD',
                        body_format: 'TEXT',
                        message: null,
                        subject: null,
                        status: 'DRAFT',
                    }),
                }),
            );
            expect(recipients.writeUploadedRecipients).toHaveBeenCalledWith(
                't1',
                'camp-1',
                [{ email: 'a@example.com', name: 'A', subject: 'Hi', message: 'Hello' }],
                'u1',
            );
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { recipient_count: 1 },
            });
        });

        it('does not require a campaign-level subject or message', async () => {
            recipients.writeUploadedRecipients.mockResolvedValueOnce(1);
            await expect(service.create('t1', 'u1', uploadDto() as any)).resolves.toBeDefined();
        });

        it('rejects an uploaded list on a non-EMAIL channel', async () => {
            await expect(
                service.create('t1', 'u1', uploadDto({ channel: 'SMS' }) as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.crmCampaign.create).not.toHaveBeenCalled();
        });

        it('rejects an upload with no rows', async () => {
            await expect(
                service.create('t1', 'u1', uploadDto({ rows: [] }) as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects an upload whose rows all fail validation', async () => {
            await expect(
                service.create('t1', 'u1', uploadDto({ rows: [{ email: 'nope', subject: 'a', message: 'b' }] }) as any),
            ).rejects.toThrow(BadRequestException);
            expect(db.crmCampaign.create).not.toHaveBeenCalled();
        });

        it('rejects an upload over the row cap', async () => {
            const rows = Array.from({ length: 1001 }, (_, i) => ({
                email: `p${i}@example.com`, name: 'P', subject: 'Hi', message: 'Hello',
            }));
            await expect(service.create('t1', 'u1', uploadDto({ rows }) as any)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('marks the campaign SCHEDULED when a time is given', async () => {
            recipients.writeUploadedRecipients.mockResolvedValueOnce(1);
            await service.create('t1', 'u1', uploadDto({ scheduled_at: '2026-08-10T14:30:00+06:00' }) as any);
            expect(db.crmCampaign.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) }),
            );
        });
    });

    describe('create() — segment campaigns', () => {
        it('still requires a message', async () => {
            await expect(
                service.create('t1', 'u1', { name: 'X', channel: 'SMS' } as any),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('send()', () => {
        it('delegates to the dispatcher', async () => {
            dispatch.queue.mockResolvedValueOnce({ queued: 4 });
            await expect(service.send('t1', 'camp-1')).resolves.toEqual({ queued: 4 });
            expect(dispatch.queue).toHaveBeenCalledWith('t1', 'camp-1');
        });
    });

    describe('cancel()', () => {
        it('cancels a scheduled campaign', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SCHEDULED' });
            await service.cancel('t1', 'camp-1');
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { status: 'CANCELLED' },
            });
        });

        it('cancels the pending remainder of a sending campaign and keeps its counts', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SENDING' });
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([
                { status: 'SENT', _count: { _all: 3 } },
                { status: 'FAILED', _count: { _all: 1 } },
            ]);

            await service.cancel('t1', 'camp-1');

            expect(db.crmCampaignRecipient.updateMany).toHaveBeenCalledWith({
                where: { campaign_id: 'camp-1', status: 'PENDING' },
                data: { status: 'CANCELLED' },
            });
            expect(db.crmCampaign.update).toHaveBeenCalledWith({
                where: { id: 'camp-1' },
                data: { status: 'CANCELLED', delivered_count: 3, failed_count: 1 },
            });
        });

        it('refuses to cancel a completed campaign', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'COMPLETED' });
            await expect(service.cancel('t1', 'camp-1')).rejects.toThrow(BadRequestException);
        });
    });

    describe('findOne()', () => {
        it('reports live progress alongside the campaign', async () => {
            db.crmCampaign.findFirst.mockResolvedValueOnce({ id: 'camp-1', status: 'SENDING' });
            db.crmCampaignRecipient.groupBy.mockResolvedValueOnce([
                { status: 'SENT', _count: { _all: 5 } },
                { status: 'FAILED', _count: { _all: 1 } },
                { status: 'PENDING', _count: { _all: 4 } },
            ]);

            const result = await service.findOne('t1', 'camp-1');

            expect(result.progress).toEqual({ total: 10, sent: 5, failed: 1, pending: 4 });
        });
    });
```

Update the imports at the top of the spec — drop `SmsService`, `WhatsAppService`, `EmailService` and `JobTrackerService`, and add:

```ts
import { CampaignRecipientsService } from './campaign-recipients.service';
import { CampaignDispatchService } from './campaign-dispatch.service';
```

Also declare `let recipients: any;` and `let dispatch: any;` beside the existing `let db: any;`, and delete the now-unused `let sms`, `let whatsapp`, `let email` declarations.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @erp71/backend -- crm-campaigns.service`
Expected: FAIL — `service.cancel is not a function` and unknown provider errors.

- [ ] **Step 3: Extend the DTOs**

Replace `apps/backend/src/crm-campaigns/crm-campaigns.dto.ts` with:

```ts
import { Type } from 'class-transformer';
import {
    IsString,
    IsOptional,
    IsEnum,
    IsUUID,
    IsDateString,
    IsIn,
    IsEmail,
    IsNotEmpty,
    IsArray,
    ArrayMaxSize,
    ValidateNested,
} from 'class-validator';
import { CAMPAIGN_UPLOAD_MAX_ROWS } from '@erp71/shared-types';

export enum CampaignChannel {
    SMS = 'SMS',
    WHATSAPP = 'WHATSAPP',
    EMAIL = 'EMAIL',
}

export enum CampaignTargetSegment {
    ALL = 'ALL',
    VIP = 'VIP',
    AT_RISK = 'At-Risk',
    REGULAR = 'Regular',
    NEW = 'New',
}

export enum CampaignRecipientSource {
    SEGMENT = 'SEGMENT',
    UPLOAD = 'UPLOAD',
}

export enum CampaignBodyFormat {
    TEXT = 'TEXT',
    HTML = 'HTML',
}

/** One row of an uploaded recipient list. */
export class CampaignUploadRowDto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsString()
    @IsNotEmpty()
    subject: string;

    @IsString()
    @IsNotEmpty()
    message: string;
}

export class CreateCampaignDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsEnum(CampaignChannel)
    channel: CampaignChannel;

    @IsOptional()
    @IsEnum(CampaignRecipientSource)
    recipient_source?: CampaignRecipientSource;

    @IsOptional()
    @IsEnum(CampaignBodyFormat)
    body_format?: CampaignBodyFormat;

    @IsOptional()
    @IsString()
    subject?: string;

    /** Required for SEGMENT campaigns; UPLOAD campaigns carry a message per row. */
    @IsOptional()
    @IsString()
    message?: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(CAMPAIGN_UPLOAD_MAX_ROWS)
    @ValidateNested({ each: true })
    @Type(() => CampaignUploadRowDto)
    rows?: CampaignUploadRowDto[];

    @IsOptional()
    @IsIn(['ALL', 'VIP', 'At-Risk', 'Regular', 'New'])
    target_segment?: string;

    @IsOptional()
    @IsUUID()
    target_group_id?: string;

    @IsOptional()
    @IsDateString()
    scheduled_at?: string;
}

export class UpdateCampaignDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    subject?: string;

    @IsOptional()
    @IsString()
    message?: string;

    @IsOptional()
    @IsEnum(CampaignBodyFormat)
    body_format?: CampaignBodyFormat;

    @IsOptional()
    @IsIn(['ALL', 'VIP', 'At-Risk', 'Regular', 'New'])
    target_segment?: string;

    @IsOptional()
    @IsUUID()
    target_group_id?: string;

    @IsOptional()
    @IsDateString()
    scheduled_at?: string;
}
```

- [ ] **Step 4: Rewrite the service**

Replace `apps/backend/src/crm-campaigns/crm-campaigns.service.ts` with:

```ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { validateCampaignRows } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { CreateCampaignDto, UpdateCampaignDto } from './crm-campaigns.dto';
import { paginate } from '../common/pagination.dto';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { CampaignDispatchService } from './campaign-dispatch.service';

@Injectable()
export class CrmCampaignsService {
    constructor(
        private db: DatabaseService,
        private recipients: CampaignRecipientsService,
        private dispatch: CampaignDispatchService,
        private readonly logger: AppLogger,
    ) {}

    async create(tenantId: string, userId: string, dto: CreateCampaignDto) {
        const source = dto.recipient_source ?? 'SEGMENT';

        if (source === 'UPLOAD') {
            return this.createFromUpload(tenantId, userId, dto);
        }

        if (!dto.message) {
            throw new BadRequestException('message is required.');
        }
        if (dto.channel === 'EMAIL' && !dto.subject) {
            throw new BadRequestException('subject is required for EMAIL campaigns.');
        }

        return this.db.crmCampaign.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                channel: dto.channel,
                recipient_source: 'SEGMENT',
                body_format: dto.body_format ?? 'TEXT',
                subject: dto.subject,
                message: dto.message,
                target_segment: dto.target_segment ?? 'ALL',
                target_group_id: dto.target_group_id,
                scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
                created_by: userId,
                status: dto.scheduled_at ? 'SCHEDULED' : 'DRAFT',
            },
            include: { creator: { select: { id: true, name: true, email: true } } },
        });
    }

    /**
     * An uploaded list is validated with the same rules the browser previewed
     * with, then materialised into recipients straight away — so the detail
     * view can show exactly who will be emailed before anything is sent.
     */
    private async createFromUpload(tenantId: string, userId: string, dto: CreateCampaignDto) {
        if (dto.channel !== 'EMAIL') {
            throw new BadRequestException('An uploaded recipient list can only be sent by email.');
        }

        const { rows, fileError } = validateCampaignRows(dto.rows ?? []);
        if (fileError) throw new BadRequestException(fileError);

        const campaign = await this.db.crmCampaign.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                channel: 'EMAIL',
                recipient_source: 'UPLOAD',
                body_format: dto.body_format ?? 'TEXT',
                subject: null,
                message: null,
                target_segment: null,
                target_group_id: null,
                scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
                created_by: userId,
                status: dto.scheduled_at ? 'SCHEDULED' : 'DRAFT',
            },
            include: { creator: { select: { id: true, name: true, email: true } } },
        });

        const written = await this.recipients.writeUploadedRecipients(tenantId, campaign.id, rows, userId);
        await this.db.crmCampaign.update({
            where: { id: campaign.id },
            data: { recipient_count: written },
        });

        return { ...campaign, recipient_count: written };
    }

    async findAll(tenantId: string, opts?: { page?: number; limit?: number }) {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const [items, total] = await Promise.all([
            this.db.crmCampaign.findMany({
                where: { tenant_id: tenantId },
                include: {
                    creator: { select: { id: true, name: true } },
                    _count: { select: { recipients: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.crmCampaign.count({ where: { tenant_id: tenantId } }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                creator: { select: { id: true, name: true, email: true } },
                recipients: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        phone: true,
                        subject: true,
                        status: true,
                        sent_at: true,
                        error: true,
                    },
                    orderBy: [{ status: 'asc' }, { sent_at: 'desc' }],
                    take: 100,
                },
            },
        });
        if (!campaign) throw new NotFoundException('Campaign not found');

        return { ...campaign, progress: await this.progressOf(id) };
    }

    async update(tenantId: string, id: string, dto: UpdateCampaignDto) {
        const existing = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Campaign not found');
        if (!['DRAFT', 'SCHEDULED'].includes(existing.status)) {
            throw new BadRequestException('Only DRAFT/SCHEDULED campaigns can be edited');
        }
        if (
            existing.channel === 'EMAIL' &&
            existing.recipient_source === 'SEGMENT' &&
            dto.subject !== undefined &&
            !dto.subject
        ) {
            throw new BadRequestException('subject is required for EMAIL campaigns.');
        }

        const data: any = { ...dto };
        if (dto.scheduled_at !== undefined) {
            data.scheduled_at = dto.scheduled_at ? new Date(dto.scheduled_at) : null;
            data.status = dto.scheduled_at ? 'SCHEDULED' : 'DRAFT';
        }

        return this.db.crmCampaign.update({
            where: { id },
            data,
            include: { creator: { select: { id: true, name: true } } },
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Campaign not found');
        if (existing.status === 'SENDING') {
            throw new BadRequestException('Cannot delete a campaign that is currently sending');
        }
        await this.db.crmCampaign.delete({ where: { id } });
        return { success: true };
    }

    /**
     * Stops a campaign before, or part-way through, its send. Emails already
     * out cannot be recalled, so the counts of what did go are kept.
     */
    async cancel(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!campaign) throw new NotFoundException('Campaign not found');
        if (!['SCHEDULED', 'SENDING'].includes(campaign.status)) {
            throw new BadRequestException(`Campaign is ${campaign.status} and cannot be cancelled`);
        }

        if (campaign.status === 'SCHEDULED') {
            await this.db.crmCampaign.update({ where: { id }, data: { status: 'CANCELLED' } });
            return { success: true };
        }

        await this.db.crmCampaignRecipient.updateMany({
            where: { campaign_id: id, status: 'PENDING' },
            data: { status: 'CANCELLED' },
        });
        const progress = await this.progressOf(id);
        await this.db.crmCampaign.update({
            where: { id },
            data: { status: 'CANCELLED', delivered_count: progress.sent, failed_count: progress.failed },
        });
        this.logger.log(`Campaign ${id} cancelled after ${progress.sent} sent`);
        return { success: true };
    }

    async previewRecipients(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!campaign) throw new NotFoundException('Campaign not found');

        if (campaign.recipient_source === 'UPLOAD') {
            const progress = await this.progressOf(id);
            return { count: progress.total, sample: [] };
        }

        const customers = await this.recipients.resolveTargetCustomers(
            tenantId,
            campaign.target_segment,
            campaign.target_group_id,
        );
        return {
            count: customers.length,
            sample: customers.slice(0, 10).map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
        };
    }

    send(tenantId: string, id: string) {
        return this.dispatch.queue(tenantId, id);
    }

    /** Called by SalesService after a sale to attribute revenue to recent campaigns. */
    async attributeSale(tenantId: string, customerId: string, amount: number): Promise<void> {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recipient = await this.db.crmCampaignRecipient.findFirst({
            where: {
                customer_id: customerId,
                status: 'SENT',
                campaign: {
                    tenant_id: tenantId,
                    status: 'COMPLETED',
                    sent_at: { gte: thirtyDaysAgo },
                },
            },
            orderBy: { sent_at: 'desc' },
        });

        if (!recipient) return;

        await this.db.crmCampaign.update({
            where: { id: recipient.campaign_id },
            data: {
                attributed_revenue: { increment: amount },
                attributed_orders: { increment: 1 },
            },
        });
    }

    private async progressOf(campaignId: string) {
        const grouped = await this.db.crmCampaignRecipient.groupBy({
            by: ['status'],
            where: { campaign_id: campaignId },
            _count: { _all: true },
        });
        const countOf = (status: string) =>
            grouped.find((g: any) => g.status === status)?._count?._all ?? 0;
        const sent = countOf('SENT');
        const failed = countOf('FAILED');
        const pending = countOf('PENDING') + countOf('SENDING');
        return { total: sent + failed + pending + countOf('CANCELLED'), sent, failed, pending };
    }
}
```

Note `attributeSale` needs `crmCampaignRecipient.findFirst` on the mock; add `findFirst: jest.fn()` to the spec's `crmCampaignRecipient` mock if a test exercises it.

- [ ] **Step 5: Add the cancel route**

In `apps/backend/src/crm-campaigns/crm-campaigns.controller.ts`, add after the `send` handler:

```ts
    @Post(':id/cancel')
    cancel(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.cancel(tenant.tenantId, id);
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w @erp71/backend -- crm-campaigns`
Expected: PASS across `crm-campaigns.service.spec.ts`, `campaign-recipients.service.spec.ts`, `campaign-dispatch.service.spec.ts`, `campaign-body.util.spec.ts`.

- [ ] **Step 7: Verify the whole backend suite and build**

Run: `npm test -w @erp71/backend && npm run build -w @erp71/backend`
Expected: both exit 0. If another module's spec constructs `CrmCampaignsService` directly, update its providers to the new four.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/crm-campaigns
git commit -m "feat(crm): create, cancel and track campaigns from an uploaded list"
```

---

## Task 7: Extract the spreadsheet parser

**Files:**
- Create: `apps/frontend/src/lib/spreadsheet.ts`
- Create: `apps/frontend/src/lib/spreadsheet.test.ts`
- Modify: `apps/frontend/src/components/import-dialog.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseSpreadsheetFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }>` and `autoMapHeaders(headers: string[], fields: { key: string; label: string }[]): Record<string, string>`. Task 9's upload component uses both.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/lib/spreadsheet.test.ts`:

```ts
import { parseSpreadsheetFile, autoMapHeaders } from './spreadsheet';

const csvFile = (body: string, name = 'list.csv') =>
    new File([body], name, { type: 'text/csv' });

describe('parseSpreadsheetFile', () => {
    it('reads headers and rows from a CSV', async () => {
        const result = await parseSpreadsheetFile(
            csvFile('Email,Subject\na@example.com,Hi\nb@example.com,Yo\n'),
        );
        expect(result.headers).toEqual(['Email', 'Subject']);
        expect(result.rows).toEqual([
            { Email: 'a@example.com', Subject: 'Hi' },
            { Email: 'b@example.com', Subject: 'Yo' },
        ]);
    });

    it('skips blank lines', async () => {
        const result = await parseSpreadsheetFile(csvFile('Email\na@example.com\n\n'));
        expect(result.rows).toHaveLength(1);
    });

    it('rejects an unsupported extension', async () => {
        await expect(parseSpreadsheetFile(csvFile('x', 'notes.txt'))).rejects.toThrow(
            'Unsupported file type ".txt". Please upload a .csv or .xlsx file.',
        );
    });

    it('rejects a file with no extension', async () => {
        await expect(parseSpreadsheetFile(csvFile('x', 'noext'))).rejects.toThrow(
            'Unsupported file type',
        );
    });
});

describe('autoMapHeaders', () => {
    const fields = [
        { key: 'email', label: 'Email' },
        { key: 'name', label: 'Name' },
    ];

    it('matches a header to a field by label, ignoring case and padding', () => {
        expect(autoMapHeaders(['  email ', 'Name'], fields)).toEqual({ email: '  email ', name: 'Name' });
    });

    it('matches a header to a field by key', () => {
        expect(autoMapHeaders(['name'], fields)).toEqual({ email: '', name: 'name' });
    });

    it('leaves a field unmapped when no header matches', () => {
        expect(autoMapHeaders(['Phone'], fields)).toEqual({ email: '', name: '' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @erp71/frontend -- spreadsheet`
Expected: FAIL — `Cannot find module './spreadsheet'`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/lib/spreadsheet.ts`:

```ts
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedSpreadsheet {
    headers: string[];
    rows: Record<string, string>[];
}

/** Reads a .csv, .xlsx or .xls file in the browser. The first sheet wins. */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
    if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
        throw new Error(`Unsupported file type ".${ext ?? ''}". Please upload a .csv or .xlsx file.`);
    }

    if (ext === 'csv') {
        const text = await file.text();
        const parsed = Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: true,
        });
        if (parsed.errors.length > 0) throw new Error(parsed.errors[0].message);
        return { headers: parsed.meta.fields ?? [], rows: parsed.data };
    }

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
    return { headers: json.length > 0 ? Object.keys(json[0]) : [], rows: json };
}

/** Guesses which spreadsheet header feeds which field, by label then by key. */
export function autoMapHeaders(
    headers: string[],
    fields: { key: string; label: string }[],
): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const field of fields) {
        const match = headers.find(
            (h) =>
                h.trim().toLowerCase() === field.label.toLowerCase() ||
                h.trim().toLowerCase() === field.key.toLowerCase(),
        );
        mapping[field.key] = match ?? '';
    }
    return mapping;
}
```

- [ ] **Step 4: Point the import dialog at it**

In `apps/frontend/src/components/import-dialog.tsx`:

- Delete the `import Papa from 'papaparse';` and `import * as XLSX from 'xlsx';` lines and the whole local `parseFile` function (lines 34–55).
- Add `import { parseSpreadsheetFile, autoMapHeaders } from '@/lib/spreadsheet';`
- In `handleFile`, replace `await parseFile(file)` with `await parseSpreadsheetFile(file)`.
- Replace the inline auto-mapping block with:

```ts
      setMapping(autoMapHeaders(headers, fields));
```

removing the `const auto: Record<string, string> = {};` loop that preceded it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @erp71/frontend -- spreadsheet`
Expected: PASS, 7 tests.

- [ ] **Step 6: Verify nothing else broke**

Run: `npm test -w @erp71/frontend && npx tsc --noEmit -p apps/frontend/tsconfig.json`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/lib/spreadsheet.ts apps/frontend/src/lib/spreadsheet.test.ts apps/frontend/src/components/import-dialog.tsx
git commit -m "refactor(frontend): extract the spreadsheet parser out of ImportDialog"
```

---

## Task 8: Dhaka schedule conversion

**Files:**
- Create: `apps/frontend/src/lib/schedule-time.ts`
- Create: `apps/frontend/src/lib/schedule-time.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `dhakaLocalToIso(localValue: string): string | null` and `isoToDhakaLocal(iso: string | null): string`. Task 9 and Task 10 use both.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/lib/schedule-time.test.ts`:

```ts
import { dhakaLocalToIso, isoToDhakaLocal } from './schedule-time';

describe('dhakaLocalToIso', () => {
    it('stamps a datetime-local value as Dhaka time', () => {
        expect(dhakaLocalToIso('2026-08-10T14:30')).toBe('2026-08-10T14:30:00+06:00');
    });

    it('keeps seconds when the picker supplies them', () => {
        expect(dhakaLocalToIso('2026-08-10T14:30:45')).toBe('2026-08-10T14:30:45+06:00');
    });

    it('returns null for an empty value', () => {
        expect(dhakaLocalToIso('')).toBeNull();
    });

    it('resolves to the right instant', () => {
        expect(new Date(dhakaLocalToIso('2026-08-10T14:30')!).toISOString()).toBe(
            '2026-08-10T08:30:00.000Z',
        );
    });
});

describe('isoToDhakaLocal', () => {
    it('renders an instant as a Dhaka datetime-local value', () => {
        expect(isoToDhakaLocal('2026-08-10T08:30:00.000Z')).toBe('2026-08-10T14:30');
    });

    it('rolls over the date when Dhaka is already tomorrow', () => {
        expect(isoToDhakaLocal('2026-08-10T20:00:00.000Z')).toBe('2026-08-11T02:00');
    });

    it('returns an empty string for null', () => {
        expect(isoToDhakaLocal(null)).toBe('');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @erp71/frontend -- schedule-time`
Expected: FAIL — `Cannot find module './schedule-time'`.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/lib/schedule-time.ts`:

```ts
// ERP71 serves Bangladeshi retailers. Campaign schedules are always picked in
// Dhaka wall-clock time, and Bangladesh has no daylight saving, so a fixed
// +06:00 offset is exact rather than an approximation.
const DHAKA_OFFSET = '+06:00';
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * Turns a `datetime-local` value into an unambiguous instant.
 *
 * Without this the browser posts a bare wall-clock string, which the UTC
 * server reads as UTC — putting every scheduled campaign six hours out.
 */
export function dhakaLocalToIso(localValue: string): string | null {
    if (!localValue) return null;
    const withSeconds = localValue.length === 16 ? `${localValue}:00` : localValue;
    return `${withSeconds}${DHAKA_OFFSET}`;
}

/** The inverse: an instant rendered for a `datetime-local` input, in Dhaka time. */
export function isoToDhakaLocal(iso: string | null): string {
    if (!iso) return '';
    const shifted = new Date(new Date(iso).getTime() + DHAKA_OFFSET_MS);
    return shifted.toISOString().slice(0, 16);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @erp71/frontend -- schedule-time`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/schedule-time.ts apps/frontend/src/lib/schedule-time.test.ts
git commit -m "feat(frontend): convert campaign schedules between Dhaka time and instants"
```

---

## Task 9: Upload step component

The file-drop → map → preview UI that lives inside the create modal.

**Files:**
- Create: `apps/frontend/src/app/(app)/crm/campaigns/upload-recipients.tsx`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/crmHr.ts`

**Interfaces:**
- Consumes: `parseSpreadsheetFile`, `autoMapHeaders` (Task 7); `validateCampaignRows`, `ValidCampaignRow`, `CampaignRowIssue` (Task 1).
- Produces: default-exported `UploadRecipients` component with props
  `{ rows: ValidCampaignRow[]; issues: CampaignRowIssue[]; onChange: (rows: ValidCampaignRow[], issues: CampaignRowIssue[]) => void }`.
  Task 10 renders it.

- [ ] **Step 1: Add the i18n strings**

In `apps/frontend/src/lib/localization/messages/en/crmHr.ts`, inside the `"crmCampaigns"` object (after `"allChannels"`), add:

```ts
        "upload": {
            "recipientsLabel": "Recipients",
            "sourceSegment": "Customer segment",
            "sourceUpload": "Upload list",
            "bodyFormatLabel": "Message format",
            "bodyFormatText": "Plain text",
            "bodyFormatHtml": "HTML",
            "dropzone": "Drag & drop or click to browse",
            "dropzoneHint": "Supports .csv and .xlsx — up to 1,000 rows",
            "downloadTemplate": "Download template",
            "mapTitle": "Match your columns",
            "mapHint": "Tell us which column holds each field. Required fields are marked *.",
            "skipColumn": "— skip —",
            "fieldEmail": "Email",
            "fieldName": "Name",
            "fieldSubject": "Subject",
            "fieldMessage": "Message",
            "previewTitle": "{count} recipients ready",
            "previewHint": "Showing the first {shown} of {count}.",
            "issuesTitle": "{count} rows skipped",
            "issueLine": "Row {line} ({email}): {reason}",
            "changeFile": "Choose a different file",
            "nameFallbackHint": "Rows with no name are named after the part of the address before the @.",
            "uploadRequired": "Upload a recipient list to continue."
        },
        "schedule": {
            "label": "Schedule (optional)",
            "resolved": "Sends {when} (Bangladesh time)",
            "reschedule": "Reschedule",
            "rescheduled": "Schedule updated",
            "rescheduleFailed": "Failed to update the schedule",
            "cancel": "Cancel campaign",
            "cancelConfirm": "Cancel \"{name}\"? Emails already sent cannot be recalled.",
            "cancelled": "Campaign cancelled",
            "cancelFailed": "Failed to cancel the campaign"
        },
        "recipients": {
            "title": "Recipients",
            "progress": "{sent} sent · {failed} failed · {pending} pending",
            "columnRecipient": "Recipient",
            "columnSubject": "Subject",
            "columnStatus": "Status",
            "showingFirst": "Showing the first {shown} of {total}.",
            "none": "No recipients yet"
        },
```

Add the same key structure to `bn/crmHr.ts`:

```ts
        "upload": {
            "recipientsLabel": "প্রাপক",
            "sourceSegment": "গ্রাহক সেগমেন্ট",
            "sourceUpload": "তালিকা আপলোড",
            "bodyFormatLabel": "বার্তার ধরন",
            "bodyFormatText": "সাধারণ টেক্সট",
            "bodyFormatHtml": "HTML",
            "dropzone": "ফাইল টেনে আনুন বা ক্লিক করুন",
            "dropzoneHint": ".csv ও .xlsx সমর্থিত — সর্বোচ্চ ১,০০০ সারি",
            "downloadTemplate": "টেমপ্লেট ডাউনলোড",
            "mapTitle": "কলাম মেলান",
            "mapHint": "কোন কলামে কোন তথ্য আছে জানান। * চিহ্নিত ঘরগুলো আবশ্যক।",
            "skipColumn": "— বাদ দিন —",
            "fieldEmail": "ইমেইল",
            "fieldName": "নাম",
            "fieldSubject": "বিষয়",
            "fieldMessage": "বার্তা",
            "previewTitle": "{count} জন প্রাপক প্রস্তুত",
            "previewHint": "{count} এর মধ্যে প্রথম {shown} দেখানো হচ্ছে।",
            "issuesTitle": "{count} সারি বাদ পড়েছে",
            "issueLine": "সারি {line} ({email}): {reason}",
            "changeFile": "অন্য ফাইল বাছুন",
            "nameFallbackHint": "নাম না থাকলে ইমেইলের @ এর আগের অংশ নাম হিসেবে ব্যবহৃত হবে।",
            "uploadRequired": "এগোতে হলে একটি প্রাপক তালিকা আপলোড করুন।"
        },
        "schedule": {
            "label": "সময় নির্ধারণ (ঐচ্ছিক)",
            "resolved": "{when} এ পাঠানো হবে (বাংলাদেশ সময়)",
            "reschedule": "সময় বদলান",
            "rescheduled": "সময় হালনাগাদ হয়েছে",
            "rescheduleFailed": "সময় হালনাগাদ করা যায়নি",
            "cancel": "ক্যাম্পেইন বাতিল",
            "cancelConfirm": "\"{name}\" বাতিল করবেন? যেসব ইমেইল চলে গেছে সেগুলো ফেরানো যাবে না।",
            "cancelled": "ক্যাম্পেইন বাতিল হয়েছে",
            "cancelFailed": "ক্যাম্পেইন বাতিল করা যায়নি"
        },
        "recipients": {
            "title": "প্রাপক",
            "progress": "{sent} পাঠানো · {failed} ব্যর্থ · {pending} অপেক্ষমাণ",
            "columnRecipient": "প্রাপক",
            "columnSubject": "বিষয়",
            "columnStatus": "অবস্থা",
            "showingFirst": "{total} এর মধ্যে প্রথম {shown} দেখানো হচ্ছে।",
            "none": "এখনো কোনো প্রাপক নেই"
        },
```

And to `ms/crmHr.ts`:

```ts
        "upload": {
            "recipientsLabel": "Penerima",
            "sourceSegment": "Segmen pelanggan",
            "sourceUpload": "Muat naik senarai",
            "bodyFormatLabel": "Format mesej",
            "bodyFormatText": "Teks biasa",
            "bodyFormatHtml": "HTML",
            "dropzone": "Seret & lepas atau klik untuk pilih",
            "dropzoneHint": "Menyokong .csv dan .xlsx — sehingga 1,000 baris",
            "downloadTemplate": "Muat turun templat",
            "mapTitle": "Padankan lajur anda",
            "mapHint": "Beritahu kami lajur mana untuk setiap medan. Medan wajib ditanda *.",
            "skipColumn": "— langkau —",
            "fieldEmail": "E-mel",
            "fieldName": "Nama",
            "fieldSubject": "Subjek",
            "fieldMessage": "Mesej",
            "previewTitle": "{count} penerima sedia",
            "previewHint": "Memaparkan {shown} pertama daripada {count}.",
            "issuesTitle": "{count} baris dilangkau",
            "issueLine": "Baris {line} ({email}): {reason}",
            "changeFile": "Pilih fail lain",
            "nameFallbackHint": "Baris tanpa nama akan dinamakan mengikut bahagian alamat sebelum @.",
            "uploadRequired": "Muat naik senarai penerima untuk meneruskan."
        },
        "schedule": {
            "label": "Jadual (pilihan)",
            "resolved": "Dihantar {when} (waktu Bangladesh)",
            "reschedule": "Jadual semula",
            "rescheduled": "Jadual dikemas kini",
            "rescheduleFailed": "Gagal mengemas kini jadual",
            "cancel": "Batalkan kempen",
            "cancelConfirm": "Batalkan \"{name}\"? E-mel yang telah dihantar tidak boleh ditarik balik.",
            "cancelled": "Kempen dibatalkan",
            "cancelFailed": "Gagal membatalkan kempen"
        },
        "recipients": {
            "title": "Penerima",
            "progress": "{sent} dihantar · {failed} gagal · {pending} menunggu",
            "columnRecipient": "Penerima",
            "columnSubject": "Subjek",
            "columnStatus": "Status",
            "showingFirst": "Memaparkan {shown} pertama daripada {total}.",
            "none": "Tiada penerima lagi"
        },
```

- [ ] **Step 2: Verify the catalogs still match**

Run: `npm test -w @erp71/frontend -- catalog`
Expected: PASS — all three locales have identical key paths.

- [ ] **Step 3: Write the component**

Create `apps/frontend/src/app/(app)/crm/campaigns/upload-recipients.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import {
    validateCampaignRows,
    type CampaignRowIssue,
    type ValidCampaignRow,
} from '@erp71/shared-types';
import { parseSpreadsheetFile, autoMapHeaders } from '@/lib/spreadsheet';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Select } from '@/components/ui';

interface UploadRecipientsProps {
    rows: ValidCampaignRow[];
    issues: CampaignRowIssue[];
    onChange: (rows: ValidCampaignRow[], issues: CampaignRowIssue[]) => void;
}

const TEMPLATE = 'Email,Name,Subject,Message\nrahim@example.com,Rahim Uddin,Eid offer,Hello Rahim\n';

export default function UploadRecipients({ rows, issues, onChange }: UploadRecipientsProps) {
    const { t } = useI18n();
    const m = t.crmCampaigns.upload;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [headers, setHeaders] = useState<string[]>([]);
    const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [fileError, setFileError] = useState<string | null>(null);

    const FIELDS = [
        { key: 'email', label: m.fieldEmail, required: true },
        { key: 'name', label: m.fieldName, required: false },
        { key: 'subject', label: m.fieldSubject, required: true },
        { key: 'message', label: m.fieldMessage, required: true },
    ];

    const revalidate = (raw: Record<string, string>[], map: Record<string, string>) => {
        const mapped = raw.map((r) => ({
            email: map.email ? r[map.email] : '',
            name: map.name ? r[map.name] : '',
            subject: map.subject ? r[map.subject] : '',
            message: map.message ? r[map.message] : '',
        }));
        const result = validateCampaignRows(mapped);
        setFileError(result.fileError);
        onChange(result.rows, result.issues);
    };

    const handleFile = async (file: File) => {
        setFileError(null);
        try {
            const parsed = await parseSpreadsheetFile(file);
            const map = autoMapHeaders(parsed.headers, FIELDS);
            setHeaders(parsed.headers);
            setRawRows(parsed.rows);
            setMapping(map);
            revalidate(parsed.rows, map);
        } catch (e) {
            setHeaders([]);
            setRawRows([]);
            onChange([], []);
            setFileError(e instanceof Error ? e.message : 'Failed to read the file.');
        }
    };

    const handleMappingChange = (key: string, header: string) => {
        const next = { ...mapping, [key]: header };
        setMapping(next);
        revalidate(rawRows, next);
    };

    const downloadTemplate = () => {
        const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'campaign-recipients.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    if (rawRows.length === 0) {
        return (
            <div className="space-y-3">
                <div
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-200 rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors min-h-touch"
                >
                    <Upload className="w-8 h-8 text-gray-300 mb-3" />
                    <p className="font-semibold text-gray-700 text-sm">{m.dropzone}</p>
                    <p className="text-xs text-gray-400 mt-1">{m.dropzoneHint}</p>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
                />
                <button
                    type="button"
                    onClick={downloadTemplate}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                    {m.downloadTemplate}
                </button>
                {fileError && (
                    <p className="text-xs text-danger font-semibold">{fileError}</p>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="space-y-3">
                <p className="text-xs text-gray-500">{m.mapHint}</p>
                {FIELDS.map((field) => (
                    <Field key={field.key} label={field.label} required={field.required}>
                        <Select
                            value={mapping[field.key] ?? ''}
                            onChange={(e) => handleMappingChange(field.key, e.target.value)}
                        >
                            <option value="">{m.skipColumn}</option>
                            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </Select>
                    </Field>
                ))}
                <p className="text-xs text-gray-400">{m.nameFallbackHint}</p>
            </div>

            {fileError && (
                <div className="flex items-start gap-2 p-3 bg-danger-light rounded-lg">
                    <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                    <p className="text-xs text-danger-text font-semibold">{fileError}</p>
                </div>
            )}

            {rows.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <p className="text-sm font-semibold text-gray-900">
                            {m.previewTitle.replace('{count}', String(rows.length))}
                        </p>
                    </div>
                    <p className="text-xs text-gray-400">
                        {m.previewHint
                            .replace('{shown}', String(Math.min(5, rows.length)))
                            .replace('{count}', String(rows.length))}
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="px-3 py-2 text-left font-semibold text-gray-500">{m.fieldEmail}</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-500">{m.fieldName}</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-500">{m.fieldSubject}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.slice(0, 5).map((r) => (
                                    <tr key={r.email} className="border-t border-gray-100">
                                        <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">{r.email}</td>
                                        <td className="px-3 py-2 text-gray-700 max-w-[120px] truncate">{r.name}</td>
                                        <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">{r.subject}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {issues.length > 0 && (
                <div className="p-3 bg-amber-50 rounded-lg">
                    <p className="text-xs font-semibold text-amber-700 mb-1.5">
                        {m.issuesTitle.replace('{count}', String(issues.length))}
                    </p>
                    <ul className="space-y-1 max-h-40 overflow-y-auto">
                        {issues.slice(0, 50).map((issue) => (
                            <li key={`${issue.line}-${issue.email}`} className="text-xs text-amber-800">
                                {m.issueLine
                                    .replace('{line}', String(issue.line))
                                    .replace('{email}', issue.email || '—')
                                    .replace('{reason}', issue.reason)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <Button
                variant="secondary"
                onClick={() => { setRawRows([]); setHeaders([]); setFileError(null); onChange([], []); }}
            >
                {m.changeFile}
            </Button>
        </div>
    );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p apps/frontend/tsconfig.json`
Expected: exits 0. `Field` does accept `required` — the existing create modal already uses it on the Message field — so this should pass as written.

- [ ] **Step 5: Commit**

```bash
git add "apps/frontend/src/app/(app)/crm/campaigns/upload-recipients.tsx" apps/frontend/src/lib/localization/messages
git commit -m "feat(crm): upload step for campaign recipient lists"
```

---

## Task 10: Campaigns page wiring

**Files:**
- Modify: `apps/frontend/src/lib/api.ts`
- Modify: `apps/frontend/src/app/(app)/crm/campaigns/page.tsx`

**Interfaces:**
- Consumes: `UploadRecipients` (Task 9), `dhakaLocalToIso`/`isoToDhakaLocal` (Task 8), `POST /crm/campaigns/:id/cancel` (Task 6).
- Produces: nothing downstream.

- [ ] **Step 1: Add the API client method**

In `apps/frontend/src/lib/api.ts`, beside `sendCrmCampaign` (line 1250), add:

```ts
    cancelCrmCampaign: (id: string) => fetchWithAuth(`/crm/campaigns/${id}/cancel`, { method: 'POST' }),
```

- [ ] **Step 2: Extend the Campaign type and form state**

In `apps/frontend/src/app/(app)/crm/campaigns/page.tsx`, add to the `Campaign` interface:

```ts
    recipient_source: string;
    body_format: string;
    progress?: { total: number; sent: number; failed: number; pending: number };
    recipients?: Array<{
        id: string;
        email: string | null;
        name: string | null;
        subject: string | null;
        status: string;
        error: string | null;
    }>;
```

Add the imports:

```ts
import type { CampaignRowIssue, ValidCampaignRow } from '@erp71/shared-types';
import { dhakaLocalToIso, isoToDhakaLocal } from '@/lib/schedule-time';
import UploadRecipients from './upload-recipients';
```

Extend the create form state:

```ts
    const [form, setForm] = useState({
        name: '',
        description: '',
        channel: 'SMS',
        recipient_source: 'SEGMENT',
        body_format: 'TEXT',
        subject: '',
        target_segment: 'ALL',
        message: '',
        scheduled_at: '',
    });
    const [uploadRows, setUploadRows] = useState<ValidCampaignRow[]>([]);
    const [uploadIssues, setUploadIssues] = useState<CampaignRowIssue[]>([]);
```

- [ ] **Step 3: Rewrite the submit guard and handler**

Replace the `isEmail` / `canSubmit` / `handleCreate` block with:

```ts
    const isEmail = form.channel === 'EMAIL';
    const isUpload = form.recipient_source === 'UPLOAD';
    const canSubmit = isUpload
        ? Boolean(form.name.trim()) && uploadRows.length > 0
        : Boolean(form.name.trim() && form.message.trim() && (!isEmail || form.subject.trim()));

    const resetForm = () => {
        setForm({
            name: '', description: '', channel: 'SMS', recipient_source: 'SEGMENT',
            body_format: 'TEXT', subject: '', target_segment: 'ALL', message: '', scheduled_at: '',
        });
        setUploadRows([]);
        setUploadIssues([]);
    };

    const handleCreate = async () => {
        if (!canSubmit) return;
        setCreating(true);
        try {
            await api.createCrmCampaign(
                isUpload
                    ? {
                          name: form.name,
                          description: form.description || undefined,
                          channel: 'EMAIL',
                          recipient_source: 'UPLOAD',
                          body_format: form.body_format,
                          rows: uploadRows,
                          scheduled_at: dhakaLocalToIso(form.scheduled_at) ?? undefined,
                      }
                    : {
                          name: form.name,
                          description: form.description || undefined,
                          channel: form.channel,
                          recipient_source: 'SEGMENT',
                          body_format: isEmail ? form.body_format : undefined,
                          subject: isEmail ? form.subject : undefined,
                          target_segment: form.target_segment,
                          message: form.message,
                          scheduled_at: dhakaLocalToIso(form.scheduled_at) ?? undefined,
                      },
            );
            toast.success(m.created);
            setShowCreate(false);
            resetForm();
            await loadCampaigns();
        } catch (err: any) {
            toast.error(err?.message ?? m.createFailed);
        } finally {
            setCreating(false);
        }
    };
```

Choosing **Upload list** forces the channel to EMAIL, so add a handler used by the source radios:

```ts
    const setSource = (source: string) => {
        setForm((f) => ({ ...f, recipient_source: source, channel: source === 'UPLOAD' ? 'EMAIL' : f.channel }));
        if (source === 'SEGMENT') { setUploadRows([]); setUploadIssues([]); }
    };
```

- [ ] **Step 4: Rewrite the create modal body**

Replace the contents of the create `ModalShell`'s scrolling `div` (currently the Name / Channel+Segment / Subject / Message / Schedule fields) with:

```tsx
                        <Field label={m.columns.name} required>
                            <Input
                                type="text"
                                placeholder={m.placeholders.name}
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            />
                        </Field>

                        <Field label={m.upload.recipientsLabel}>
                            <div className="flex gap-4">
                                {[
                                    { value: 'SEGMENT', label: m.upload.sourceSegment },
                                    { value: 'UPLOAD', label: m.upload.sourceUpload },
                                ].map((option) => (
                                    <label key={option.value} className="flex items-center gap-2 cursor-pointer min-h-touch">
                                        <input
                                            type="radio"
                                            name="recipient-source"
                                            value={option.value}
                                            checked={form.recipient_source === option.value}
                                            onChange={() => setSource(option.value)}
                                            className="accent-blue-600"
                                        />
                                        <span className="text-sm font-medium text-gray-700">{option.label}</span>
                                    </label>
                                ))}
                            </div>
                        </Field>

                        {isUpload ? (
                            <UploadRecipients
                                rows={uploadRows}
                                issues={uploadIssues}
                                onChange={(rows, issues) => { setUploadRows(rows); setUploadIssues(issues); }}
                            />
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Channel">
                                        <Select
                                            value={form.channel}
                                            onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                                        >
                                            {CHANNELS.map((ch) => <option key={ch}>{ch}</option>)}
                                        </Select>
                                    </Field>
                                    <Field label="Target Segment">
                                        <Select
                                            value={form.target_segment}
                                            onChange={(e) => setForm((f) => ({ ...f, target_segment: e.target.value }))}
                                        >
                                            {SEGMENTS.map((s) => <option key={s}>{s}</option>)}
                                        </Select>
                                    </Field>
                                </div>

                                {isEmail && (
                                    <Field label={m.subjectLabel} required>
                                        <Input
                                            type="text"
                                            placeholder={m.placeholders.subject}
                                            value={form.subject}
                                            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                                        />
                                    </Field>
                                )}

                                <Field
                                    label="Message"
                                    required
                                    hint={form.channel === 'SMS' ? `${charCount} chars · ${smsPages} SMS page${smsPages !== 1 ? 's' : ''}` : undefined}
                                >
                                    <Textarea
                                        placeholder={m.placeholders.message}
                                        value={form.message}
                                        onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                                        rows={4}
                                    />
                                </Field>
                            </>
                        )}

                        {(isEmail || isUpload) && (
                            <Field label={m.upload.bodyFormatLabel}>
                                <div className="flex gap-4">
                                    {[
                                        { value: 'TEXT', label: m.upload.bodyFormatText },
                                        { value: 'HTML', label: m.upload.bodyFormatHtml },
                                    ].map((option) => (
                                        <label key={option.value} className="flex items-center gap-2 cursor-pointer min-h-touch">
                                            <input
                                                type="radio"
                                                name="body-format"
                                                value={option.value}
                                                checked={form.body_format === option.value}
                                                onChange={() => setForm((f) => ({ ...f, body_format: option.value }))}
                                                className="accent-blue-600"
                                            />
                                            <span className="text-sm font-medium text-gray-700">{option.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </Field>
                        )}

                        <Field
                            label={m.schedule.label}
                            hint={form.scheduled_at ? m.schedule.resolved.replace('{when}', form.scheduled_at.replace('T', ' ')) : undefined}
                        >
                            <Input
                                type="datetime-local"
                                value={form.scheduled_at}
                                onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                            />
                        </Field>
```

Point the modal's Cancel button and `onBackdropClick` at `() => { setShowCreate(false); resetForm(); }`.

- [ ] **Step 5: Load the full campaign on select**

Replace `handleSelect` so the detail modal has recipients and progress:

```ts
    const handleSelect = async (campaign: Campaign) => {
        setSelected(campaign);
        setPreview(null);
        setRescheduleValue(isoToDhakaLocal(campaign.scheduled_at));
        setPreviewLoading(true);
        try {
            const full = await api.getCrmCampaign(campaign.id);
            setSelected(full);
            if (full.status === 'DRAFT' && full.recipient_source === 'SEGMENT') {
                setPreview(await api.previewCampaignRecipients(campaign.id));
            } else {
                setPreview({ count: full.progress?.total ?? full.recipient_count, sample: [] });
            }
        } finally {
            setPreviewLoading(false);
        }
    };
```

Add the reschedule state beside the other detail state:

```ts
    const [rescheduleValue, setRescheduleValue] = useState('');
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [cancelling, setCancelling] = useState(false);
```

- [ ] **Step 6: Add the cancel and reschedule handlers**

```ts
    const handleCancel = async () => {
        if (!selected) return;
        if (!confirm(m.schedule.cancelConfirm.replace('{name}', selected.name))) return;
        setCancelling(true);
        try {
            await api.cancelCrmCampaign(selected.id);
            toast.success(m.schedule.cancelled);
            setSelected(null);
            await loadCampaigns();
        } catch (err: any) {
            toast.error(err?.message ?? m.schedule.cancelFailed);
        } finally {
            setCancelling(false);
        }
    };

    const handleReschedule = async () => {
        if (!selected) return;
        setSavingSchedule(true);
        try {
            await api.updateCrmCampaign(selected.id, {
                scheduled_at: dhakaLocalToIso(rescheduleValue) ?? undefined,
            });
            toast.success(m.schedule.rescheduled);
            setSelected(null);
            await loadCampaigns();
        } catch (err: any) {
            toast.error(err?.message ?? m.schedule.rescheduleFailed);
        } finally {
            setSavingSchedule(false);
        }
    };
```

- [ ] **Step 7: Add the recipients table, progress and actions to the detail modal**

Insert before the detail modal's closing scroll `div`:

```tsx
                        {selected.progress && selected.progress.total > 0 && (
                            <p className="text-xs text-gray-500">
                                {m.recipients.progress
                                    .replace('{sent}', String(selected.progress.sent))
                                    .replace('{failed}', String(selected.progress.failed))
                                    .replace('{pending}', String(selected.progress.pending))}
                            </p>
                        )}

                        {selected.recipient_source === 'UPLOAD' && (
                            <div>
                                <p className="text-xs font-semibold text-gray-500 mb-2">{m.recipients.title}</p>
                                {selected.recipients && selected.recipients.length > 0 ? (
                                    <>
                                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="bg-gray-50">
                                                        <th className="px-3 py-2 text-left font-semibold text-gray-500">{m.recipients.columnRecipient}</th>
                                                        <th className="px-3 py-2 text-left font-semibold text-gray-500 hidden md:table-cell">{m.recipients.columnSubject}</th>
                                                        <th className="px-3 py-2 text-left font-semibold text-gray-500">{m.recipients.columnStatus}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selected.recipients.map((r) => (
                                                        <tr key={r.id} className="border-t border-gray-100">
                                                            <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate">
                                                                {r.name ?? r.email}
                                                                <span className="block text-gray-400">{r.email}</span>
                                                            </td>
                                                            <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate hidden md:table-cell">{r.subject}</td>
                                                            <td className="px-3 py-2">
                                                                <StatusBadge tone={recipientStatusTone[r.status] ?? 'neutral'}>{r.status}</StatusBadge>
                                                                {r.error && <span className="block text-danger mt-0.5">{r.error}</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {(selected.progress?.total ?? 0) > selected.recipients.length && (
                                            <p className="text-xs text-gray-400 mt-1.5">
                                                {m.recipients.showingFirst
                                                    .replace('{shown}', String(selected.recipients.length))
                                                    .replace('{total}', String(selected.progress?.total ?? 0))}
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-xs text-gray-400">{m.recipients.none}</p>
                                )}
                            </div>
                        )}

                        {selected.status === 'SCHEDULED' && (
                            <Field label={m.schedule.label}>
                                <div className="flex gap-2">
                                    <Input
                                        type="datetime-local"
                                        value={rescheduleValue}
                                        onChange={(e) => setRescheduleValue(e.target.value)}
                                    />
                                    <Button variant="secondary" onClick={handleReschedule} loading={savingSchedule}>
                                        {m.schedule.reschedule}
                                    </Button>
                                </div>
                            </Field>
                        )}
```

Add the status tone map beside `campaignStatusTone`:

```ts
const recipientStatusTone: Record<string, StatusBadgeTone> = {
    PENDING: 'neutral',
    SENDING: 'warning',
    SENT: 'success',
    FAILED: 'danger',
    CANCELLED: 'neutral',
};
```

And in the detail `ModalFooter`, before the Send button:

```tsx
                        {['SCHEDULED', 'SENDING'].includes(selected.status) && (
                            <Button variant="secondary" onClick={handleCancel} loading={cancelling}>
                                {m.schedule.cancel}
                            </Button>
                        )}
```

- [ ] **Step 8: Type-check, test and lint**

Run: `npx tsc --noEmit -p apps/frontend/tsconfig.json && npm test -w @erp71/frontend && npm run lint -w @erp71/frontend`
Expected: all three exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/lib/api.ts "apps/frontend/src/app/(app)/crm/campaigns/page.tsx"
git commit -m "feat(crm): create, schedule and cancel uploaded-list campaigns from the UI"
```

---

## Task 11: End-to-end check in the running app

**Files:** none changed unless a defect turns up.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Start the stack**

Run: `npm run dev` from the repo root. Wait for the backend on :3001 and the frontend on :3000.

- [ ] **Step 2: Prepare a test file**

Create `/tmp/campaign-test.csv`:

```text
Email,Name,Subject,Message
a@example.com,Ayesha,Your Eid order,Hello Ayesha, your order is ready.
b@example.com,,Your Eid order,Hello there.
not-an-email,Broken,Subject,Body
a@example.com,Dup,Second,Body
```

- [ ] **Step 3: Walk the flow**

In the app, go to CRM → Campaigns → **New Campaign**:

1. Name it "Upload smoke test", choose **Upload list**, upload the CSV.
2. Confirm the preview reads **2 recipients ready** and **2 rows skipped**, naming row 3 as not a valid email and row 4 as a duplicate.
3. Confirm row 2's contact name previews as `b`.
4. Set a schedule two minutes out and create the campaign.
5. Confirm it lists as `SCHEDULED`, and that opening it shows both recipients as `PENDING` and offers **Reschedule** and **Cancel campaign**.
6. Wait for the cron, or click **Send Now** on a second, unscheduled copy. Confirm the recipients turn `SENT` (or `FAILED` with a readable SMTP reason if no mail transport is configured locally) and the campaign reaches `COMPLETED`.
7. Confirm CRM → Contacts now holds contacts for both addresses, tagged as imported.
8. Re-upload the same file into a new campaign and confirm no duplicate contacts appear.
9. Create a plain segment SMS campaign and confirm it still sends as before.
10. At 360px width, confirm the create modal and the recipients table do not scroll the page sideways.

- [ ] **Step 4: Fix anything that fails**

Any defect is fixed with a test first, in the file that owns the behaviour, then committed on its own.

- [ ] **Step 5: Commit only if something changed**

```bash
git add -A && git commit -m "fix(crm): <what the smoke test caught>"
```

---

## Task 12: Documentation and TODO

**Files:**
- Modify: `TODO.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Update TODO.md**

Move any related open item to `## COMPLETED` and add:

```markdown
- [x] CRM: create an email campaign from a CSV/Excel upload with per-row subject and message, plus scheduled delivery, cancel and reschedule — done 2026-08-09
```

Add any follow-up work the build surfaced to the appropriate priority section — at minimum:

```markdown
- [ ] CRM campaigns: unsubscribe link and suppression list for uploaded email lists
- [ ] CRM campaigns: open/click tracking for email campaigns
```

- [ ] **Step 2: Run the full suite one last time**

Run: `npm test -w @erp71/shared-types && npm test -w @erp71/backend && npm test -w @erp71/frontend && npm run build -w @erp71/backend && npm run build -w @erp71/frontend`
Expected: all five exit 0.

- [ ] **Step 3: Commit and push**

```bash
git add TODO.md
git commit -m "docs: record CRM campaign list upload in TODO"
git push -u origin feat/crm-campaign-list-upload
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-09-crm-campaign-list-upload-design.md`:

- Data model → Task 2. Upload flow and row validation → Tasks 1, 9. Recipient resolution → Task 4. Sending and body rendering → Tasks 3, 5. Scheduling, cancel, reschedule → Tasks 6, 8, 10. API → Task 6. UI → Tasks 7, 9, 10. Testing → each task's own steps plus Task 11.
- The spec's "re-applied server-side" requirement is met by Task 6 calling the same `validateCampaignRows` the browser used in Task 9.
- Out-of-scope items (merge tags, per-recipient windows, attachments, tracking, unsubscribe) appear in no task; the last two are logged as follow-ups in Task 12.
