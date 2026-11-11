# Ask ERP71 — Wave 1 & 2 tool coverage

**Date:** 2026-11-11
**Status:** Draft pending review
**Asked as:** cover the retail-ops reports the assistant sits next to (Wave 1) and the whole paid modules it cannot yet read (Wave 2), wrapping existing services. No text-to-SQL. No writes.

---

## Problem

Ask ERP71 answers from a fixed menu of read-only tools (`CHAT_TOOLS`, ~33 today). Several pages a shop uses every day have no tool: Daily Report, cashier sessions, sales/purchase line items, Mushak 6.2, bad-debt write-offs, sales exchanges, warranty claims. Whole paid modules — storefront orders, manufacturing, imports, CRM pipeline beyond the open-leads slice of `open_pipeline` — are also dark. The model either links out or invents an empty report.

The system prompt still says “you cannot see line items”, which is already wrong for anomaly work and will be false once Wave 1 lands.

## Goals

- Wave 1: the assistant can answer the same questions the Daily Report, cashier overview, line-item reports, Mushak 6.2, and bad-debts page answer, and can list sales exchanges and warranty claims and resolve a lead by name.
- Wave 2: the assistant can list storefront orders, summarise manufacturing (jobs / product P&L / analytics), report import shipments and the LC register, and read CRM leads / campaigns / follow-ups.
- Every new tool wraps an existing domain service. Numbers match the page. `tenantId` is never a tool parameter.
- Wave 1 is shippable on its own. Wave 2 follows on the same design.

## Non-goals

- Wave 0 extra `APP_PAGES` that have no new tool (HR reports already listed; remaining link-only pages stay later).
- Wave 3 writes, Payroll, Loans, Projects, SMS.
- Wave 4 text-to-SQL.
- Wave 5 two-stage router, unless live eval after this work proves routing collapse.
- Expanding `ChatTool.permission` from a single `StorePermission` to any-of arrays.
- Historical cashier till reports (overview is today-only).
- Import duty/cost register inside `import_status`.
- Inventing a `premiumImports` entitlement (APP_REGISTRY has none; `unknownEntitlementKeys` already records that `premiumImports` never existed).
- Changing credit metering, streaming, or charts.

---

## Who it is for

Any role that already holds the matching store permission. The tool is withheld from the menu when the caller lacks it — same as today. Plan gating is on top of that.

## Architecture

Keep tool-calling over existing services. Add tools to the existing per-domain files under `apps/backend/src/ai/tools/`. Introduce `ChatToolDepsFactory` so `ChatService` does not grow from ~16 constructor args to ~27.

```
POST /ai/chat
  → resolveTools (permission + modules + feature flags)
  → agent loop
       tool.handler(ctx, args, depsFactory.build())
         → existing *Service method (same as REST)
         → project + cap rows (MAX_TOOL_ROWS = 20)
```

No new HTTP endpoints. No schema change.

---

## Tools

### Wave 1 — new tools

| Name | File | Permission | Modules | Wraps |
|---|---|---|---|---|
| `daily_report` | `operations.tools.ts` | `VIEW_FINANCIAL_REPORTS` | `retail` | `DailyReportService.getReport` |
| `cashier_sessions` | `operations.tools.ts` | `CREATE_SALE` | `retail` | `CashierSessionsService.getOverview` |
| `sales_line_items` | `sales.tools.ts` | `VIEW_FINANCIAL_REPORTS` | `retail` | `SalesLineItemsService.getSalesLineItems` |
| `purchase_line_items` | `purchasing.tools.ts` | `VIEW_FINANCIAL_REPORTS` | `retail`, `inventory` | `PurchaseLineItemsService.getPurchaseLineItems` |
| `mushak_summary` | `finance.tools.ts` | `VIEW_FINANCIAL_REPORTS` | `retail` | `MushakService.getSalesBook` |
| `bad_debts` | `parties.tools.ts` | `WRITE_OFF_CUSTOMER_DEBT` | `retail`, `crm` | `CustomersService.listWriteOffs` |

REST uses broader sets (`SALES_READ`, `POS_STAFF`, `MANUFACTURING_READ`). `ChatTool.permission` stays a single value this wave; the table above is the mapping.

### Wave 1 — extend existing tools

`list_documents` `type` enum adds `sales_exchange` and `warranty_claim`.

- Exchange row: `number` = `exchange_number`, `amount` = `difference`, `party` = original sale customer, `status`.
- Claim row: `number` = `claim_number`, `amount` omitted, `party` = customer name, `status`, `detail` = product name + serial.

`resolve_entity` `type` enum adds `lead`. Match `Lead.name` / `mobile` / `email` (not the `*_norm` columns). `detail` is mobile or email. Soft-delete does not apply (`Lead` has none).

### Wave 2 — new tools (combined `kind` to limit routing)

| Name | File | Permission | Modules | `kind` | Wraps |
|---|---|---|---|---|---|
| `storefront_orders` | `operations.tools.ts` | `CREATE_SALE` | `storefront` | — | `StorefrontService.getOrders` |
| `manufacturing_summary` | `operations.tools.ts` | `EDIT_PRODUCTS` | `manufacturing` | `jobs` \| `product_pl` \| `analytics` | `listJobs` / `getProductPL` / `getAnalytics` |
| `import_status` | `operations.tools.ts` | `VIEW_IMPORTS` | `imports` | `shipments` \| `lc_register` | `findAll` / `lcRegister` |
| `crm_pipeline` | `operations.tools.ts` | `VIEW_LEADS` | `crm` | `leads` \| `campaigns` \| `follow_ups` | `CrmLeadsService` / `CrmCampaignsService` / `CrmFollowUpsService` |

Four tools, not ten. `kind` is required on the three combined tools.

---

## Parameters and projection

Shared: `tenantId` never a parameter. `STORE_PROP` / `DATE_RANGE_PROPS` / `PAGING_PROPS` from `tools/types.ts` unless noted. Money through `money()`. Dates through `isoDate()`. Rows through `page()` except where the domain service already paginates — then pass `limit: MAX_TOOL_ROWS` into the service and echo its `total`.

### `daily_report`

Parameters: `date` (YYYY-MM-DD, omit = today in `ctx.timezone`), `storeId` (omit = current branch). **Required branch.** Use `resolveRequiredStoreId` (new): never all-branches. Owner with several branches and no `storeId` / no current branch → `{ error }` telling the model to pass a branch id from the prompt list. Do not call `getReport` without a `storeId`.

Load `storeName` from `ctx.stores`. Load `tenantName` via `ChatDataService.tenantName(tenantId)` (`db.tenant.findUnique`, name or `''`). `locale` is always `'en'` (WhatsApp text is omitted).

Project: `date`, `storeName`, `headlines`, `sales`, `tenders`, `till` (sessions projected to cashier/counter/status/opening/expected/closing/variance; plus rollup and `openSessionCount` / `unassignedSalesCount`), `moneyOut`, `dues`, `topProducts`, `stock` (`reorderCount`, `zeroCount`, `shrinkageCount`, `shrinkageAmount` only), `checklist` (`code`, `count`, `href`). Omit `whatsappText`, `returns.rows`, `stock.reorder`.

Future date: let `DailyReportService` throw; `ChatService` already serialises handler throws as `{ error }`.

### `cashier_sessions`

Parameters: `storeId` only. Standard `resolveStoreId` (owners may see every branch). **No `date`.** Overview is today-only (`open` + `closed_today`). Description must say so.

Project: `store_id`, `totals` (`open_count`, `closed_count`, `sales_total`, `expected_cash`, `short`, `over`), `open` and `closed_today` rows capped with `page()`: cashier name, counter name, branch name, `sales_count`, `sales_total`, `expected_cash`, `closing_cash`, `variance`, `opened_at` / `closed_at` as ISO.

### `sales_line_items` / `purchase_line_items`

Parameters: `from`, `to` (required), `storeId`, `productId`, `customerId` (sales) or `supplierId` (purchases), `search`, paging. Resolve `storeId` with `resolveStoreId`. Pass `limit: MAX_TOOL_ROWS` and `offset`-derived page into the existing DTO.

Project `summary` (lineCount, invoice/bill count, quantity, amount, returnedQuantity, returnedAmount) plus rows: invoice/bill number, date, party name, product name/sku, qty, unitPrice, amount, returnedQuantity. Do not return Prisma entities.

### `mushak_summary`

Parameters: `from`, `to` (required), `storeId`, `taxableOnly` (boolean), paging.

Project: `form` (`6.2`), `period`, `totals` (invoices, totalValue, sdAmount, vatAmount, inclusiveTotal), `estimated`, plus `page(rows)` of `{ date, invoiceNumber, buyer, vatAmount, sdAmount, totalValue }`. Not the full book.

### `bad_debts`

Parameters: `from`, `to`, `customerId`, paging. Call `listWriteOffs` with `timezone: ctx.timezone`.

Project rows: customer name/phone, amount (`money`), reason, date, created-by name.

### `storefront_orders`

Parameters: `storeId`, paging. `getOrders(tenantId, page, limit, storeId)`.

Project: order id, created_at, status, customer name/phone, item count, total (`money`).

### `manufacturing_summary`

- `jobs`: `listJobs`; rows = product name/sku, quantity, status, totalJobCost.
- `product_pl`: `getProductPL`; keep `totals`; page `products` to name, qty produced, production cost, revenue, gross profit.
- `analytics`: `getAnalytics(tenantId, ctx.timezone)`; keep headline totals; page `volumeTrend`.

### `import_status`

- `shipments`: `findAll` with `openOnly: 'true'` unless the model passes a status; project reference, supplier, status, eta, lc_number.
- `lc_register`: `lcRegister(tenantId, withinDays?, storeId)`; project lc_number, supplier, status, expiry, daysToExpiry, invoice_value_bdt. `withinDays` optional number.

Duty report is out of scope.

### `crm_pipeline`

- `leads`: always include `getStatusSummary` (`counts`, `open`). Rows from `findAll` (`search`, `status`, `page`/`limit`, `timezone: ctx.timezone`). Project name, status, mobile, source, next_step_date.
- `campaigns`: `findAll`; project name, created_at, recipient count.
- `follow_ups`: always include `getTodaySummary` (`dueToday`, `overdue`, `total`). Rows: `scope=today` → `findAll({ dueToday: true, timezone })`; `scope=overdue` → `findAll({ status: 'PENDING', timezone, limit: 100 })` then keep `due_at < start of today` and `page()`; default `scope` is `today`. Project party name (customer or lead), due_at, status, assignee.

`open_pipeline` `kind: leads` stays for “what is still open”. Prompt says to use `crm_pipeline` for lists, campaigns, and follow-ups.

---

## Module gating

`ChatToolModule` adds `'storefront' | 'imports'`.

`ChatService.resolveModules`:

- Always `accounting`.
- If `!accountingOnly`: `retail`, `inventory`, `hr`, **`storefront`**, **`imports`**.
- `crm` only when `hasPlanEntitlement(features, 'premiumCrm')`.
- `manufacturing` only when `premiumManufacturing` (unchanged).

Do not invent `premiumImports`. Storefront and imports are on every non-accounting plan, matching `APP_REGISTRY`.

Retag these `APP_PAGES` from `modules: ['crm']` to `modules: ['retail', 'crm']` so BASIC still gets customer deep-links after `crm` is gated:

- `/sales/customers`, `/sales/customer-ledger`, `/sales/customers/reports/due-aging`, `/sales/customers/reports/bad-debts`.

`/crm/contacts` and `/crm/contacts/new` stay `crm`. Existing tools tagged `['retail', 'crm']` (`customer_lookup`, `open_pipeline`, …) stay visible on BASIC via `retail`. `crm_pipeline` is `crm` only.

---

## Branch helper

Add `resolveRequiredStoreId(ctx, requested?)` next to `resolveStoreId` in `tools/types.ts`.

- Requested id in `ctx.stores` → that id.
- Requested id missing from the list → current branch (`ctx.storeId` or the only store) plus a note; if no current branch → `{ error }`.
- Omitted, current branch in the list → that id.
- Omitted, exactly one store in `ctx.stores` → that id.
- Omitted, several stores and no current branch → `{ error: 'Daily report is per branch. Pass storeId from the branch list in the system prompt.' }`.

Never returns a missing `storeId` on success.

---

## Wiring

`ChatToolDepsFactory` (`apps/backend/src/ai/chat-tool-deps.factory.ts`): Nest injectable. Constructor takes every report service `ChatToolDeps` needs. `build(): ChatToolDeps`. `ChatService` injects the factory plus `db`, `ai`, `platformSettings`, `planEntitlements`, `timezones`, `authCache`. `this.deps` becomes `this.toolDeps.build()`.

`ChatToolDeps` gains, as they are added:

`dailyReport`, `cashierSessions`, `salesLineItems`, `purchaseLineItems`, `mushak`, `storefront`, `manufacturing`, `imports`, `crmLeads`, `crmCampaigns`, `crmFollowUps`.

`customers` already exists (Wave 1 `bad_debts` uses `listWriteOffs`).

Module exports to add:

- `DailyReportModule` → `DailyReportService`
- `SalesReportsModule` → also `SalesLineItemsService`
- `PurchaseReportsModule` → also `PurchaseLineItemsService`
- `ManufacturingModule` → `ManufacturingService`
- `StorefrontModule` → `StorefrontService`

Already exported: `CashierSessionsService`, `MushakService`, `ImportsService`, `CrmLeadsService`, `CrmCampaignsService`, `CrmFollowUpsService`, `CustomersService`.

`AiModule` imports those modules and provides `ChatToolDepsFactory`.

`chat.service.spec.ts` `makeService` constructs a stub factory. `chat-tools.spec.ts` `makeDeps` grows the stub object. `chat-data.service.spec.ts` `makeDb` adds `salesExchange` and `warrantyClaim` (`lead` is already there).

---

## Prompt, pages, routes, help

`buildSystemPrompt` CHOOSING TOOLS:

- Daily close / today’s branch snapshot → `daily_report` (always a branch).
- Open tills / till variance **today** → `cashier_sessions` (no date; it is today).
- Which invoices a product/customer figure came from → `sales_line_items` / `purchase_line_items`.
- Mushak 6.2 / VAT sales book totals → `mushak_summary`.
- Written-off customer debts → `bad_debts`.
- Online orders → `storefront_orders`.
- Production jobs / manufactured product P&L / manufacturing analytics → `manufacturing_summary`.
- Import shipments / LC expiry → `import_status`.
- Lead lists, campaigns, follow-ups → `crm_pipeline` (`open_pipeline` remains for committed-but-unfinished work).
- Replace “you cannot see line items” on the anomalies bullet with: do not eyeball outliers from line-item or document lists; `transaction_anomalies` has already compared against this business’s history.

New `APP_PAGES` (paths must exist under `apps/frontend/src/app/(app)`):

| Path | Label | Modules |
|---|---|---|
| `/sales/daily-report` | Daily Report | `retail` |
| `/sales/cashier-sessions` | Cashier Sessions | `retail` |
| `/sales/reports/mushak` | Mushak books | `retail` |
| `/sales/exchanges` | Sales Exchanges | `retail` |
| `/sales/warranty-claims` | Warranty Claims | `retail` |
| `/storefront` | Online Orders | `storefront` |
| `/manufacturing/jobs` | Production Jobs | `manufacturing` |
| `/manufacturing/product-pl` | Manufactured product P&L | `manufacturing` |
| `/manufacturing/analytics` | Manufacturing analytics | `manufacturing` |
| `/purchases/imports` | Import shipments | `imports` |
| `/purchases/imports/lc-register` | LC register | `imports` |
| `/crm/leads` | Leads | `crm` |
| `/crm/campaigns` | Campaigns | `crm` |
| `/crm/follow-ups` | Follow-ups | `crm` |

`/sales/reports/line-items`, `/purchases/reports/line-items`, `/sales/customers/reports/bad-debts` already exist.

`AiChatWidget` `TOOL_ROUTES` for every new tool name → the page above (`manufacturing_summary` → `/manufacturing/jobs`; `import_status` → `/purchases/imports`; `crm_pipeline` → `/crm/leads`).

Help: add FAQs to **existing** sections (do not add a section key — `help-content.spec.ts` only mirrors keys, but a new key forces nine locale catalogs). Backend `help-content.ts` plus all nine `apps/frontend/src/lib/localization/messages/*/help.ts`. Update the `aiAssistant` “what can it see” answer to name the new reports.

`packages/shared-types/index.ts` `AI_CHAT_TOOL_NAMES` is stale (original eight) and unused except as an export. Replace it with the live `CHAT_TOOLS` name list after each wave so the shared contract matches the server.

Eval: append questions to `apps/backend/test/fixtures/ai-chat-eval.md`. Do not run the live set in this work (still a separate TODO).

---

## Testing

Jest, existing files:

- `chat-tools.spec.ts` — registry (no tenant param, unique names), each new handler’s projection, caps, required-branch error, cashier has no date param, combined-tool `kind` dispatch.
- `chat-data.service.spec.ts` — lead resolve; exchange/claim list; tenant scope; add models to `makeDb`.
- `chat.service.spec.ts` — factory wiring; `accountingOnly` withholds storefront/imports/retail; `premiumCrm` gates `crm_pipeline`; BASIC still sees `customer_lookup`; `premiumManufacturing` still gates manufacturing.
- `help-content.spec.ts` — section keys still match; add one search hit for a new FAQ.

No new HTTP tests. No browser pass (no UI behaviour change beyond `TOOL_ROUTES` map entries).

---

## Key decisions

1. Wrap services, do not query Prisma from tools except `ChatDataService` for entity/document lookups (same as today).
2. Combine Wave 2 with `kind` enums (~10 tools, not ~20).
3. `ChatToolDepsFactory` first, then tools.
4. Daily report is per-branch; cashier overview is today-only; Mushak is totals + paged rows.
5. `crm` module requires `premiumCrm`; customer pages retagged `retail`+`crm`.
6. No `premiumImports`. Storefront and imports follow `!accountingOnly`.
7. Single permission per tool; REST set-OR is not copied.
8. One spec, one plan, Wave 1 tasks then Wave 2 so Wave 1 can ship first.
