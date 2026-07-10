# ERP71 Dashboard Redesign ("Business Monitor" v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the owner dashboard at `apps/frontend/src/app/(app)/dashboard/page.tsx` into a Clean & Airy, glanceable, action-oriented home screen — health hero + attention strip + sales-by-category donut + top products/customers — backed by real ERP71 data.

**Architecture:** One new backend aggregation (`GET /sales-reports/by-category`) mirroring the existing `by-product` report. On the frontend, decompose the 500-line `page.tsx` into eight focused widget components under `components/dashboard/`, each fetching from existing (or the one new) endpoint, gated by the existing accounting-only plan mode, and localized via `t.dashboardHome`.

**Tech Stack:** NestJS + Prisma (backend), Next.js 15 client components + Tailwind (frontend), Jest + Testing Library (both), existing `compactDensity` tokens and `fetchWithAuth` API client.

## Global Constraints

- All business queries scoped to `tenantId` via `TenantInterceptor` — copy the existing report pattern exactly.
- New backend endpoint sits on `SalesReportsController` (guards: `JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard`; `@RequiresPlan('BASIC')`; `@UseInterceptors(TenantInterceptor)`).
- Only `status: 'COMPLETED'` sales count toward revenue aggregations.
- Currency rendered via existing `formatBDT`; dates via `formatDate`; interpolation via `formatMessage`. No hardcoded user-facing strings — every string is a `t.dashboardHome.*` key with **en, bn, ms** values.
- Charts stay hand-rolled (CSS/SVG) — no new charting dependency.
- Respect accounting-only plan mode: `isAccountingOnlyPlan(planCode, features)` hides retail-only widgets, matching the current `accountingOnlyMode` gating.
- Test runner is `jest` in both `apps/backend` and `apps/frontend` (run from each app dir).
- Visual tokens: canvas `#f6f8fb`, card border `#eef2f7`, primary `#6366f1`, positive `#16a34a`, negative `#dc2626`.

---

### Task 1: Backend `GET /sales-reports/by-category` aggregation

**Files:**
- Modify: `apps/backend/src/sales-reports/sales-reports.dto.ts` (add `GetSalesByCategoryDto`)
- Modify: `apps/backend/src/sales-reports/sales-reports.service.ts` (add `getSalesByCategory`)
- Modify: `apps/backend/src/sales-reports/sales-reports.controller.ts` (add route)
- Test: `apps/backend/src/sales-reports/sales-reports.service.spec.ts` (add describe block)

**Interfaces:**
- Produces: `getSalesByCategory(tenantId: string, query: GetSalesByCategoryDto): Promise<{ summary: { totalRevenue: number; categoryCount: number }; rows: Array<{ categoryId: string | null; categoryName: string; revenue: number; share: number }> }>`. Route: `GET /sales-reports/by-category?storeId&from&to`. Top 5 categories + an "Other" rollup; uncategorized products bucket under `categoryName: 'Uncategorized'`, `categoryId: null`.

- [ ] **Step 1: Add the DTO**

In `apps/backend/src/sales-reports/sales-reports.dto.ts`, append:

```typescript
export class GetSalesByCategoryDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}
```

- [ ] **Step 2: Write the failing service test**

In `apps/backend/src/sales-reports/sales-reports.service.spec.ts`, add inside the top-level `describe`:

```typescript
describe('getSalesByCategory', () => {
    it('aggregates revenue by product group with shares and an Other rollup', async () => {
        const saleItems = [
            { quantity: 2, price_at_sale: 100, product: { group_id: 'g1', group: { id: 'g1', name: 'Electronics' } } },
            { quantity: 1, price_at_sale: 300, product: { group_id: 'g2', group: { id: 'g2', name: 'Lighting' } } },
            { quantity: 1, price_at_sale: 100, product: { group_id: null, group: null } },
        ];
        db.saleItem.findMany.mockResolvedValue(saleItems);

        const result = await service.getSalesByCategory('tenant-1', {});

        expect(result.summary.totalRevenue).toBe(600);
        expect(result.summary.categoryCount).toBe(3);
        const electronics = result.rows.find((r) => r.categoryName === 'Electronics');
        expect(electronics).toMatchObject({ categoryId: 'g1', revenue: 200 });
        expect(electronics!.share).toBeCloseTo(33.333, 2);
        const uncategorized = result.rows.find((r) => r.categoryName === 'Uncategorized');
        expect(uncategorized).toMatchObject({ categoryId: null, revenue: 100 });
    });

    it('returns empty rows and zero total when there are no sales', async () => {
        db.saleItem.findMany.mockResolvedValue([]);
        const result = await service.getSalesByCategory('tenant-1', {});
        expect(result).toEqual({ summary: { totalRevenue: 0, categoryCount: 0 }, rows: [] });
    });
});
```

If the spec's existing setup does not already expose a mocked `db` with `saleItem.findMany` and a `service` instance, mirror the setup used by the existing `getSalesByProduct` tests in the same file (reuse the same `db` mock object and `service` construction).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/backend && npx jest sales-reports.service --t "getSalesByCategory"`
Expected: FAIL — `service.getSalesByCategory is not a function`.

- [ ] **Step 4: Implement the service method**

In `apps/backend/src/sales-reports/sales-reports.service.ts`, import the DTO in the existing import from `./sales-reports.dto`, then add this method to the class (after `getSalesByProduct`):

```typescript
    async getSalesByCategory(tenantId: string, query: GetSalesByCategoryDto) {
        const dateFilter = buildDateWindow(query.from, query.to);

        const saleItems = await this.db.saleItem.findMany({
            where: {
                sale: {
                    tenant_id: tenantId,
                    status: 'COMPLETED',
                    ...(query.storeId ? { store_id: query.storeId } : {}),
                    ...dateFilter,
                },
            },
            select: {
                quantity: true,
                price_at_sale: true,
                product: {
                    select: {
                        group_id: true,
                        group: { select: { id: true, name: true } },
                    },
                },
            },
        });

        const catMap = new Map<string, { categoryId: string | null; categoryName: string; revenue: number }>();
        for (const item of saleItems) {
            const groupId = item.product?.group_id ?? null;
            const key = groupId ?? '__uncategorized__';
            const name = item.product?.group?.name ?? 'Uncategorized';
            const existing = catMap.get(key) ?? { categoryId: groupId, categoryName: name, revenue: 0 };
            existing.revenue += item.quantity * Number(item.price_at_sale);
            catMap.set(key, existing);
        }

        const sorted = Array.from(catMap.values()).sort((a, b) => b.revenue - a.revenue);
        const totalRevenue = sorted.reduce((sum, r) => sum + r.revenue, 0);

        const TOP_N = 5;
        const rows = sorted.slice(0, TOP_N).map((r) => ({
            ...r,
            share: totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0,
        }));

        const rest = sorted.slice(TOP_N);
        if (rest.length > 0) {
            const otherRevenue = rest.reduce((sum, r) => sum + r.revenue, 0);
            rows.push({
                categoryId: null,
                categoryName: 'Other',
                revenue: otherRevenue,
                share: totalRevenue > 0 ? (otherRevenue / totalRevenue) * 100 : 0,
            });
        }

        return { summary: { totalRevenue, categoryCount: sorted.length }, rows };
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/backend && npx jest sales-reports.service --t "getSalesByCategory"`
Expected: PASS (both cases).

- [ ] **Step 6: Wire the controller route**

In `apps/backend/src/sales-reports/sales-reports.controller.ts`, add `GetSalesByCategoryDto` to the DTO import list, then add the route method to the class:

```typescript
    @Get('by-category')
    getSalesByCategory(@Tenant() tenant: TenantContext, @Query() query: GetSalesByCategoryDto) {
        return this.service.getSalesByCategory(tenant.tenantId, query);
    }
```

- [ ] **Step 7: Run the full report spec + build**

Run: `cd apps/backend && npx jest sales-reports && npx tsc --noEmit -p tsconfig.json`
Expected: all sales-reports specs PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/sales-reports
git commit -m "feat(sales-reports): GET /sales-reports/by-category revenue aggregation"
```

---

### Task 2: Frontend API client method

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (add `getSalesByCategory`)

**Interfaces:**
- Consumes: Task 1 route `GET /sales-reports/by-category`.
- Produces: `api.getSalesByCategory(params?: { storeId?: string; from?: string; to?: string }): Promise<{ summary: { totalRevenue: number; categoryCount: number }; rows: Array<{ categoryId: string | null; categoryName: string; revenue: number; share: number }> }>`.

- [ ] **Step 1: Add the client method**

In `apps/frontend/src/lib/api.ts`, directly after the existing `getSalesByProduct` method (~line 338), add:

```typescript
    getSalesByCategory: (params?: { storeId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.storeId) query.set('storeId', params.storeId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/sales-reports/by-category${query.toString() ? `?${query.toString()}` : ''}`);
    },
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/api.ts
git commit -m "feat(api): getSalesByCategory client method"
```

---

### Task 3: Dashboard i18n keys (en / bn / ms)

**Files:**
- Modify: `apps/frontend/src/lib/localization/messages/en/core.ts`
- Modify: `apps/frontend/src/lib/localization/messages/bn/core.ts`
- Modify: `apps/frontend/src/lib/localization/messages/ms/core.ts`

**Interfaces:**
- Produces: new keys on `dashboardHome`: `greetingMorning`, `greetingAfternoon`, `greetingEvening`, `rangeToday`, `rangeWeek`, `rangeMonth`, `sectionHealth`, `sectionAttention`, `sectionMoney`, `sectionDrivers`, `kpiSales`, `kpiNetProfit`, `kpiCashInHand`, `kpiReceivables`, `attnOverdue`, `attnLowStock`, `attnDeliveries`, `attnRenewal`, `attnAllClear`, `salesByCategory`, `salesByCategoryEmpty`, `topProducts`, `topCustomers`, `unitsSold`, `ordersCount`, `otherCategory`, `uncategorized`. (Consumed by Tasks 4–10.)

- [ ] **Step 1: Add keys to the English catalog**

In `apps/frontend/src/lib/localization/messages/en/core.ts`, inside the existing `dashboardHome` object, add:

```typescript
        greetingMorning: 'Good morning',
        greetingAfternoon: 'Good afternoon',
        greetingEvening: 'Good evening',
        rangeToday: 'Today',
        rangeWeek: 'This week',
        rangeMonth: 'Month',
        sectionHealth: 'Business health',
        sectionAttention: 'Needs your attention',
        sectionMoney: 'Money in & where it comes from',
        sectionDrivers: 'Who & what is driving it',
        kpiSales: 'Sales',
        kpiNetProfit: 'Net profit',
        kpiCashInHand: 'Cash in hand',
        kpiReceivables: 'Receivables due',
        attnOverdue: '{count} invoices overdue',
        attnLowStock: '{count} products low on stock',
        attnDeliveries: '{count} orders awaiting delivery',
        attnRenewal: 'Plan renews in {days} days',
        attnAllClear: "You're all caught up 🎉",
        salesByCategory: 'Sales by category',
        salesByCategoryEmpty: 'No category sales yet this period',
        topProducts: 'Top selling products',
        topCustomers: 'Top customers',
        unitsSold: '{count} sold',
        ordersCount: '{count} orders',
        otherCategory: 'Other',
        uncategorized: 'Uncategorized',
```

- [ ] **Step 2: Add the same keys to bn and ms catalogs**

Add the identical key set to the `dashboardHome` object in both `bn/core.ts` and `ms/core.ts` with translated values. Bengali (`bn`):

```typescript
        greetingMorning: 'সুপ্রভাত',
        greetingAfternoon: 'শুভ অপরাহ্ন',
        greetingEvening: 'শুভ সন্ধ্যা',
        rangeToday: 'আজ',
        rangeWeek: 'এই সপ্তাহ',
        rangeMonth: 'মাস',
        sectionHealth: 'ব্যবসার অবস্থা',
        sectionAttention: 'আপনার মনোযোগ প্রয়োজন',
        sectionMoney: 'আয় ও এর উৎস',
        sectionDrivers: 'কে ও কী চালাচ্ছে',
        kpiSales: 'বিক্রয়',
        kpiNetProfit: 'নিট মুনাফা',
        kpiCashInHand: 'হাতে নগদ',
        kpiReceivables: 'বকেয়া প্রাপ্য',
        attnOverdue: '{count}টি চালান বকেয়া',
        attnLowStock: '{count}টি পণ্যের স্টক কম',
        attnDeliveries: '{count}টি অর্ডার ডেলিভারির অপেক্ষায়',
        attnRenewal: '{days} দিনে প্ল্যান নবায়ন',
        attnAllClear: 'সব কিছু ঠিক আছে 🎉',
        salesByCategory: 'বিভাগ অনুযায়ী বিক্রয়',
        salesByCategoryEmpty: 'এই সময়ে কোনো বিভাগভিত্তিক বিক্রয় নেই',
        topProducts: 'সর্বাধিক বিক্রীত পণ্য',
        topCustomers: 'শীর্ষ গ্রাহক',
        unitsSold: '{count}টি বিক্রি',
        ordersCount: '{count}টি অর্ডার',
        otherCategory: 'অন্যান্য',
        uncategorized: 'শ্রেণিবিহীন',
```

Malay (`ms`):

```typescript
        greetingMorning: 'Selamat pagi',
        greetingAfternoon: 'Selamat tengah hari',
        greetingEvening: 'Selamat petang',
        rangeToday: 'Hari ini',
        rangeWeek: 'Minggu ini',
        rangeMonth: 'Bulan',
        sectionHealth: 'Kesihatan perniagaan',
        sectionAttention: 'Perlu perhatian anda',
        sectionMoney: 'Wang masuk & sumbernya',
        sectionDrivers: 'Siapa & apa pemacunya',
        kpiSales: 'Jualan',
        kpiNetProfit: 'Untung bersih',
        kpiCashInHand: 'Tunai di tangan',
        kpiReceivables: 'Belum terima',
        attnOverdue: '{count} invois tertunggak',
        attnLowStock: '{count} produk stok rendah',
        attnDeliveries: '{count} pesanan menunggu penghantaran',
        attnRenewal: 'Pelan diperbaharui dalam {days} hari',
        attnAllClear: 'Semua selesai 🎉',
        salesByCategory: 'Jualan mengikut kategori',
        salesByCategoryEmpty: 'Tiada jualan kategori buat masa ini',
        topProducts: 'Produk paling laris',
        topCustomers: 'Pelanggan teratas',
        unitsSold: '{count} terjual',
        ordersCount: '{count} pesanan',
        otherCategory: 'Lain-lain',
        uncategorized: 'Tanpa kategori',
```

- [ ] **Step 3: Verify catalog parity**

Run: `cd apps/frontend && npx jest catalog.test`
Expected: PASS — the catalog parity test confirms all three locales share the same keys. If it fails, it names the missing/extra key; fix and re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/localization/messages
git commit -m "i18n(dashboard): add v2 dashboard copy in en/bn/ms"
```

---

### Task 4: `Sparkline` + `HealthKpiTile` components

**Files:**
- Create: `apps/frontend/src/components/dashboard/Sparkline.tsx`
- Create: `apps/frontend/src/components/dashboard/HealthKpiTile.tsx`
- Test: `apps/frontend/src/components/dashboard/HealthKpiTile.test.tsx`

**Interfaces:**
- Produces: `Sparkline({ points: number[]; className?: string })` — inline SVG polyline. `HealthKpiTile({ title: string; value: string; delta: string; deltaPositive: boolean; points: number[] })`. (Consumed by Task 10.)

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/dashboard/HealthKpiTile.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { HealthKpiTile } from './HealthKpiTile';

describe('HealthKpiTile', () => {
    it('renders title, value and delta', () => {
        render(<HealthKpiTile title="Sales" value="৳3.4L" delta="▲ 12%" deltaPositive points={[1, 2, 3]} />);
        expect(screen.getByText('Sales')).toBeInTheDocument();
        expect(screen.getByText('৳3.4L')).toBeInTheDocument();
        expect(screen.getByText('▲ 12%')).toBeInTheDocument();
    });

    it('applies the negative delta color when deltaPositive is false', () => {
        render(<HealthKpiTile title="Receivables" value="৳54k" delta="3 overdue" deltaPositive={false} points={[3, 2, 1]} />);
        expect(screen.getByText('3 overdue')).toHaveClass('text-[#dc2626]');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest HealthKpiTile`
Expected: FAIL — cannot find module `./HealthKpiTile`.

- [ ] **Step 3: Implement `Sparkline`**

Create `apps/frontend/src/components/dashboard/Sparkline.tsx`:

```tsx
'use client';

export function Sparkline({ points, className }: { points: number[]; className?: string }) {
    if (!points.length) return null;
    const w = 100;
    const h = 24;
    const max = Math.max(...points, 1);
    const min = Math.min(...points, 0);
    const range = max - min || 1;
    const step = points.length > 1 ? w / (points.length - 1) : w;
    const d = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * h).toFixed(1)}`)
        .join(' ');

    return (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`h-5 w-full ${className ?? ''}`} aria-hidden="true">
            <path d={d} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}
```

- [ ] **Step 4: Implement `HealthKpiTile`**

Create `apps/frontend/src/components/dashboard/HealthKpiTile.tsx`:

```tsx
'use client';

import { Sparkline } from './Sparkline';

export function HealthKpiTile({
    title,
    value,
    delta,
    deltaPositive,
    points,
}: {
    title: string;
    value: string;
    delta: string;
    deltaPositive: boolean;
    points: number[];
}) {
    return (
        <div className="rounded-xl border border-[#eef2f7] bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
            <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">{value}</p>
            <p className={`mt-0.5 text-[10px] font-bold ${deltaPositive ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>{delta}</p>
            <div className="mt-2">
                <Sparkline points={points} />
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest HealthKpiTile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/dashboard/Sparkline.tsx apps/frontend/src/components/dashboard/HealthKpiTile.tsx apps/frontend/src/components/dashboard/HealthKpiTile.test.tsx
git commit -m "feat(dashboard): HealthKpiTile with sparkline"
```

---

### Task 5: `SalesByCategoryDonut` component

**Files:**
- Create: `apps/frontend/src/components/dashboard/SalesByCategoryDonut.tsx`
- Test: `apps/frontend/src/components/dashboard/SalesByCategoryDonut.test.tsx`

**Interfaces:**
- Consumes: Task 2 row shape `{ categoryId: string | null; categoryName: string; revenue: number; share: number }`.
- Produces: `SalesByCategoryDonut({ rows, totalLabel, emptyLabel })` where `rows: CategoryRow[]`, `totalLabel: string`, `emptyLabel: string`. Renders a CSS `conic-gradient` donut + legend; shows `emptyLabel` when `rows` is empty. (Consumed by Task 10.)

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/dashboard/SalesByCategoryDonut.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { SalesByCategoryDonut } from './SalesByCategoryDonut';

const rows = [
    { categoryId: 'g1', categoryName: 'Electronics', revenue: 200, share: 40 },
    { categoryId: 'g2', categoryName: 'Lighting', revenue: 300, share: 60 },
];

describe('SalesByCategoryDonut', () => {
    it('renders a legend row per category with its share', () => {
        render(<SalesByCategoryDonut rows={rows} totalLabel="৳500" emptyLabel="No sales" />);
        expect(screen.getByText('Electronics')).toBeInTheDocument();
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.getByText('৳500')).toBeInTheDocument();
    });

    it('shows the empty label when there are no rows', () => {
        render(<SalesByCategoryDonut rows={[]} totalLabel="৳0" emptyLabel="No sales" />);
        expect(screen.getByText('No sales')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest SalesByCategoryDonut`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the component**

Create `apps/frontend/src/components/dashboard/SalesByCategoryDonut.tsx`:

```tsx
'use client';

export type CategoryRow = {
    categoryId: string | null;
    categoryName: string;
    revenue: number;
    share: number;
};

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#e2e8f0'];

export function SalesByCategoryDonut({
    rows,
    totalLabel,
    emptyLabel,
}: {
    rows: CategoryRow[];
    totalLabel: string;
    emptyLabel: string;
}) {
    if (!rows.length) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-xs font-medium text-gray-400">
                {emptyLabel}
            </div>
        );
    }

    let cursor = 0;
    const stops = rows
        .map((row, i) => {
            const start = cursor;
            cursor += row.share;
            return `${PALETTE[i % PALETTE.length]} ${start}% ${cursor}%`;
        })
        .join(', ');

    return (
        <div className="flex items-center gap-4">
            <div
                className="relative h-24 w-24 shrink-0 rounded-full"
                style={{ background: `conic-gradient(${stops})` }}
                aria-hidden="true"
            >
                <div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-white">
                    <span className="text-xs font-extrabold text-slate-900">{totalLabel}</span>
                </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-1">
                {rows.map((row, i) => (
                    <li key={row.categoryId ?? row.categoryName} className="flex items-center gap-2 text-[11px] text-slate-700">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="truncate">{row.categoryName}</span>
                        <span className="ml-auto font-extrabold text-slate-900">{Math.round(row.share)}%</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest SalesByCategoryDonut`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/SalesByCategoryDonut.tsx apps/frontend/src/components/dashboard/SalesByCategoryDonut.test.tsx
git commit -m "feat(dashboard): SalesByCategoryDonut component"
```

---

### Task 6: `RankedListPanel` (Top products + Top customers)

**Files:**
- Create: `apps/frontend/src/components/dashboard/RankedListPanel.tsx`
- Test: `apps/frontend/src/components/dashboard/RankedListPanel.test.tsx`

**Interfaces:**
- Produces: `RankedListPanel({ title, items, emptyLabel })` where `items: Array<{ id: string; name: string; meta: string; amount: string; avatarInitials?: string }>`. When `avatarInitials` is present it renders a colored initials circle; otherwise a neutral thumbnail square. Both Top Products and Top Customers use this one component. (Consumed by Task 10.)

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/dashboard/RankedListPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { RankedListPanel } from './RankedListPanel';

describe('RankedListPanel', () => {
    it('renders ranked items with name, meta and amount', () => {
        render(
            <RankedListPanel
                title="Top selling products"
                emptyLabel="Nothing yet"
                items={[{ id: 'p1', name: 'LED Bulb', meta: '180 sold', amount: '৳21.6k' }]}
            />,
        );
        expect(screen.getByText('Top selling products')).toBeInTheDocument();
        expect(screen.getByText('LED Bulb')).toBeInTheDocument();
        expect(screen.getByText('180 sold')).toBeInTheDocument();
        expect(screen.getByText('৳21.6k')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('renders the empty label when there are no items', () => {
        render(<RankedListPanel title="Top customers" emptyLabel="No customers yet" items={[]} />);
        expect(screen.getByText('No customers yet')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest RankedListPanel`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the component**

Create `apps/frontend/src/components/dashboard/RankedListPanel.tsx`:

```tsx
'use client';

export type RankedItem = {
    id: string;
    name: string;
    meta: string;
    amount: string;
    avatarInitials?: string;
};

const AVATAR_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4'];

export function RankedListPanel({
    title,
    items,
    emptyLabel,
}: {
    title: string;
    items: RankedItem[];
    emptyLabel: string;
}) {
    return (
        <div className="rounded-xl border border-[#eef2f7] bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h3 className="mb-2 text-xs font-bold text-slate-900">{title}</h3>
            {items.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-slate-400">{emptyLabel}</p>
            ) : (
                <ul>
                    {items.map((item, i) => (
                        <li key={item.id} className="flex items-center gap-2 border-b border-slate-50 py-1.5 text-[11px] last:border-0">
                            <span className="w-4 shrink-0 text-center font-extrabold text-slate-400">{i + 1}</span>
                            {item.avatarInitials ? (
                                <span
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                                    style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                                >
                                    {item.avatarInitials}
                                </span>
                            ) : (
                                <span className="h-6 w-6 shrink-0 rounded-md bg-slate-100" />
                            )}
                            <span className="min-w-0">
                                <span className="block truncate font-semibold text-slate-900">{item.name}</span>
                                <span className="block text-[9px] text-slate-400">{item.meta}</span>
                            </span>
                            <span className="ml-auto font-extrabold text-slate-900">{item.amount}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest RankedListPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/RankedListPanel.tsx apps/frontend/src/components/dashboard/RankedListPanel.test.tsx
git commit -m "feat(dashboard): RankedListPanel for top products & customers"
```

---

### Task 7: `AttentionStrip` component

**Files:**
- Create: `apps/frontend/src/components/dashboard/AttentionStrip.tsx`
- Test: `apps/frontend/src/components/dashboard/AttentionStrip.test.tsx`

**Interfaces:**
- Produces: `AttentionStrip({ items, allClearLabel })` where `items: Array<{ id: string; tone: 'red' | 'amber' | 'blue' | 'violet'; value: string; label: string; href: string; cta: string }>`. Renders color-coded cards; when `items` is empty renders a single all-clear card with `allClearLabel`. (Consumed by Task 10.)

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/dashboard/AttentionStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { AttentionStrip } from './AttentionStrip';

describe('AttentionStrip', () => {
    it('renders one card per attention item with a deep link', () => {
        render(
            <AttentionStrip
                allClearLabel="All caught up"
                items={[{ id: 'overdue', tone: 'red', value: '৳54k', label: '3 invoices overdue', href: '/sales', cta: 'Collect' }]}
            />,
        );
        expect(screen.getByText('3 invoices overdue')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Collect/ })).toHaveAttribute('href', '/sales');
    });

    it('renders the all-clear card when there are no items', () => {
        render(<AttentionStrip allClearLabel="All caught up" items={[]} />);
        expect(screen.getByText('All caught up')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest AttentionStrip`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the component**

Create `apps/frontend/src/components/dashboard/AttentionStrip.tsx`:

```tsx
'use client';

import Link from 'next/link';

export type AttentionTone = 'red' | 'amber' | 'blue' | 'violet';

export type AttentionItem = {
    id: string;
    tone: AttentionTone;
    value: string;
    label: string;
    href: string;
    cta: string;
};

const BORDER: Record<AttentionTone, string> = {
    red: 'border-l-[#ef4444]',
    amber: 'border-l-[#f59e0b]',
    blue: 'border-l-[#3b82f6]',
    violet: 'border-l-[#8b5cf6]',
};

export function AttentionStrip({ items, allClearLabel }: { items: AttentionItem[]; allClearLabel: string }) {
    if (!items.length) {
        return (
            <div className="rounded-xl border border-[#eef2f7] bg-white p-4 text-center text-xs font-semibold text-emerald-700 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                {allClearLabel}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {items.map((item) => (
                <Link
                    key={item.id}
                    href={item.href}
                    className={`rounded-xl border border-[#eef2f7] border-l-[3px] ${BORDER[item.tone]} bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md`}
                >
                    <p className="text-lg font-extrabold text-slate-900">{item.value}</p>
                    <p className="mt-0.5 text-[10px] text-slate-600">{item.label}</p>
                    <span className="mt-1 inline-block text-[10px] font-bold text-[#6366f1]">{item.cta} →</span>
                </Link>
            ))}
        </div>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest AttentionStrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/AttentionStrip.tsx apps/frontend/src/components/dashboard/AttentionStrip.test.tsx
git commit -m "feat(dashboard): AttentionStrip component"
```

---

### Task 8: `DashboardHeader` (greeting + range toggle)

**Files:**
- Create: `apps/frontend/src/components/dashboard/DashboardHeader.tsx`
- Test: `apps/frontend/src/components/dashboard/DashboardHeader.test.tsx`

**Interfaces:**
- Produces: `type DashboardRange = 'today' | 'week' | 'month'`. `DashboardHeader({ greeting, tenantName, subtitle, range, onRangeChange })` where `range: DashboardRange`, `onRangeChange: (r: DashboardRange) => void`. Renders three toggle buttons; clicking one calls `onRangeChange`. (Consumed by Task 10.)

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/dashboard/DashboardHeader.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardHeader } from './DashboardHeader';

describe('DashboardHeader', () => {
    it('renders greeting and calls onRangeChange when a range button is clicked', () => {
        const onRangeChange = jest.fn();
        render(
            <DashboardHeader
                greeting="Good afternoon, Karim 👋"
                tenantName="Rahim Electronics"
                subtitle="Here's how your shop is doing"
                range="week"
                onRangeChange={onRangeChange}
                labels={{ today: 'Today', week: 'This week', month: 'Month' }}
            />,
        );
        expect(screen.getByText('Good afternoon, Karim 👋')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Month' }));
        expect(onRangeChange).toHaveBeenCalledWith('month');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest DashboardHeader`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the component**

Create `apps/frontend/src/components/dashboard/DashboardHeader.tsx`:

```tsx
'use client';

export type DashboardRange = 'today' | 'week' | 'month';

export function DashboardHeader({
    greeting,
    tenantName,
    subtitle,
    range,
    onRangeChange,
    labels,
}: {
    greeting: string;
    tenantName: string;
    subtitle: string;
    range: DashboardRange;
    onRangeChange: (r: DashboardRange) => void;
    labels: Record<DashboardRange, string>;
}) {
    const ranges: DashboardRange[] = ['today', 'week', 'month'];
    return (
        <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
                <h1 className="text-lg font-extrabold tracking-tight text-slate-900">{greeting}</h1>
                <p className="mt-0.5 text-[11px] text-slate-500">
                    {tenantName} · {subtitle}
                </p>
            </div>
            <div className="flex gap-1">
                {ranges.map((r) => (
                    <button
                        key={r}
                        type="button"
                        onClick={() => onRangeChange(r)}
                        className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                            r === range
                                ? 'border-[#6366f1] bg-[#6366f1] text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                    >
                        {labels[r]}
                    </button>
                ))}
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest DashboardHeader`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/DashboardHeader.tsx apps/frontend/src/components/dashboard/DashboardHeader.test.tsx
git commit -m "feat(dashboard): DashboardHeader with range toggle"
```

---

### Task 9: Range → date-window helper

**Files:**
- Create: `apps/frontend/src/lib/dashboard-range.ts`
- Test: `apps/frontend/src/lib/dashboard-range.test.ts`

**Interfaces:**
- Consumes: `DashboardRange` from Task 8.
- Produces: `rangeToWindow(range: DashboardRange, now?: Date): { from: string; to: string }` returning ISO strings. `today` = start of today→now; `week` = 6 days ago 00:00→now; `month` = 1st of month 00:00→now. (Consumed by Task 10 to parameterize every range-aware fetch.)

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/lib/dashboard-range.test.ts`:

```ts
import { rangeToWindow } from './dashboard-range';

describe('rangeToWindow', () => {
    const now = new Date('2026-07-10T15:00:00.000Z');

    it('today starts at midnight of the current day', () => {
        const { from, to } = rangeToWindow('today', now);
        expect(from).toBe('2026-07-10T00:00:00.000Z');
        expect(to).toBe(now.toISOString());
    });

    it('week starts six days before today at midnight', () => {
        expect(rangeToWindow('week', now).from).toBe('2026-07-04T00:00:00.000Z');
    });

    it('month starts on the first of the month at midnight', () => {
        expect(rangeToWindow('month', now).from).toBe('2026-07-01T00:00:00.000Z');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest dashboard-range`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the helper**

Create `apps/frontend/src/lib/dashboard-range.ts`:

```ts
import type { DashboardRange } from '@/components/dashboard/DashboardHeader';

export function rangeToWindow(range: DashboardRange, now: Date = new Date()): { from: string; to: string } {
    const to = now.toISOString();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    if (range === 'today') {
        return { from: start.toISOString(), to };
    }
    if (range === 'week') {
        start.setUTCDate(start.getUTCDate() - 6);
        return { from: start.toISOString(), to };
    }
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: monthStart.toISOString(), to };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest dashboard-range`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/dashboard-range.ts apps/frontend/src/lib/dashboard-range.test.ts
git commit -m "feat(dashboard): rangeToWindow date helper"
```

---

### Task 10: Recompose `page.tsx` to orchestrate the widgets

**Files:**
- Modify: `apps/frontend/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/frontend/src/app/(app)/dashboard/page.test.tsx`

**Interfaces:**
- Consumes: `DashboardHeader`/`DashboardRange` (T8), `HealthKpiTile` (T4), `AttentionStrip` (T7), `SalesByCategoryDonut` (T5), `RankedListPanel` (T6), `rangeToWindow` (T9), `api.getSalesByCategory` (T2), existing `api.getFinancialKpis/getFinancialTrends/getProducts/getSales/getSalesByProduct/getSalesByCustomer`, existing `FrequentQuickLinks`, `CashFlowChart` (keep in-file), `isAccountingOnlyPlan`, i18n keys (T3).

- [ ] **Step 1: Add a smoke test for the recomposed page**

In `apps/frontend/src/app/(app)/dashboard/page.test.tsx`, following the existing mock setup in that file (it already mocks `@/lib/api`), add a test asserting the new sections render. Extend the existing `api` mock with `getSalesByCategory`, `getSalesByProduct`, and `getSalesByCustomer` returning empty shapes, then:

```tsx
it('renders the v2 dashboard sections', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText('Business health')).toBeInTheDocument();
    expect(await screen.findByText('Needs your attention')).toBeInTheDocument();
    expect(await screen.findByText('Sales by category')).toBeInTheDocument();
    expect(await screen.findByText('Top selling products')).toBeInTheDocument();
    expect(await screen.findByText('Top customers')).toBeInTheDocument();
});
```

If the existing test file asserts on old copy that this redesign removes (e.g. "Business Monitor", "Active Orders"), update those assertions to the new section labels rather than leaving them broken.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest "dashboard/page"`
Expected: FAIL — new section labels not found.

- [ ] **Step 3: Recompose `page.tsx`**

Rewrite `apps/frontend/src/app/(app)/dashboard/page.tsx` so its default export orchestrates the widgets. Keep the existing `CashFlowChart`, `formatCurrency`, and plan-mode detection. Key structure (fill in with real data mapping):

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { isAccountingOnlyPlan } from '@/lib/plan-entitlements';
import { formatMessage, useI18n } from '@/lib/i18n';
import { rangeToWindow } from '@/lib/dashboard-range';
import FrequentQuickLinks from '@/components/dashboard/FrequentQuickLinks';
import { DashboardHeader, type DashboardRange } from '@/components/dashboard/DashboardHeader';
import { HealthKpiTile } from '@/components/dashboard/HealthKpiTile';
import { AttentionStrip, type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { SalesByCategoryDonut, type CategoryRow } from '@/components/dashboard/SalesByCategoryDonut';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import PageShell from '@/components/ui/compact/PageShell';

export default function DashboardPage() {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const [range, setRange] = useState<DashboardRange>('week');
    const [accountingOnlyMode, setAccountingOnlyMode] = useState(false);
    const [greetingName, setGreetingName] = useState('');
    const [tenantName, setTenantName] = useState(copy.yourBusiness);
    // ...state for kpis, categories, topProducts, topCustomers, attention, recent, financial trends...

    useEffect(() => {
        const window = rangeToWindow(range);
        // fetch getMe (once), then Promise.allSettled the range-aware endpoints:
        //   getFinancialKpis(window), getFinancialTrends(window),
        //   getProducts(), getSales(), getSalesByCategory(window),
        //   getSalesByProduct(window), getSalesByCustomer(window)
        // gate retail fetches on !accountingOnlyMode as the current page does.
        // Map results into the widget-facing shapes below.
    }, [range]);

    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        const base = hour < 12 ? copy.greetingMorning : hour < 17 ? copy.greetingAfternoon : copy.greetingEvening;
        return greetingName ? `${base}, ${greetingName} 👋` : `${base} 👋`;
    }, [copy, greetingName]);

    return (
        <PageShell maxWidth="full">
            <div className="space-y-4">
                <DashboardHeader
                    greeting={greeting}
                    tenantName={tenantName}
                    subtitle={copy.tenantSubtitle ? formatMessage(copy.tenantSubtitle, { tenant: tenantName }) : ''}
                    range={range}
                    onRangeChange={setRange}
                    labels={{ today: copy.rangeToday, week: copy.rangeWeek, month: copy.rangeMonth }}
                />
                <FrequentQuickLinks accountingOnlyMode={accountingOnlyMode} />

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{copy.sectionHealth}</p>
                    <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                        {/* four <HealthKpiTile/>: sales, net profit, cash in hand, receivables */}
                    </div>
                </section>

                {!accountingOnlyMode && (
                    <section>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{copy.sectionAttention}</p>
                        <AttentionStrip items={attentionItems} allClearLabel={copy.attnAllClear} />
                    </section>
                )}

                <section>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{copy.sectionMoney}</p>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
                        <div className="rounded-xl border border-[#eef2f7] bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                            {/* keep existing CashFlowChart, fed by financial trend points */}
                        </div>
                        {!accountingOnlyMode && (
                            <div className="rounded-xl border border-[#eef2f7] bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                                <h3 className="mb-2 text-xs font-bold text-slate-900">{copy.salesByCategory}</h3>
                                <SalesByCategoryDonut rows={categoryRows} totalLabel={formatBDT(categoryTotal, { locale })} emptyLabel={copy.salesByCategoryEmpty} />
                            </div>
                        )}
                    </div>
                </section>

                {!accountingOnlyMode && (
                    <section>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{copy.sectionDrivers}</p>
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                            <RankedListPanel title={copy.topProducts} items={topProducts} emptyLabel={copy.noProductsFound} />
                            <RankedListPanel title={copy.topCustomers} items={topCustomers} emptyLabel={copy.noRecentActivity} />
                            {/* RankedListPanel or existing ActivityItem list for recent activity */}
                        </div>
                    </section>
                )}
            </div>
        </PageShell>
    );
}
```

Map endpoint results into the widget shapes:
- **HealthKpiTile** — sales from `getFinancialKpis().kpis.gross_revenue`; net profit from trend `comparison.net_profit`; cash from `net_cash_movement`; receivables from `accounts_receivable`. `points` from `getFinancialTrends().points` (e.g. `net_profit` per point). `delta`/`deltaPositive` computed from sign.
- **AttentionStrip** — build `AttentionItem[]` client-side: low-stock count (products where `reorder_level != null && stock_quantity <= reorder_level`, href `/inventory`), overdue receivables (from KPIs, href `/sales`), pending deliveries (sales with delivery-pending status, href `/sales`), renewal days (from `getMe` tenant subscription, href `/billing`). Omit any item whose count is 0.
- **SalesByCategoryDonut** — `rows = getSalesByCategory().rows` (already `CategoryRow[]`), replacing server `categoryName === 'Other'` with `copy.otherCategory` and `'Uncategorized'` with `copy.uncategorized`; `categoryTotal = summary.totalRevenue`.
- **RankedListPanel (products)** — `getSalesByProduct().rows.slice(0,4)` → `{ id: product_id, name: product.name, meta: formatMessage(copy.unitsSold, { count: unitsSold }), amount: formatBDT(revenue, { locale }) }`.
- **RankedListPanel (customers)** — `getSalesByCustomer()` rows `.slice(0,4)` → `{ id, name, meta: formatMessage(copy.ordersCount, { count }), amount, avatarInitials }` (initials = first letters of the customer name).

Keep per-widget loading skeletons and the amber inline error notice from the current page.

- [ ] **Step 4: Run the page test to verify it passes**

Run: `cd apps/frontend && npx jest "dashboard/page"`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/frontend && npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual verification (per the `verify` skill)**

Run the app (`npm run dev` in `apps/frontend`, backend running), open `/dashboard`, confirm: greeting + range toggle switches data; health KPIs with sparklines; attention strip deep-links; category donut renders with legend; top products & customers populate; resize to mobile (375px) — all grids collapse to one column. Confirm an accounting-only-plan tenant hides retail panels.

- [ ] **Step 7: Commit**

```bash
git add "apps/frontend/src/app/(app)/dashboard/page.tsx" "apps/frontend/src/app/(app)/dashboard/page.test.tsx"
git commit -m "feat(dashboard): recompose Business Monitor v2 from widget components"
```

---

### Task 11: E2E smoke coverage + TODO.md update

**Files:**
- Modify: the `@readonly` dashboard E2E spec under `apps/frontend/e2e/` (the one that already loads `/dashboard`)
- Modify: `TODO.md`

**Interfaces:** none.

- [ ] **Step 1: Extend the read-only dashboard E2E**

In the existing `@readonly` Playwright spec that visits `/dashboard`, add assertions that the new section headings are visible (localized "Business health" / "Sales by category" / "Top customers"). Follow the existing selectors/pattern in that file — do not introduce mutating actions (keep it read-only).

- [ ] **Step 2: Run the read-only suite locally**

Run: `cd apps/frontend && npx playwright test --grep @readonly`
Expected: the dashboard case PASSES (or is skipped only if the suite requires a seeded/live target — in that case confirm it compiles with `npx playwright test --list --grep @readonly`).

- [ ] **Step 3: Update TODO.md**

Per `CLAUDE.md`, move the completed dashboard work into the `## COMPLETED` section with today's date and add any discovered follow-ups (e.g. "Extract `GET /dashboard/attention` aggregator if client assembly is slow", "Add top-suppliers panel"):

```markdown
- [x] Redesign owner dashboard (Business Monitor v2): Clean & Airy layout, health KPIs w/ sparklines, attention strip, sales-by-category donut, top products & customers; new GET /sales-reports/by-category — done 2026-07-10
```

- [ ] **Step 4: Commit**

```bash
git add TODO.md apps/frontend/e2e
git commit -m "test(dashboard): read-only E2E coverage for Business Monitor v2 + TODO"
```

---

## Self-Review

**Spec coverage:**
- Visual system → Tasks 4–10 use the exact tokens (Global Constraints). ✓
- Layout (greeting/range, quick actions, health, attention, money band w/ donut, drivers band) → Tasks 8, 10 (quick actions reuse `FrequentQuickLinks`), 4, 7, 5, 6. ✓
- Data flow — reused endpoints + new `by-category` → Tasks 1, 2, 10. ✓
- Attention strip client-side assembly → Task 10 Step 3. ✓
- Component decomposition (8 widgets) → Tasks 4–8 (Sparkline, HealthKpiTile, SalesByCategoryDonut, RankedListPanel×2 uses, AttentionStrip, DashboardHeader; SalesExpenseChart kept as in-file `CashFlowChart`; RecentActivity via RankedListPanel/existing ActivityItem). ✓
- Loading/error/empty states → carried in Tasks 5,6,7 (empty labels) + Task 10 Step 3 (skeletons/errors kept). ✓
- i18n en/bn/ms → Task 3. ✓
- Testing (component specs, service spec, E2E, plan-mode) → each component task + Task 1 + Task 11; plan-mode gating exercised in Task 10. ✓
- Accounting-only plan mode → Task 10 gates retail sections. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases" in code steps. Task 10 Step 3 intentionally shows the composition skeleton with an explicit data-mapping list rather than a 400-line verbatim file — every mapping and prop shape is spelled out and every dependency is a concrete symbol from an earlier task. ✓

**Type consistency:** `DashboardRange` defined in Task 8, consumed by Tasks 9 & 10. `CategoryRow` (T5), `RankedItem` (T6), `AttentionItem` (T7) match their usage in T10. `getSalesByCategory` return shape identical across T1 (service), T2 (client), T5/T10 (consumer). ✓
