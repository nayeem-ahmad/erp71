# Custom Fields for Leads — Design

**Date:** 2026-07-12
**Status:** Approved (pending spec review)
**Scope:** CRM Leads first, built on a reusable custom-fields engine.

## Goal

Let each tenant define up to **10** extra, text-only fields of their own choosing on
CRM Leads. Tenants name the fields; the values are captured per lead. Built as a
generic, tenant-scoped engine so Customers/Products/etc. can adopt it later with
minimal work.

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Where fields apply | Reusable engine, wired to `LEAD` first |
| Field types | Text only |
| Storage | JSONB column on the entity + per-tenant definitions table |
| Config UI | New CRM Settings → Custom Fields page (owner/admin) |
| Surfaces | Lead create/edit form, lead detail view, leads list/table columns, CSV import/export |
| Permission | New `MANAGE_CRM_SETTINGS` (separate from `MANAGE_LEADS`) |
| Max fields | 10 active per entity per tenant |
| Deletion | Non-destructive: hide the field, keep stored values |

## Architecture

A generic custom-fields engine keyed by an **entity type** enum. Definitions live in
one table; per-record values live in a JSONB column on each entity. Only `LEAD` is
enabled in this pass.

### Data model (Prisma)

```prisma
enum CustomFieldEntity { LEAD }   // extend later: CUSTOMER, PRODUCT, ...

model CustomFieldDefinition {
  id         String   @id @default(uuid())
  tenant_id  String
  entity     CustomFieldEntity
  key        String              // server-generated stable slug: cf_1..cf_10
  label      String              // tenant-chosen display name
  order      Int      @default(0)
  is_active  Boolean  @default(true)
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  tenant     Tenant   @relation(fields: [tenant_id], references: [id], onDelete: Cascade)

  @@unique([tenant_id, entity, key])
  @@index([tenant_id, entity])
}
```

On the `Lead` model, add:

```prisma
custom_fields Json?   // { "cf_1": "Gold", "cf_2": "2026-08-01" }
```

**Key stability:** `key` (`cf_1`…`cf_10`) is generated server-side and never changes.
Renaming a label never orphans stored values; only `label` is user-facing.

Production applies schema via `prisma db push` on backend startup (reads
`schema.prisma` directly). A matching `prisma migrate` file is added for local
history and parity.

## Backend

New generic module: `apps/backend/src/custom-fields/`.

### Endpoints

- `GET /custom-fields?entity=LEAD` → active definitions for the tenant, ordered by
  `order`. Available to any user who can view the entity (e.g. `VIEW_LEADS`) so forms
  can render.
- `PUT /custom-fields?entity=LEAD` → reconcile the set for that entity.
  Body: `[{ key?, label, order }]`. Server:
  - reconciles by `key`: rows with a `key` are updated (label/order); rows without a
    `key` are new,
  - **new rows take the first inactive slot** — the `(tenant, entity)` set holds at
    most 10 persistent rows keyed `cf_1`…`cf_10`; a new field reactivates an inactive
    slot's row (relabel + `is_active = true`) rather than inserting a fresh key, so the
    `@@unique([tenant_id, entity, key])` constraint is never violated and freed keys
    are safely reused,
  - enforces **max 10 active** definitions (400 if exceeded),
  - trims labels; label required, ≤ 40 chars, unique among **active** fields per entity
    within tenant,
  - marks omitted existing definitions `is_active = false` and blanks nothing else
    (non-destructive; stored lead values under that key remain).
  - Gated by **`MANAGE_CRM_SETTINGS`**.

**Slot model:** a slot (`cf_1`…`cf_10`) is a stable identity. Removing a field
deactivates its slot; re-adding reuses the first inactive slot. This keeps at most 10
definition rows per tenant/entity and guarantees stored values always map to a stable
key.

### Shared sanitizer

`sanitizeCustomFields(defs, input): Record<string,string>`

- keeps only keys matching **active** definitions,
- coerces values to trimmed strings, ≤ 500 chars each,
- strips unknown/inactive keys silently.

Used by the leads create, update, and import paths.

### Leads wiring

- `CreateLeadDto` / `UpdateLeadDto` gain optional `custom_fields?: Record<string, string>`,
  validated with `@IsOptional()` + object validation, then run through the sanitizer
  in the service before persisting.
- Import (`importRows`): active definitions are loaded once; each field's `label`
  becomes an importable column mapping to its `key`. Values pass through the sanitizer.
- All queries stay tenant-scoped via `TenantInterceptor`.

## Frontend

- **CRM Settings → Custom Fields page:** up to 10 label rows with add / remove /
  reorder, saved via `PUT /custom-fields?entity=LEAD`. Nav entry and page gated by
  `MANAGE_CRM_SETTINGS`.
- **Lead create/edit form:** fetch active defs, render one text input per field, bound
  to `form.custom_fields[key]`.
- **Lead detail view:** render `label: value` for active fields that have a value.
- **Leads list/table:** custom fields offered as optional, toggleable columns.
- **CSV import/export:** `LEAD_IMPORT_FIELDS` extended dynamically from the active defs
  (label = column header, key = target); export includes the same columns.

## Permissions

Add to `packages/shared-types/index.ts`:

- `MANAGE_CRM_SETTINGS: "MANAGE_CRM_SETTINGS"` — in the CRM permission group, default
  granted to owner/admin roles, label e.g. "Manage CRM custom fields & settings".

## Error handling & validation

- More than 10 active definitions → 400.
- Missing/blank label, label > 40 chars, or duplicate label within entity → 400.
- Lead `custom_fields` values coerced to strings, trimmed, capped at 500 chars.
- Unknown or inactive keys in a lead payload are stripped silently (not an error).
- Deleting a definition never deletes stored lead values.

## Testing

Unit tests:

- `CustomFieldsService`: cap-of-10 enforcement; key assignment and stability across
  renames; deactivation on omit; label validation (required/length/uniqueness).
- `sanitizeCustomFields`: strips unknown/inactive keys; coerces and caps values.
- Leads create/update/import honor the sanitizer.
- Permission gating on `PUT /custom-fields`.

## Out of scope (YAGNI)

- Non-text field types (number/date/dropdown/boolean) — text only for now.
- Custom fields on entities other than Lead — engine supports it, but only `LEAD` is
  enabled.
- Per-field required/validation rules, search/filter by custom field.
