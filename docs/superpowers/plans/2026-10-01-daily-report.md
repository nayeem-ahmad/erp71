# Daily Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a one-day shop snapshot at `/sales/daily-report` that prints on letterhead and shares the same numbers as a short WhatsApp message.

**Architecture:** A new Nest `daily-report` module composes existing sales, till, purchase, expense, dues, and stock queries into one `DailyReport` JSON, including server-built `whatsappText`. The Next page renders that payload, prints via `openPrintWindow` + `PrintDocType.DAILY_REPORT`, and shares via a message-only `MessageShareModal` (`wa.me` / Copy). No new tables.

**Tech Stack:** NestJS, Prisma/`DatabaseService`, Jest; Next.js 15, React Testing Library, existing `openPrintWindow` / letterhead, Tailwind compact UI.

**Spec:** `docs/superpowers/specs/2026-10-01-daily-report-design.md`

## Global Constraints

- Branch is `dev`. Never commit to `main`. Do not stage `.vscode/settings.json`.
- Backend tests from repo root: `npx jest --testPathPatterns="src/daily-report/" --workspace apps/backend`. Frontend: `npm test --workspace apps/frontend -- <file>`.
- After `packages/shared-types` edits: `npm run build --workspace packages/shared-types`.
- UI: `PageShell` / `PageHeader`, `blue-600` accent, `min-h-touch` targets, money via `formatBDT()`. No new chart library, no jsPDF, no Meta Cloud send.
- HTTP gate is `VIEW_FINANCIAL_REPORTS` only (OWNER passes). Do not use `SALES_READ`.
- Nav id `sales.daily-report` sits under `sales`, outside `sales.reports` (`advancedOnly`).
- Calendar days use `tenant-time.util` (`zonedDayStart`, `zonedDateString`, `addCalendarDays`) — never `toISOString().slice(0, 10)` on a sale timestamp.
- Reuse `SalesReportsService.getSalesSummary` / `getSalesBreakdown` / `getSalesByProduct` and `CashierSessionsService.getSessionSummary`. Do not reimplement till expected-cash math.
- Message catalog: every locale file (`en`, `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur`) must keep the same key paths (`catalog.test.ts`). Real copy in `en` and `bn`; others may copy English.
- One `TODO.md` COMPLETED entry at feature ship, not per task.

## Review Focus

- An overnight till (`opened_at` yesterday, still `OPEN`) must appear on today's report. Test in Task 2.
- A 01:00 Asia/Dhaka sale must land on that Dhaka date, not the previous UTC date. Test in Task 2.
- `storeId` belonging to another tenant must 404 before any aggregate runs. Test in Task 3.
- A cashier with only `CREATE_SALE` must 403. Test in Task 3.
- A zero-activity day must still produce shareable `whatsappText` containing `No sales`. Test in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/daily-report/daily-report.types.ts` | **new** — `DailyReport` payload (spec) |
| `apps/backend/src/daily-report/money.ts` | **new** — `round2`, `buildTenders` |
| `apps/backend/src/daily-report/whatsapp-copy.ts` | **new** — en/bn strings for the chat body |
| `apps/backend/src/daily-report/format-whatsapp.ts` | **new** — `formatDailyReportWhatsApp` |
| `apps/backend/src/daily-report/daily-report.dto.ts` | **new** — query `date`, `storeId`, `locale` |
| `apps/backend/src/daily-report/daily-report.service.ts` | **new** — compose snapshot |
| `apps/backend/src/daily-report/daily-report.controller.ts` | **new** — `GET /daily-report` |
| `apps/backend/src/daily-report/daily-report.module.ts` | **new** |
| `apps/backend/src/cashier-sessions/cashier-sessions.module.ts` | **modify** — `exports: [CashierSessionsService]` |
| `apps/backend/src/app.module.ts` | **modify** — import `DailyReportModule` |
| `apps/backend/src/print-templates/print-templates.dto.ts` | **modify** — `DAILY_REPORT` |
| `packages/shared-types/navigation.ts` | **modify** — registry, layout, `NAV_PERMISSIONS` |
| `apps/frontend/src/lib/print/types.ts` | **modify** — `DAILY_REPORT` |
| `apps/frontend/src/app/(app)/settings/print-templates/HeaderEditor.tsx` | **modify** — `DOC_TYPES` |
| `apps/frontend/src/lib/localization/messages/*/settingsExtras.ts` | **modify** — `docTypes.DAILY_REPORT` |
| `apps/frontend/src/lib/localization/messages/*/core.ts` | **modify** — sidebar + dashboard link |
| `apps/frontend/src/lib/localization/messages/*/sales.ts` | **modify** — `dailyReport` page copy |
| `apps/frontend/src/lib/localization/messages/*/components.ts` | **modify** — `shareMessageModal` |
| `apps/frontend/src/lib/routes.ts` | **modify** — `sales.dailyReport` |
| `apps/frontend/src/lib/api.ts` | **modify** — `getDailyReport` |
| `apps/frontend/src/lib/daily-report-print.ts` | **new** — HTML body for `openPrintWindow` |
| `apps/frontend/src/components/share/MessageShareModal.tsx` | **new** |
| `apps/frontend/src/app/(app)/sales/daily-report/page.tsx` | **new** |
| `apps/frontend/src/components/dashboard/RetailDashboard.tsx` | **modify** — **Today’s report** |
| `TODO.md` | **modify** — record the work at ship |

---

### Task 1: Payload helpers and WhatsApp formatter

**Files:**
- Create: `apps/backend/src/daily-report/daily-report.types.ts`
- Create: `apps/backend/src/daily-report/money.ts`
- Create: `apps/backend/src/daily-report/whatsapp-copy.ts`
- Create: `apps/backend/src/daily-report/format-whatsapp.ts`
- Test: `apps/backend/src/daily-report/money.spec.ts`
- Test: `apps/backend/src/daily-report/format-whatsapp.spec.ts`

**Interfaces:**
- Consumes: none (pure)
- Produces:
  - `DailyReport` type exactly as in the spec (`headlines`, `sales`, `tenders`, `till | null`, `moneyOut | null`, `dues | null`, `topProducts`, `returns`, `stock | null`, `checklist`, `whatsappText`)
  - `round2(n: number): number` — `Math.round(n * 100) / 100`
  - `buildTenders(gross: number, payments: Array<{ method: string; amount: number }>): Array<{ method: string; amount: number }>` — drop zero amounts, append `{ method: 'Credit', amount }` when `round2(gross - sum) > 0`
  - `formatDailyReportWhatsApp(report: DailyReport, locale: string): string` — uses `whatsapp-copy.ts` (`en` default; `bn` when locale starts with `bn`)
  - `WHATSAPP_COPY.en.noSales = 'No sales'`

- [ ] **Step 1: Write the failing tests**

```ts
// money.spec.ts
import { buildTenders, round2 } from './money';

describe('buildTenders', () => {
    it('appends Credit so tenders sum to gross', () => {
        const tenders = buildTenders(1000, [
            { method: 'CASH', amount: 600 },
            { method: 'bKash', amount: 250 },
        ]);
        expect(tenders).toEqual([
            { method: 'CASH', amount: 600 },
            { method: 'bKash', amount: 250 },
            { method: 'Credit', amount: 150 },
        ]);
        expect(round2(tenders.reduce((s, t) => s + t.amount, 0))).toBe(1000);
    });

    it('omits Credit when payments cover gross', () => {
        expect(buildTenders(400, [{ method: 'CASH', amount: 400 }])).toEqual([
            { method: 'CASH', amount: 400 },
        ]);
    });
});
```

```ts
// format-whatsapp.spec.ts
import { formatDailyReportWhatsApp } from './format-whatsapp';
import type { DailyReport } from './daily-report.types';

function emptyReport(overrides: Partial<DailyReport> = {}): DailyReport {
    return {
        tenantName: 'Karim Electronics',
        storeName: 'Main',
        date: '2026-10-01',
        timezone: 'Asia/Dhaka',
        generatedAt: '2026-10-01T15:18:00.000Z',
        asOf: '2026-10-01T15:18:00.000Z',
        firstSaleAt: null,
        lastSaleAt: null,
        headlines: { netSales: 0, cashMovement: 0, newDues: 0, vsPreviousPct: null },
        sales: { bills: 0, gross: 0, returnsAmount: 0, returnsCount: 0, net: 0, avgBill: 0 },
        tenders: [],
        till: null,
        moneyOut: { purchases: { count: 0, net: 0 }, paidToSuppliers: 0, expenses: { count: 0, amount: 0 } },
        dues: null,
        topProducts: [],
        returns: { rows: [], moreCount: 0 },
        stock: null,
        checklist: [],
        whatsappText: '',
        ...overrides,
    };
}

describe('formatDailyReportWhatsApp', () => {
    it('says No sales on a quiet day', () => {
        const text = formatDailyReportWhatsApp(emptyReport(), 'en');
        expect(text).toMatch(/Karim Electronics/);
        expect(text).toMatch(/No sales/);
        expect(text).not.toMatch(/Purchases/i);
    });

    it('omits a zero purchases line and includes till variance', () => {
        const text = formatDailyReportWhatsApp(
            emptyReport({
                headlines: { netSales: 84500, cashMovement: 31200, newDues: 12000, vsPreviousPct: 12 },
                sales: { bills: 47, gross: 89100, returnsAmount: 4600, returnsCount: 3, net: 84500, avgBill: 1798 },
                tenders: [
                    { method: 'CASH', amount: 38000 },
                    { method: 'bKash', amount: 22500 },
                    { method: 'Credit', amount: 12000 },
                ],
                till: {
                    sessions: [],
                    rollup: {
                        openingCash: 2000, cashTakings: 38000, refunds: 0, cashIn: 0, cashOut: 0,
                        expectedCash: 23200, closingCash: 23050, variance: -150,
                    },
                    openSessionCount: 0,
                    unassignedSalesCount: 0,
                },
                moneyOut: { purchases: { count: 0, net: 0 }, paidToSuppliers: 0, expenses: { count: 1, amount: 1800 } },
                topProducts: [{ name: 'Samsung 25W', units: 14, revenue: 12600 }],
                checklist: [{ code: 'REORDER', count: 4, href: '/inventory/reports/reorder' }],
            }),
            'en',
        );
        expect(text).toMatch(/Sales ৳84,500/);
        expect(text).toMatch(/till/);
        expect(text).toMatch(/-৳150|−৳150/);
        expect(text).not.toMatch(/purchases/i);
        expect(text).toMatch(/expenses/i);
        expect(text.length).toBeLessThanOrEqual(700);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="src/daily-report/money.spec.ts" --workspace apps/backend`
Expected: FAIL — cannot find module `./money`

- [ ] **Step 3: Write types, `round2`, `buildTenders`, copy, formatter**

`DailyReport` copied from the spec. Formatter rules: drop a line when its block is null or zero; tender line lists non-zero methods; compact thousands (`38k`) only on the tender line when the full ৳ form would blow the cap; checklist max two items then `+N more on the full report`; last line `As of {h:mm a}` from `asOf` in `timezone`; quiet day is shop · branch · date, `No sales`, As of.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="src/daily-report/" --workspace apps/backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/daily-report/daily-report.types.ts \
        apps/backend/src/daily-report/money.ts \
        apps/backend/src/daily-report/money.spec.ts \
        apps/backend/src/daily-report/whatsapp-copy.ts \
        apps/backend/src/daily-report/format-whatsapp.ts \
        apps/backend/src/daily-report/format-whatsapp.spec.ts
git commit -m "$(cat <<'EOF'
feat(daily-report): format WhatsApp text from the snapshot payload

Pure helpers: tenders including Credit sum to gross, and a quiet day
renders as a shareable No sales bubble under 700 characters.
EOF
)"
```

---

### Task 2: DailyReportService composition

**Files:**
- Create: `apps/backend/src/daily-report/daily-report.service.ts`
- Test: `apps/backend/src/daily-report/daily-report.service.spec.ts`

**Interfaces:**
- Consumes: `DailyReport`, `buildTenders`, `round2`, `formatDailyReportWhatsApp`; `SalesReportsService.getSalesSummary` / `getSalesBreakdown` / `getSalesByProduct`; `CashierSessionsService.getSessionSummary`; `PurchaseReportsService.getPurchaseSummary`; `ExpensesService.getSummary`; `AccountingService.getAccountingDashboardOverview`; `DatabaseService`; `zonedDayStart`, `addCalendarDays`, `zonedDateString` from `../common/tenant-time.util`
- Produces:
  - `DailyReportService.getReport(input: { tenantId: string; storeId: string; tenantName: string; storeName: string; date: string; timezone: string; locale: string; now?: Date }): Promise<DailyReport>`
  - Throws `BadRequestException` when `date > zonedDateString(now, timezone)`
  - Sales failure rejects (do not catch). Other blocks: `Promise.allSettled` → `null`

Stub pattern: instantiate `DailyReportService` with jest mocks. Prisma mock returns `[]` by default; override per test.

- [ ] **Step 1: Write the failing tests**

```ts
import { BadRequestException } from '@nestjs/common';
import { DailyReportService } from './daily-report.service';

function salesSummary(net: number, gross = net, bills = 1, returns = 0) {
    return {
        summary: {
            totalRevenue: gross,
            totalReturns: returns,
            netRevenue: net,
            transactionCount: bills,
            avgOrderValue: bills ? net / bills : 0,
        },
        rows: [{ date: '2026-10-01', transactions: bills, grossRevenue: gross, returns, netRevenue: net }],
    };
}

describe('DailyReportService.getReport', () => {
    const salesReports = {
        getSalesSummary: jest.fn(),
        getSalesBreakdown: jest.fn(),
        getSalesByProduct: jest.fn(),
    };
    const cashierSessions = { getSessionSummary: jest.fn() };
    const purchaseReports = { getPurchaseSummary: jest.fn() };
    const expenses = { getSummary: jest.fn() };
    const accounting = { getAccountingDashboardOverview: jest.fn() };
    const db = {
        sale: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), aggregate: jest.fn() },
        salesReturn: { findMany: jest.fn().mockResolvedValue([]) },
        cashierSession: { findMany: jest.fn().mockResolvedValue([]) },
        customerCreditTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        supplierCreditTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        product: { findMany: jest.fn().mockResolvedValue([]) },
        inventoryShrinkage: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const input = {
        tenantId: 't1',
        storeId: 's1',
        tenantName: 'Karim Electronics',
        storeName: 'Main',
        date: '2026-10-01',
        timezone: 'Asia/Dhaka',
        locale: 'en',
        now: new Date('2026-10-01T15:00:00.000Z'),
    };

    let service: DailyReportService;

    beforeEach(() => {
        jest.clearAllMocks();
        salesReports.getSalesSummary.mockImplementation((_tid: string, q: { from?: string }) => {
            if (q.from === '2026-09-30') return salesSummary(0, 0, 0, 0);
            return salesSummary(800, 1000, 2, 200);
        });
        salesReports.getSalesBreakdown.mockResolvedValue({
            rows: [
                { label: 'CASH', revenue: 600 },
                { label: 'bKash', revenue: 250 },
            ],
        });
        salesReports.getSalesByProduct.mockResolvedValue({
            rows: [{ product: { name: 'Charger' }, unitsSold: 3, revenue: 500 }],
        });
        purchaseReports.getPurchaseSummary.mockResolvedValue({
            summary: { netPurchases: 0, orderCount: 0 },
        });
        expenses.getSummary.mockResolvedValue({ total: 0, entries: [] });
        accounting.getAccountingDashboardOverview.mockResolvedValue({
            position: { accounts_receivable: 142000, accounts_payable: 87000 },
        });
        db.sale.aggregate.mockResolvedValue({ _sum: { total_amount: 1000, amount_paid: 850 } });
        service = new DailyReportService(
            db as any,
            salesReports as any,
            cashierSessions as any,
            purchaseReports as any,
            expenses as any,
            accounting as any,
        );
    });

    it('makes tenders including Credit equal gross and net equal gross minus returns', async () => {
        const report = await service.getReport(input);
        expect(report.sales.gross).toBe(1000);
        expect(report.sales.net).toBe(800);
        expect(report.headlines.netSales).toBe(800);
        const tenderSum = report.tenders.reduce((s, t) => s + t.amount, 0);
        expect(tenderSum).toBe(1000);
        expect(report.tenders.some((t) => t.method === 'Credit' && t.amount === 150)).toBe(true);
    });

    it('puts a 01:00 Asia/Dhaka sale on that Dhaka date via getSalesSummary from/to', async () => {
        await service.getReport(input);
        expect(salesReports.getSalesSummary).toHaveBeenCalledWith(
            't1',
            expect.objectContaining({ from: '2026-10-01', to: '2026-10-01', storeId: 's1' }),
            'Asia/Dhaka',
        );
    });

    it('includes an overnight open till on today and leaves unassigned sales out of expected cash', async () => {
        db.cashierSession.findMany.mockResolvedValue([
            {
                id: 'sess-night',
                status: 'OPEN',
                opened_at: new Date('2026-09-30T18:00:00.000Z'),
                closed_at: null,
                opening_cash: 500,
                counter: { name: 'Counter 1' },
                user: { name: 'Amina' },
            },
        ]);
        cashierSessions.getSessionSummary.mockResolvedValue({
            sessionId: 'sess-night',
            openingCash: 500,
            cashTakings: 300,
            refunds: 0,
            cashIn: 0,
            cashOut: 0,
            expectedCash: 800,
            closingCash: null,
            variance: null,
        });
        db.sale.count.mockResolvedValue(2); // unassigned
        const report = await service.getReport(input);
        expect(report.till?.sessions).toHaveLength(1);
        expect(report.till?.sessions[0].sessionId).toBe('sess-night');
        expect(report.till?.rollup.expectedCash).toBe(800);
        expect(report.till?.unassignedSalesCount).toBe(2);
        expect(report.till?.openSessionCount).toBe(1);
        expect(report.till?.rollup.variance).toBeNull();
    });

    it('nulls stock when the product query rejects and still returns sales', async () => {
        db.product.findMany.mockRejectedValue(new Error('stock down'));
        const report = await service.getReport(input);
        expect(report.stock).toBeNull();
        expect(report.sales.net).toBe(800);
    });

    it('rejects a future local date', async () => {
        await expect(service.getReport({ ...input, date: '2026-10-02' })).rejects.toBeInstanceOf(BadRequestException);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="src/daily-report/daily-report.service.spec.ts" --workspace apps/backend`
Expected: FAIL — `DailyReportService` is not a constructor

- [ ] **Step 3: Implement `getReport`**

Rules (all from the spec):

1. Future `date` → `BadRequestException`.
2. Sales: `getSalesSummary(tenantId, { from: date, to: date, storeId }, timezone)` — if it throws, rethrow.
3. Previous day: `addCalendarDays(date, -1)` into the same method; `vsPreviousPct` null when yesterday net is 0.
4. Tenders: `getSalesBreakdown(..., { groupBy: 'payment_method', from: date, to: date, storeId }, timezone)` then `buildTenders(gross, rows mapped label/revenue)`.
5. `newDues`: `sum(max(0, total_amount - amount_paid))` on that day's `COMPLETED` sales for the store (Prisma `findMany` with `sale_date` between `zonedDayStart(date)` inclusive and `zonedDayStart(addCalendarDays(date,1))` exclusive).
6. Till sessions: `cashierSession.findMany` where `store_id`, `tenant_id`, `opened_at < endOfDay` AND (`closed_at` null OR `closed_at >= startOfDay`). Each row `getSessionSummary`. Roll-up sums; `closingCash`/`variance` null if any `OPEN`.
7. Unassigned: `sale.count` where `session_id: null`, same day window, `status: 'COMPLETED'`.
8. Cash movement: till roll-up `cashTakings - refunds + cashIn - cashOut` when sessions.length > 0; else cash tenders (methods classified `classifyPaymentMode(m) === 'cash'`) minus cash refunds.
9. Purchases / expenses / supplier `PAYMENT` txs / customer `PAYMENT` txs each settled independently into `moneyOut` / `dues.collected`.
10. Dues: on accounting success, `{ newDues, collected, accountsReceivable, accountsPayable }`; on throw, `dues: null`.
11. Top 5 products from `getSalesByProduct`.
12. Returns: up to 5 `salesReturn` that day.
13. Stock: products at/below reorder (cap 5 names) + zero on-hand count + shrinkage posted that day; on throw `stock: null`.
14. Checklist: `OPEN_TILL` if `openSessionCount > 0` → `/sales/cashier-sessions`; `REORDER` if `reorderCount > 0` → `/inventory/reports/reorder`; `PENDING_DELIVERY` if count of sales with status in `['DELIVERY_PENDING','AWAITING_DELIVERY','PENDING_DELIVERY']` > 0 → `/sales/delivery`.
15. `whatsappText = formatDailyReportWhatsApp({ ...payload, whatsappText: '' }, locale)` last.
16. `generatedAt`/`asOf` = `now.toISOString()`.
17. `firstSaleAt`/`lastSaleAt` from min/max `sale_date` that day.

Pending-delivery statuses must match `RetailDashboard.tsx` (same three strings).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="src/daily-report/" --workspace apps/backend`
Expected: PASS (Task 1 + Task 2)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/daily-report/daily-report.service.ts \
        apps/backend/src/daily-report/daily-report.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(daily-report): compose the shop-day snapshot from existing modules

Sales, tenders, overnight tills, and dues come from current services;
a dead stock query drops that block instead of failing the page.
EOF
)"
```

---

### Task 3: HTTP module, guards, store 404

**Files:**
- Create: `apps/backend/src/daily-report/daily-report.dto.ts`
- Create: `apps/backend/src/daily-report/daily-report.controller.ts`
- Create: `apps/backend/src/daily-report/daily-report.module.ts`
- Test: `apps/backend/src/daily-report/daily-report.controller.spec.ts`
- Modify: `apps/backend/src/cashier-sessions/cashier-sessions.module.ts` — add `exports: [CashierSessionsService]`
- Modify: `apps/backend/src/app.module.ts` — import `DailyReportModule` next to `SalesReportsModule`

**Interfaces:**
- Consumes: `DailyReportService.getReport`; `TenantContext` (`tenantId`, `storeId`, `timezone`)
- Produces:
  - `GET /daily-report?date&storeId&locale`
  - `@RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)`
  - `@RequiresPlan('BASIC')`
  - Guards: `JwtAuthGuard`, `StorePermissionGuard`, `SubscriptionAccessGuard`, `TenantInterceptor` — copy `SalesReportsController` class-level setup
  - 404 when `storeId` (query or `tenant.storeId`) is missing or `db.store.findFirst({ where: { id, tenant_id } })` is null — **before** `getReport`

DTO:

```ts
export class GetDailyReportDto {
    @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
    date?: string;

    @IsOptional() @IsUUID()
    storeId?: string;

    @IsOptional() @IsString()
    locale?: string;
}
```

- [ ] **Step 1: Write the failing controller tests**

```ts
import { NotFoundException } from '@nestjs/common';
import { DailyReportController } from './daily-report.controller';

describe('DailyReportController', () => {
    const service = { getReport: jest.fn() };
    const db = { store: { findFirst: jest.fn() }, tenant: { findUnique: jest.fn() } };
    const tenant = {
        tenantId: 't1',
        storeId: 's1',
        userId: 'u1',
        timezone: 'Asia/Dhaka',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        db.store.findFirst.mockResolvedValue({ id: 's1', name: 'Main', tenant_id: 't1' });
        db.tenant.findUnique.mockResolvedValue({ name: 'Karim Electronics' });
        service.getReport.mockResolvedValue({ sales: { net: 1 } });
    });

    it('404s a store that is not this tenant before aggregating', async () => {
        db.store.findFirst.mockResolvedValue(null);
        const controller = new DailyReportController(service as any, db as any);
        await expect(controller.get(tenant as any, { storeId: 'other-store' })).rejects.toBeInstanceOf(NotFoundException);
        expect(service.getReport).not.toHaveBeenCalled();
    });

    it('passes the active store and locale through', async () => {
        const controller = new DailyReportController(service as any, db as any);
        await controller.get(tenant as any, { date: '2026-10-01', locale: 'bn' });
        expect(service.getReport).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 't1',
                storeId: 's1',
                date: '2026-10-01',
                locale: 'bn',
                timezone: 'Asia/Dhaka',
                storeName: 'Main',
                tenantName: 'Karim Electronics',
            }),
        );
    });
});
```

Also add a guard metadata test (same file or beside it) that the handler metadata includes `VIEW_FINANCIAL_REPORTS` via `Reflect.getMetadata(STORE_PERMISSIONS_KEY, DailyReportController.prototype.get)` so a cashier with only `CREATE_SALE` cannot pass `StorePermissionGuard`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="src/daily-report/daily-report.controller.spec.ts" --workspace apps/backend`
Expected: FAIL — cannot find controller

- [ ] **Step 3: Implement controller, module, export cashier service, register in `app.module.ts`**

Default `date` when omitted: `zonedDateString(new Date(), tenant.timezone)`. Default `storeId`: query or `tenant.storeId`. Default `locale`: `en`. Missing store id after that → 404.

Run `npx jest --testPathPatterns="src/auth/route-authorization" --workspace apps/backend` after wiring. If the scanner flags `GET /daily-report` as open, the decorator is missing — fix it; do not add the route to `OPEN_ROUTES`.

- [ ] **Step 4: Run tests**

Run: `npx jest --testPathPatterns="src/daily-report/" --workspace apps/backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/daily-report/daily-report.dto.ts \
        apps/backend/src/daily-report/daily-report.controller.ts \
        apps/backend/src/daily-report/daily-report.controller.spec.ts \
        apps/backend/src/daily-report/daily-report.module.ts \
        apps/backend/src/cashier-sessions/cashier-sessions.module.ts \
        apps/backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(daily-report): expose GET /daily-report behind financial-report permission

A store outside the tenant 404s before aggregates run. Cashiers with
CREATE_SALE only stay on their own till close.
EOF
)"
```

---

### Task 4: PrintDocType `DAILY_REPORT`

**Files:**
- Modify: `apps/backend/src/print-templates/print-templates.dto.ts` — add `DAILY_REPORT = 'DAILY_REPORT'`
- Modify: `apps/frontend/src/lib/print/types.ts` — add `'DAILY_REPORT'` to `PrintDocType`
- Modify: `apps/frontend/src/app/(app)/settings/print-templates/HeaderEditor.tsx` — append `'DAILY_REPORT'` to `DOC_TYPES`
- Modify: every `apps/frontend/src/lib/localization/messages/*/settingsExtras.ts` `docTypes` map — `DAILY_REPORT: 'Daily reports'` (bn: `'দৈনিক রিপোর্ট'`)

**Interfaces:**
- Consumes: existing `PrintDocType` enum / union
- Produces: `DAILY_REPORT` assignable on a letterhead, same lockstep as `PAYSLIP`

- [ ] **Step 1: Write the failing resolve test**

In `apps/backend/src/print-templates/print-templates.service.spec.ts`, next to the existing `PrintDocType.SALES_INVOICE` case:

```ts
it('resolves DAILY_REPORT against the default template', async () => {
    const result = await service.resolve('ten1', PrintDocType.DAILY_REPORT);
    expect(result).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx jest --testPathPatterns="src/print-templates/print-templates.service.spec.ts" --workspace apps/backend`
Expected: FAIL — `PrintDocType.DAILY_REPORT` is undefined (after adding the assertion)

- [ ] **Step 3: Add the enum / union / DOC_TYPES / labels in lockstep**

- [ ] **Step 4: Run**

Run: `npx jest --testPathPatterns="src/print-templates/print-templates.service.spec.ts" --workspace apps/backend`
And: `npm test --workspace apps/frontend -- src/lib/localization/messages/catalog.test.ts`
Expected: PASS (catalog fails until every locale has `docTypes.DAILY_REPORT` — add them all in this step)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/print-templates/print-templates.dto.ts \
        apps/backend/src/print-templates/print-templates.service.spec.ts \
        apps/frontend/src/lib/print/types.ts \
        apps/frontend/src/app/\(app\)/settings/print-templates/HeaderEditor.tsx \
        apps/frontend/src/lib/localization/messages
git commit -m "$(cat <<'EOF'
feat(print): add DAILY_REPORT letterhead document type

Same lockstep as payslips: dto enum, frontend union, HeaderEditor
checkboxes, and docTypes labels in every locale catalog.
EOF
)"
```

---

### Task 5: Nav, routes, page copy

**Files:**
- Modify: `packages/shared-types/navigation.ts`
  - Registry: `'sales.daily-report': { id: 'sales.daily-report', kind: 'link', icon: 'ClipboardList', labelKey: 'sidebar.items.dailyReport', href: '/sales/daily-report' }`
  - Layout: `layoutNode('sales.daily-report', 'sales', 10)` then bump `sales.reports` 10→11 and `sales.setup` 11→12
  - `NAV_PERMISSIONS['sales.daily-report'] = ['VIEW_FINANCIAL_REPORTS']`
- Modify: `apps/frontend/src/lib/routes.ts` — `sales.dailyReport: '/sales/daily-report'`
- Modify: `apps/frontend/src/lib/localization/messages/*/core.ts` — `sidebar.items.dailyReport: 'Daily Report'` (bn: `'দৈনিক রিপোর্ট'`), `dashboardHome.todaysReport: "Today's report"`
- Modify: `apps/frontend/src/lib/localization/messages/*/sales.ts` — `dailyReport` page strings: `title`, `print`, `share`, `openTill`, `asOf`, section labels (`sales`, `tenders`, `till`, `moneyOut`, `dues`, `topProducts`, `returns`, `stock`, `checklist`), `credit`, `noSales`
- Modify: `apps/frontend/src/lib/localization/messages/*/components.ts` — `shareMessageModal: { title, description, copy, copied, whatsapp, close, previewLabel }`
- Test: `apps/frontend/src/lib/nav-daily-report.test.ts` that imports `NAV_REGISTRY` / `DEFAULT_TENANT_NAV_LAYOUT` / `NAV_PERMISSIONS` and asserts:
  - `NAV_REGISTRY['sales.daily-report'].href === '/sales/daily-report'`
  - `NAV_REGISTRY['sales.daily-report'].advancedOnly` is falsy
  - parent is `sales` (layout `parentId === 'sales'`)
  - `NAV_PERMISSIONS['sales.daily-report']` equals `['VIEW_FINANCIAL_REPORTS']`

**Interfaces:**
- Consumes: existing `layoutNode`, `NAV_REGISTRY`
- Produces: sidebar link visible on BASIC; hidden from cashiers via `NAV_PERMISSIONS`

- [ ] **Step 1: Write the failing nav test** in `apps/frontend/src/lib/nav-daily-report.test.ts`

- [ ] **Step 2: Run** `npm test --workspace apps/frontend -- src/lib/nav-daily-report.test.ts` — FAIL cannot resolve id

- [ ] **Step 3: Add registry, layout bump, permissions, routes, all-locale strings**

Then: `npm run build --workspace packages/shared-types`

Saved tenant layouts pick up the node later with `npx tsx packages/database/prisma/sync-nav-layout.ts --nodes=sales.daily-report` — run that in this step if the script exists at that path (the spec names it). Do not reset layouts.

- [ ] **Step 4: Run** `npm test --workspace apps/frontend -- src/lib/nav-daily-report.test.ts src/lib/localization/messages/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/navigation.ts \
        apps/frontend/src/lib/routes.ts \
        apps/frontend/src/lib/nav-daily-report.test.ts \
        apps/frontend/src/lib/localization/messages
git commit -m "$(cat <<'EOF'
feat(nav): add Daily Report under Sales for BASIC shops

Sits beside Mushak, outside the advanced reports subgroup, and is
gated on VIEW_FINANCIAL_REPORTS so the till role does not see it.
EOF
)"
```

---

### Task 6: API client and MessageShareModal

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` — add `getDailyReport`
- Create: `apps/frontend/src/components/share/MessageShareModal.tsx`
- Test: `apps/frontend/src/components/share/MessageShareModal.test.tsx`

**Interfaces:**
- Consumes: `DailyReport` shape (duplicate a frontend type in `apps/frontend/src/lib/daily-report.ts` exporting the same fields; do not import from the backend path)
- Produces:
  - `api.getDailyReport(params: { date?: string; storeId?: string; locale?: string }): Promise<DailyReport>` → `GET /daily-report?...`
  - `MessageShareModal({ subject: string; text: string; onClose: () => void })` — textarea defaulting to `text`, Copy writes the current textarea value, WhatsApp `href={`https://wa.me/?text=${encodeURIComponent(body)}`}` `target="_blank"` `rel="noopener noreferrer"`. No short path, no revoke.

- [ ] **Step 1: Write the failing modal test** (mirror `ShareModal.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageShareModal from './MessageShareModal';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages, locale: 'en' }), formatMessage: (t: string) => t };
});

it('previews the server text and points WhatsApp at wa.me', () => {
    render(<MessageShareModal subject="Daily Report" text="No sales" onClose={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('No sales');
    const link = screen.getByRole('link', { name: /whatsapp/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('wa.me'));
    expect(link.getAttribute('href')).toContain(encodeURIComponent('No sales'));
});

it('copies the edited body, not the original', async () => {
    const writeText = jest.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MessageShareModal subject="Daily Report" text="No sales" onClose={() => {}} />);
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('Hello');
});
```

- [ ] **Step 2: Run** `npm test --workspace apps/frontend -- src/components/share/MessageShareModal.test.tsx` — FAIL

- [ ] **Step 3: Implement modal + `api.getDailyReport`**

```ts
getDailyReport: (params?: { date?: string; storeId?: string; locale?: string }) => {
    const query = new URLSearchParams();
    if (params?.date) query.set('date', params.date);
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.locale) query.set('locale', params.locale);
    return fetchWithAuth(`/daily-report${query.toString() ? `?${query.toString()}` : ''}`);
},
```

- [ ] **Step 4: Run the modal test** — PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/api.ts \
        apps/frontend/src/lib/daily-report.ts \
        apps/frontend/src/components/share/MessageShareModal.tsx \
        apps/frontend/src/components/share/MessageShareModal.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): Daily Report API helper and message share modal

Share is a chat body (Copy / wa.me), not a short link. Editing the
preview does not change the printed snapshot.
EOF
)"
```

---

### Task 7: Daily Report page and print

**Files:**
- Create: `apps/frontend/src/lib/daily-report-print.ts`
- Test: `apps/frontend/src/lib/daily-report-print.test.ts`
- Create: `apps/frontend/src/app/(app)/sales/daily-report/page.tsx`
- Test: `apps/frontend/src/app/(app)/sales/daily-report/page.test.tsx`

**Interfaces:**
- Consumes: `api.getDailyReport`, `MessageShareModal`, `openPrintWindow`, `usePrintHeader` with `docType: 'DAILY_REPORT'`, `routes.sales.dailyReport`, `formatBDT`, `PageShell` / `PageHeader`
- Produces: page at `/sales/daily-report` with date input, Print, Share; null/empty blocks unmounted

`buildDailyReportHtml(report, labels): string` — section order from the spec. Omit a section when its value is `null` or empty (stock all-zero, moneyOut all-zero/null sides, no top products, empty checklist).

- [ ] **Step 1: Write failing tests**

Print helper — `quietPayload` is a `DailyReport` with `stock: null`, zero `moneyOut`, empty `checklist`, `whatsappText: 'Karim Electronics · Main · 1 Oct\nNo sales\nAs of 9:18 pm'`, and non-zero `sales`:

```ts
it('omits the stock section when stock is null', () => {
    const html = buildDailyReportHtml(quietPayload, enLabels);
    expect(html).not.toMatch(/Stock/i);
    expect(html).toMatch(/Sales/);
});
```

Page (same i18n/api/router mocks as `sales/reports/summary/page.test.tsx`):

```ts
it('unmounts empty blocks and wires Print and Share', async () => {
    const { api } = require('@/lib/api');
    api.getDailyReport.mockResolvedValue(quietPayload); // stock null, moneyOut zeros, checklist []
    render(<DailyReportPage />);
    await waitFor(() => expect(screen.getByText(/Daily Report/i)).toBeInTheDocument());
    expect(screen.queryByText(/Stock/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
});

it('opens print with DAILY_REPORT letterhead', async () => {
    // mock openPrintWindow and usePrintHeader
    await userEvent.click(screen.getByRole('button', { name: /print/i }));
    expect(openPrintWindow).toHaveBeenCalled();
});

it('opens share with server whatsappText', async () => {
    await userEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(screen.getByRole('textbox')).toHaveValue(quietPayload.whatsappText);
});
```

- [ ] **Step 2: Run page + print tests** — FAIL

- [ ] **Step 3: Implement print helper and page**

Date `<input type="date">` default today (browser local is acceptable for the control; the API uses tenant timezone). Pass `locale` from `useI18n()`. Pass `storeId` from `getWorkspaceItem('store_id')` when set. Print: `openPrintWindow({ title, headerHtml, bodyHtml: buildDailyReportHtml(...), paperSize from prefs })`. Open till: amber callout using `report.till.openSessionCount`.

- [ ] **Step 4: Run** `npm test --workspace apps/frontend -- src/app/\(app\)/sales/daily-report/page.test.tsx src/lib/daily-report-print.test.ts`
Expected: PASS

Lint: `cd apps/frontend && npx next lint --quiet --file src/app/(app)/sales/daily-report/page.tsx --file src/lib/daily-report-print.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/daily-report-print.ts \
        apps/frontend/src/lib/daily-report-print.test.ts \
        apps/frontend/src/app/\(app\)/sales/daily-report
git commit -m "$(cat <<'EOF'
feat(frontend): Daily Report page with letterhead print and share

The screen, the A4, and WhatsApp all read the same GET /daily-report
payload. Empty modules do not leave blank sections on the page.
EOF
)"
```

---

### Task 8: Retail dashboard link and TODO.md

**Files:**
- Modify: `apps/frontend/src/components/dashboard/RetailDashboard.tsx` — pass `toolbar` to `DashboardHeader` with a link `href={routes.sales.dailyReport}` labelled `t.dashboardHome.todaysReport`
- Test: `apps/frontend/src/app/(app)/dashboard/page.test.tsx` (already mocks RetailDashboard data) — assert the retail render includes the Today’s report link; Accounting variant does not
- Modify: `TODO.md` — under COMPLETED, one line dated 2026-10-01: Daily Report (print + WhatsApp tap-to-share) at `/sales/daily-report`

**Interfaces:**
- Consumes: `DashboardHeader` `toolbar?: ReactNode`, `routes.sales.dailyReport`
- Produces: retail landing only

- [ ] **Step 1: Write the failing dashboard assertion**

In `dashboard/page.test.tsx`, after the existing retail render, `expect(screen.getByRole('link', { name: /today's report/i })).toHaveAttribute('href', '/sales/daily-report')`. In the accounting-variant case already in that file, `queryByRole('link', { name: /today's report/i })` is null.

- [ ] **Step 2: Run** `npm test --workspace apps/frontend -- src/app/\(app\)/dashboard/page.test.tsx` — FAIL on retail

- [ ] **Step 3: Add the toolbar link on `RetailDashboard` only** (`AccountingDashboard.tsx` untouched)

- [ ] **Step 4: Run dashboard test** — PASS. Then `npm test --workspace apps/frontend -- src/lib/localization/messages/catalog.test.ts src/lib/nav-daily-report.test.ts src/components/share/MessageShareModal.test.tsx src/app/\(app\)/sales/daily-report/page.test.tsx src/app/\(app\)/dashboard/page.test.tsx` and `npx jest --testPathPatterns="src/daily-report/" --workspace apps/backend`

- [ ] **Step 5: Commit** (include TODO.md)

```bash
git add apps/frontend/src/components/dashboard/RetailDashboard.tsx \
        apps/frontend/src/app/\(app\)/dashboard/page.test.tsx \
        TODO.md
git commit -m "$(cat <<'EOF'
feat(dashboard): link Today’s report from the retail home

Accounting, CRM, and Projects landings stay as they are. Records the
Daily Report in TODO.md COMPLETED.
EOF
)"
```

---

## Self-review notes (for the implementer)

Spec coverage: payload helpers (T1), composition + invariants + overnight till + Dhaka date + stock degrade + future date (T2), HTTP + 404 + permission (T3), letterhead type (T4), nav BASIC + i18n (T5), WhatsApp modal (T6), page/print (T7), dashboard link (T8). Out of spec on purpose: scheduled send, day-close lock, all-branches, PDF-in-chat.
