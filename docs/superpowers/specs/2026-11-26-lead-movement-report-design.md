# Lead movement report

**Date:** 2026-11-26
**Status:** Approved in chat 2026-11-26
**Asked as:** count how many leads landed in each status during a selected date range, so pipeline movement is readable. Lead funnel stays a cohort-by-arrival-month report.

---

## Intent

A sales manager picks a period and sees, for each pipeline stage, how many **distinct leads** moved as far as that stage in the period. That is the missing “flow” half of the CRM reports: Lead funnel answers “who arrived, where they stand now”; the dashboard funnel answers “who sits here now”; this report answers “who moved here in this window.”

## Goals

- A new CRM report, **Lead movement**, under CRM → Reports, next to Lead funnel.
- Period is when a lead’s **stage changed** (calendar days in the tenant timezone).
- Each lead in the window counts **once**.
- That once is the furthest stage toward Converted the lead landed on in the window, unless the lead’s **latest** landing in the window is Lost, in which case it counts as Lost.
- The reader picks which stages are visible. Hidden stages are skipped when ranking, so the visible stages are the funnel.
- Creating a lead counts as the first landing.
- Tenant custom stages participate, in board `sort_order`.

## Non-goals

- Changing Lead funnel, the dashboard funnel, or lost-leads.
- Reconstructing hops between open stages that happened before this log exists.
- Click-through from a count to the leads list (the list cannot yet filter “stage changed in this window”).
- Per-owner rows, source splits, or a time-of-day picker. Period presets stay the same calendar-day windows as the other CRM reports.
- Showing status changes on the lead’s activity timeline.
- Transition rules, stage probabilities, or forbidding backwards moves.

## Anti-goals

- Counting a lead in every stage it visited in the window (that inflates the funnel).
- Using `Lead.updated_at` as “stage changed” (any field edit would count).
- Letting a lost-then-reopened lead stay in Lost for the same window.

---

## Approaches

| Approach | What it is | Why it was dropped or kept |
|---|---|---|
| **A. `LeadStatusEvent` log + new report** | One row per real stage landing. The report reads events in the window. | **Picked.** Furthest-in-window and Lost-as-outcome both need every landing in the range, not only the current stage. Hiring already does this with `JobApplicationEvent`. |
| B. `status_changed_at` on `Lead` | Stamp the last change, group current status by that timestamp. | Cannot pick the furthest of several landings in one window. A later hop overwrites the earlier one. |
| C. Admin `RecordHistory` | Diff snapshots of lead updates. | Optional per entity, admin-only, JSON blobs, not a tenant report source. |

The page lives at `/crm/reports/lead-movement`. Rewriting Lead funnel was considered and rejected in chat.

---

## Counting rules

A **landing** is an event whose `created_at` falls in `[from, to]` (inclusive, tenant timezone, same `resolveDateWindow` as the other CRM reports).

For each lead that has at least one landing in the window:

1. If Lost is **visible** and the **latest** landing in the window has lifecycle `LOST`, the lead counts as Lost — even if it also landed on Qualified (or any open stage) earlier in the window.
2. Otherwise take the landings in the window whose stage is **visible**, ignore Lost, and pick the one with the highest `sort_order` (then name). That lead counts in that stage.
3. If after those steps there is no visible stage left, the lead is omitted.

Unchecking Lost therefore uses the same skip rule as any other stage: Qualified → Lost with Lost hidden counts as Qualified; Lost-only with Lost hidden is omitted. `totals.lost` only includes leads that counted on the Lost row.

**Visible stages.** Query `statusIds` is a list of `LeadStatusOption.id`. Omitted or empty means every **active** stage, in `sort_order`. Unchecking a stage both hides its row and removes it from ranking.

**Create** is a landing with `from_status_id` null.

**No-op.** Re-saving the same stage writes no event. `LeadStatusResolver.forUpdate` already returns undefined in that case.

**Mine.** When `mine=true`, only leads whose **current** `assigned_to` is the caller. Same rule as the scorecard: owner history is not stored.

**Examples** (all stages visible):

| Landings in the window | Counts as |
|---|---|
| New | New |
| New → Contacted → Qualified | Qualified |
| Qualified → Lost | Lost |
| Lost → Qualified (reopened) | Qualified |
| New → Converted | Converted |
| created as Negotiation (custom, lifecycle QUALIFIED) | Negotiation |

Contacted hidden, same leads:

| Landings in the window | Counts as |
|---|---|
| New → Contacted | New |
| Contacted only | omitted |
| Contacted → Qualified | Qualified |

---

## Data model

```prisma
model LeadStatusEvent {
  id              String      @id @default(uuid())
  tenant_id       String
  lead_id         String
  from_status_id  String?
  to_status_id    String?
  from_lifecycle  LeadStatus?
  to_lifecycle    LeadStatus
  created_by      String?
  created_at      DateTime    @default(now())

  tenant     Tenant            @relation(...)
  lead       Lead              @relation(..., onDelete: Cascade)
  fromStatus LeadStatusOption? @relation("LeadStatusEventFrom", fields: [from_status_id], references: [id], onDelete: SetNull)
  toStatus   LeadStatusOption? @relation("LeadStatusEventTo", fields: [to_status_id], references: [id], onDelete: SetNull)
  creator    User?             @relation(..., onDelete: SetNull)

  @@index([tenant_id, created_at])
  @@index([tenant_id, lead_id, created_at])
  @@index([tenant_id, to_status_id, created_at])
}
```

`to_lifecycle` is denormalised so ranking still works if a custom stage is later deleted (`SetNull` on the option FKs). Production applies schema with `prisma db push`; this table is additive.

**Writer.** One helper, used inside the same transaction as the lead write:

```ts
recordLeadStatusChange(tx, {
  tenantId, leadId,
  from: { id, lifecycle } | null,
  to:   { id, lifecycle },
  actorId, at?: Date,
})
```

Call it only when `to.id` differs from `from.id` (or from is null on create). Paths that must call it:

- `CrmLeadsService.create` / `update` / bulk status / convert-to-customer
- CSV import create, and import update when the stage actually changes
- Storefront enquiry creating a lead

The helper is the only `leadStatusEvent.create` in the codebase. Tests on the write paths assert an event was inserted; the report tests feed events directly.

**Deleting a custom stage.** Taxonomy already reassigns current leads onto a replacement, then hard-deletes the option. Events that point at the deleted stage are **in use**: the same `reassignTo` is required even when no live lead sits on it, and those event rows are updated to the replacement (`to_status_id` / `to_lifecycle`, and `from_*` when they point at the deleted id). That is a rewrite of history onto the surviving stage, not a new landing — do **not** insert a fresh event dated now, or a setup tidy-up would look like mass movement today. System stages stay hide-only, as they do now.

**Demo data.** `write-crm.ts` inserts leads already in a final stage and never goes through `CrmLeadsService`. It must also insert the matching events (create at `created_at`; a close event at `closed_at` when converted or lost) so a demo tenant’s report is not empty.

---

## History that already exists

Open-stage hops from before deploy cannot be rebuilt.

**Backfill (idempotent `sync:lead-status-events`, run from `db-prepare.sh` after `sync:lead-taxonomy`):**

- For every lead with `closed_at` and lifecycle CONVERTED or LOST and no event yet: insert one event at `closed_at`, `from_*` null, `to_*` the current stage. Past periods then show won/lost movement.
- Do not insert events for open leads. Their first real move after deploy is the first row the report can trust.

Re-running the sync is a no-op (skip a lead that already has any event).

---

## API

`GET /crm/reports/lead-movement`

Same guards as Lead funnel: `premiumCrm` + `VIEW_LEADS`. Same query as other CRM reports (`from`, `to`, `mine`) plus:

- `statusIds` — repeated or comma-separated option ids. Omit for all active stages.

Window clamped to 371 days (`clampWindow`), same as activity summary / scorecard.

Response:

```ts
type Stage = {
  id: string;
  code: string;
  name: string;
  lifecycle: string;
  is_system: boolean;
  is_active: boolean;
};

{
  filters: { from, to, mine, status_ids: string[] },
  /** Picker contents: every active stage, plus inactive ones that have a landing in this window. */
  available_stages: Stage[],
  /** Visible rows only, in sort_order, zero-filled. Inactive visible stages (explicitly selected) come after the active ones. */
  stages: Array<Stage & { count: number; share_pct: number | null }>,
  totals: {
    moved: number;       // distinct leads that counted in a visible stage
    converted: number;
    lost: number;
    conversion_pct: number | null; // converted / (converted + lost), null if none closed
  }
}
```

The picker is built from `available_stages`, not from `stages`. Default selection is the active subset. An inactive stage with landings in the window appears in the picker so those leads can be included; it is not a table row until selected.

---

## UI

`/crm/reports/lead-movement`, cloned from the Lead aging / Lead funnel report shell: `PageShell` + `PageHeader` + `DataTable` (`filterLayout="row"`, `viewOptions`, stats strip).

Filters:

- Period chip (`reportPeriodFilter`), default the same as other CRM reports.
- Stages multi-select of the tenant’s stages. Default: all active. Persisted in the URL (`statusIds`) so a saved view is shareable.
- `MineOnlyToggle`.

Columns: Stage, Leads, Share. Footer is totals.moved.

Stats: Moved, Converted, Lost, Conversion rate.

Empty: “No leads changed stage in this period.”

Copy in all nine locales. Nav node `crm.reports.lead-movement` (`premiumOnly`, `VIEW_LEADS`), layout order immediately after Lead funnel. Hub card next to Lead funnel. After deploy, tenants with a custom sidebar need `sync-nav-layout.ts --nodes=crm.reports.lead-movement`.

No new accent colours. Counts are integers; rates use `formatRate` / `percent()`.

---

## Left to the builder

- Exact Prisma relation names on `Tenant` / `Lead` / `User` / `LeadStatusOption`.
- SQL vs in-memory grouping for the per-lead “latest / furthest” fold; correctness of the counting rules matters more than the query shape.
- Whether `statusIds` is repeated query keys or one comma-separated value; match whatever nearby list filters already do.
- Icon for the nav node (ArrowRightLeft or GitBranch are both fine).
- Whether convert-to-customer that is already CONVERTED is a no-op (today’s convert path already no-ops; no extra event).

---

## Calls made in this document

These were not named in chat; they are the author’s so they can be checked while reading:

1. **Latest-is-Lost, then furthest** — but only when Lost is visible. Qualified → Lost counts as Lost. Lost → Qualified (reopened in the same window) counts as Qualified. Lost hidden: Qualified → Lost counts as Qualified; Lost-only is omitted.
2. **Skip hidden stages** when ranking (agreed in spirit; applied here, including Lost).
3. **Current owner** for `mine`, not owner-at-event-time.
4. **Backfill won/lost only.** Open-stage history starts at deploy.
5. **No click-through** in v1.
6. **Conversion %** is converted / (converted + lost) among counted leads, matching the dashboard’s closed-in-period rate, not converted / moved.
7. **Calendar days**, not a datetime picker.
8. **Import and storefront** write events. A bulk CSV that moves a stage is movement.
9. **Helper is the only insert.** Resolver stays a stage lookup.
10. **Deleting a custom stage rewrites event FKs** onto the replacement and does not insert a landing dated now. Events count as in-use for the reassign prompt.
11. **Demo CRM writes events** so the report has rows on a generated tenant.
12. **`available_stages` in the payload** feeds the picker; `stages` is only the visible table.
