# Ask ERP71 Wave 1 & 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Ask ERP71 read-only tools for Daily Report, cashier sessions, line items, Mushak 6.2, bad debts, exchanges, warranty claims, and lead lookup (Wave 1), then storefront orders, manufacturing, imports, and CRM pipeline (Wave 2), wrapping existing services.

**Architecture:** Keep the tool-calling menu. Introduce `ChatToolDepsFactory` so `ChatService` does not grow ~11 constructor args. New tools live in the existing `apps/backend/src/ai/tools/*.ts` files. Wave 2 tools use a required `kind` enum. `resolveModules` adds `storefront`/`imports` for every non-accounting plan and gates `crm` on `premiumCrm`.

**Tech Stack:** NestJS, existing domain services, Jest. Frontend change is `TOOL_ROUTES` plus Help Center FAQ copy in nine locales.

**Spec:** `docs/superpowers/specs/2026-11-11-ai-assistant-wave-1-2-design.md`

## Global Constraints

- Work on `dev`. `.githooks/` blocks commits on `main`. Author: Nayeem Ahmad `<nayeem.ahmad@gmail.com>`. Conventional commits; no Co-Authored-By.
- Do not stage unrelated dirty work (staffing matrix, skills, `.vscode/settings.json`, `.gitignore` `.worktrees/` line).
- `tenantId` is never a tool parameter. `chat-tools.spec.ts` already asserts this for every tool.
- Wrap existing services. Project and cap rows (`MAX_TOOL_ROWS = 20`, `money()`, `isoDate()`, `page()`). No text-to-SQL. No writes. No new HTTP routes. No schema change.
- `ChatTool.permission` stays a single `StorePermission` (values in the spec table).
- Backend tests from `apps/backend`: `npx jest --config ./jest.config.js <file> --runInBand`.
- Help FAQs: same new questions in `apps/backend/src/ai/help-content.ts` and all nine `apps/frontend/src/lib/localization/messages/*/help.ts`. Do not add a Help section key.
- One `TODO.md` COMPLETED entry at feature ship (end of Wave 2, or end of Wave 1 if shipping Wave 1 alone).
- Wave 1 (Tasks 1–7) is shippable without Wave 2.

## Review Focus

- An owner with two branches who omits `storeId` on `daily_report` gets `{ error }` asking for a branch, never an all-branches report. Test in Task 4.
- `cashier_sessions` parameters have no `date`; a closed-yesterday till is absent from `closed_today`. Test in Task 4.
- `accountingOnly: true` withholds `storefront_orders`, `import_status`, and every `retail` tool. Test in Task 2 (modules) and Task 8/10 (tool tags).
- A BASIC tenant (`premiumCrm` absent) still receives `customer_lookup` and customer `APP_PAGES`; `crm_pipeline` is absent. Test in Task 2 and Task 11.
- A future `daily_report` date surfaces as a tool `{ error }` containing “future”, not a payload. Test in Task 4 (handler lets `getReport` throw).

Each of those has a test in the task that owns the code.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/ai/chat-tool-deps.factory.ts` | Nest factory; `build(): ChatToolDeps` |
| `apps/backend/src/ai/tools/types.ts` | `ChatToolModule`, `ChatToolDeps`, `resolveRequiredStoreId` |
| `apps/backend/src/ai/chat.service.ts` | Inject factory; `resolveModules`; CHOOSING TOOLS copy |
| `apps/backend/src/ai/ai.module.ts` | Import domain modules; provide factory |
| `apps/backend/src/ai/tools/{sales,purchasing,finance,parties,operations,meta}.tools.ts` | New / extended tools |
| `apps/backend/src/ai/chat-data.service.ts` | `lead` entity; exchange/claim documents; `tenantName` |
| `apps/backend/src/ai/app-navigation.ts` | New pages; retag customer pages |
| `apps/backend/src/ai/help-content.ts` | FAQs in existing sections |
| Domain `*.module.ts` listed in Task 1 / Wave 2 tasks | Export the services the factory injects |
| `apps/frontend/src/components/AiChatWidget.tsx` | `TOOL_ROUTES` |
| nine `help.ts` | Same FAQs |
| `packages/shared-types/index.ts` | `AI_CHAT_TOOL_NAMES` live list |
| `apps/backend/test/fixtures/ai-chat-eval.md` | New questions |
| `TODO.md` | One COMPLETED line at ship |

---

### Task 1: `ChatToolDepsFactory`

**Files:**
- Create: `apps/backend/src/ai/chat-tool-deps.factory.ts`
- Modify: `apps/backend/src/ai/chat.service.ts` (constructor + `deps` getter)
- Modify: `apps/backend/src/ai/ai.module.ts` (provider)
- Modify: `apps/backend/src/ai/chat.service.spec.ts` (`makeService`)

**Interfaces:**
- Consumes: current `ChatToolDeps` fields in `tools/types.ts` (salesReports … anomalies, web).
- Produces:
  - `@Injectable() class ChatToolDepsFactory { constructor(/* current report services */); build(): ChatToolDeps }`
  - `ChatService` constructor: `(db, ai, platformSettings, planEntitlements, toolDeps: ChatToolDepsFactory, timezones, authCache)`
  - `private get deps(): ChatToolDeps { return this.toolDeps.build(); }`

Do not add Wave 1/2 services yet.

- [ ] **Step 1: Write the failing test**

In `chat.service.spec.ts`, change `makeService` so `new ChatService(...)` takes a stub factory:

```ts
const toolDeps = { build: () => ({
    salesReports, inventoryReports: {} as any, purchaseReports: {} as any,
    customers: {} as any, suppliers: {} as any, expenses: {} as any,
    accounting: {} as any, data: chatData, web: webSearch, anomalies,
}) };
const service = new ChatService(db, ai, platformSettings, planEntitlements, toolDeps as any, timezones, authCache);
```

Keep the existing `resolveTools` OWNER-length assertion. It fails until the constructor matches.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx jest --config ./jest.config.js src/ai/chat.service.spec.ts --runInBand`
Expected: FAIL compiling `new ChatService` (wrong arity) or the first test.

- [ ] **Step 3: Implement the factory and slim `ChatService`**

Move the ten report/data/web/anomaly injections into `ChatToolDepsFactory`. `AiModule.providers` includes the factory. Existing `ChatService.resolveTools` behaviour is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config ./jest.config.js src/ai/chat.service.spec.ts src/ai/chat-tools.spec.ts --runInBand`
Expected: PASS (existing counts still hold).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai/chat-tool-deps.factory.ts apps/backend/src/ai/chat.service.ts apps/backend/src/ai/ai.module.ts apps/backend/src/ai/chat.service.spec.ts
git commit -m "$(cat <<'EOF'
refactor(ai): inject chat tool deps through a factory

ChatService keeps auth, billing, and the agent loop. Report services
move to ChatToolDepsFactory so Wave 1/2 tools do not grow its constructor.
EOF
)"
```

---

### Task 2: Module gating

**Files:**
- Modify: `apps/backend/src/ai/tools/types.ts` (`ChatToolModule`)
- Modify: `apps/backend/src/ai/chat.service.ts` (`resolveModules`)
- Modify: `apps/backend/src/ai/app-navigation.ts` (retag four customer pages)
- Test: `apps/backend/src/ai/chat.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 factory (unchanged).
- Produces:
  - `ChatToolModule = 'retail' | 'inventory' | 'accounting' | 'crm' | 'hr' | 'manufacturing' | 'storefront' | 'imports'`
  - `resolveModules`: `!accountingOnly` → add `retail`, `inventory`, `hr`, `storefront`, `imports`. Add `crm` only if `hasPlanEntitlement(features, 'premiumCrm')`. `premiumManufacturing` unchanged.
  - Those four `APP_PAGES` use `modules: ['retail', 'crm']`.

- [ ] **Step 1: Write the failing tests**

Append to `chat.service.spec.ts`:

```ts
it('withholds crm-only tools when premiumCrm is off', async () => {
    const { service } = makeService({ planFeatures: {} });
    const { modules } = await service.resolveTools(OWNER_CTX);
    expect(modules.has('crm')).toBe(false);
    expect(modules.has('storefront')).toBe(true);
    expect(modules.has('imports')).toBe(true);
});

it('adds crm when premiumCrm is on', async () => {
    const { service } = makeService({ planFeatures: { premiumCrm: true } });
    expect((await service.resolveTools(OWNER_CTX)).modules.has('crm')).toBe(true);
});

it('withholds storefront and imports from an accounting-only tenant', async () => {
    const { service } = makeService({ planFeatures: { accountingOnly: true } });
    const { modules } = await service.resolveTools(OWNER_CTX);
    expect(modules.has('storefront')).toBe(false);
    expect(modules.has('imports')).toBe(false);
    expect(modules.has('retail')).toBe(false);
});
```

Keep the existing test that `customer_lookup` remains available on a default (non-accounting) plan — it is tagged `retail`+`crm`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat.service.spec.ts --runInBand`
Expected: FAIL — `crm` still always on; `storefront`/`imports` unknown.

- [ ] **Step 3: Implement `resolveModules` and retag customer pages**

Exact membership is in the spec “Module gating” section.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config ./jest.config.js src/ai/chat.service.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai/tools/types.ts apps/backend/src/ai/chat.service.ts apps/backend/src/ai/app-navigation.ts apps/backend/src/ai/chat.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(ai): gate crm on premiumCrm; add storefront and imports modules

BASIC still sees customer_lookup via retail. Customer APP_PAGES are
tagged retail+crm so deep-links survive the crm gate.
EOF
)"
```

---

### Task 3: `resolve_entity` lead + `list_documents` exchange/claim

**Files:**
- Modify: `apps/backend/src/ai/chat-data.service.ts` (`EntityType`, `DocumentType`, `resolveEntity`, `listDocuments`, `tenantName`)
- Modify: `apps/backend/src/ai/tools/meta.tools.ts` (`ENTITY_TYPES`, `DOCUMENT_TYPES`)
- Modify: `apps/backend/src/ai/chat-data.service.spec.ts` (`makeDb` + cases)
- Modify: `apps/backend/src/ai/chat-tools.spec.ts` (enum smoke if any)

**Interfaces:**
- Consumes: Prisma `lead`, `salesExchange`, `warrantyClaim`.
- Produces:
  - `tenantName(tenantId: string): Promise<string>`
  - `EntityType` includes `'lead'`
  - `DocumentType` includes `'sales_exchange' | 'warranty_claim'`
  - Exchange: `number` = `exchange_number`, `amount` = `Number(difference)`, `party` = sale.customer.name, `branch` = store.name, `status`
  - Claim: `number` = `claim_number`, `party` = customer.name, `branch` = store.name, `status`, `detail` = `${product.name} · ${serial_number}`
  - Lead resolve: `OR` on `name` / `mobile` / `email` contains; `label` = name; `detail` = mobile ?? email

- [ ] **Step 1: Write the failing tests**

`chat-data.service.spec.ts`:

- Extend `makeDb()` with `salesExchange` and `warrantyClaim`.
- Add `'lead'` to the tenant-scope entity loop; expect `db.lead.findMany` called with `tenant_id: TENANT`.
- `resolveEntity(TENANT, 'lead', 'Rahim')` maps `{ id, name: 'Rahim', mobile: '0171', email: null }` → `{ id, label: 'Rahim', detail: '0171' }`.
- Add `'sales_exchange'` and `'warranty_claim'` to the document tenant-scope loop; expect those models’ `findMany` scoped.
- One normalisation test per new document type using the spec field names.
- `tenantName('tenant-1')` returns `'Karim Electronics'` when `db.tenant.findUnique` resolves `{ name: 'Karim Electronics' }`, and `''` when it resolves `null`.

`meta.tools.ts` enums must include the new strings or `list_documents` / `resolve_entity` will reject them at the schema.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat-data.service.spec.ts --runInBand`
Expected: FAIL — type not assignable / switch falls through.

- [ ] **Step 3: Implement the cases and `tenantName`**

`tenantName`: `findUnique` on `tenant`, return `name ?? ''`. Search filters match existing `list_documents` (`contains` + `mode: 'insensitive'` on the number column). Date window uses the same `buildWindow` helper as other documents (`created_at`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config ./jest.config.js src/ai/chat-data.service.spec.ts src/ai/chat-tools.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai/chat-data.service.ts apps/backend/src/ai/chat-data.service.spec.ts apps/backend/src/ai/tools/meta.tools.ts apps/backend/src/ai/chat-tools.spec.ts
git commit -m "$(cat <<'EOF'
feat(ai): resolve leads and list exchanges and warranty claims

list_documents and resolve_entity cover the two document families
and the lead name the CRM tools will filter by.
EOF
)"
```

---

### Task 4: `daily_report` + `cashier_sessions`

**Files:**
- Modify: `apps/backend/src/ai/tools/types.ts` (`resolveRequiredStoreId`, `ChatToolDeps`)
- Modify: `apps/backend/src/ai/tools/operations.tools.ts`
- Modify: `apps/backend/src/ai/chat-tool-deps.factory.ts`
- Modify: `apps/backend/src/ai/ai.module.ts` (import `DailyReportModule`, `CashierSessionsModule`)
- Modify: `apps/backend/src/daily-report/daily-report.module.ts` (`exports: [DailyReportService]`)
- Modify: `apps/backend/src/ai/chat-tools.spec.ts` (`makeDeps` + handler tests)
- Modify: `apps/backend/src/ai/chat-data.service.spec.ts` if `tenantName` tests live there

**Interfaces:**
- Consumes: Task 1 factory; Task 3 `tenantName`; spec parameter/projection tables.
- Produces:
  - `resolveRequiredStoreId(ctx: ChatToolContext, requested?: string): { storeId: string; note?: string } | { error: string }`
  - Tools `daily_report`, `cashier_sessions` as specified
  - `ChatToolDeps.dailyReport`, `ChatToolDeps.cashierSessions`

- [ ] **Step 1: Write the failing tests**

`chat-tools.spec.ts` — import `resolveRequiredStoreId` from `./tools/types` (re-exported via `chat-tools.ts` if that is the local pattern; otherwise import from `./tools/types`).

`resolveRequiredStoreId`:

- Owner, `requested: 'store-1'` → `{ storeId: 'store-1' }`.
- Owner, two stores, no request, no `ctx.storeId` → `{ error }` matching `/per branch/`.
- Staff, omitted request, `ctx.storeId = 'store-1'` → `{ storeId: 'store-1' }`.
- Unknown `requested` with a current branch → `{ storeId: current, note }` containing the unknown id.

`daily_report`:

- `makeDeps` stub `dailyReport.getReport` resolving a fixture with `headlines`, `sales`, `whatsappText: 'SECRET'`, `stock.reorder: [{ name: 'X' }]`.
- Stub `data.tenantName` → `'Karim Electronics'`.
- `run('daily_report', { date: '2026-07-01', storeId: 'store-1' }, deps)` → `getReport` called with `storeId: 'store-1'`, `tenantName: 'Karim Electronics'`, `storeName: 'Gulshan'`, `locale: 'en'`.
- Result has `headlines` and no `whatsappText` and no `stock.reorder`.
- Omitted store on owner ctx without `storeId` → `{ error }` and `getReport` not called.
- `getReport` rejecting `new BadRequestException('Date cannot be in the future')` → handler rejects with that message (do not catch).

`cashier_sessions`:

- Schema properties do not include `date`.
- Stub `getOverview` returning one open and one closed_today row; result `totals.open_count === 1`; row cashier is the name string; amounts passed through `money()`.
- `getOverview` called with `(tenant-1, 'store-1', 'Asia/Dhaka')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts --runInBand`
Expected: FAIL — tools missing.

- [ ] **Step 3: Implement helper, tools, exports, factory fields**

`daily_report` description must say it is per-branch and that a missing branch id is an error. `cashier_sessions` description must say it is **today only** (open + closed today).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts src/ai/chat.service.spec.ts src/ai/chat-data.service.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai/tools/types.ts apps/backend/src/ai/tools/operations.tools.ts apps/backend/src/ai/chat-tool-deps.factory.ts apps/backend/src/ai/ai.module.ts apps/backend/src/daily-report/daily-report.module.ts apps/backend/src/ai/chat-tools.spec.ts
git commit -m "$(cat <<'EOF'
feat(ai): daily report and today-only cashier session tools

Daily report refuses all-branches. Cashier overview wraps getOverview
and does not take a date.
EOF
)"
```

---

### Task 5: `sales_line_items` + `purchase_line_items`

**Files:**
- Modify: `apps/backend/src/ai/tools/types.ts` (`ChatToolDeps`)
- Modify: `apps/backend/src/ai/tools/sales.tools.ts`
- Modify: `apps/backend/src/ai/tools/purchasing.tools.ts`
- Modify: `apps/backend/src/ai/chat-tool-deps.factory.ts`
- Modify: `apps/backend/src/sales-reports/sales-reports.module.ts` (export `SalesLineItemsService`)
- Modify: `apps/backend/src/purchase-reports/purchase-reports.module.ts` (export `PurchaseLineItemsService`)
- Modify: `apps/backend/src/ai/ai.module.ts` (modules already imported; factory gains the two services)
- Modify: `apps/backend/src/ai/chat-tools.spec.ts`

**Interfaces:**
- Consumes: `getSalesLineItems` / `getPurchaseLineItems` return `{ summary, rows, pagination }`.
- Produces: tools named in the spec; `ChatToolDeps.salesLineItems`, `purchaseLineItems`.

- [ ] **Step 1: Write the failing tests**

`sales_line_items`: stub returns `summary: { lineCount: 2, invoiceCount: 1, quantity: 5, amount: 100.126, returnedQuantity: 1, returnedAmount: 10 }` and one Prisma-shaped row. Assert `amount === 100.13`, row has `invoiceNumber` / product name / no nested `sale` object, and the service was called with `tenant-1` and `from`/`to` plus `limit` ≤ 20.

`purchase_line_items`: same shape with `supplier` instead of `customer`.

Both tools: `permission === VIEW_FINANCIAL_REPORTS`; `from`/`to` required.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts --runInBand`
Expected: FAIL — tools missing.

- [ ] **Step 3: Implement tools and module exports**

Pass `storeId` from `resolveStoreId`. Pass `productId` / `customerId` / `supplierId` / `search` through when present. Do not re-`page()` service-paginated rows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai/tools/types.ts apps/backend/src/ai/tools/sales.tools.ts apps/backend/src/ai/tools/purchasing.tools.ts apps/backend/src/ai/chat-tool-deps.factory.ts apps/backend/src/ai/ai.module.ts apps/backend/src/sales-reports/sales-reports.module.ts apps/backend/src/purchase-reports/purchase-reports.module.ts apps/backend/src/ai/chat-tools.spec.ts
git commit -m "$(cat <<'EOF'
feat(ai): sales and purchase line-item tools

Wrap the existing line-item report services so the assistant can
name the invoices behind a total.
EOF
)"
```

---

### Task 6: `mushak_summary` + `bad_debts`

**Files:**
- Modify: `apps/backend/src/ai/tools/types.ts`, `finance.tools.ts`, `parties.tools.ts`, `chat-tool-deps.factory.ts`, `ai.module.ts` (import `MushakModule`; `CustomersModule` already imported)
- Modify: `apps/backend/src/ai/chat-tools.spec.ts`

**Interfaces:**
- Consumes: `MushakService.getSalesBook`, `CustomersService.listWriteOffs`.
- Produces: `ChatToolDeps.mushak`; `bad_debts` uses existing `deps.customers`.

- [ ] **Step 1: Write the failing tests**

`mushak_summary`: stub `getSalesBook` with `totals` and 25 rows. Assert `totals.vatAmount` is `money()`-rounded, `rows.length === 20`, `hasMore === true`, each row only the spec fields (no `buyer` object beyond a name string). `permission === VIEW_FINANCIAL_REPORTS`.

`bad_debts`: stub `listWriteOffs` with one item `{ customer: { name: 'Karim', phone: '0171' }, amount: 500.126, reference_id: 'UNCOLLECTABLE', created_at, creator: { name: 'Asha' } }` — project `reason` from `reference_id` if the stub has not already mapped it. `permission === WRITE_OFF_CUSTOMER_DEBT`. Called with `timezone: 'Asia/Dhaka'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts --runInBand`
Expected: FAIL — tools missing.

- [ ] **Step 3: Implement**

`mushak_summary` pages the sales-book rows after the service returns (the service is unpaged). `taxableOnly` forwarded as `'true'` when the arg is true.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai/tools/types.ts apps/backend/src/ai/tools/finance.tools.ts apps/backend/src/ai/tools/parties.tools.ts apps/backend/src/ai/chat-tool-deps.factory.ts apps/backend/src/ai/ai.module.ts apps/backend/src/ai/chat-tools.spec.ts
git commit -m "$(cat <<'EOF'
feat(ai): Mushak 6.2 summary and bad-debt write-off tools

Totals plus a paged sales book; write-offs reuse CustomersService.
EOF
)"
```

---

### Task 7: Wave 1 prompt, pages, routes, help, eval

**Files:**
- Modify: `apps/backend/src/ai/chat.service.ts` (CHOOSING TOOLS + anomalies bullet)
- Modify: `apps/backend/src/ai/app-navigation.ts` (Wave 1 pages from the spec table)
- Modify: `apps/backend/src/ai/help-content.ts`
- Modify: `apps/backend/src/ai/help-content.spec.ts` (one new search assertion)
- Modify: `apps/frontend/src/components/AiChatWidget.tsx` (`TOOL_ROUTES`)
- Modify: nine `apps/frontend/src/lib/localization/messages/*/help.ts`
- Modify: `packages/shared-types/index.ts` (`AI_CHAT_TOOL_NAMES`)
- Modify: `apps/backend/test/fixtures/ai-chat-eval.md`

**Interfaces:**
- Consumes: Wave 1 tool names from Tasks 3–6.
- Produces: prompt rules, pages, routes, FAQs, eval rows in the spec.

- [ ] **Step 1: Write the failing tests**

`help-content.spec.ts`: `searchHelp('daily report for a branch')` (or the exact FAQ question) returns a hit whose answer mentions Daily Report.

Optional: a small test that `CHAT_TOOLS_BY_NAME.daily_report` exists and `pagesForModules` with `retail` includes `/sales/daily-report`. If `pagesForModules` is unexported, export it for the test or assert via `buildNavigationSection`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/help-content.spec.ts --runInBand`
Expected: FAIL — no FAQ yet.

- [ ] **Step 3: Implement copy and lists**

CHOOSING TOOLS bullets: spec “Prompt, pages, routes, help”. **Delete** “you cannot see line items”.

Wave 1 `APP_PAGES`: daily-report, cashier-sessions, mushak, exchanges, warranty-claims (line-items and bad-debts already listed).

`TOOL_ROUTES`:

```
daily_report: '/sales/daily-report'
cashier_sessions: '/sales/cashier-sessions'
sales_line_items: '/sales/reports/line-items'
purchase_line_items: '/purchases/reports/line-items'
mushak_summary: '/sales/reports/mushak'
bad_debts: '/sales/customers/reports/bad-debts'
```

FAQs (existing sections only):

- `sales`: “Can I ask the assistant for today’s Daily Report / open tills / invoice lines / Mushak 6.2 / write-offs / an exchange or warranty claim?” — yes, and name the pages.
- `aiAssistant`: extend “what can it see” with those reports.

Same FAQ objects in all nine frontend `help.ts` files.

`AI_CHAT_TOOL_NAMES`: replace the eight-name list with every current `CHAT_TOOLS` name including Wave 1. Keep declaration order matching `CHAT_TOOLS` assembly in `chat-tools.ts`.

Eval appendix (verbatim questions → expected tool):

| Question | Tool |
|---|---|
| What is today's daily report for Gulshan? | `daily_report` |
| Are any tills still open? | `cashier_sessions` |
| Show me the sale lines for [seeded product] last month | `resolve_entity` then `sales_line_items` |
| What did we buy of [seeded product] last month? | `purchase_line_items` |
| What is our Mushak 6.2 VAT total this month? | `mushak_summary` |
| Which customer debts have we written off? | `bad_debts` |
| Show exchange EX-1 | `list_documents` `sales_exchange` |
| Open warranty claims this month | `list_documents` `warranty_claim` |
| Who is the lead named Rahim? | `resolve_entity` `lead` |

Do not run the live eval set.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config ./jest.config.js src/ai/help-content.spec.ts src/ai/chat-tools.spec.ts src/ai/chat.service.spec.ts --runInBand`
From repo root, frontend catalog: `npm test --workspace apps/frontend -- src/lib/localization/catalog.test.ts` (or the existing catalog test path).
Expected: PASS. Rebuild `packages/shared-types` if its test imports `AI_CHAT_TOOL_NAMES`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai/chat.service.ts apps/backend/src/ai/app-navigation.ts apps/backend/src/ai/help-content.ts apps/backend/src/ai/help-content.spec.ts apps/frontend/src/components/AiChatWidget.tsx apps/frontend/src/lib/localization/messages apps/backend/test/fixtures/ai-chat-eval.md packages/shared-types/index.ts
git commit -m "$(cat <<'EOF'
feat(ai): Wave 1 prompt, pages, help, and eval questions

The assistant can name Daily Report, tills, line items, Mushak,
write-offs, exchanges, and warranty claims, and the prompt no
longer claims it cannot see line items.
EOF
)"
```

Wave 1 is shippable here.

---

### Task 8: `storefront_orders`

**Files:**
- Modify: `apps/backend/src/storefront/storefront.module.ts` (`exports: [StorefrontService]`)
- Modify: `apps/backend/src/ai/tools/types.ts`, `operations.tools.ts`, `chat-tool-deps.factory.ts`, `ai.module.ts`, `chat-tools.spec.ts`

**Interfaces:**
- Consumes: `StorefrontService.getOrders(tenantId, page, limit, storeId?)`.
- Produces: `storefront_orders` tool; `ChatToolDeps.storefront`; `modules: ['storefront']`; `permission: CREATE_SALE`.

- [ ] **Step 1: Write the failing tests**

Stub `getOrders` → `{ items: [{ id, created_at, status: 'PENDING', customer_name: 'Nadia', customer_phone: '0171', items: [{}, {}], total: 1200.126 }], total: 1 }`. Result row: `itemCount: 2`, `total: 1200.13`, no nested `items` array. `modules` includes `'storefront'`. Accounting-only OWNER’s `resolveTools` names omit `storefront_orders` (add in `chat.service.spec.ts`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts src/ai/chat.service.spec.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement**

Page via the service (`limit: MAX_TOOL_ROWS`). `resolveStoreId` for `storeId`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/storefront/storefront.module.ts apps/backend/src/ai
git commit -m "feat(ai): storefront online-orders tool"
```

---

### Task 9: `manufacturing_summary`

**Files:**
- Modify: `apps/backend/src/manufacturing/manufacturing.module.ts` (`exports: [ManufacturingService]`)
- Modify: `apps/backend/src/ai/tools/types.ts`, `operations.tools.ts`, `chat-tool-deps.factory.ts`, `ai.module.ts`, `chat-tools.spec.ts`, `chat.service.spec.ts`

**Interfaces:**
- Consumes: `listJobs` / `getProductPL` / `getAnalytics`.
- Produces: tool `manufacturing_summary`; required `kind: 'jobs' | 'product_pl' | 'analytics'`; `modules: ['manufacturing']`; `permission: EDIT_PRODUCTS`; `ChatToolDeps.manufacturing`.

- [ ] **Step 1: Write the failing tests**

- Missing `kind` is in `required`.
- `kind: 'jobs'` calls `listJobs` only.
- `kind: 'product_pl'` calls `getProductPL` only and pages `products`.
- `kind: 'analytics'` calls `getAnalytics(tenantId, 'Asia/Dhaka')`.
- OWNER without `premiumManufacturing` does not see the tool (`chat.service.spec.ts`, `planFeatures: {}`).
- OWNER with `premiumManufacturing: true` does.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts src/ai/chat.service.spec.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement** dispatch on `kind` as in the spec. Unknown `kind` → `{ error: 'kind must be jobs, product_pl, or analytics' }` without calling a service.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/manufacturing/manufacturing.module.ts apps/backend/src/ai
git commit -m "feat(ai): manufacturing summary tool (jobs, product P&L, analytics)"
```

---

### Task 10: `import_status`

**Files:**
- Modify: `apps/backend/src/ai/tools/types.ts`, `operations.tools.ts`, `chat-tool-deps.factory.ts`, `ai.module.ts` (import `ImportsModule`), `chat-tools.spec.ts`, `chat.service.spec.ts`

**Interfaces:**
- Consumes: `ImportsService.findAll`, `lcRegister`.
- Produces: tool `import_status`; required `kind: 'shipments' | 'lc_register'`; `modules: ['imports']`; `permission: VIEW_IMPORTS`; `ChatToolDeps.imports`.

- [ ] **Step 1: Write the failing tests**

- `kind: 'shipments'` calls `findAll` with `openOnly: 'true'` when no status passed; rows expose `reference_number`, `status`, `lc_number`, supplier name string.
- `kind: 'lc_register'` calls `lcRegister(tenantId, withinDays, storeId)` and exposes `daysToExpiry`.
- Accounting-only OWNER omits the tool.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts src/ai/chat.service.spec.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement** per spec. Duty report is not a `kind`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai
git commit -m "feat(ai): import shipments and LC-register tool"
```

---

### Task 11: `crm_pipeline`

**Files:**
- Modify: `apps/backend/src/ai/tools/types.ts`, `operations.tools.ts`, `chat-tool-deps.factory.ts`, `ai.module.ts` (import `CrmLeadsModule`, `CrmCampaignsModule`, `CrmFollowUpsModule`)
- Modify: `apps/backend/src/ai/chat-tools.spec.ts`, `chat.service.spec.ts`

**Interfaces:**
- Consumes: `getStatusSummary` / `findAll` (leads), `findAll` (campaigns), `getTodaySummary` / `findAll` (follow-ups).
- Produces: tool `crm_pipeline`; required `kind: 'leads' | 'campaigns' | 'follow_ups'`; `modules: ['crm']`; `permission: VIEW_LEADS`; `ChatToolDeps.crmLeads`, `crmCampaigns`, `crmFollowUps`.

- [ ] **Step 1: Write the failing tests**

- `kind: 'leads'` includes `open` from `getStatusSummary` and rows from `findAll` with `timezone`.
- `kind: 'campaigns'` does not call lead/follow-up services.
- `kind: 'follow_ups'` includes `{ dueToday, overdue, total }`; default `scope` today calls `findAll` with `dueToday: true`.
- `scope: 'overdue'` filters `status: 'PENDING'` rows to `due_at` before today (freeze `ctx` timezone `Asia/Dhaka`, one overdue and one future row).
- `makeService({ planFeatures: {} })` OWNER names omit `crm_pipeline`.
- `makeService({ planFeatures: { premiumCrm: true } })` includes it.
- `customer_lookup` still present when `premiumCrm` is off.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/chat-tools.spec.ts src/ai/chat.service.spec.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement** per spec. Do not add an `overdue` flag to `CrmFollowUpsService.findAll`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai
git commit -m "feat(ai): CRM pipeline tool for leads, campaigns, and follow-ups"
```

---

### Task 12: Wave 2 prompt, pages, help, eval, TODO

**Files:**
- Modify: `apps/backend/src/ai/chat.service.ts`, `app-navigation.ts`, `help-content.ts`, `help-content.spec.ts`
- Modify: `apps/frontend/src/components/AiChatWidget.tsx`
- Modify: nine `help.ts`
- Modify: `packages/shared-types/index.ts` (`AI_CHAT_TOOL_NAMES` add Wave 2 names)
- Modify: `apps/backend/test/fixtures/ai-chat-eval.md`
- Modify: `TODO.md`

**Interfaces:**
- Consumes: Wave 2 tool names.
- Produces: prompt bullets, pages, routes, FAQs, eval rows, one COMPLETED `TODO.md` line.

- [ ] **Step 1: Write the failing test**

`searchHelp('online orders')` or the new storefront FAQ hits Storefront → Online Orders. `buildNavigationSection` with modules `{storefront, manufacturing, imports, crm, …}` includes `/storefront`, `/manufacturing/jobs`, `/purchases/imports`, `/crm/leads`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config ./jest.config.js src/ai/help-content.spec.ts --runInBand`
Expected: FAIL.

- [ ] **Step 3: Implement lists and copy**

CHOOSING TOOLS: storefront / manufacturing_summary / import_status / crm_pipeline vs `open_pipeline` (spec).

`APP_PAGES`: remaining rows of the spec table.

`TOOL_ROUTES`: `storefront_orders` → `/storefront`; `manufacturing_summary` → `/manufacturing/jobs`; `import_status` → `/purchases/imports`; `crm_pipeline` → `/crm/leads`.

FAQs in existing `storefront` / `manufacturing` / `crm` / `aiAssistant` sections: the assistant can now read those lists.

Eval:

| Question | Tool |
|---|---|
| Any pending online orders? | `storefront_orders` |
| How many production jobs are in progress? | `manufacturing_summary` `jobs` |
| What is the P&L on manufactured products? | `manufacturing_summary` `product_pl` |
| Which LCs expire soon? | `import_status` `lc_register` |
| How many open leads do we have? | `crm_pipeline` `leads` |
| What follow-ups are overdue? | `crm_pipeline` `follow_ups` |

`TODO.md`: under AI data chatbot, check off a new Wave 1+2 coverage item and move it to COMPLETED with date 2026-11-11 (or today). Leave the live-eval item open.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --config ./jest.config.js src/ai --runInBand`
Frontend: `npm test --workspace apps/frontend -- src/lib/localization/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/ai apps/frontend/src/components/AiChatWidget.tsx apps/frontend/src/lib/localization/messages packages/shared-types/index.ts apps/backend/test/fixtures/ai-chat-eval.md TODO.md
git commit -m "$(cat <<'EOF'
feat(ai): Wave 2 prompt, pages, help, and eval questions

Storefront, manufacturing, imports, and CRM pipeline are reachable
from Ask ERP71 and documented in Help.
EOF
)"
```

---

## Self-review notes

- Spec tools, module gates, permissions, projections, pages, and eval questions each map to a task (1 factory, 2 gating, 3 meta, 4–6 Wave 1 tools, 7 Wave 1 copy, 8–11 Wave 2 tools, 12 Wave 2 copy).
- `ChatToolDeps` field names in later tasks match Task 1’s `build()` return and grow in place.
- Review Focus cases have tests in Tasks 2, 4, 8, 10, 11.
- Wave 1 can merge without Tasks 8–12.
