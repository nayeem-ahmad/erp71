# Dynamic Lead Statuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenants manage their own lead pipeline stages from CRM → Setup → Statuses; every surface (web, dashboard, mobile) reads that list.

**Architecture:** New `LeadStatusOption` table + `Lead.status_id` (the *stage*). The existing `Lead.status` enum stays as the *lifecycle* and is always written from the option's fixed `lifecycle` column. All open/won/lost logic keeps reading `Lead.status`. Statuses join the existing `/crm/lead-taxonomy/:kind` machinery as a fifth kind.

**Tech Stack:** Prisma 5 / Postgres, NestJS, Next.js 15 + Jest/RTL, Flutter.

**Spec:** `docs/superpowers/specs/2026-10-01-dynamic-lead-statuses-design.md`

## Global Constraints

- Schema change must be additive only: `prisma migrate diff` emits zero `DROP` / `ALTER COLUMN`.
- `packages/database/index.js` and `prisma/lead-taxonomy.seed.js` are hand-maintained CJS mirrors — every export added to the `.ts` goes into the `.js` too.
- Seeded codes are immutable: `NEW, CONTACTED, QUALIFIED, CONVERTED, LOST`. Custom stages always get `lifecycle = QUALIFIED`.
- Protected: NEW, CONVERTED, LOST cannot be deactivated or deleted.
- Old clients sending `status: <code>` keep working; on update, a code equal to the current lifecycle is a stage no-op.
- UI rules (CLAUDE.md): blue-600 accent, emerald/amber/red semantics, shared primitives, no `alert()`.
- All nine locale catalogs get every new key (`messages/catalog.test.ts`).

## Review Focus

1. Lead on a custom stage edited from an old mobile build that re-sends `status: QUALIFIED` → must stay on the custom stage (Task 3 test).
2. Lead currently on a stage that was since deactivated, saved from the web form unchanged → must save (Task 3 test: inactive current stage allowed).
3. Custom stage deleted while leads use it, reassigned to Lost/Converted → must be refused (Task 2 test).
4. Lead with `status_id = null` (not yet backfilled) rendered on web/mobile → label falls back to the lifecycle (Tasks 6, 8 tests).
5. Bulk set-status to a custom stage → writes both columns; to a Lost-lifecycle stage → refused (Task 3 test).

---

### Task 1: Schema, seed catalogue, boot sync

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `LeadStatusOption`, `Lead.status_id` + relation + index, `Tenant.leadStatusOptions`)
- Create: `packages/database/prisma/migrations/<ts>_lead_status_options/migration.sql` (documentation copy of the diff)
- Modify: `packages/database/prisma/lead-taxonomy.seed.ts` + `.js` — `DEFAULT_LEAD_STATUSES`, `PROTECTED_STATUS_CODES`, `CUSTOM_STATUS_LIFECYCLE`, seed in `seedDefaultLeadTaxonomy`
- Modify: `packages/database/index.ts` + `index.js` — re-export new constants
- Modify: `packages/database/prisma/sync-lead-taxonomy.ts` — statuses step + exported pure `plannedStatusRepairs()`
- Test: `apps/backend/src/crm-lead-taxonomy/lead-taxonomy-catalogue.spec.ts` (parity), new `apps/backend/src/crm-lead-taxonomy/status-sync.spec.ts`

**Produces:** `DEFAULT_LEAD_STATUSES: {code,name,lifecycle,sort_order}[]`, `PROTECTED_STATUS_CODES = ['NEW','CONVERTED','LOST']`, `CUSTOM_STATUS_LIFECYCLE = 'QUALIFIED'`, `db.leadStatusOption`, `Lead.status_id`, `Lead.statusOption`.

- [ ] Add model + relation; `npx prisma format`; `npx prisma generate`.
- [ ] Run `prisma migrate diff` old→new; confirm no DROP/ALTER COLUMN; save SQL as migration.
- [ ] Add seed constants (ts + js) and seeding; extend parity spec; run it.
- [ ] Sync step: seed, backfill `status_id IS NULL` by code, repair drift where option.lifecycle ≠ lead.status; delta counters; dry-run honoured. Pure helper tested in `status-sync.spec.ts`.
- [ ] `npm run db:push --workspace=@erp71/database` locally, run sync `--dry-run` then for real.
- [ ] Commit.

### Task 2: Taxonomy kind `statuses`

**Files:** `apps/backend/src/crm-lead-taxonomy/lead-taxonomy.dto.ts`, `crm-lead-taxonomy.service.ts`, `crm-lead-taxonomy.service.spec.ts`

**Produces:** `LeadTaxonomyKind.STATUS = 'statuses'`; service rules; `TaxonomyOption.lifecycle?`.

- [ ] Tests first: create forces `lifecycle: 'QUALIFIED'`; deactivate/delete NEW/CONVERTED/LOST → 400; delete in-use custom stage requires reassign; reassign target must be active + open lifecycle; reassign `updateMany` writes `{status_id, status: target.lifecycle}`; usage counts `status_id`.
- [ ] Implement: model() → `leadStatusOption`; CONSUMERS entry `{table:'lead', fk:'status_id'}`; LABELS 'Lead status'; guards.
- [ ] Run spec; commit.

### Task 3: Lead write paths + resolver

**Files:** create `apps/backend/src/crm-leads/lead-status.resolver.ts` (+ spec); modify `crm-leads.dto.ts` (`status_id` on create/update, `statusId` on list), `crm-leads.service.ts`, `storefront-enquiries.service.ts`, `demo-data/generator/write-crm.ts`, `crm-leads.service.spec.ts`

**Produces:**
```ts
type ResolvedStage = { id: string; lifecycle: LeadStatus } ;
class LeadStatusResolver {
  forCreate(tenantId, dto: { status_id?: string; status?: LeadStatus }): Promise<ResolvedStage | null>; // null only when tenant has no rows
  forUpdate(tenantId, existing: { status: string; status_id: string | null }, dto): Promise<ResolvedStage | undefined>; // undefined = unchanged
  seeded(tenantId, code: LeadStatus): Promise<{id}|null>;
}
```
- [ ] Resolver tests: id wins; foreign/unknown id → 400; inactive id → 400 unless current; code == current lifecycle on update → undefined; code differs → seeded row; neither → NEW (create) / undefined (update).
- [ ] Wire into create/update (dto.status replaced by resolved lifecycle before existing transition logic), bulk STATUS (value = option id or code; closed lifecycle refused), import (status cell via `buildTaxonomyIndex` over status rows), convert (CONVERTED row), storefront (NEW row), demo generator (map by code).
- [ ] `leadIncludes.statusOption`; sort `status` → `statusOption.sort_order`; `findAll` `statusId`.
- [ ] Run crm-leads + storefront + demo specs; commit.

### Task 4: Counts / dashboard stages

**Files:** `crm-leads.service.ts#getStatusSummary`, `crm-dashboard.service.ts#getPipeline`, specs

**Produces:** `stages: { id, code, name, lifecycle, is_system, count }[]` on both responses (active in sort order + inactive with leads). `counts`/`open` unchanged.

- [ ] Tests, implement (groupBy `status_id` + option list), run, commit.

### Task 5: Web — API types, label helper, Setup tab

**Files:** `apps/frontend/src/lib/api.ts` (`CrmListKind` + `'statuses'`), `lib/use-lead-taxonomy.ts` (`lifecycle?`), create `lib/lead-status.ts` (`leadStatusLabel`, `leadStatusTone`, `isOpenLifecycle`, `DEFAULT_STATUS_NAMES`), `app/(app)/crm/setup/page.tsx`, `components/crm/CrmListPanel.tsx`, nine `messages/*/crmHr.ts` (or wherever setup copy lives), tests.

- [ ] Helper tests; Setup tab test (protected rows show no hide/delete; reassign only open stages); implement; locale parity; commit.

### Task 6: Web — lead form, list, detail, funnel

**Files:** `crm/leads/lead-form-fields.tsx`, `crm/leads/page.tsx`, `crm/leads/[id]/page.tsx`, `components/dashboard/CrmDashboard.tsx`, tests.

- [ ] Form: options from `useLeadTaxonomy('statuses')` (+ current inactive); sends `status_id`; lost-reason keyed on lifecycle.
- [ ] List: filter (open + stages → `statusId`; legacy `status` param still honoured), chips via label helper, bulk menu = active open stages.
- [ ] Detail badge via helper. Funnel from `pipeline.stages`.
- [ ] Update existing tests; `npx jest` for touched dirs; `next lint --quiet`; `tsc --noEmit`; commit.

### Task 7: Mobile

**Files:** `apps/mobile/lib/features/crm/data/models.dart`, `crm_repository.dart`, `leads/leads_screen.dart`, `leads/lead_detail_screen.dart`, `home/crm_home_screen.dart`, tests under `apps/mobile/test/`.

- [ ] `LeadStage` model; `Lead.stage`; overview `stages`; repository `leadStatuses()` + `setLeadStage`; filter chips; detail status picker; home funnel; tests; `flutter analyze` + `flutter test`; commit.

### Task 8: Docs + TODO

- [ ] `docs/crm/lead-taxonomy-rollout.md` statuses section; `TODO.md` completed entry; commit.
