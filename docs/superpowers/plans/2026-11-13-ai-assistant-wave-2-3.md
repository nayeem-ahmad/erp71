# Ask ERP71 Wave 2 leftovers & Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Ask ERP71 read-only tools for manufacturing BOMs, import duty, storefront pages/menu, CRM contacts, the approvals inbox, leave/attendance/recruitment, and statutory payroll registers, wrapping existing services.

**Architecture:** Keep the tool-calling menu. Extend three Wave 2 combined tools with new `kind` values. Add four tools (`storefront_content`, `approvals_inbox`, `hr_reports`, `hr_statutory`). Inject backing services through `ChatToolDepsFactory`. `CrmContactsModule` ↔ `AiModule` uses `forwardRef`.

**Tech Stack:** NestJS, existing domain services, Jest. Frontend change is `TOOL_ROUTES` plus Help Center FAQ copy in nine locales.

**Spec:** `docs/superpowers/specs/2026-11-13-ai-assistant-wave-2-3-design.md`

## Global Constraints

- Work on `feat/ai-assistant-wave-2-3` (isolated worktree from `origin/dev`). Author: Nayeem Ahmad `<nayeem.ahmad@gmail.com>`. Conventional commits; no Co-Authored-By.
- Do not stage unrelated dirty work on the primary `dev` checkout.
- `tenantId` is never a tool parameter. Wrap existing services. Project and cap rows (`MAX_TOOL_ROWS = 20`, `money()`, `nullableMoney()`, `isoDate()`, `page()`). No text-to-SQL. No writes. No new HTTP routes. No schema change.
- `ChatTool.permission` stays a single `StorePermission` (values in the spec table).
- Backend tests from `apps/backend`: `npx jest --config ./jest.config.js <file> --runInBand`.
- Help FAQs: same new questions in `apps/backend/src/ai/help-content.ts` and all nine `apps/frontend/src/lib/localization/messages/*/help.ts`. Do not add a Help section key.
- One `TODO.md` COMPLETED entry at feature ship.

## Review Focus

- `import_status` `kind: duty` calls `dutyReport` and no longer returns the old unknown-kind error. Test in Task 2.
- Leave-balance money columns come from `HrReportsService.leaveBalance` (null when `can_view_payroll` is false). The tool does not invent liability. Test in Task 5.
- `approvals_inbox` is withheld without `MANAGE_HR` even though REST is any-of four perms. Test in Task 4 (permission on the tool) and Task 6 (prompt).
- `CrmContactsModule` still loads when `AuthModule` is required first. Test in Task 1.
- `accountingOnly: true` withholds `storefront_content`. Test in Task 3 (module tag) and Task 6 if a resolveTools assertion is added.

Each of those has a test in the task that owns the code.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/ai/tools/types.ts` | `ChatToolDeps` new fields; `toTenantContext` |
| `apps/backend/src/ai/chat-tool-deps.factory.ts` | Inject new services |
| `apps/backend/src/ai/ai.module.ts` | Import domain modules |
| `apps/backend/src/ai/tools/operations.tools.ts` | Extended kinds + new tools |
| `apps/backend/src/ai/tools/meta.tools.ts` | `contact` entity type |
| `apps/backend/src/ai/chat-data.service.ts` | `contact` resolve |
| `apps/backend/src/ai/chat.service.ts` | CHOOSING TOOLS copy |
| `apps/backend/src/ai/app-navigation.ts` | New pages |
| `apps/backend/src/ai/help-content.ts` | FAQs |
| `apps/backend/src/approvals/approvals.module.ts` | Export `ApprovalsService` |
| `apps/backend/src/crm-contacts/crm-contacts.module.ts` | `forwardRef(() => AiModule)` |
| `apps/frontend/src/components/AiChatWidget.tsx` | `TOOL_ROUTES` |
| nine `help.ts` | Same FAQs |
| `packages/shared-types/index.ts` | `AI_CHAT_TOOL_NAMES` |
| `apps/backend/test/fixtures/ai-chat-eval.md` | New questions |
| `TODO.md` | One COMPLETED line at ship |

---

### Task 1: Wiring

**Files:**
- Modify: `apps/backend/src/ai/tools/types.ts`
- Modify: `apps/backend/src/ai/chat-tool-deps.factory.ts`
- Modify: `apps/backend/src/ai/ai.module.ts`
- Modify: `apps/backend/src/ai/ai.module.spec.ts`
- Modify: `apps/backend/src/approvals/approvals.module.ts`
- Modify: `apps/backend/src/crm-contacts/crm-contacts.module.ts`
- Modify: `apps/backend/src/ai/chat-tools.spec.ts` (`makeDeps`)
- Modify: `apps/backend/src/ai/chat.service.spec.ts` (stub factory if it typechecks)

**Interfaces:**
- Consumes: current `ChatToolDeps`.
- Produces:
  - `ChatToolDeps` fields `storefrontPages`, `crmContacts`, `approvals`, `hrReports`, `statutoryReports`, `recruitment`
  - `toTenantContext(ctx: ChatToolContext): TenantContext`
  - Factory constructor args for those six services
  - `ApprovalsModule` `exports: [ApprovalsService]`
  - `CrmContactsModule` `imports: [forwardRef(() => AiModule), …]`
  - `AiModule` imports listed in the spec

- [ ] **Step 1: Write the failing test**

In `ai.module.spec.ts`, add CrmContacts to the Auth-first loop (same shape as Storefront/Manufacturing/Imports). Assert every import of `CrmContactsModule` is defined after `jest.resetModules(); require('../auth/auth.module')`.

In `chat-tools.spec.ts`, a tiny unit around `toTenantContext` can wait until Task 5; this task’s red is the Auth-first assertion failing because CrmContacts is not yet deferred.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest --config ./jest.config.js src/ai/ai.module.spec.ts --runInBand`
Expected: FAIL — CrmContacts not in the Auth-first list, or AiModule import of CrmContacts is undefined.

- [ ] **Step 3: Implement wiring**

Add the six `ChatToolDeps` fields (type-only imports). Implement `toTenantContext`. Grow the factory. Import modules in `AiModule`. Export `ApprovalsService`. `forwardRef` on both sides of Ai ↔ CrmContacts. Grow `makeDeps` stubs (`listPages`/`listMenuLinks`, `findAll`, `inbox`, `leaveBalance`/`attendanceSummary`/`payrollCost`, `wagesRegister`/`taxDeductionStatement`/`providentFundRegister`, `summary`/`listApplications`; manufacturing `listBoms`; imports `dutyReport`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest --config ./jest.config.js src/ai/ai.module.spec.ts src/ai/chat-tools.spec.ts src/ai/chat.service.spec.ts --runInBand`
Expected: PASS (existing tests still green with larger stubs).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai/tools/types.ts apps/backend/src/ai/chat-tool-deps.factory.ts apps/backend/src/ai/ai.module.ts apps/backend/src/ai/ai.module.spec.ts apps/backend/src/approvals/approvals.module.ts apps/backend/src/crm-contacts/crm-contacts.module.ts apps/backend/src/ai/chat-tools.spec.ts apps/backend/src/ai/chat.service.spec.ts
git commit -m "feat(ai): wire Wave 2 leftover and Wave 3 report services"
```

---

### Task 2: BOMs and import duty

**Files:**
- Modify: `apps/backend/src/ai/tools/operations.tools.ts` (`manufacturing_summary`, `import_status`)
- Test: `apps/backend/src/ai/chat-tools.spec.ts`

**Interfaces:**
- Consumes: `deps.manufacturing.listBoms`, `deps.imports.dutyReport` from Task 1 stubs.
- Produces: `kind` enums include `boms` and `duty`.

- [ ] **Step 1: Write the failing tests**

- `manufacturing_summary` enum includes `boms`; `kind: 'boms'` calls `listBoms` only; rows are product/sku/outputQty/componentCount; 25 recipes cap at 20.
- `import_status` enum includes `duty`; replace the current `kind: 'duty'` unknown-kind test with a dispatch to `dutyReport`; keep totals; page lines; unknown kind `foo` still errors.
- `dutyReport` receives `storeId` from `resolveStoreId` and `includeUnpaid` only when the model passes true.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts -t "manufacturing_summary|import_status" --runInBand`
Expected: FAIL — enum still jobs|product_pl|analytics and shipments|lc_register; `kind: duty` still errors.

- [ ] **Step 3: Implement the two kinds** in `operations.tools.ts` per the spec projections.

- [ ] **Step 4: Run tests**

Run: `cd apps/backend && npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts -t "manufacturing_summary|import_status" --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ai): expose manufacturing BOMs and import duty on existing tools"
```

---

### Task 3: `storefront_content`

**Files:**
- Modify: `apps/backend/src/ai/tools/operations.tools.ts`
- Test: `apps/backend/src/ai/chat-tools.spec.ts`

**Interfaces:**
- Consumes: `deps.storefrontPages.listPages` / `listMenuLinks`
- Produces: tool `storefront_content`, permission `MANAGE_STOREFRONT_PAGES`, modules `['storefront']`, required `kind` `pages`|`menu`

- [ ] **Step 1: Write the failing tests** — permission, modules, required kind; `pages` projects slug/title/status and caps 20; `menu` projects label and page title; unknown kind errors without calling the service.

- [ ] **Step 2: Run** `chat-tools.spec.ts -t "storefront_content"` — FAIL name not in registry.

- [ ] **Step 3: Implement** the tool per the spec.

- [ ] **Step 4: Run** — PASS

- [ ] **Step 5: Commit** `feat(ai): read storefront pages and menu from the assistant`

---

### Task 4: Contacts and approvals inbox

**Files:**
- Modify: `apps/backend/src/ai/tools/operations.tools.ts` (`crm_pipeline`, `approvals_inbox`)
- Modify: `apps/backend/src/ai/tools/meta.tools.ts` (`ENTITY_TYPES`)
- Modify: `apps/backend/src/ai/chat-data.service.ts`
- Test: `apps/backend/src/ai/chat-tools.spec.ts`, `apps/backend/src/ai/chat-data.service.spec.ts`

**Interfaces:**
- Consumes: `deps.crmContacts.findAll`, `deps.approvals.inbox`, `toTenantContext`
- Produces: `crm_pipeline` kind `contacts`; `resolve_entity` type `contact`; tool `approvals_inbox` permission `MANAGE_HR` modules `['hr']`

- [ ] **Step 1: Write the failing tests**

- `crm_pipeline` enum includes `contacts`; `findAll` called with tenant, timezone, limit ≤ 20; rows are name/company/mobile/email (no Prisma include dump).
- `resolve_entity` type `contact` is in the enum; `ChatDataService` matches name/mobile/email, scopes `tenant_id`, `detail` is mobile or email; `makeDb` gains `crmContact`; tenant-scope loop includes `'contact'`.
- `approvals_inbox` permission `MANAGE_HR`; calls `inbox` with `toTenantContext` fields; keeps `total`/`counts`; pages items; omits `details`; amounts through `nullableMoney`.

- [ ] **Step 2: Run** `chat-tools.spec.ts -t "crm_pipeline|approvals_inbox|resolve_entity"` and `chat-data.service.spec.ts` — FAIL.

- [ ] **Step 3: Implement** per the spec.

- [ ] **Step 4: Run** those files — PASS

- [ ] **Step 5: Commit** `feat(ai): resolve CRM contacts and list the approvals inbox`

---

### Task 5: HR reports and statutory registers

**Files:**
- Modify: `apps/backend/src/ai/tools/operations.tools.ts`
- Test: `apps/backend/src/ai/chat-tools.spec.ts`

**Interfaces:**
- Consumes: `deps.hrReports`, `deps.statutoryReports`, `deps.recruitment`, `toTenantContext`, `zonedDateString`
- Produces: `hr_reports` (`VIEW_HR`) kinds `leave_balance`|`attendance`|`recruitment`; `hr_statutory` (`VIEW_PAYROLL`) kinds `wages`|`tax`|`pf`|`payroll_cost`

- [ ] **Step 1: Write the failing tests**

- Permissions and required `kind`.
- `leave_balance` calls `leaveBalance` with `{ year }` (default shop-zone year when omitted) and a tenant context whose `userId`/`userRole` match `ctx`; keeps `summary` and `can_view_payroll`; `liability` stays null when the service returned null; 25 rows cap at 20.
- `attendance` / `payroll_cost` pass current shop-zone month as both ends of the range when omitted.
- `recruitment` always includes `summary` and pages applications (applicant name, job title, stage).
- `wages` uses current month when omitted; money on gross/net.
- `tax` / `pf` default `startYear`: for a shop-zone date in January 2027, startYear is 2026; in August 2026, startYear is 2026.
- Unknown kind errors without calling a service.

Pin timezone `Asia/Dhaka` (already the spec `ctx`).

- [ ] **Step 2: Run** `chat-tools.spec.ts -t "hr_reports|hr_statutory"` — FAIL.

- [ ] **Step 3: Implement** both tools per the spec.

- [ ] **Step 4: Run** — PASS

- [ ] **Step 5: Commit** `feat(ai): wrap HR leave, recruitment, and statutory payroll reports`

---

### Task 6: Prompt, pages, help, eval, catalog

**Files:**
- Modify: `apps/backend/src/ai/chat.service.ts` (CHOOSING TOOLS)
- Modify: `apps/backend/src/ai/app-navigation.ts`
- Modify: `apps/backend/src/ai/help-content.ts`
- Modify: `apps/backend/src/ai/help-content.spec.ts`
- Modify: `apps/frontend/src/components/AiChatWidget.tsx`
- Modify: nine `apps/frontend/src/lib/localization/messages/*/help.ts`
- Modify: `packages/shared-types/index.ts` (`AI_CHAT_TOOL_NAMES`)
- Modify: `apps/backend/test/fixtures/ai-chat-eval.md`
- Modify: `TODO.md`

**Interfaces:**
- Consumes: tool names from Tasks 3–5.
- Produces: prompt bullets, APP_PAGES, TOOL_ROUTES, FAQs, eval rows, COMPLETED bullet.

- [ ] **Step 1: Write the failing tests**

- `help-content.spec.ts`: search `leave balance` / `wages register` hits the new HR FAQ; navigation with `hr`+`storefront`+`imports`+`manufacturing` contains `/hr/recruitment/applications`, `/storefront/pages`, `/purchases/imports/duty-report`, `/manufacturing`.
- Optional: `chat.service.spec.ts` that `accountingOnly` withholds `storefront_content` (it is tagged `storefront`).

- [ ] **Step 2: Run** `help-content.spec.ts` — FAIL missing paths/FAQ.

- [ ] **Step 3: Implement** prompt, pages, routes, help (all nine locales, same new FAQ indices), eval questions (BOMs, duty, pages, contact lookup, approvals, leave, wages, tax, recruitment), `AI_CHAT_TOOL_NAMES` (`storefront_content`, `approvals_inbox`, `hr_reports`, `hr_statutory`), TODO COMPLETED.

- [ ] **Step 4: Run** `help-content.spec.ts` and the frontend localization catalog if one exists (`apps/frontend` jest on help or catalog). Expected PASS.

- [ ] **Step 5: Commit** `feat(ai): document Wave 2 leftover and Wave 3 assistant coverage`

---

## Self-review

Spec coverage: leftover BOMs, duty, pages/menu, contacts, approvals; skip lead-gen writes and platform blog; Wave 3 leave/attendance/recruitment + wages/tax/PF/payroll-cost; wiring/cycles; prompt/pages/help/eval. Non-goals remain out.

Type consistency: `toTenantContext`, dep field names, kind strings match across tasks.
