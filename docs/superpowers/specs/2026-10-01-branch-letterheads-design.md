# Branch letterheads — per-store print-template overrides

**Date:** 2026-10-01
**Status:** Draft pending review
**Asked as:** whether two branches of one tenant can print two different
letterheads; then spec store-scoped assignment on the existing templates.

---

## Problem

Letterheads are tenant-owned designs. `PrintTemplate` has `tenant_id`,
`doc_types`, and one `is_default`. `PrintTemplatesService.resolve` picks
the template assigned to that document type, else the tenant default, else
branding. Two stores of the same company therefore print the same paper.

A shop with Gulshan and Dhanmondi wants Gulshan invoices on a Gulshan
letterhead and Dhanmondi invoices on a Dhanmondi letterhead, without
duplicating the designer or giving up today’s per-document-type split
(invoice vs challan vs receipt).

---

## Goals

- Templates stay **tenant-owned named designs**. Two branches can share one
  design.
- Each branch can **override** which template is used for each
  `PrintDocType`. Unset follows the company assignment.
- Prints of a document that belongs to one store use that **document’s**
  store, not the user’s currently selected branch.
- Unscoped prints (company-wide report, list spanning all stores, public
  shared quotation **template**) use company paper.
- `{{store_name}}` and `{{address}}` fill from the document’s store when
  the printer has one. Sales invoices do not do this today.
- A tenant with one store sees **no new UI**.

---

## Non-goals (v1)

- Store-owned template copies (each branch designing in isolation).
- Extra store fields (phone, email, website, BIN, TIN per branch). Store
  still has `name` and `address` only.
- A new `StorePermission`. Creating templates and writing overrides stay
  `SETTINGS_ADMIN`.
- Session store choosing the letterhead.
- Public `/q/:token` using the quotation’s branch **template**. The link
  keeps company paper. Tokens may still print the quote’s store name and
  address (that already happens).
- Playwright e2e.
- Changing paper size, compact, skip-preview, or the designer itself.

Those stay later work.

---

## Who it is for

OWNER, and anyone who already reaches Letterhead Design
(`SETTINGS_ADMIN` = `MANAGE_USERS` / `MANAGE_STORES` / `MANAGE_COUNTERS`).
Printers keep using `PRINT_READ` to resolve.

No new nav node. No new permission.

---

## Placement

| Surface | Detail |
|---|---|
| Route | `/settings/print-templates` (existing) |
| New card | **What each branch prints**, above the existing template chips + designer |
| Visibility | Rendered only when the tenant has **two or more** stores |
| Company pill | Explains that company paper is the document-type checkboxes on each template (unchanged) |
| Branch pill | One row per `PrintDocType`, select: **Company default** or a named template |
| Save | Assignment dropdowns `PUT` on change. Template **Save** still saves only the design |

---

## Architecture

Templates do not gain a `store_id`. A small assignment table holds
overrides.

```
PrintTemplate                          (unchanged: tenant design)
PrintTemplateStoreAssignment           (new)
  (tenant_id, store_id, doc_type) → template_id

GET  /print-templates/resolve?docType=&storeId=
GET  /print-templates/assignments
PUT  /print-templates/assignments      { storeId, docType, templateId | null }

resolve(tenantId, docType, storeId?)
        │
        ├── storeId present AND override row for (store, docType)
        │     → that template
        ├── template whose doc_types includes docType
        ├── tenant default (is_default)
        └── branding fallback (logo + colour)
```

Missing `storeId`, a store in another tenant, or no override: skip the
first step and use the company chain. Resolve never 404s for a bad
`storeId`; printing must still produce paper.

Frontend cache key today is `docType`. It becomes
`` `${docType ?? 'DEFAULT'}:${storeId ?? ''}` ``. Saving a template or an
override still calls `clearPrintTemplateCache()`.

---

## Data

New Prisma model, mapped to `print_template_store_assignments`. Production
schema is `db push` on boot; no numbered migration.

```
model PrintTemplateStoreAssignment {
  id          String   @id @default(uuid())
  tenant_id   String
  store_id    String
  doc_type    String
  template_id String
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt

  tenant   Tenant        @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  store    Store         @relation(fields: [store_id], references: [id], onDelete: Cascade)
  template PrintTemplate @relation(fields: [template_id], references: [id], onDelete: Cascade)

  @@unique([tenant_id, store_id, doc_type])
  @@index([tenant_id, store_id])
  @@index([template_id])
  @@map("print_template_store_assignments")
}
```

`onDelete: Cascade` from tenant, store, and template. Deleting a letterhead
drops its branch pins; those branches fall back to company paper. Deleting
a store drops its rows. Reverse arrays go on `Tenant`, `Store`, and
`PrintTemplate`. `PrintTemplate` unique `(tenant_id, name)` is unchanged.

`doc_type` is a `PrintDocType` string, same as `PrintTemplate.doc_types`.

---

## API

Declared on `PrintTemplatesController` **before** `GET :id`.

```
GET  /print-templates/resolve?docType=&storeId=
GET  /print-templates/assignments
PUT  /print-templates/assignments
```

Existing list / get / create / patch / delete of templates stay as they
are.

### Resolve

- Auth: JWT + tenant interceptor + `PRINT_READ` (OWNER always passes).
- `docType` optional `PrintDocType`.
- `storeId` optional UUID. When present and the store belongs to this
  tenant, apply the override step. Otherwise ignore it.
- Response unchanged: `{ template_id, name, config }`.

### List assignments

- Auth: `PRINT_READ`.
- Returns every override for the tenant:

```ts
Array<{
  store_id: string;
  doc_type: PrintDocType;
  template_id: string;
}>
```

Empty array when none exist. The UI already has the store list from
elsewhere.

### Upsert / clear

- Auth: `SETTINGS_ADMIN`.
- Body:

```ts
{ storeId: string; docType: PrintDocType; templateId: string | null }
```

- `templateId` a UUID → upsert the unique `(tenant, store, docType)` row.
- `templateId` null → delete that row if it exists; succeed as a no-op
  when it does not (clearing **Company default**).
- Unknown extra properties → 400 (`forbidNonWhitelisted`).

### Write errors

| When | Status |
|---|---|
| `storeId` missing, not a UUID, or not this tenant’s store | 400 |
| `docType` missing or not a `PrintDocType` | 400 |
| `templateId` present but not this tenant’s template | 400 |
| `templateId` neither a UUID nor null | 400 |

A store the caller cannot sell from is still assignable: this is a tenant
settings write, not a till action.

---

## Resolve vs pin

The assignment select has two kinds of value:

| UI value | Stored | Later change of company paper |
|---|---|---|
| **Company default** | no row | this branch follows |
| A named template, even if it is currently the company default | override row | this branch **stays on that template** |

Picking the named company template is a pin, not a follow.

---

## Print wiring

`usePrintHeader(docType?, { eager?, storeId? })`.
`resolve(storeId?: string)` fetches (and caches) for that pair.

Printers pass the **document’s** store:

| Document | `storeId` source |
|---|---|
| Sales invoice, POS receipt, delivery challan | `sale.store_id` |
| Sales return, sales order | that document’s `store_id` |
| Quotation / proforma **inside the app** | `quotation.store_id` |
| Purchase invoice, purchase order, purchase return | that document’s `store_id` |
| Voucher, money receipt | the voucher/payment’s store when it has one |
| Daily report | the report’s `storeId` (already one branch) |
| `LIST_REPORT` / P&L / balance sheet / trial balance | pass `storeId` only when the report **scope is one store**; omit when company / all stores |
| Payslip | the document’s store if it has one; otherwise omit |
| Public `/q/:token` | **omit** `storeId` (company template). Keep filling `store_name` / `address` tokens from `quote.store` as today |

List-row print (sales, purchases, and the same pattern elsewhere) must
**not** use a header resolved on mount with no store. On click: load the
document, `header.resolve(document.store_id)`, then print.

Pages that are already one store at mount (POS, daily report, a
store-scoped P&L) may eager-fetch with that `storeId`. The print call still
passes the document’s store so a reprint of another branch’s row cannot
wear the session letterhead.

### HeaderContext

When the printer has a store:

- `storeName` ← `store.name`
- `address` ← `store.address`
- `companyName` ← tenant branding business name (unchanged)
- `phone` / `email` / `website` / `vatRegNo` / `tin` ← tenant values when
  the printer already has them; do not invent store-level fields

`sales-invoice-printer` today sets `companyName`, `address`, `phone` and
omits `storeName`. v1 passes `storeName` from the sale’s store, and uses
that store’s `address` when it is non-empty (otherwise the company
address the printer already had). POS receipt today stuffs branding
`companyName` into both `companyName` and `storeName`; v1 keeps branding
on `companyName` and sets `storeName` from the sale’s store.

A line of only empty tokens still drops, same as `applyTokens` today.

---

## UI

Settings → Letterhead Design. Template chips, designer, preview, and
document-type checkboxes stay. New card only when `stores.length >= 2`.

**What each branch prints**

- Pills: **Company** plus each store name.
- **Company** selected: short copy that company paper is assigned on each
  template via document types. No extra dropdowns.
- A store selected: one row per `PrintDocType` (same list as
  `HeaderEditor` `DOC_TYPES`, including `DAILY_REPORT`). Each row is a
  `<select>`: first option **Company default**, then every template name.
  Current override is selected when one exists.
- Changing a select `PUT`s immediately. Failure toasts and reverts the
  control. Success calls `clearPrintTemplateCache()`.
- No second Save on the card. Template **Save** does not write
  assignments.

Mobile: pills wrap; type / select is one column (the mockup A stack).

Deleting a template: existing confirm copy still holds. Branch pins for
that template cascade away; those rows show **Company default** after
reload.

---

## i18n

New keys under `settingsExtras.printTemplates` in **all 9** locale files
(`en`, `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur`). The locale catalog
test fails the build otherwise.

Needed strings (names indicative):

- Card title **What each branch prints**
- Company pill label
- Hint: blank / Company default follows company paper
- Select option **Company default**
- Assignment save / load failure toasts

Document-type labels already exist under `printTemplates.docTypes`.

---

## Files

| File | Role |
|---|---|
| `packages/database/prisma/schema.prisma` | `PrintTemplateStoreAssignment` + relations on Tenant, Store, PrintTemplate |
| `apps/backend/src/print-templates/print-templates.dto.ts` | `storeId` on resolve query; `UpsertPrintTemplateAssignmentDto`; assignment response |
| `apps/backend/src/print-templates/print-templates.dto.spec.ts` | whitelist / enum / null `templateId` |
| `apps/backend/src/print-templates/print-templates.service.ts` | `resolve(..., storeId?)`, `listAssignments`, `upsertAssignment` |
| `apps/backend/src/print-templates/print-templates.service.spec.ts` | override, fallback, ignore foreign store, pin vs follow, clear no-op, write 400s |
| `apps/backend/src/print-templates/print-templates.controller.ts` | `GET assignments`, `PUT assignments`; `storeId` query on resolve. Both routes before `:id` |
| `apps/backend/src/auth/route-authorization.baseline.ts` | new routes |
| `apps/backend/src/auth/route-authorization.spec.ts` / `.roles.spec.ts` | stay green |
| `apps/backend/src/sales-quotations/sales-quotations.service.ts` | `shareLetterhead` keeps `resolve(tenantId, docType)` with **no** storeId |
| `apps/frontend/src/lib/api.ts` | `getPrintTemplateAssignments`, `upsertPrintTemplateAssignment`; resolve query can pass `storeId` |
| `apps/frontend/src/lib/print/use-print-header.ts` | cache key includes `storeId`; `resolve(storeId?)` |
| `apps/frontend/src/lib/print/use-print-header.test.tsx` | cache isolation per store; query string |
| `apps/frontend/src/lib/hooks/useSalePrinting.ts` | resolve invoice + challan headers from `sale.store_id` at click |
| `apps/frontend/src/lib/hooks/usePurchasePrinting.ts` | same for `purchase.store_id` |
| `apps/frontend/src/lib/sale-print-actions.ts` / `sales-invoice-printer.ts` / `pos-receipt-printer.ts` | HeaderContext store name + address |
| Other `usePrintHeader` call sites | pass document/report store when the print has one |
| `apps/frontend/src/app/(app)/settings/print-templates/page.tsx` | assignment card |
| `apps/frontend/src/app/(app)/settings/print-templates/page.test.tsx` | hidden with one store; PUT on change; Company default clears |
| `apps/frontend/src/lib/localization/messages/*/settingsExtras.ts` | new keys, all 9 locales |

No new nav node. `ProductsService` / inventory untouched.

---

## Testing

TDD against the service and the hook first, then the page.

### Backend (`print-templates.service.spec.ts` + dto spec)

- Override for `(store, SALES_INVOICE)` wins over a tenant `doc_types`
  match.
- No override → existing doc-type / default / branding chain unchanged.
- `storeId` for another tenant’s store is ignored (company chain).
- Resolve without `storeId` never reads the assignment table’s store
  filter as “match nothing”; it skips the override step.
- PUT named template upserts; a second PUT for the same pair replaces
  `template_id`.
- PUT `templateId: null` deletes the row; a second clear succeeds.
- PUT with a template from another tenant → 400.
- Deleting a template (existing `remove`) leaves no assignment rows for
  that `template_id` (cascade; assert the delete is issued, or that a
  following resolve falls back).

DTO: `plainToInstance` + `validate` with `whitelist: true`,
`forbidNonWhitelisted: true`. An unknown property → 400.
`templateId: null` is allowed.

### Frontend

- `usePrintHeader('SALES_INVOICE')` and
  `usePrintHeader('SALES_INVOICE', { storeId: 's1' })` are two cache
  entries; resolving one does not return the other.
- `resolve('s1')` calls
  `/print-templates/resolve?docType=SALES_INVOICE&storeId=s1`.
- Assignment card absent when `stores.length < 2`.
- Selecting a named template PUTs `{ storeId, docType, templateId }`.
- Selecting **Company default** PUTs `templateId: null`.
- Failed PUT reverts the select.
- Sales list print for a Gulshan sale calls resolve with that sale’s
  `store_id` (not the session store).
- Invoice HeaderContext includes `storeName` from the sale’s store.

### i18n

Every new key exists in all 9 locale files.

### Out of test scope for v1

Playwright e2e (CI often skips it), extra store contact fields, public
quotation branch-template (explicitly company paper).

---

## Key decisions

1. **Override rows, not store-owned designs.** Templates stay reusable.
   Empty means follow company paper, so existing shops change nothing.
2. **Per branch and per document type.** The operator asked for two
   letterheads on two branches without dropping invoice-vs-challan
   assignment.
3. **Document store, not session store.** Reprinting a Dhanmondi sale
   while the switcher is on Gulshan still prints Dhanmondi paper.
4. **Unscoped prints stay on company paper.** Company-wide reports and
   the public quotation **template** omit `storeId`.
5. **Public quotation tokens may still name the store.**
   `shareLetterhead` already fills `store_name` / `address` from
   `quote.store` on the company template. Do not strip that.
6. **Named template is a pin.** Choosing the current company default by
   name keeps the branch there if company paper later moves.
7. **Hide the card until two stores.** A single-branch tenant must not
   see a new settings block.
8. **PUT on change.** Assignments are not part of template Save, so
   switching Gulshan’s invoice template cannot accidentally rewrite the
   open design.
9. **No new permission.** Same gates as today’s print-templates routes.
10. **Fill `{{store_name}}` / `{{address}}` from the document’s store**
    once printers already pass `storeId`. That gap on sales invoices is
    in v1 because the print path has the store anyway.

---

## Later (explicitly out of this spec)

- Phone / email / BIN on `Store`, and tokens for them.
- Public quotation using the quote’s branch template.
- Per-user default “print with my current branch” for unscoped reports.
- Copying a template into a store-private design.
