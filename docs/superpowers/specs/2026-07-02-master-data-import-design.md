# Master Data Import Feature — Design Spec

**Date:** 2026-07-02  
**Status:** Approved  
**Scope:** Bulk import via CSV/XLSX for all 11 master data tables

---

## Overview

Users can import master data records in bulk from a CSV or Excel file through a multi-step dialog in each list UI. The dialog handles file parsing in the browser, lets the user map spreadsheet columns to system fields when headers don't match exactly, and sends clean JSON rows to a per-module backend endpoint.

---

## Architecture

### Overall Flow

```
User picks file (CSV / XLSX)
  → frontend parses with papaparse (CSV) or xlsx (Excel)
  → ImportDialog detects column headers from row 1
  → shows mapping UI: spreadsheet column → system field
  → user sets skip/upsert mode
  → frontend sends { rows: MappedRow[], mode } JSON to POST /:entity/import
  → backend validates + inserts/updates + collects errors
  → result shown: created / updated / skipped / per-row errors
```

No file is uploaded to the server. All parsing and mapping happens in the browser.

### Backend

- **Shared utility:** `apps/backend/src/common/import.util.ts`  
  `runImport<T>(rows, mode, tenantId, config)` — generic skip/upsert loop, error collection, returns `{ created, updated, skipped, errors }`.
- **Per-module endpoint:** each of the 11 modules adds `POST /:entity/import` accepting `{ rows: Record<string, unknown>[], mode: 'skip' | 'upsert' }` (JSON, no file/multer).
- Auth: existing JWT + `TenantInterceptor` — same as all other endpoints on each module.
- No database migrations required — all 11 tables already exist.

### Frontend

- **Shared component:** `apps/frontend/src/components/import-dialog.tsx`  
  Multi-step modal used by all 11 list pages.
- Each list page adds an Import button in the toolbar (beside the existing Add button) and passes a `fields` config to `<ImportDialog>`.
- New dependency: `papaparse` (CSV parsing). `xlsx` already installed.

---

## ImportDialog Component

### Steps

```
Step 1: Upload  →  Step 2: Map Fields  →  Step 3: Preview  →  Step 4: Result
```

**Step 1 — Upload**
- Drag-and-drop zone + Browse button; accepts `.csv` and `.xlsx`.
- On file select, parse immediately in browser. Detect column headers from row 1.

**Step 2 — Map Fields**
- Table: one row per system field. Each row has a dropdown of detected spreadsheet columns.
- Auto-match: pre-select a column if its name matches a system field label (case-insensitive).
- Required fields marked `*`. User cannot advance if any required field is unmapped.
- Optional fields can be set to "— skip —".
- Skip / Upsert toggle at the bottom of this step.

**Step 3 — Preview**
- First 5 rows shown after applying the mapping.
- "Import X rows" button to proceed.

**Step 4 — Result**
- Summary: `X created / Y updated / Z skipped / W errors`.
- Errors: expandable per-row list (e.g. `Row 14: missing required field "name"`).
- "Done" closes dialog. "Import another file" resets to Step 1.

### Component API

```ts
interface ImportField {
  key: string       // JSON key sent to backend
  label: string     // shown in mapping UI
  required: boolean
}

interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

<ImportDialog
  open={boolean}
  onClose={() => void}
  entityLabel="Suppliers"
  fields={ImportField[]}
  importFn={(rows: Record<string, unknown>[], mode: 'skip' | 'upsert') => Promise<ImportResult>}
  onSuccess={() => void}   // e.g. refresh list
/>
```

---

## Backend Shared Utility

**`apps/backend/src/common/import.util.ts`**

```ts
interface ImportConfig<T> {
  requiredFields: (keyof T)[]
  findDuplicate: (row: T, tenantId: string) => Promise<string | null>  // returns existing record id or null
  create: (row: T, tenantId: string) => Promise<void>
  update: (id: string, row: T) => Promise<void>
  rowLabel: (row: T) => string  // e.g. row.name — used in error messages
}

function runImport<T>(
  rows: Record<string, unknown>[],
  mode: 'skip' | 'upsert',
  tenantId: string,
  config: ImportConfig<T>,
): Promise<{ created: number; updated: number; skipped: number; errors: string[] }>
```

Logic per row:
1. Validate required fields — push error and continue if missing.
2. Call `findDuplicate` — if found and `mode === 'skip'`, increment skipped and continue; if `mode === 'upsert'`, call `update`.
3. If no duplicate, call `create`.
4. Any thrown error is caught and added to `errors` as `Row N: <message>`.

### Endpoint DTO

```ts
class ImportRowsDto {
  @IsArray()
  rows: Record<string, unknown>[]

  @IsEnum(['skip', 'upsert'])
  mode: 'skip' | 'upsert'
}
```

### Example — Suppliers Controller

```ts
@Post('import')
importRows(@Tenant() t: TenantContext, @Body() body: ImportRowsDto) {
  return this.suppliersService.importRows(t.tenantId, body.rows, body.mode)
}
```

---

## Field Definitions Per Table

Unique key = field(s) used by `findDuplicate` to detect existing records.

| Table | Required Fields | Optional Fields | Unique Key |
|-------|----------------|-----------------|------------|
| Brands | `name` | `description` | `name` |
| Product Groups | `name` | `description` | `name` |
| Product Subgroups | `name`, `group_name` | `description` | `name` + resolved group id |
| Suppliers | `name` | `phone`, `email`, `address`, `contact_person` | `name` |
| Customers | `name` | `phone`, `email`, `address`, `customer_group_name` | `phone` (fallback: `email`; if both absent, treated as no duplicate check — always creates) |
| Customer Groups | `name` | `description`, `discount_percent` | `name` |
| Price Lists | `name` | `description`, `is_default` | `name` |
| Employees | `name`, `employee_code` | `email`, `phone`, `department`, `designation`, `joining_date`, `salary` | `employee_code` |
| Warehouses | `name` | `address`, `is_default` | `name` |
| Payment Methods | `name` | `description`, `is_active` | `name` |
| Territories | `name` | `description` | `name` |

**Relational field resolution (backend):**
- `Product Subgroups.group_name` → looked up by name within tenant; row errors if not found.
- `Customers.customer_group_name` → looked up by name within tenant; row errors if not found.

All text fields are trimmed. Duplicate detection is case-insensitive.

---

## Import Button Placement

Each list page toolbar:
```
[Search / Filters ...]          [Import]  [+ Add New]
```

- Import button opens `<ImportDialog>`.
- Requires the same permission as the "create" action for that entity.
- On `onSuccess`, the list refreshes (same pattern as post-create/delete).

---

## Error Handling

- **Row-level errors** (missing required field, lookup failed, DB constraint): collected, import continues on remaining rows.
- **File parse errors** (corrupt file, unreadable encoding): shown on Step 1 before proceeding.
- **No valid rows after mapping**: user cannot advance past Step 3.
- **Backend errors** (500): shown as a top-level error on the result step.

---

## Dependencies

| Package | Location | Purpose | Action |
|---------|----------|---------|--------|
| `papaparse` | frontend | CSV parsing | Add |
| `@types/papaparse` | frontend | types | Add |
| `xlsx` | frontend | XLSX parsing | Already installed |
| `@types/multer` | backend | multipart types | Already installed (not used here) |

No new backend dependencies required.
