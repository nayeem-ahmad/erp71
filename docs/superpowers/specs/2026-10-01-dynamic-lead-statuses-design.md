# Dynamic lead statuses (tenant-managed pipeline stages)

**Status:** design approved in chat 2026-10-01 (approach A, mobile included)

## Goal

A tenant manages its own lead status list from **CRM → Setup → Statuses**:
add in-progress stages ("Proposal Sent", "Negotiation"), rename, reorder and
hide them. The lead form, list, detail page, dashboard funnel and the mobile app
all show the tenant's list instead of the hardcoded five.

**Converted** and **Lost** stay built in. A tenant can rename them but not
delete them, and cannot create additional won or lost statuses.

## Non-goals

- Several won or lost statuses (e.g. "Lost – Price"). Lost reasons stay free text.
- Per-stage win probability, stage colours, automation or transition rules.
- Dropping the `Lead.status` enum column. It stays permanently (see below).
- Changes to the AI chat summaries, which keep reading the lifecycle column.

## Core idea: stage vs lifecycle

Today `Lead.status` carries two meanings: the label shown to users, and the
lifecycle the code branches on (open / won / lost). This design splits them:

| Concept | Column | Who reads it |
|---|---|---|
| **Stage**: what the tenant sees and picks | `Lead.status_id` → `LeadStatusOption` | display, picker, filters, funnel, per-stage counts, sort |
| **Lifecycle**: what the code branches on | `Lead.status` (existing `LeadStatus` enum, unchanged) | `closed_at`, lost reason, scoring, conversion, won/lost KPIs, bulk guard, CSV import rules, old mobile builds, AI chat |

The two are always written together. Every option row has a fixed
`lifecycle` value, and writing a stage writes its lifecycle into `Lead.status`:

| Option | `lifecycle` |
|---|---|
| seeded NEW / CONTACTED / QUALIFIED / LOST / CONVERTED | its own code |
| any tenant-created stage | `QUALIFIED` (the open-pipeline bucket) |

Because the lifecycle column keeps exactly its current values, roughly 30
existing call sites that branch on `LeadStatus.CONVERTED` / `LOST` / the open
set need **no change**. Old mobile builds keep parsing `status` and show a
custom stage as "Qualified": wrong label, but no crash or data loss.

## Data model

```prisma
/// Tenant-editable lead pipeline stages. `Lead.status` (the LeadStatus enum)
/// remains the lifecycle column; this table is the label the tenant sees.
model LeadStatusOption {
  id         String     @id @default(uuid())
  tenant_id  String
  code       String     // immutable; seeded rows use the LeadStatus codes
  name       String
  lifecycle  LeadStatus // written into Lead.status whenever a lead takes this stage
  sort_order Int        @default(0)
  is_system  Boolean    @default(false)
  is_active  Boolean    @default(true)
  created_at DateTime   @default(now())
  updated_at DateTime   @updatedAt

  tenant Tenant @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  leads  Lead[]

  @@unique([tenant_id, code])
  @@unique([tenant_id, name])
  @@index([tenant_id, is_active, sort_order])
}

model Lead {
  // … existing fields; `status LeadStatus @default(NEW)` unchanged
  status_id    String?
  statusOption LeadStatusOption? @relation(fields: [status_id], references: [id], onDelete: Restrict)
  @@index([tenant_id, status_id])
}
```

**Migration safety.** Production reconciles with `prisma db push
--accept-data-loss`, so the change must be additive only. Verify with
`prisma migrate diff` that the change produces only CREATE TABLE, CREATE INDEX,
ADD FOREIGN KEY and ADD COLUMN statements, with **zero** DROP or ALTER COLUMN
(the same gate as `docs/crm/lead-taxonomy-rollout.md` phase 1). Add a
documentation migration under `packages/database/prisma/migrations/`.

`status_id` is nullable so the column can be added on a populated table; the
boot sync fills it. No contract phase is planned: `Lead.status` is not legacy.

## Seeding and backfill

- `lead-taxonomy.seed.ts` **and** `lead-taxonomy.seed.js` (hand-maintained
  mirror; `lead-taxonomy-catalogue.spec.ts` checks parity) gain
  `DEFAULT_LEAD_STATUSES`: the five codes with English names, `lifecycle` equal
  to code and sort orders 1–5 (New, Contacted, Qualified, Converted, Lost).
  `seedDefaultLeadTaxonomy` creates them with `skipDuplicates`.
- `sync-lead-taxonomy.ts` (already in the container start chain) gains a
  statuses step per tenant:
  1. seed defaults (idempotent);
  2. **backfill**: set `status_id` to the seeded row whose `code = Lead.status`
     wherever `status_id IS NULL`;
  3. **drift repair**: wherever `status_id`'s option has
     `lifecycle <> Lead.status`, reset `status_id` to the seeded row for
     `Lead.status`. This catches any write path that changed the lifecycle
     without the stage (raw SQL, a path missed in this change, or a rollback
     followed by roll-forward);
  4. report counts in the existing delta output and respect `--dry-run`.

  Like the existing steps, it warns rather than exits non-zero.

## Rules for the option list

Statuses join the existing CRM list machinery as a fifth kind:
`LeadTaxonomyKind.STATUS = 'statuses'` on `/crm/lead-taxonomy/:kind`. The
endpoints, permissions (read: `CRM_STAFF`; write: `MANAGE_CRM_SETTINGS`), name
uniqueness and code allocation are all reused.

| Row | Rename | Reorder | Deactivate (hide) | Delete |
|---|---|---|---|---|
| NEW | yes | yes | **no**: it is the default for new leads | **no** |
| CONTACTED, QUALIFIED | yes | yes | yes | becomes deactivate (system row) |
| CONVERTED, LOST | yes | yes | **no**: needed to close leads | **no** |
| custom | yes | yes | yes | yes; must move leads to another stage if in use |

- `create` ignores any client-sent lifecycle and always uses `QUALIFIED`.
- Reassigning on delete: the target must be an **active** stage with an **open**
  lifecycle (NEW, CONTACTED, QUALIFIED). `updateMany` sets both `status_id` and
  `status = target.lifecycle`. An open-to-open move does not touch `closed_at`
  or the score (scoring only distinguishes CONVERTED/LOST from open).
- `usage` counts `Lead.status_id`.

## Writing a lead's status

A single helper (`LeadStatusResolver`, in the taxonomy module) owns the
mapping. Lead write paths call it; none of them builds `status_id` by hand.

**API input.** `CreateLeadDto` / `UpdateLeadDto` gain `status_id?: string`
(new clients). The existing `status?: LeadStatus` stays, so old mobile builds
keep working. Resolution:

1. `status_id` present → load the tenant's option. It must belong to the tenant
   and be active, unless it is the lead's current stage. Lifecycle comes from the
   row. If both fields are sent and disagree, `status_id` wins.
2. otherwise `status` present:
   - **update** where `status` equals the lead's current lifecycle → no-op for
     the stage. This protects a lead on "Negotiation" from an old mobile build
     that shows it as "Qualified" and re-sends `QUALIFIED`;
   - otherwise → the seeded row whose code equals `status`.
3. neither present → create: the NEW row; update: unchanged.

The existing transition logic (`applyStatusTransition`, `closed_at`, lost
reason, closing out planned activities, the converted-is-read-only guard,
scoring) then runs on the resolved **lifecycle** exactly as it does today. Only
a lifecycle change counts as a "transition", so moving Contacted → Negotiation
does not touch `closed_at`.

**Every write path is updated to write both columns:**

- `crm-leads.service`: `create`, `update`, `bulkAction` (bulk set-status takes
  `status_id`; rejected when the target's lifecycle is LOST or CONVERTED,
  matching today's guard), `importRows` (CSV `status` cell resolves by id, code,
  then name via the existing `buildTaxonomyIndex`; LOST is still rejected),
  `convert`.
- `crm-lead-conversations` log-conversation `leadStatus` (accept
  `leadStatusId` beside it, using the same resolution).
- `storefront-enquiries` (new lead → NEW row).
- `demo-data/generator/write-crm.ts`.
- Any other `lead.create` / `lead.update(Many)` that sets `status`. Implementation
  starts with a grep for these; the boot sync's drift repair is the backstop.

`leadIncludes` gains `statusOption: { select: { id, code, name, lifecycle, is_system } }`.
The response keeps `status` (the lifecycle).

## Reading

- **List filter.** `GET /crm/leads` keeps `status` (the `open` sentinel or a
  lifecycle code, as old mobile sends it) and gains `statusId` (one stage).
  Web uses `open` or `statusId`.
- **Sort.** The `status` sort key orders by `statusOption.sort_order`.
- **Status summary** (`getStatusSummary`) and **dashboard pipeline**
  (`crm-dashboard.service`): keep `counts` keyed by lifecycle code and `open`
  (old mobile reads them; custom stages count under QUALIFIED, consistent with
  the lifecycle column), and add
  `stages: { id, code, name, lifecycle, is_system, count }[]`: active stages in
  sort order, plus any inactive stage that still holds leads. Won/lost-in-period,
  conversion rate and days-to-convert stay on the lifecycle column.

## Web UI

- **CRM → Setup → Statuses tab.** A new `statuses` tab in
  `app/(app)/crm/setup/page.tsx`, rendered by the existing `CrmListPanel` with
  `kind="statuses"`. Additions to the panel for this kind: a lifecycle badge
  (Open / Won / Lost), and the deactivate/delete controls hidden for NEW, CONVERTED
  and LOST. The reassign-on-delete picker only offers active open stages.
  Description copy explains that Converted and Lost close a lead.
- **Labels.** A helper `leadStatusLabel(option, m)` returns the translated
  `m.statuses[code]` when the row is a system row whose name is still the seeded
  English default, and the stored name otherwise. Today's translated labels
  therefore survive for tenants who don't rename anything, while renamed and
  custom stages show verbatim. If `statusOption` is null (not yet backfilled),
  it falls back to `m.statuses[lead.status]`.
- **Tone.** Derived from lifecycle: NEW = primary, other open = neutral,
  CONVERTED = success, LOST = danger (the current mapping).
- **Lead form** (`lead-form-fields.tsx`). Status select lists active stages
  plus the lead's current stage if it is inactive, and sends `status_id`. The
  lost-reason field and validation key off the selected option's lifecycle
  instead of the literal `'LOST'`. `LEAD_STATUSES` is removed or kept only as the
  lifecycle constant.
- **Leads list** (`crm/leads/page.tsx`). The status filter shows "Open pipeline"
  plus the stage list (sent as `statusId`); the stale `?status=CONTACTED`
  bookmark form keeps working through the lifecycle param. Status chips and the
  bulk set-status menu (currently hardcoded `NEW/CONTACTED/QUALIFIED`) use active
  open stages.
- **Lead detail** (`crm/leads/[id]/page.tsx`). Badge shows the stage label;
  `isConverted` / lost-reason checks stay on `lead.status`.
- **Dashboard funnel** (`CrmDashboard.tsx` / `PipelineFunnel`). Bars come from
  `pipeline.stages`: open stages in sort order, then Converted ('won'). This
  replaces the hardcoded stage list.
- `useLeadTaxonomy('statuses')` serves the list. `api.ts` `CrmListKind` gains
  `'statuses'`.
- i18n: new keys (tab label, description, lifecycle badges, "cannot hide/delete"
  hints) in all nine locale catalogs (`messages/catalog.test.ts` enforces parity).

## Mobile (Flutter)

- `Lead` parses `statusOption` into a `stage` (id, name, code, lifecycle). The
  existing `LeadStatus` enum stays as the **lifecycle** (`isOpen`, lost checks,
  tone). Display uses `stage.name`, falling back to `status.label`.
- `CrmRepository` fetches `/crm/lead-taxonomy/statuses`. `setLeadStatus` takes
  a stage and sends `status_id`, plus `lost_reason` when its lifecycle is LOST.
- Leads screen filter chips: "Open" plus the active stage list, sent as
  `statusId`.
- Home funnel uses `pipeline.stages` when present, falling back to `counts`
  (so a new app against an old server still works).
- Update the enum's doc comment ("a fixed enum on the server, not a configurable
  stage"), which becomes false.
- Ships through the existing mobile workflow; old installs keep working as
  described above.

## Error handling

- Unknown or foreign `status_id` → 400 "Lead status not found." Deactivated
  (and not the lead's current stage) → 400 "… is deactivated."
- Hiding or deleting NEW, CONVERTED or LOST → 400 with a reason.
- Deleting an in-use custom stage without `reassignTo` → 409 with
  `requiresReassign` (existing flow). A non-open or inactive target → 400.
- Boot sync residuals → warning, never a failed boot.

## Testing

- **Backend unit:** taxonomy service status rules (protected rows, lifecycle
  forced on create, reassign target validation, reassign writes both columns);
  status resolver (id vs code, old-client no-op rule, inactive current stage
  allowed); leads service create/update/bulk/import/convert write both columns
  and keep transition semantics (Contacted → custom leaves `closed_at` alone,
  custom → Lost requires a reason and stamps `closed_at`); `statusId` filter;
  dashboard `stages` output; catalogue parity spec covers `DEFAULT_LEAD_STATUSES`.
- **Sync script:** export the statuses step's pure decision logic (which stage
  a lead should be on, given its lifecycle and current option) from
  `sync-lead-taxonomy.ts` and test it from a backend spec the way
  `crm-activities/backfill.spec.ts` tests `sync-crm-activities.ts`. Exercise
  the SQL by running the script with `--dry-run` against the local DB.
- **Migration gate:** `prisma migrate diff` output checked to be
  destruction-free.
- **Frontend:** setup panel for statuses (protected controls hidden, reassign
  options), lead form sends `status_id` and shows lost reason for a LOST-lifecycle
  stage, list filter, funnel from `stages`, label helper (translated vs
  verbatim), locale parity.
- **Mobile:** model parsing with and without `statusOption`, overview parsing
  with and without `stages`.

## Rollout and rollback

- One release: additive schema plus boot sync. The app works the moment the sync
  has run, and degrades (labels from the lifecycle) for any lead not yet
  backfilled.
- Rollback to the previous image: its `db push` drops `LeadStatusOption` and
  `status_id`. Leads keep `Lead.status`, so they show as Qualified and nothing
  else is lost. Custom stage definitions are lost and would need recreating
  after rolling forward.
- Update `docs/crm/lead-taxonomy-rollout.md` with a short "Statuses" section
  explaining that statuses deliberately do **not** follow the contract phase.
