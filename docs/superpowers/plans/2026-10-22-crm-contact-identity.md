# CRM contact identity — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let many leads share one email by pointing each lead at a person (`CrmContact`) and, when they have one, a company (`Organization`), without changing any existing row's current fields.

**Architecture:** New nullable foreign keys and one new table. Pure planners decide every backfill write; the sync scripts only apply those writes. Identity stays on the contact (mobile and LinkedIn). The lead keeps its snapshot columns and loses its unique indexes. Production backfill runs in `db-prepare.sh` after `db push`.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Next.js 15, Jest. Normalization from `packages/shared-types/lead-identity.ts`.

**Spec:** `docs/superpowers/specs/2026-10-22-crm-contact-identity-design.md`

## Global Constraints

- The backfill may insert `Organization` and `CrmContact` rows and may set only these columns, and only when they are null: `CrmContact.organization_id`, `CrmContact.customer_id`, `CrmContact.mobile_norm`, `CrmContact.email_norm`, `CrmContact.linkedin_norm`, `Lead.contact_id`, `Lead.organization_id`, `Lead.mobile_norm`, `Lead.email_norm`, `Lead.linkedin_norm`.
- No `DELETE`. No update of `Lead.name`, `Lead.mobile`, `Lead.email`, `Lead.linkedin_url`, `Lead.status`, or any other existing lead column. No update of `CrmContact.name`, `CrmContact.company`, `CrmContact.mobile`, `CrmContact.email`, or `CrmContact.notes`. No update of any `Customer` column.
- Never match or group by email. "Karim Traders" and " karim traders " are one organization (`name_norm` = trim, lowercase, internal whitespace collapsed). "Karim Traders Ltd" is another. Display `name` is the oldest contact's trimmed `company`, original casing kept.
- `@@unique([tenant_id, mobile])` on `CrmContact` stays. New foreign keys use `onDelete: SetNull`.
- Production applies schema with `prisma db push` in `apps/backend/scripts/db-prepare.sh` while the old backend is still serving. The migration file is DDL only (no `UPDATE`, no `DELETE`). The sync that writes a shared `email_norm` runs after the step `prisma db push`.
- New UI strings go into all nine locales (`en`, `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur`). UI rules in `CLAUDE.md` apply. No new nav entry and no new permission.
- Commit each task on `dev`. Do not commit unrelated dirty files.

## Review Focus

1. **A contact whose mobile is `01712-345678` and another whose mobile is `+8801712345678`** both remain; only the older receives `mobile_norm`; a lead with that number links to the older one and does not insert a third contact.
2. **Two leads that share `info@shop.com` and nothing else** become two contacts. Their emails on the lead rows stay as stored.
3. **A lead whose mobile matches a contact with a different name** gets `contact_id` set; neither `name` changes; the mismatch is counted, not applied.
4. **Two converted leads on one contact pointing at two customers** leave `CrmContact.customer_id` null. The `Customer` rows are untouched.
5. **Running the sync twice** inserts nothing and updates nothing.
6. **`db push` before the lead-norm fill** has already dropped `Lead_tenant_id_email_norm_key` (and the mobile and LinkedIn uniques), so filling a second shared norm cannot throw and abort boot.

---

### Task 1: Pure planners

**Files:**
- Create: `packages/database/prisma/crm-identity-plan.ts`
- Test: `apps/backend/src/crm-leads/crm-identity-plan.spec.ts`

**Interfaces:**
- Consumes: `normalizeLeadMobile`, `normalizeLeadEmail`, `normalizeProfileUrl` from `@erp71/shared-types`.
- Produces:
  - `planContactNorms(rows, claimed: Set<string>) -> { updates: { id: string; data: Partial<{ mobile_norm: string; email_norm: string; linkedin_norm: string }> }[]; collisions: number }`
  - `planOrganizations(contacts, existing: { id: string; tenant_id: string; name_norm: string }[]) -> { inserts: { tenant_id: string; name: string; name_norm: string }[]; links: { contactId: string; name_norm: string }[] }`
  - `planLeadLinks(leads, contacts) -> { contactInserts: { key: string; fromLeadId: string; tenant_id: string; name: string; mobile: string | null; email: string | null; linkedin_url: string | null; address: string | null; mobile_norm: string | null; email_norm: string | null; linkedin_norm: string | null }[]; leadLinks: { leadId: string; contactId?: string; contactKey?: string; organizationId: string | null }[]; customerLinks: { contactId: string; customerId: string }[]; nameMismatches: { leadId: string; contactId: string }[] }`
  - `organizationNameNorm(raw: string): string`

Lead and contact row fields are the columns named in the spec's link rules, plus `id`, `tenant_id`, `created_at`, and the nullable ids the planner must skip when set. `leadLinks` are emitted only for leads whose `contact_id` is null. `organizationId` is null when the lead already has `organization_id` or the contact has none. `customerLinks` are emitted only when the contact's `customer_id` is null and every linked lead with a non-null `converted_customer_id` names the same one.

- [ ] **Step 1: Write the failing tests**

Require the module the way `lead-identity-backfill.spec.ts` requires `sync-lead-identity.ts`. Assert:

- `planContactNorms` on `01712-345678` then `+8801712345678` (same tenant, oldest first) sets `mobile_norm` on the first only, sets `email_norm` on both when both have an email, and returns `collisions: 1`. The update `data` keys are a subset of `mobile_norm` | `email_norm` | `linkedin_norm`.
- `planOrganizations` on company `"Karim Traders"` and `" karim traders "` with no existing org returns one insert (`name: "Karim Traders"`, `name_norm: "karim traders"`) and two links. A contact that already has `organization_id` produces no link. A blank company produces nothing. No link object has a `company` key.
- `planLeadLinks` on two leads with the same mobile and different emails returns one `contactInserts` entry (name and email copied from the older lead) and two `leadLinks`. Two leads that share only `info@shop.com` return two inserts. A lead whose mobile is `01712-345678` matches an existing contact whose raw mobile is `+8801712345678` and whose `mobile_norm` is null: one `leadLinks` entry with that `contactId`, no insert. When that contact's name differs, the result also has one `nameMismatches` entry and no contact field changes. A lead with `contact_id` set returns nothing for that lead. Two converted leads with two `converted_customer_id` values return no `customerLinks`. Two with the same id return one.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest --testPathPatterns=crm-identity-plan.spec --workspace apps/backend`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the three planners**

Match rules are the spec's link rules and the Global Constraints. A planned insert is visible to later leads in the same run, keyed by normalized mobile and then LinkedIn, so the second lead does not insert another contact. Do not import Prisma.

- [ ] **Step 4: Re-run the test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/crm-identity-plan.ts apps/backend/src/crm-leads/crm-identity-plan.spec.ts
git commit -m "test: plan CRM contact links without rewriting rows"
```

---

### Task 2: Schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`model Tenant` back-relation, `model Customer` back-relation, `model Lead` around the unique indexes, `model CrmContact`)
- Create: `packages/database/prisma/migrations/<timestamp>_crm_contact_identity/migration.sql` (DDL only)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Organization`; `CrmContact.organization_id`, `customer_id`, `mobile_norm`, `email_norm`, `linkedin_norm`; `Lead.contact_id`, `organization_id`. Lead's three `@@unique` identity lines become `@@index`. Contact gains `@@unique([tenant_id, mobile_norm])`, `@@unique([tenant_id, linkedin_norm])`, `@@index([tenant_id, email_norm])`. Organization has `@@unique([tenant_id, name_norm])`.

- [ ] **Step 1: Add the models and columns**

`Organization`: `id`, `tenant_id`, `name`, `name_norm`, optional `email`, `phone`, `address`, `website_url`, timestamps. Relations to tenant, contacts, and leads.

All new foreign keys nullable, `onDelete: SetNull`. Add the back-relations on `Tenant`, `Customer`, `CrmContact.leads`, and `Organization`. Keep `CrmContact.company` and `@@unique([tenant_id, mobile])`. Replace the three `Lead` identity `@@unique` lines with `@@index` on the same columns. Keep every other lead index.

- [ ] **Step 2: Generate the migration and read it**

Run from `packages/database`: `npx prisma migrate dev --name crm_contact_identity --create-only`

The SQL may `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`, `CREATE UNIQUE INDEX`, and `DROP INDEX` the three lead identity uniques. It must not contain `UPDATE` or `DELETE`. If Prisma emits data SQL, delete those statements.

- [ ] **Step 3: Generate the client**

Run: `npx prisma generate --schema packages/database/prisma/schema.prisma`
Expected: generation succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): add organization and nullable lead contact links"
```

---

### Task 3: Fill shared lead norms

**Files:**
- Modify: `packages/database/prisma/sync-lead-identity.ts`
- Modify: `apps/backend/src/crm-leads/lead-identity-backfill.spec.ts`
- Modify: the header comment in `apps/backend/scripts/db-prepare.sh` on the `sync:lead-identity` step (the step stays after `prisma db push`)

**Interfaces:**
- Consumes: `leadIdentityOf`.
- Produces: `planBackfill` fills every null norm from the raw column, including when another lead already holds that value. Updates still contain only norm keys. A lead whose norms are already set is absent from `updates`.

- [ ] **Step 1: Change the existing tests**

Replace the expectation that a second lead sharing an email or mobile is left null. Assert both leads receive the norm, and that a lead which already has `email_norm` is not updated. Keep the assertion that display columns are never in `data`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest --testPathPatterns=lead-identity-backfill.spec --workspace apps/backend`
Expected: FAIL on the shared-email case.

- [ ] **Step 3: Stop skipping shared lead norms**

Rewrite the header comment: the unique indexes are gone, so leaving a shared norm null would hide an email the user can already see. Do not write `email`, `mobile`, or `linkedin_url`.

- [ ] **Step 4: Re-run the test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/sync-lead-identity.ts apps/backend/src/crm-leads/lead-identity-backfill.spec.ts apps/backend/scripts/db-prepare.sh
git commit -m "fix: fill lead identity norms when several leads share one"
```

---

### Task 4: Backfill syncs

**Files:**
- Create: `packages/database/prisma/sync-contact-identity.ts`
- Create: `packages/database/prisma/sync-crm-organizations.ts`
- Create: `packages/database/prisma/sync-lead-contacts.ts`
- Modify: `packages/database/package.json` (three `sync:` scripts)
- Modify: `apps/backend/scripts/db-prepare.sh` (three steps immediately after `sync:lead-identity`)

**Interfaces:**
- Consumes: `planContactNorms`, `planOrganizations`, `planLeadLinks`.
- Produces: `npm run sync:contact-identity`, `sync:crm-organizations`, `sync:lead-contacts` in `@erp71/database`. Each accepts `--dry-run` and `--tenant=<uuid>`, logs counts, and exits non-zero on a thrown error. Order in `db-prepare.sh`: `sync:lead-identity`, `sync:contact-identity`, `sync:crm-organizations`, `sync:lead-contacts`.

- [ ] **Step 1: Write the drivers**

Each driver loads rows oldest-`created_at`-then-`id` first, calls its planner, and applies only the planner output. `sync:lead-contacts` writes norms on the inserted contact in the same insert. It writes a lead update as `{ contact_id, organization_id }` and omits `organization_id` when the planner passed null because the lead already had one. It writes a contact update as `{ customer_id }` only. `--dry-run` prints the counts and writes nothing.

- [ ] **Step 2: Register the steps**

`package.json` scripts call `tsx prisma/sync-*.ts`. In `db-prepare.sh`, a comment on each step states that it inserts or fills null columns only, and that `sync:lead-contacts` must stay after the other two because it reads `mobile_norm` and `organization_id`.

- [ ] **Step 3: Dry-run against the dev database**

Run each script with `--dry-run`. Expected: the log prints scanned and planned counts and a second dry-run prints the same plan. No row changes (`updated_at` on a sampled lead is unchanged). If no dev database is reachable, say so and skip this step rather than pointing the script at production.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/sync-contact-identity.ts packages/database/prisma/sync-crm-organizations.ts packages/database/prisma/sync-lead-contacts.ts packages/database/package.json apps/backend/scripts/db-prepare.sh
git commit -m "feat(db): backfill organizations and lead contact links"
```

---

### Task 5: Lead writes link a contact and allow a shared email

**Files:**
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts` (`assertIdentityFree`, `create`, `update`, import `dedupeKeys` / `findDuplicate`)
- Modify: `apps/backend/src/crm-leads/crm-leads.service.spec.ts`
- Modify: `packages/shared-types/lead-identity.ts` only if email must leave `identityDedupeKeys`; prefer a lead-import wrapper that drops `email_norm` keys instead of changing the helper for contacts.

**Interfaces:**
- Consumes: `Organization` and the new lead columns from Task 2. `normalizeLeadMobile` / `normalizeProfileUrl`.
- Produces: `CrmLeadsService` create and update set `contact_id`. They do not call `crmContact.update` when a contact already has that mobile or LinkedIn. Import dedupe keys are mobile and LinkedIn only.

- [ ] **Step 1: Write the failing service tests**

- Creating a lead with an email already stored on another lead succeeds, and both rows keep that email.
- Creating a lead whose mobile matches a contact sets `contact_id` to that contact and does not call `crmContact.update`.
- Creating a lead whose mobile matches nothing calls `crmContact.create` once and stores the new id.
- Import of a second row with the same email and a different mobile is not in `duplicates`. Import of a second row with the same mobile still is.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest --testPathPatterns=crm-leads.service.spec --workspace apps/backend`
Expected: FAIL on the shared-email create (today it throws "A lead with this email already exists.").

- [ ] **Step 3: Implement attach-or-create**

Remove email, mobile, and LinkedIn from the lead duplicate rejection. On create and on an update that changes mobile or LinkedIn, resolve the contact inside the same transaction as the lead write: match `mobile_norm` or raw mobile normalized, then LinkedIn, oldest first; otherwise create the contact from the lead snapshot, including norms. Copy `organization_id` from the contact when the lead's is null. Do not copy the lead's name or email onto an existing contact. Leave import skip/upsert matching leads by mobile and LinkedIn, and stop matching them by email.

- [ ] **Step 4: Re-run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-leads/crm-leads.service.ts apps/backend/src/crm-leads/crm-leads.service.spec.ts
git commit -m "feat(crm): link leads to contacts and allow a shared email"
```

---

### Task 6: Contact writes keep the company string and find the organization

**Files:**
- Modify: `apps/backend/src/crm-contacts/crm-contacts.service.ts`
- Modify: `apps/backend/src/crm-contacts/crm-contacts.service.spec.ts`

**Interfaces:**
- Consumes: `organizationNameNorm`, `Organization`, contact norm columns.
- Produces: create and update write `company` as they do now, plus `organization_id` and the three norms. A repeated email does not throw. A repeated normalized mobile throws the existing mobile conflict.

- [ ] **Step 1: Write the failing tests**

- Two creates with the same email and different mobiles both succeed, and both store `email_norm`.
- A create with `company: " Karim Traders "` writes `company: "Karim Traders"` (current trim behavior) and sets `organization_id` to the org whose `name_norm` is `karim traders`, creating that org when absent.
- An update that sets `company` to `""` writes `company: null` and `organization_id: null`, and does not delete the organization.
- A create whose mobile normalizes to an existing contact's `mobile_norm` throws the mobile conflict.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest --testPathPatterns=crm-contacts.service.spec --workspace apps/backend`
Expected: FAIL on `organization_id`.

- [ ] **Step 3: Implement find-or-create and the norm columns**

Look up `Organization` by `tenant_id` + `name_norm` before insert. On a unique conflict, re-read and use that row. Write norms with `leadIdentityOf`. Keep the raw-mobile check. Compare the incoming mobile with `normalizeLeadMobile` against both `mobile_norm` and the raw mobile, and the same for LinkedIn.

- [ ] **Step 4: Re-run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-contacts/crm-contacts.service.ts apps/backend/src/crm-contacts/crm-contacts.service.spec.ts
git commit -m "feat(crm): attach contacts to an organization without dropping company"
```

---

### Task 7: Storefront, campaigns, and convert

**Files:**
- Modify: `apps/backend/src/storefront-enquiries/storefront-enquiries.service.ts`
- Modify: `apps/backend/src/storefront-enquiries/storefront-enquiries.service.spec.ts`
- Modify: `apps/backend/src/crm-campaigns/campaign-recipients.service.ts` (`resolveParties`)
- Modify: `apps/backend/src/crm-campaigns/campaign-recipients.service.spec.ts`
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts` (`convert`)

**Interfaces:**
- Consumes: `contact_id` on leads, `email_norm` on contacts.
- Produces: storefront logs onto the matched contact's newest open lead or creates a lead with `contact_id` set. `resolveParties` sets `lead_id` or `contact_id` only when exactly one row in that table has the address. `convert` sets `CrmContact.customer_id` when it is null.

- [ ] **Step 1: Write the failing tests**

- An enquiry whose mobile matches a contact with an open lead creates a conversation on that lead and does not create a lead. The lead's status is not written.
- An enquiry whose email matches two contacts creates a new lead and a new contact.
- `resolveParties` with two leads sharing an email returns `lead_id: null` for that address.
- `convert` on a lead with `contact_id` and a null `customer_id` updates the contact with `{ customer_id }` and does not include the customer's name or phone in that update.

- [ ] **Step 2: Run those four tests and confirm they fail**

- [ ] **Step 3: Implement the three behaviors**

Open lead means `status` is not `CONVERTED` or `LOST`. Newest is `updated_at` descending, then `id`. Do not update the existing lead. Do not update existing `CrmCampaignRecipient` rows.

- [ ] **Step 4: Re-run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/storefront-enquiries apps/backend/src/crm-campaigns/campaign-recipients.service.ts apps/backend/src/crm-campaigns/campaign-recipients.service.spec.ts apps/backend/src/crm-leads/crm-leads.service.ts apps/backend/src/crm-leads/crm-leads.service.spec.ts
git commit -m "feat(crm): resolve shared emails without picking a lead at random"
```

---

### Task 8: Show the link

**Files:**
- Modify: `apps/frontend/src/app/(app)/crm/contacts/contact-form-fields.tsx` (read-only organization name when the saved contact has one)
- Modify: the lead detail surface that already renders the lead snapshot (`apps/frontend/src/components/crm/LeadWorkspace.tsx` or `apps/frontend/src/app/(app)/crm/leads/[id]/page.tsx` — whichever already shows mobile and email)
- Modify: the nine locale files under `apps/frontend/src/lib/localization/messages/`
- Test: the existing contact-form and lead-detail tests next to those files

**Interfaces:**
- Consumes: `organization: { id, name } | null` and `contact: { id, name } | null` added to the lead and contact API selects. The contact form still posts `company` as a string. It does not post `organization_id`.
- Produces: no new route. The lead page links the contact name to `/crm/contacts/:id`.

- [ ] **Step 1: Write the failing UI tests**

A saved contact with `organization.name` of `Karim Traders` shows that name and still submits `company`. A lead with a `contact` shows the contact name as a link. A lead with `contact: null` shows the snapshot and no link.

- [ ] **Step 2: Run the tests and confirm they fail**

- [ ] **Step 3: Include the relations in the backend selects and render them**

Add the strings to all nine locales. Follow `PageShell` / existing CRM typography. Do not add a page.

- [ ] **Step 4: Re-run the frontend tests and lint the touched files**

Run the Jest files from `apps/frontend`. Run `npx next lint --quiet --file <each touched file>` from `apps/frontend`.

- [ ] **Step 5: Verify in the browser**

Open a contact, save a company, and confirm the organization line appears and the company field still holds the typed text. Open a lead that shares that contact's mobile and confirm the contact link and the lead's own email are both still there. Open a second lead with the same email and a different mobile and confirm both exist.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/(app)/crm/contacts apps/frontend/src/components/crm apps/frontend/src/app/(app)/crm/leads apps/frontend/src/lib/localization/messages apps/backend/src/crm-leads apps/backend/src/crm-contacts
git commit -m "feat(crm): show the contact and organization on the lead"
```

Update `TODO.md`: check nothing off; add a ROADMAP note only if a follow-up was discovered. The backfill itself is this plan, not a leftover.
