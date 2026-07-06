# CRM Leads Import — Design Spec

**Date:** 2026-07-06
**Status:** Approved
**Scope:** Bulk import via CSV/XLSX for CRM Leads, extending the existing master data import pattern to a 12th module.

---

## Overview

Adds an "Import" action to CRM > Leads that lets users bulk-upload leads from a CSV or Excel file. Reuses the shared pattern documented in [2026-07-02-master-data-import-design.md](2026-07-02-master-data-import-design.md) (`ImportDialog` frontend component + `runImport` backend utility) — no new abstractions. This doc only covers what's specific to Leads.

---

## Backend

- **Endpoint:** `POST /crm/leads/import` on `CrmLeadsController`, same shape as other modules: `@Body() body: ImportRowsDto` → `this.service.importRows(tenant.tenantId, body.rows, body.mode)`.
- **Guarded by** the controller's existing `JwtAuthGuard`, `SubscriptionAccessGuard` + `@RequiresFeature('premiumCrm')` and `TenantInterceptor` — no additional guard needed.
- **Service method** `CrmLeadsService.importRows(tenantId, rows, mode)` built on `runImport<T>`:
  - `requiredFields: ['name', 'mobile']`
  - `findDuplicate`: `db.lead.findUnique({ where: { tenant_id_mobile: { tenant_id, mobile } } })` — reuses the existing `@@unique([tenant_id, mobile])` constraint, same lookup already used in `create()`.
  - `create`: same defaults as `CrmLeadsService.create()` (`priority` default `MEDIUM`, `source` default `OTHER`, `status` default `NEW`), including `score` computed via `computeLeadScore()`.
  - `update` (upsert mode): patches the matched fields on the existing lead; does not recompute score or touch fields not present in the import row.

### Enum handling (Leads-specific — the master spec's 11 tables have no enums)

For `category`, `priority`, `source`, `status`:
1. Trim the raw value and uppercase it.
2. If it matches a value of the corresponding Prisma enum (`LeadCategory`, `LeadPriority`, `LeadSource`, `LeadStatus`), use it.
3. If blank or unmatched:
   - `category` → left `null` (field has no default).
   - `priority` → falls back to `MEDIUM`.
   - `source` → falls back to `OTHER`.
   - `status` → falls back to `NEW`.
4. No row is rejected for an invalid enum value — it silently falls back, consistent with these fields being optional-with-defaults on `create()`. (This differs from missing `name`/`mobile`, which does reject the row.)

### Field table

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | |
| `mobile` | Yes | Unique per tenant; dedup key |
| `email` | No | |
| `address` | No | |
| `category` | No | Enum, see above |
| `priority` | No | Enum, defaults `MEDIUM` |
| `source` | No | Enum, defaults `OTHER` |
| `status` | No | Enum, defaults `NEW` |
| `remarks` | No | |

**Out of scope for this iteration** (deferred, not blocking): `assigned_to`, `next_step_assigned_to`, `next_step`, `next_step_date`, `linkedin_url`, `fb_url`, `x_url`, `website_url`. Assignment fields need a user lookup (by email/name) that the generic import pattern doesn't currently support; the rest can be added later by extending the field table if needed. These remain UI-only (set after import via the existing lead edit form).

---

## Frontend

- `apps/frontend/src/app/(app)/crm/leads/page.tsx`: add an "Import" button in the header toolbar, next to the existing "Add Lead" link — same placement/style convention as [sales/customers/page.tsx](../../../apps/frontend/src/app/\(app\)/sales/customers/page.tsx).
- Renders the existing `<ImportDialog>` unmodified:
  ```ts
  entityLabel="Leads"
  fields={LEAD_IMPORT_FIELDS} // per field table above
  importFn={(rows, mode) => api.importLeads(rows, mode)}
  onSuccess={() => void loadLeads()}
  ```
- `apps/frontend/src/lib/api.ts`: add `importLeads(rows, mode)` → `POST /crm/leads/import`, mirroring `importCustomers`.
- No new frontend dependencies (papaparse/xlsx already installed for the master data import feature).

---

## Error Handling

Same as the master spec: row-level errors collected and reported (`Row N: ...`), import continues past bad rows; no file leaves the browser unparsed; no valid rows after mapping blocks the Preview step.

---

## Testing

- Backend unit tests (`crm-leads.service.spec.ts`): create via import, skip on duplicate mobile, upsert on duplicate mobile, missing required field produces a row error, invalid enum value falls back to default instead of erroring.
- Manual verification: full dialog flow (upload → map → preview → import → result) against the CRM Leads page in the browser, confirming the new lead appears in the list.
