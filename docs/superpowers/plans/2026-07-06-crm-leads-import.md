# CRM Leads Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "bulk import from CSV/Excel" action to CRM > Leads, matching the existing import pattern already used by 11 other modules (Customers, Suppliers, Employees, etc.).

**Architecture:** Reuse the generic `runImport()` backend utility (`apps/backend/src/common/import.util.ts`) and the generic `<ImportDialog>` frontend component (`apps/frontend/src/components/import-dialog.tsx`) unmodified. Add one backend endpoint (`POST /crm/leads/import`) and one frontend wiring point (Import button + dialog on the Leads list page). No new abstractions, no schema changes.

**Tech Stack:** NestJS (`CrmLeadsController`/`CrmLeadsService`), Prisma (`Lead` model, already has `@@unique([tenant_id, mobile])`), Next.js page (`apps/frontend/src/app/(app)/crm/leads/page.tsx`), `papaparse`/`xlsx` (already installed, used by `ImportDialog`).

## Global Constraints

- Required import fields: `name`, `mobile` (matches `CreateLeadDto`, matches the `@@unique([tenant_id, mobile])` constraint).
- Optional import fields (this iteration): `email`, `address`, `category`, `priority`, `source`, `status`, `remarks`. Assignment fields (`assigned_to`, `next_step_assigned_to`), next-step fields, and social/website URL fields are **out of scope** — left UI-only, set after import via the existing edit form.
- Enum fields (`category`, `priority`, `source`, `status`): trim + uppercase, validate against the Prisma enum; invalid/blank falls back silently to the same defaults `create()` uses (`priority` → `MEDIUM`, `source` → `OTHER`, `status` → `NEW`; `category` → `null`, no default). No row is rejected for an invalid enum value.
- A row whose resolved `status` is `LOST` is rejected with a row-level error (`lost_reason` is required for LOST leads per `CrmLeadsService.create()`, and `lost_reason` is not an importable field in this iteration).
- Dedup key: `tenant_id_mobile` (same compound unique index create()/update() already use).
- `mode: 'skip'` never touches an existing lead; `mode: 'upsert'` patches only the fields present in the row (does not recompute `score`, matching the `runImport` `update` contract used by other modules).
- Spec reference: `docs/superpowers/specs/2026-07-06-crm-leads-import-design.md`.

---

### Task 1: Backend — `CrmLeadsService.importRows()`

**Files:**
- Modify: `apps/backend/src/crm-leads/crm-leads.service.ts`
- Test: `apps/backend/src/crm-leads/crm-leads.service.spec.ts`

**Interfaces:**
- Consumes: `runImport<T>(rows, mode, tenantId, config): Promise<ImportResult>` from `apps/backend/src/common/import.util.ts` (already exists, no changes). `ImportResult = { created: number; updated: number; skipped: number; errors: string[] }`.
- Consumes: `LeadCategory`, `LeadPriority`, `LeadSource`, `LeadStatus` enums from `@prisma/client` (already imported in `crm-leads.dto.ts` via re-export — import directly from `@prisma/client` in the service, same as `crm-leads.service.ts` already does for `LeadStatus`... actually `crm-leads.service.ts` currently imports `LeadStatus` from `./crm-leads.dto`; follow that same re-export path for consistency).
- Produces: `CrmLeadsService.importRows(tenantId: string, rows: Record<string, unknown>[], mode: 'skip' | 'upsert'): Promise<ImportResult>` — consumed by Task 2's controller endpoint.

- [ ] **Step 1: Write the failing tests**

Add to `apps/backend/src/crm-leads/crm-leads.service.spec.ts`, inside the existing top-level `describe('CrmLeadsService', ...)` block (after the `getStatusSummary()` describe block):

```ts
    describe('importRows()', () => {
        it('creates a new lead from a valid row with defaults applied', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-10' });

            const result = await service.importRows('tenant-1', [
                { name: 'Alice', mobile: '01800000001', email: 'alice@example.com' },
            ], 'skip');

            expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        name: 'Alice',
                        mobile: '01800000001',
                        email: 'alice@example.com',
                        priority: 'MEDIUM',
                        source: 'OTHER',
                        status: 'NEW',
                    }),
                }),
            );
        });

        it('skips a duplicate mobile in skip mode', async () => {
            db.lead.findUnique.mockResolvedValueOnce({ id: 'lead-existing' });

            const result = await service.importRows('tenant-1', [
                { name: 'Bob', mobile: '01800000002' },
            ], 'skip');

            expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: [] });
            expect(db.lead.update).not.toHaveBeenCalled();
        });

        it('updates a duplicate mobile in upsert mode', async () => {
            db.lead.findUnique.mockResolvedValueOnce({ id: 'lead-existing' });
            db.lead.update.mockResolvedValueOnce({ id: 'lead-existing' });

            const result = await service.importRows('tenant-1', [
                { name: 'Bob Updated', mobile: '01800000002', priority: 'HIGH' },
            ], 'upsert');

            expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: [] });
            expect(db.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'lead-existing' },
                    data: expect.objectContaining({ name: 'Bob Updated', priority: 'HIGH' }),
                }),
            );
        });

        it('reports a row error for missing required fields and continues', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-11' });

            const result = await service.importRows('tenant-1', [
                { name: '', mobile: '' },
                { name: 'Carol', mobile: '01800000003' },
            ], 'skip');

            expect(result.created).toBe(1);
            expect(result.errors).toEqual(['Row 2: missing required field(s): name, mobile']);
        });

        it('falls back to defaults for an invalid enum value instead of erroring', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);
            db.lead.create.mockResolvedValueOnce({ id: 'lead-12' });

            const result = await service.importRows('tenant-1', [
                { name: 'Dana', mobile: '01800000004', priority: 'not-a-priority', source: 'nope' },
            ], 'skip');

            expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
            expect(db.lead.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ priority: 'MEDIUM', source: 'OTHER' }),
                }),
            );
        });

        it('rejects a row with status LOST since lost_reason is not importable', async () => {
            db.lead.findUnique.mockResolvedValueOnce(null);

            const result = await service.importRows('tenant-1', [
                { name: 'Evan', mobile: '01800000005', status: 'LOST' },
            ], 'skip');

            expect(result.created).toBe(0);
            expect(result.errors).toEqual([
                'Row 2: status LOST requires a lost_reason, which import does not support — set status after import instead',
            ]);
            expect(db.lead.create).not.toHaveBeenCalled();
        });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx jest crm-leads.service.spec.ts -t "importRows"`
Expected: FAIL — `service.importRows is not a function`

- [ ] **Step 3: Implement `importRows()`**

In `apps/backend/src/crm-leads/crm-leads.service.ts`, change the existing import line:
```ts
import { CreateLeadDto, LeadStatus, UpdateLeadDto } from './crm-leads.dto';
```
to:
```ts
import { CreateLeadDto, LeadCategory, LeadPriority, LeadSource, LeadStatus, UpdateLeadDto } from './crm-leads.dto';
```

And add this import alongside the other existing imports at the top of the file:
```ts
import { runImport, ImportResult } from '../common/import.util';
```

Add this method to the `CrmLeadsService` class (after `getStatusSummary`, or after `create`, whichever is closer in the actual file — self-contained either way):

```ts
    private resolveEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
        if (raw === undefined || raw === null) return undefined;
        const value = String(raw).trim().toUpperCase();
        return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        return runImport(rows, mode, tenantId, {
            requiredFields: ['name', 'mobile'],
            castRow: (raw) => {
                const status = this.resolveEnum(raw.status, Object.values(LeadStatus)) ?? LeadStatus.NEW;
                if (status === LeadStatus.LOST) {
                    throw new Error('status LOST requires a lost_reason, which import does not support — set status after import instead');
                }
                return {
                    name: String(raw.name ?? '').trim(),
                    mobile: String(raw.mobile ?? '').trim(),
                    email: raw.email ? String(raw.email).trim() || null : null,
                    address: raw.address ? String(raw.address).trim() || null : null,
                    remarks: raw.remarks ? String(raw.remarks).trim() || null : null,
                    category: this.resolveEnum(raw.category, Object.values(LeadCategory)) ?? null,
                    priority: this.resolveEnum(raw.priority, Object.values(LeadPriority)) ?? LeadPriority.MEDIUM,
                    source: this.resolveEnum(raw.source, Object.values(LeadSource)) ?? LeadSource.OTHER,
                    status,
                };
            },
            findDuplicate: async (row) => {
                const existing = await this.db.lead.findUnique({
                    where: { tenant_id_mobile: { tenant_id: tenantId, mobile: row.mobile } },
                    select: { id: true },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                const score = computeLeadScore(
                    { status: row.status, source: row.source, priority: row.priority, last_contacted_at: null, next_step_date: null },
                    0,
                );
                await this.db.lead.create({
                    data: {
                        tenant_id: tenantId,
                        name: row.name,
                        mobile: row.mobile,
                        email: row.email,
                        address: row.address,
                        remarks: row.remarks,
                        category: row.category,
                        priority: row.priority,
                        source: row.source,
                        status: row.status,
                        score,
                    },
                });
            },
            update: async (id, row) => {
                await this.db.lead.update({
                    where: { id },
                    data: {
                        name: row.name,
                        mobile: row.mobile,
                        email: row.email,
                        address: row.address,
                        remarks: row.remarks,
                        category: row.category,
                        priority: row.priority,
                        source: row.source,
                        status: row.status,
                    },
                });
            },
        });
    }
```

`computeLeadScore` is already imported at the top of `crm-leads.service.ts` (`import { computeLeadScore } from './lead-scoring.util';`) — no new import needed for it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && npx jest crm-leads.service.spec.ts`
Expected: PASS — all `importRows()` tests plus the pre-existing tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/crm-leads/crm-leads.service.ts apps/backend/src/crm-leads/crm-leads.service.spec.ts
git commit -m "Add CrmLeadsService.importRows() for bulk lead import"
```

---

### Task 2: Backend — wire the `POST /crm/leads/import` endpoint

**Files:**
- Modify: `apps/backend/src/crm-leads/crm-leads.controller.ts`

**Interfaces:**
- Consumes: `CrmLeadsService.importRows(tenantId, rows, mode)` from Task 1. `ImportRowsDto` (`{ rows: Record<string, unknown>[]; mode: 'skip' | 'upsert' }`) from `apps/backend/src/common/import.dto.ts` (already exists, used by `CustomersController` — no changes needed).
- Produces: `POST /crm/leads/import` route, consumed by Task 3's frontend `api.importLeads()`.

- [ ] **Step 1: Add the route**

In `apps/backend/src/crm-leads/crm-leads.controller.ts`, add the import:

```ts
import { ImportRowsDto } from '../common/import.dto';
```

Add this method to `CrmLeadsController` (placed before the `findAll()`/`@Get()` route, matching where `CustomersController` places its `import` route relative to other routes — specifically, add it right after the `create()` method and before `@Get()`, so it isn't shadowed by any parameterized route):

```ts
    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.service.importRows(tenant.tenantId, body.rows, body.mode);
    }
```

- [ ] **Step 2: Verify the backend still builds and existing tests pass**

Run: `cd apps/backend && npx tsc --noEmit && npx jest crm-leads`
Expected: PASS — no type errors, all `crm-leads` spec files (service + controller) pass.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/crm-leads/crm-leads.controller.ts
git commit -m "Wire POST /crm/leads/import endpoint"
```

---

### Task 3: Frontend — `api.importLeads()`

**Files:**
- Modify: `apps/frontend/src/lib/api.ts`

**Interfaces:**
- Produces: `api.importLeads(rows: Record<string, unknown>[], mode: 'skip' | 'upsert'): Promise<ImportResult>` — consumed by Task 4's `<ImportDialog importFn={...}>`.

- [ ] **Step 1: Add the function**

In `apps/frontend/src/lib/api.ts`, add this immediately after the existing `deleteLead` entry (line 500, `deleteLead: (id: string) => fetchWithAuth(...)`):

```ts
    importLeads: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/crm/leads/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
```

(This exactly mirrors the existing `importCustomers` entry at line 397 of the same file.)

- [ ] **Step 2: Verify it typechecks**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/api.ts
git commit -m "Add api.importLeads() client function"
```

---

### Task 4: Frontend — Import button + dialog on the Leads page

**Files:**
- Modify: `apps/frontend/src/app/(app)/crm/leads/page.tsx`

**Interfaces:**
- Consumes: `api.importLeads` (Task 3), `ImportDialog` + `ImportField` type from `apps/frontend/src/components/import-dialog.tsx` (already exists, unmodified).

- [ ] **Step 1: Add imports and state**

In `apps/frontend/src/app/(app)/crm/leads/page.tsx`:

Change the lucide-react import on line 5 from:
```ts
import { UserPlus, Plus, RefreshCw, Search, Eye, Trash2, ListChecks } from 'lucide-react';
```
to:
```ts
import { UserPlus, Plus, RefreshCw, Search, Eye, Trash2, ListChecks, Upload } from 'lucide-react';
```

Add this import after line 11 (`import { DataTable } from '@/components/data-table';`):
```ts
import { ImportDialog, type ImportField } from '@/components/import-dialog';
```

Add this module-level constant after the `columnHelper`/color-map constants near the top of the file (after line 46, `function scoreBadgeColor...}`, before `export default function LeadsPage()`):
```ts
const LEAD_IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'mobile', label: 'Mobile', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'category', label: 'Category', required: false },
    { key: 'priority', label: 'Priority', required: false },
    { key: 'source', label: 'Source', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'remarks', label: 'Remarks', required: false },
];
```

Add this state next to the other `useState` calls (after line 59, `const [myTodaysActions, setMyTodaysActions] = useState(false);`):
```ts
    const [importOpen, setImportOpen] = useState(false);
```

- [ ] **Step 2: Add the Import button**

In the header button row (around line 191-201), change:
```tsx
                <div className="flex items-center gap-2">
                    <button onClick={loadLeads} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <Link
                        href={routes.crm.leadNew}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700"
                    >
                        <Plus className="w-4 h-4" /> {m.newLead}
                    </Link>
                </div>
```
to:
```tsx
                <div className="flex items-center gap-2">
                    <button onClick={loadLeads} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setImportOpen(true)}
                        className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50"
                    >
                        <Upload className="w-4 h-4" /> Import
                    </button>
                    <Link
                        href={routes.crm.leadNew}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700"
                    >
                        <Plus className="w-4 h-4" /> {m.newLead}
                    </Link>
                </div>
```

- [ ] **Step 3: Render the dialog**

At the end of the component's returned JSX, change:
```tsx
            <DataTable<Lead>
                tableId="crm-leads"
                title={m.title}
                data={leads}
                columns={columns}
                isLoading={loading}
                emptyMessage={myTodaysActions ? m.myTodaysActionsEmpty : m.emptyMessage}
            />
        </div>
    );
```
to:
```tsx
            <DataTable<Lead>
                tableId="crm-leads"
                title={m.title}
                data={leads}
                columns={columns}
                isLoading={loading}
                emptyMessage={myTodaysActions ? m.myTodaysActionsEmpty : m.emptyMessage}
            />

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel="Leads"
                fields={LEAD_IMPORT_FIELDS}
                importFn={(rows, mode) => api.importLeads(rows, mode)}
                onSuccess={() => void loadLeads()}
            />
        </div>
    );
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/frontend/src/app/(app)/crm/leads/page.tsx"
git commit -m "Add Import button and dialog to CRM Leads page"
```

---

### Task 5: Manual verification and TODO.md update

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Start the app and exercise the golden path**

Use the `run` skill or start backend + frontend dev servers. Navigate to `/crm/leads`. Click "Import". Upload a small `.csv` with header row `name,mobile,email,category,priority,source,status` and 2-3 data rows (include one row that duplicates an existing lead's mobile, and one row with an invalid priority value like `super-high` to confirm it falls back to `MEDIUM` instead of erroring). Confirm:
- Auto field mapping pre-fills correctly on the Map step.
- Preview shows the mapped rows.
- Skip mode: re-importing the same file reports the duplicate row as `skipped`, not `created`.
- Upsert mode: re-importing with a changed field (e.g. different `priority`) updates the existing lead — verify in the leads list.
- The new leads appear in the list after import (`onSuccess` refresh works).

- [ ] **Step 2: Exercise the LOST-status edge case**

Upload a row with `status=LOST`. Confirm the result screen shows the row-level error (`Row N: status LOST requires a lost_reason...`) and the lead is not created.

- [ ] **Step 3: Update TODO.md**

Add a completed entry under the `### CRM Module (Epic 70–74)` section of `TODO.md` (near the other CRM Leads entries, e.g. after the `CRM lead scoring...` line):

```markdown
- [x] CRM Leads bulk import from CSV/Excel — `POST /crm/leads/import` (mobile-based dedup via existing `tenant_id_mobile` unique index, skip/upsert modes, invalid enum values fall back to defaults instead of erroring, LOST status rejected per-row since lost_reason isn't importable); reuses the existing `ImportDialog`/`runImport` pattern from the master data import feature — done 2026-07-06
```

- [ ] **Step 4: Commit**

```bash
git add TODO.md
git commit -m "Update TODO.md for CRM Leads import"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers backend field table + enum fallback + LOST rejection + dedup key from the spec. Task 2 covers the endpoint. Tasks 3-4 cover the frontend button/dialog wiring. Task 5 covers manual verification of the flow described in the spec's Error Handling section. All spec sections have a corresponding task.
- **Type consistency:** `importRows(tenantId: string, rows: Record<string, unknown>[], mode: 'skip' | 'upsert'): Promise<ImportResult>` is defined identically in Task 1 (service) and referenced identically in Task 2 (controller) and Task 3 (frontend `api.importLeads` mirrors the same `rows`/`mode` shape). `ImportField`/`ImportResult` types are the pre-existing ones from `import-dialog.tsx` / `import.util.ts` — not redefined.
- **No placeholders:** every step has literal code, not descriptions.
