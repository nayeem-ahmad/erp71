# Ask ERP71 — Wave 2 leftovers & Wave 3 HR depth

**Date:** 2026-11-13
**Status:** Draft
**Asked as:** original gap-analysis Wave 2 leftovers plus Wave 3 HR depth. Wrap existing services. No text-to-SQL. No writes.

Wave numbering is the original gap-analysis waves (Wave 1+2 retail ops and paid modules already live). This is not the later “Wave 3 writes / Wave 4 SQL / Wave 5 router” numbering.

---

## Problem

Ask ERP71 already reads storefront orders, manufacturing jobs/P&L/analytics, import shipments/LCs, and CRM leads/campaigns/follow-ups. The original Wave 2 leftover list and Wave 3 HR reports are still dark: BOMs, import duty, storefront pages/menu, CRM contacts, the approvals inbox, leave balance, wages/tax/PF, and recruitment.

The model either links out or invents an empty report.

## Goals

- Wave 2 leftovers: BOMs, import duty, storefront pages and menu, CRM contacts as entities, approvals inbox (read-only).
- Wave 3: leave balance (and attendance), wages register, tax and PF, payroll cost, recruitment pipeline.
- Every new or extended tool wraps an existing domain service. Numbers match the page. `tenantId` is never a tool parameter.

## Non-goals

- Lead-generation `search` / `importCandidates` — those write leads and spend AI credits.
- Tenant storefront blog — the blog is platform-admin (`admin/blog`), not a shop.
- Expanding `ChatTool.permission` from a single `StorePermission` to any-of arrays.
- Writes, text-to-SQL, two-stage router, live eval against a real model.
- Wave 4 accounting extras (loans, investors, fixed assets, bank rec, fund transfers).
- Wave 5 work management (projects/tasks, support tickets, expense-claim writes).
- Historical cashier tills. GP exception reports. Warehouse transfers / stock takes as documents.

---

## Tools

### Extend existing combined tools

| Name | Add `kind` | Permission | Modules | Wraps |
|---|---|---|---|---|
| `manufacturing_summary` | `boms` | `EDIT_PRODUCTS` | `manufacturing` | `ManufacturingService.listBoms` |
| `import_status` | `duty` | `VIEW_IMPORTS` | `imports` | `ImportsService.dutyReport` |
| `crm_pipeline` | `contacts` | `VIEW_LEADS` | `crm` | `CrmContactsService.findAll` |

`resolve_entity` `type` enum adds `contact`. Match `CrmContact.name` / `mobile` / `email`. `detail` is mobile or email. No `deleted_at` on `CrmContact`.

### New tools

| Name | File | Permission | Modules | `kind` | Wraps |
|---|---|---|---|---|---|
| `storefront_content` | `operations.tools.ts` | `MANAGE_STOREFRONT_PAGES` | `storefront` | `pages` \| `menu` | `StorefrontPagesService.listPages` / `listMenuLinks` |
| `approvals_inbox` | `operations.tools.ts` | `MANAGE_HR` | `hr` | — | `ApprovalsService.inbox` |
| `hr_reports` | `operations.tools.ts` | `VIEW_HR` | `hr` | `leave_balance` \| `attendance` \| `recruitment` | `HrReportsService.leaveBalance` / `attendanceSummary`; `RecruitmentService.summary` + `listApplications` |
| `hr_statutory` | `operations.tools.ts` | `VIEW_PAYROLL` | `hr` | `wages` \| `tax` \| `pf` \| `payroll_cost` | `StatutoryReportsService.wagesRegister` / `taxDeductionStatement` / `providentFundRegister`; `HrReportsService.payrollCost` |

Two HR tools because `ChatTool.permission` is a single `StorePermission`. Leave days and recruitment are `VIEW_HR`; wages/tax/PF/payroll-cost are `VIEW_PAYROLL`. Leave-balance money columns stay inside `HrReportsService.leaveBalance` (`canViewPayroll`); the tool does not synthesise liability.

`kind` is required on every combined tool.

### Approvals compromise

REST inbox is any-of `MANAGE_HR | APPROVE_PRODUCT_DEMAND | APPROVE_GOODS_TRANSFER | APPROVE_VOUCHER`. The tool is gated `MANAGE_HR`. The service still scopes items to kinds the caller may decide, so an owner sees every kind and an HR manager sees leave/expense claims. Voucher/transfer/demand-only approvers keep using `/crm/approvals-inbox`.

### Contacts permission

REST contacts list is any-of `CRM_STAFF` (includes `VIEW_LEADS`). The tool stays on `crm_pipeline` (`VIEW_LEADS`) so BASIC-without-CRM still cannot see it (`crm` module requires `premiumCrm`).

---

## Parameters and projection

Shared: `tenantId` never a parameter. `MAX_TOOL_ROWS = 20`. Money through `money()` / `nullableMoney()`. Dates through `isoDate()`. Rows through `page()` unless the domain service already paginates — then pass `limit: MAX_TOOL_ROWS` and echo `total`.

`toTenantContext(ctx)` maps `ChatToolContext` → `TenantContext` (`tenantId`, `storeId`, `userId`, `userRole`, `timezone`) for `leaveBalance` and `inbox`.

Omitted calendar defaults use `zonedDateString(new Date(), ctx.timezone)` (`YYYY-MM-DD` in the shop zone).

### `manufacturing_summary` `boms`

`listBoms(tenantId, page, limit)`. Project: product name/sku, outputQty, componentCount, notes.

### `import_status` `duty`

Parameters: `from`, `to`, `includeUnpaid` (boolean, default false), `storeId`, paging. `dutyReport(tenantId, { from, to, includeUnpaid, storeId })`. Keep `totals_by_type`, `total_bdt`, `recoverable_bdt`, `unpaid_bdt`. Page `lines` to shipment_reference, be_number, cost_type, amount_bdt (`money`), is_paid, paid_at.

### `crm_pipeline` `contacts`

`findAll(tenantId, { search, page, limit, timezone })`. Project: name, company, designation, mobile, email.

### `resolve_entity` `contact`

Same shape as `lead`. `ChatDataService` Prisma read (entity lookup has no canonical report).

### `storefront_content`

- `pages`: `listPages`; project slug, title, status, published_at, updated_at.
- `menu`: `listMenuLinks`; project label, href or page title/slug, page status, sort_order.

### `approvals_inbox`

No parameters besides paging. `inbox(toTenantContext(ctx))`. Keep `total`, `counts`, `kinds`. Page `items` to kind, title, amount (`nullableMoney`), requested_by, requested_at (ISO), branch. Omit `details`.

### `hr_reports`

- `leave_balance`: `year` (omit = shop-zone year). `leaveBalance(toTenantContext(ctx), { year })`. Keep `summary` and `can_view_payroll`. Page rows: employeeName, employeeCode, leaveTypeName, entitledDays, usedDays, remainingDays, liability (`nullableMoney`).
- `attendance`: `fromYear`/`fromMonth`/`toYear`/`toMonth` (omit = current shop-zone month for both ends). Keep `summary`. Page rows: label, presentDays, absentDays, leaveDays, attendanceRate.
- `recruitment`: always include `summary()`. Page `listApplications` to applicant name, job title/code, stage. Optional `stage` filter.

### `hr_statutory`

- `wages`: `year`, `month` (omit = current shop-zone month). Keep `totals`. Page rows: employee_name, employee_code, gross_earnings, total_deductions, net_pay (`money`).
- `tax`: `startYear` (omit = income year opening in July of the shop-zone date: month ≥ 7 → this year, else previous). Keep `totals`, `fiscal_year`, `notes`. Page rows: employee name/code, gross_earnings, tax_deducted.
- `pf`: same `startYear` rule. Keep `grand_total`, `fiscal_year`, `notes`. Page rows: employee name/code, total_employee_contribution.
- `payroll_cost`: same month-range defaults as attendance. Keep `summary`. Page rows: label, employees, netPay, share.

Unknown `kind` → `{ error }` without calling a service.

---

## Wiring

`ChatToolDeps` / `ChatToolDepsFactory` gain: `storefrontPages`, `crmContacts`, `approvals`, `hrReports`, `statutoryReports`, `recruitment`. `manufacturing` already has `listBoms`; `imports` already has `dutyReport`.

`AiModule` imports: `StorefrontPagesModule`, `HrReportsModule`, `PayrollModule`, `RecruitmentModule`, `ApprovalsModule`, `forwardRef(() => CrmContactsModule)`.

`CrmContactsModule` already imports `AiModule` (business-card scan). Change that import to `forwardRef(() => AiModule)` so the cycle does not bake `AiModule` as undefined.

`ApprovalsModule` currently does not export `ApprovalsService` — export it.

`toTenantContext` lives next to `resolveStoreId` in `tools/types.ts`.

Extend the Auth-first load-order test in `ai.module.spec.ts` so `CrmContactsModule` imports stay defined when `AuthModule` loads first.

---

## Prompt, pages, routes, help

`buildSystemPrompt` CHOOSING TOOLS:

- Production jobs / P&L / analytics **or BOMs** → `manufacturing_summary` (`kind` includes `boms`).
- Import shipments / LC expiry **or duty** → `import_status` (`kind` includes `duty`). Drop “Duty figures are not in that tool.”
- Storefront pages or menu → `storefront_content`.
- CRM contacts → `crm_pipeline` `contacts`; resolve a contact by name via `resolve_entity`.
- Approvals waiting on the caller → `approvals_inbox` (read-only).
- Leave balance / attendance / hiring pipeline → `hr_reports`.
- Wages register / tax / PF / payroll cost → `hr_statutory`.

New `APP_PAGES` (paths exist under `apps/frontend/src/app/(app)`):

| Path | Label | Modules |
|---|---|---|
| `/manufacturing` | Bills of materials | `manufacturing` |
| `/purchases/imports/duty-report` | Import duty report | `imports` |
| `/storefront/pages` | Storefront pages | `storefront` |
| `/storefront/menu` | Storefront menu | `storefront` |
| `/crm/approvals-inbox` | Approvals inbox | `hr` |
| `/hr/recruitment/applications` | Recruitment applications | `hr` |
| `/hr/recruitment/job-posts` | Job posts | `hr` |

HR report pages already exist. Contacts already exist under `crm`.

`AiChatWidget` `TOOL_ROUTES`: `storefront_content` → `/storefront/pages`; `approvals_inbox` → `/crm/approvals-inbox`; `hr_reports` → `/hr/reports/leave-balance`; `hr_statutory` → `/hr/reports/wages-register`. Existing combined tools keep their current default page.

Help: add FAQs to existing sections (no new section key). Update the `aiAssistant` “what can it see” answer. Mirror in `help-content.ts` and all nine `help.ts` catalogs (same FAQ indices; English copy is fine in every locale, matching Wave 1+2).

`AI_CHAT_TOOL_NAMES` gains the three new names.

Eval: append Wave 2 leftover + Wave 3 questions to `ai-chat-eval.md`. Do not run the live set.

---

## Testing

- `chat-tools.spec.ts` — new kinds and tools: dispatch, projection, caps, unknown-kind `{ error }`. Replace the current `import_status` test that treats `kind: 'duty'` as unknown.
- `chat-data.service.spec.ts` — `contact` resolve, tenant scope, add `crmContact` to `makeDb`.
- `chat.service.spec.ts` — factory stub grows; `accountingOnly` withholds `storefront_content`; `premiumCrm` gates contacts via `crm_pipeline`; manufacturing still needs `premiumManufacturing` for `boms`.
- `ai.module.spec.ts` — CrmContacts Auth-first load.
- `help-content.spec.ts` — one search hit for a new FAQ; Wave 3 pages in navigation.

No new HTTP. No schema. No browser pass beyond `TOOL_ROUTES` map entries (no UI behaviour change).
