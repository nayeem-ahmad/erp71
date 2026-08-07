# Referral Portal Pages and Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the referral partner portal's signups and payment history onto their own routes with sidebar entries, and replace the two tables on the dashboard with three charts.

**Architecture:** The portal keeps its single backend endpoint, `GET /referrals/me/ledger`. `getLedger` grows two things: an `activity` array of twelve monthly buckets, and the commissions each payment settled. All three frontend pages call that one endpoint. Charts are hand-rolled SVG components — this repo has no charting library — following the pattern already established by `CashFlowChart`.

**Tech Stack:** NestJS + Prisma (backend), Next.js 15 App Router + React + TanStack Table + Tailwind (frontend), Jest + React Testing Library (tests).

**Spec:** [`docs/superpowers/specs/2026-08-06-referral-portal-pages-and-charts-design.md`](../specs/2026-08-06-referral-portal-pages-and-charts-design.md)

## Global Constraints

These apply to every task. They come from `CLAUDE.md` and the spec.

- Work on the `dev` branch. Never commit to `main` — a git hook blocks it.
- Every `(app)` page uses `PageShell` + `PageHeader`. Never hand-copy the page wrapper class string.
- Every modal uses `ModalShell` (`@/components/ModalShell`, default export). Never hand-roll a `fixed inset-0` overlay.
- One accent color: `blue-600` for primary actions and links. Semantic colors: emerald = success, amber = warning, red = danger.
- No arbitrary hex Tailwind classes such as `bg-[#f3f4f6]`. No `rounded-2xl` / `rounded-3xl`. No `font-black uppercase tracking-widest` in app code. **Exception:** SVG `fill` / `stroke` attributes inside chart components take literal hex values, as `CashFlowChart` already does — that is an SVG attribute, not a Tailwind class.
- Compact density: `text-sm` / `text-xs` body, `p-3 md:p-4` page padding, `space-y-4` sections.
- Money always through `formatBDT()` from `@/lib/format`. Never a literal `$`.
- Mobile: ≥44px touch targets, `hideOnMobile` on secondary columns of wide tables, no horizontal body scroll at 360px.
- All user-facing strings go through i18n, added to **all three** locales: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts`.
- Chart colors are fixed at exactly two hues, already validated against light and dark surfaces: **blue `#2563eb`** and **emerald `#047857`**. Do not substitute or add a third. Their tritan separation is ΔE 7.5, inside the 6–8 floor band, so **every multi-series chart must carry a legend and direct labels** — hue alone is not permitted as the sole encoding.
- Backend tests: `cd apps/backend && npx jest src/referrals`. Frontend tests: `cd apps/frontend && npx jest <path>`.
- After the final task, update `TODO.md` per `CLAUDE.md`.

---

## File Structure

**Backend**

| File | Responsibility |
| --- | --- |
| `apps/backend/src/referrals/referral-activity.ts` (create) | Pure monthly-bucketing helper. No Prisma, no Nest — just dates in, buckets out. Isolated so it is trivially testable. |
| `apps/backend/src/referrals/referral-activity.spec.ts` (create) | Unit tests for the bucketing helper. |
| `apps/backend/src/referrals/referrals.service.ts` (modify) | `getLedger` calls the helper and adds `activity`; payments query gains the commissions include. |
| `apps/backend/src/referrals/referrals.service.spec.ts` (modify) | Integration-level tests that `getLedger` returns the new fields. |

**Frontend — shared**

| File | Responsibility |
| --- | --- |
| `apps/frontend/src/lib/routes.ts` (modify) | `referralsPortal` becomes an object with `root` / `signups` / `payments`. |
| `apps/frontend/src/components/admin/referrals/types.ts` (modify) | `ReferralActivityPoint` type; `activity` on `RefereeLedger`; `commissions` on `RefereePayment`. |
| `apps/frontend/src/components/Sidebar.tsx` (modify) | Two new referee nav children. |
| `apps/frontend/src/app/(app)/layout.tsx`, `src/lib/auth-session.ts` (modify) | `.root` on the eight `referralsPortal` references. |
| `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts` (modify) | New `referralPortal` keys. |

**Frontend — charts** (each its own file; they share nothing but the palette constants)

| File | Responsibility |
| --- | --- |
| `apps/frontend/src/components/referrals/chart-theme.ts` (create) | The two hex hues, fills, and the shared `niceStep` / `compact` axis helpers. |
| `apps/frontend/src/components/referrals/ActivityChart.tsx` (create) | Chart A — two stacked panels, shared x-axis. |
| `apps/frontend/src/components/referrals/EarningsChart.tsx` (create) | Chart B — grouped columns, earned vs paid. |
| `apps/frontend/src/components/referrals/FunnelChart.tsx` (create) | Chart C — four descending bars with drop-off. |
| `apps/frontend/src/components/referrals/funnel-model.ts` (create) | Pure stage/drop-off math for the funnel, separated so the zero-clicks case is unit-testable without rendering. |
| `apps/frontend/src/components/referrals/*.test.tsx` / `.test.ts` (create) | One test file per chart plus the funnel model. |

**Frontend — pages**

| File | Responsibility |
| --- | --- |
| `apps/frontend/src/app/(app)/referrals/use-referee-ledger.ts` (create) | Shared fetch hook. All three pages call the one endpoint through it; without this the fetch/error/loading block is copy-pasted three times. |
| `apps/frontend/src/app/(app)/referrals/page.tsx` (modify) | Dashboard — share cards, tiles, three charts. Tables removed. |
| `apps/frontend/src/app/(app)/referrals/signups/page.tsx` (create) | Signups list. |
| `apps/frontend/src/app/(app)/referrals/payments/page.tsx` (create) | Payment history list. |
| `apps/frontend/src/components/referrals/PaymentDetailModal.tsx` (create) | Modal listing the commissions a payout settled. |

---

## Task 1: Monthly bucketing helper

The pure date math, on its own, before anything touches Prisma.

**Files:**

- Create: `apps/backend/src/referrals/referral-activity.ts`
- Test: `apps/backend/src/referrals/referral-activity.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export type ReferralActivityPoint = { month: string; clicks: number; signups: number; earned_amount: number; paid_amount: number }`
  - `export function buildActivity(input: ActivityInput, now: Date): ReferralActivityPoint[]` where
    `ActivityInput = { clicks: Array<{ occurred_at: Date }>; signups: Array<{ signed_up_at: Date; earned_at: Date | null; status: string; commission_amount: unknown }>; payments: Array<{ paid_at: Date; amount: unknown }> }`
  - `export const ACTIVITY_MONTHS = 12`
  - `export function activityWindowStart(now: Date): Date` — first day of the earliest bucket, midnight local. `getLedger` uses this for the click query's `where`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/referrals/referral-activity.spec.ts`:

```ts
import { buildActivity, activityWindowStart, ACTIVITY_MONTHS } from './referral-activity';

/**
 * The activity buckets drive the partner-facing charts. A silent mistake here
 * does not corrupt money, but it does tell a partner their promotion is not
 * working when it is — so the cases below pin the boundaries: which date field
 * each series buckets on, that empty months stay present, and that a reversed
 * commission never counts as earned.
 */
describe('buildActivity', () => {
    const now = new Date('2026-08-06T10:00:00');

    const empty = { clicks: [], signups: [], payments: [] };

    it('always returns twelve buckets, oldest first, ending with the current month', () => {
        const result = buildActivity(empty, now);

        expect(result).toHaveLength(ACTIVITY_MONTHS);
        expect(result[0].month).toBe('2025-09');
        expect(result[ACTIVITY_MONTHS - 1].month).toBe('2026-08');
    });

    it('keeps months with no activity present and zeroed rather than closing the gap', () => {
        const result = buildActivity(
            { ...empty, clicks: [{ occurred_at: new Date('2026-08-01T00:00:00') }] },
            now,
        );

        expect(result.find((p) => p.month === '2026-08')?.clicks).toBe(1);
        expect(result.find((p) => p.month === '2026-07')).toEqual({
            month: '2026-07',
            clicks: 0,
            signups: 0,
            earned_amount: 0,
            paid_amount: 0,
        });
    });

    it('buckets each series on its own date field', () => {
        const result = buildActivity(
            {
                clicks: [{ occurred_at: new Date('2026-06-15T00:00:00') }],
                signups: [{
                    signed_up_at: new Date('2026-06-20T00:00:00'),
                    earned_at: new Date('2026-07-02T00:00:00'),
                    status: 'EARNED',
                    commission_amount: 400,
                }],
                payments: [{ paid_at: new Date('2026-08-01T00:00:00'), amount: 400 }],
            },
            now,
        );

        const at = (month: string) => result.find((p) => p.month === month)!;
        expect(at('2026-06').clicks).toBe(1);
        expect(at('2026-06').signups).toBe(1);
        // Earned lands in its earned_at month, not its signed_up_at month.
        expect(at('2026-06').earned_amount).toBe(0);
        expect(at('2026-07').earned_amount).toBe(400);
        expect(at('2026-08').paid_amount).toBe(400);
    });

    it('counts a PAID commission toward earned at its earned_at, not its paid_at', () => {
        const result = buildActivity(
            {
                ...empty,
                signups: [{
                    signed_up_at: new Date('2026-05-01T00:00:00'),
                    earned_at: new Date('2026-05-10T00:00:00'),
                    status: 'PAID',
                    commission_amount: 250,
                }],
            },
            now,
        );

        expect(result.find((p) => p.month === '2026-05')?.earned_amount).toBe(250);
    });

    it('leaves a REVERSED commission out of earned entirely', () => {
        const result = buildActivity(
            {
                ...empty,
                signups: [{
                    signed_up_at: new Date('2026-05-01T00:00:00'),
                    earned_at: new Date('2026-05-10T00:00:00'),
                    status: 'REVERSED',
                    commission_amount: 250,
                }],
            },
            now,
        );

        expect(result.find((p) => p.month === '2026-05')?.earned_amount).toBe(0);
        // The signup itself still happened, so it is still counted.
        expect(result.find((p) => p.month === '2026-05')?.signups).toBe(1);
    });

    it('ignores rows older than the window instead of folding them into the first bucket', () => {
        const result = buildActivity(
            { ...empty, clicks: [{ occurred_at: new Date('2024-01-01T00:00:00') }] },
            now,
        );

        expect(result.every((p) => p.clicks === 0)).toBe(true);
    });

    it('rounds money to two decimals so float sums do not drift', () => {
        const result = buildActivity(
            {
                ...empty,
                payments: [
                    { paid_at: new Date('2026-08-01T00:00:00'), amount: 0.1 },
                    { paid_at: new Date('2026-08-02T00:00:00'), amount: 0.2 },
                ],
            },
            now,
        );

        expect(result.find((p) => p.month === '2026-08')?.paid_amount).toBe(0.3);
    });
});

describe('activityWindowStart', () => {
    it('returns midnight on the first day of the earliest bucket', () => {
        const start = activityWindowStart(new Date('2026-08-06T10:00:00'));

        expect(start.getFullYear()).toBe(2025);
        expect(start.getMonth()).toBe(8); // September, zero-indexed
        expect(start.getDate()).toBe(1);
        expect(start.getHours()).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && npx jest src/referrals/referral-activity`
Expected: FAIL — "Cannot find module './referral-activity'".

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/referrals/referral-activity.ts`:

```ts
/**
 * Monthly activity buckets for the referral partner portal's charts.
 *
 * Kept free of Prisma and Nest on purpose: the date-boundary rules are the part
 * that is easy to get subtly wrong, and they are worth testing without a mocked
 * database in the way.
 *
 * Buckets use the server's local timezone, matching the rest of the platform's
 * date handling.
 */

export const ACTIVITY_MONTHS = 12;

export type ReferralActivityPoint = {
    /** 'YYYY-MM' */
    month: string;
    clicks: number;
    signups: number;
    /** BDT commission that became earned in this month. */
    earned_amount: number;
    /** BDT actually paid out in this month. */
    paid_amount: number;
};

export type ActivityInput = {
    clicks: Array<{ occurred_at: Date }>;
    signups: Array<{
        signed_up_at: Date;
        earned_at: Date | null;
        status: string;
        commission_amount: unknown;
    }>;
    payments: Array<{ paid_at: Date; amount: unknown }>;
};

/** Money is stored to two decimals; float sums drift without this. */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function monthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * First day of the earliest bucket, at midnight. `getLedger` uses this to bound
 * the click query rather than fetching a partner's entire click history.
 */
export function activityWindowStart(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth() - (ACTIVITY_MONTHS - 1), 1, 0, 0, 0, 0);
}

export function buildActivity(input: ActivityInput, now: Date): ReferralActivityPoint[] {
    const buckets = new Map<string, ReferralActivityPoint>();

    for (let offset = ACTIVITY_MONTHS - 1; offset >= 0; offset -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const month = monthKey(date);
        buckets.set(month, { month, clicks: 0, signups: 0, earned_amount: 0, paid_amount: 0 });
    }

    const add = (date: Date | null, apply: (point: ReferralActivityPoint) => void) => {
        if (!date) return;
        const point = buckets.get(monthKey(date));
        // Rows outside the window are dropped, not folded into the first bucket —
        // an old click is not September's traffic.
        if (point) apply(point);
    };

    for (const click of input.clicks) {
        add(click.occurred_at, (point) => { point.clicks += 1; });
    }

    for (const signup of input.signups) {
        add(signup.signed_up_at, (point) => { point.signups += 1; });

        // REVERSED is excluded deliberately, matching getLedger's total_earned_amount:
        // a clawed-back commission was never earned.
        if (signup.status === 'EARNED' || signup.status === 'PAID') {
            add(signup.earned_at, (point) => {
                point.earned_amount += Number(signup.commission_amount ?? 0);
            });
        }
    }

    for (const payment of input.payments) {
        add(payment.paid_at, (point) => { point.paid_amount += Number(payment.amount ?? 0); });
    }

    return [...buckets.values()].map((point) => ({
        ...point,
        earned_amount: round2(point.earned_amount),
        paid_amount: round2(point.paid_amount),
    }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend && npx jest src/referrals/referral-activity`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/referrals/referral-activity.ts apps/backend/src/referrals/referral-activity.spec.ts
git commit -m "feat(referrals): monthly activity bucketing helper for the partner charts"
```

---

## Task 2: Wire activity and payment commissions into `getLedger`

**Files:**

- Modify: `apps/backend/src/referrals/referrals.service.ts` (the `getLedger` method, currently starting at line 533)
- Test: `apps/backend/src/referrals/referrals.service.spec.ts` (the existing `describe('getLedger')` block, starting at line 516)

**Interfaces:**

- Consumes: `buildActivity`, `activityWindowStart`, `ReferralActivityPoint` from Task 1.
- Produces: `getLedger` returns two additional fields — `activity: ReferralActivityPoint[]` at the top level, and `commissions` on each element of `payments`.

- [ ] **Step 1: Add default mocks for the new query to the existing `getLedger` block**

The `describe('getLedger')` `beforeEach` at line 517 currently mocks only `db.referee.findUnique`. `jest.resetAllMocks()` runs before it, so an unmocked call returns `undefined` and `.map` on it throws. Add defaults so the seven existing tests keep passing without being individually edited:

```ts
    describe('getLedger', () => {
        beforeEach(() => {
            db.referee.findUnique.mockResolvedValue({
                id: 'referee-1',
                name: 'Rahman Traders',
                email: 'rahman@example.com',
                referral_code: 'RAHMA1B2C3',
                deleted_at: null,
            });
            // Defaults so tests that care only about the money arithmetic do not each
            // have to mock the activity queries. Individual tests override as needed.
            db.referralSignup.findMany.mockResolvedValue([]);
            db.refereePayment.findMany.mockResolvedValue([]);
            db.referralClick.count.mockResolvedValue(0);
            db.referralClick.findMany.mockResolvedValue([]);
        });
```

- [ ] **Step 2: Write the failing tests**

Add these inside the same `describe('getLedger')` block, after the existing tests:

```ts
        it('returns twelve monthly activity buckets alongside the ledger', async () => {
            const ledger = await service.getLedger('referee-1');

            expect(ledger.activity).toHaveLength(12);
            expect(ledger.activity[11].month).toMatch(/^\d{4}-\d{2}$/);
        });

        it('bounds the click query for the buckets to the twelve-month window', async () => {
            await service.getLedger('referee-1');

            expect(db.referralClick.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        referee_id: 'referee-1',
                        occurred_at: expect.objectContaining({ gte: expect.any(Date) }),
                    }),
                    select: { occurred_at: true },
                }),
            );
        });

        it('keeps summary.clicks as the all-time count, not the windowed one', async () => {
            db.referralClick.count.mockResolvedValue(500);
            db.referralClick.findMany.mockResolvedValue([{ occurred_at: new Date() }]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.summary.clicks).toBe(500);
            expect(ledger.activity.reduce((sum, p) => sum + p.clicks, 0)).toBe(1);
        });

        it('returns each payment with the commissions it settled', async () => {
            db.refereePayment.findMany.mockResolvedValue([{
                id: 'payment-1',
                referee_id: 'referee-1',
                amount: 200,
                method: 'bKash',
                reference: 'TRX1',
                notes: null,
                paid_at: new Date('2026-07-05T00:00:00.000Z'),
                created_by: null,
                created_at: new Date('2026-07-05T00:00:00.000Z'),
                commissions: [signup({ id: 'commission-3', status: 'PAID', commission_amount: 200 })],
            }]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.payments[0].commissions).toHaveLength(1);
            expect(ledger.payments[0].commissions[0].commission_amount).toBe(200);
        });

        it('gives a payment with no linked commissions an empty array, never undefined', async () => {
            db.refereePayment.findMany.mockResolvedValue([{
                id: 'payment-1',
                referee_id: 'referee-1',
                amount: 200,
                paid_at: new Date('2026-07-05T00:00:00.000Z'),
            }]);

            const ledger = await service.getLedger('referee-1');

            expect(ledger.payments[0].commissions).toEqual([]);
        });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/backend && npx jest src/referrals/referrals.service -t "getLedger"`
Expected: FAIL — the five new tests fail on `ledger.activity` being undefined and `commissions` being undefined. The seven pre-existing tests must still PASS; if any broke, the Step 1 mock defaults are wrong and must be fixed before continuing.

- [ ] **Step 4: Write the implementation**

At the top of `referrals.service.ts`, add the import:

```ts
import { buildActivity, activityWindowStart } from './referral-activity';
```

Then replace the query block and the return statement inside `getLedger`. The current `Promise.all` destructures three values; it becomes four:

```ts
        const now = new Date();
        const [commissions, payments, clicks, windowedClicks] = await Promise.all([
            this.db.referralSignup.findMany({
                where: { referee_id: refereeId },
                orderBy: { signed_up_at: 'desc' },
                include: { tenant: { select: { id: true, name: true } } },
            }),
            this.db.refereePayment.findMany({
                where: { referee_id: refereeId },
                orderBy: { paid_at: 'desc' },
                // The portal's payment page shows what each payout settled; this is the
                // same join listPayments already performs.
                include: {
                    commissions: { include: { tenant: { select: { id: true, name: true } } } },
                },
            }),
            this.db.referralClick.count({ where: { referee_id: refereeId } }),
            // summary.clicks above is all-time. The chart buckets only span twelve
            // months, so they get their own bounded query rather than reusing it.
            this.db.referralClick.findMany({
                where: { referee_id: refereeId, occurred_at: { gte: activityWindowStart(now) } },
                select: { occurred_at: true },
            }),
        ]);
```

Leave the `totalEarned` / `totalReversed` / `totalPaid` block exactly as it is. Then in the return object, add `activity` after `summary` and give payments their commissions:

```ts
            activity: buildActivity(
                { clicks: windowedClicks, signups: commissions, payments },
                now,
            ),
            commissions: commissions.map(this.mapSignup),
            payments: payments.map((p) => ({
                ...this.mapPayment(p),
                commissions: (p.commissions ?? []).map(this.mapSignup),
            })),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/backend && npx jest src/referrals`
Expected: PASS — the whole referrals suite, including the untouched `listPayments` and `recordPayment` tests.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/referrals/referrals.service.ts apps/backend/src/referrals/referrals.service.spec.ts
git commit -m "feat(referrals): add activity buckets and payment commissions to the portal ledger"
```

---

## Task 3: Routes, types, and sidebar entries

Frontend plumbing, before any page exists. After this task the app still works exactly as before — only the route constants change shape and two nav links appear.

**Files:**

- Modify: `apps/frontend/src/lib/routes.ts:236`
- Modify: `apps/frontend/src/components/admin/referrals/types.ts`
- Modify: `apps/frontend/src/components/Sidebar.tsx:211-222`
- Modify: `apps/frontend/src/app/(app)/layout.tsx` lines 101, 102, 216, 276, 330
- Modify: `apps/frontend/src/lib/auth-session.ts` lines 168, 191
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts`
- Test: `apps/frontend/src/components/Sidebar.test.tsx`

**Interfaces:**

- Consumes: `ReferralActivityPoint` shape from Task 1 (mirrored, not imported — the frontend has its own types file).
- Produces:
  - `routes.referralsPortal.root` / `.signups` / `.payments`
  - `ReferralActivityPoint` type exported from `components/admin/referrals/types.ts`
  - `RefereeLedger.activity: ReferralActivityPoint[]`
  - `RefereePayment.commissions?: ReferralCommission[]`
  - i18n keys `referralPortal.nav.signups` and `referralPortal.nav.payments`

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/components/Sidebar.test.tsx`, inside the existing top-level `describe`:

```ts
    it('shows the three referee portal destinations in referee mode', () => {
        render(<Sidebar refereeMode />);

        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Signups')).toBeInTheDocument();
        expect(screen.getByText('Payment history')).toBeInTheDocument();
    });

    it('hides the referee portal destinations outside referee mode', () => {
        render(<Sidebar canAccessAccounting />);

        expect(screen.queryByText('Payment history')).not.toBeInTheDocument();
    });
```

The `lucide-react` mock in that file lists icons explicitly, so add `Wallet: icon,` to it. `Users` and `LayoutDashboard` are already listed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest src/components/Sidebar.test.tsx -t "referee portal destinations"`
Expected: FAIL — "Unable to find an element with the text: Signups".

- [ ] **Step 3: Change the route constants**

In `apps/frontend/src/lib/routes.ts`, replace line 236:

```ts
    referralsPortal: {
        root: '/referrals',
        signups: '/referrals/signups',
        payments: '/referrals/payments',
    },
```

Then update all eight consumers to `.root`. In `apps/frontend/src/app/(app)/layout.tsx`:

- line 101: `if (!pathname.startsWith(routes.referralsPortal.root)) {`
- line 102: `router.replace(routes.referralsPortal.root);`
- line 216: `if (pathname === routes.home) router.replace(routes.referralsPortal.root);`
- line 276: `if (!pathname.startsWith(routes.referralsPortal.root)) return;`
- line 330: `if (!user?.referee?.is_active && pathname.startsWith(routes.referralsPortal.root)) {`

In `apps/frontend/src/lib/auth-session.ts`:

- line 168: `return { redirectTo: routes.referralsPortal.root };`
- line 191: `if (pathname.startsWith(routes.referralsPortal.root)) return false;`

These are access guards. If one is missed, `startsWith` receives an object, the comparison silently fails, and a non-referee is no longer redirected out of the portal. Run `grep -rn "referralsPortal" apps/frontend/src` afterwards and confirm every hit outside `routes.ts` ends in `.root`, `.signups`, or `.payments`.

- [ ] **Step 4: Extend the types**

In `apps/frontend/src/components/admin/referrals/types.ts`, add the new type and extend two existing ones:

```ts
/** One month of partner activity, as returned by the ledger endpoint. */
export type ReferralActivityPoint = {
    /** 'YYYY-MM' */
    month: string;
    clicks: number;
    signups: number;
    earned_amount: number;
    paid_amount: number;
};
```

Add to `RefereePayment`:

```ts
    /** The commissions this payout settled. Absent on the admin endpoints. */
    commissions?: ReferralCommission[];
```

Add to `RefereeLedger`, after `summary`:

```ts
    /** Twelve monthly buckets, oldest first, ending with the current month. */
    activity: ReferralActivityPoint[];
```

`activity` is required rather than optional: the ledger endpoint always returns it, and making it optional would push a `?? []` into every chart.

- [ ] **Step 5: Add the sidebar entries**

In `apps/frontend/src/components/Sidebar.tsx`, replace the `refereeMode` block at lines 211-223:

```tsx
        if (refereeMode) {
            const portal = (t as { referralPortal?: {
                breadcrumb?: string;
                dashboard?: string;
                nav?: { signups?: string; payments?: string };
            } }).referralPortal;
            return [{
                key: 'referrals',
                label: portal?.breadcrumb ?? 'Referrals',
                icon: Gift,
                children: [
                    {
                        href: routes.referralsPortal.root,
                        label: portal?.dashboard ?? 'Dashboard',
                        icon: LayoutDashboard,
                        exact: true,
                    },
                    {
                        href: routes.referralsPortal.signups,
                        label: portal?.nav?.signups ?? 'Signups',
                        icon: Users,
                    },
                    {
                        href: routes.referralsPortal.payments,
                        label: portal?.nav?.payments ?? 'Payment history',
                        icon: Wallet,
                    },
                ],
            }] as NavModule[];
        }
```

`exact: true` stays on Dashboard only, so it does not stay highlighted on the two child routes. Add `Wallet` to the `lucide-react` import at the top of the file; `Users` and `LayoutDashboard` are already imported.

- [ ] **Step 6: Add the i18n keys**

In each of `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts`, add a `nav` block inside `referralPortal`, after the `dashboard` key.

English:

```ts
        nav: {
            signups: 'Signups',
            payments: 'Payment history',
        },
```

Bangla:

```ts
        nav: {
            signups: 'সাইনআপ',
            payments: 'পেমেন্ট ইতিহাস',
        },
```

Malay:

```ts
        nav: {
            signups: 'Pendaftaran',
            payments: 'Sejarah pembayaran',
        },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/frontend && npx jest src/components/Sidebar.test.tsx`
Expected: PASS, including the pre-existing cases.

Then confirm nothing else broke on the route change:

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: no errors. A `string` vs object mismatch on `referralsPortal` surfaces here.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/lib/routes.ts apps/frontend/src/lib/auth-session.ts \
  "apps/frontend/src/app/(app)/layout.tsx" apps/frontend/src/components/Sidebar.tsx \
  apps/frontend/src/components/Sidebar.test.tsx \
  apps/frontend/src/components/admin/referrals/types.ts \
  apps/frontend/src/lib/localization/messages/en/core.ts \
  apps/frontend/src/lib/localization/messages/bn/core.ts \
  apps/frontend/src/lib/localization/messages/ms/core.ts
git commit -m "feat(referrals): portal sub-routes, activity types, and partner nav entries"
```

---

## Task 4: Shared ledger hook and the two list pages

The pages first, charts second — this way the split the user asked for lands and is testable before any SVG exists.

**Files:**

- Create: `apps/frontend/src/app/(app)/referrals/use-referee-ledger.ts`
- Create: `apps/frontend/src/components/referrals/PaymentDetailModal.tsx`
- Create: `apps/frontend/src/app/(app)/referrals/signups/page.tsx`
- Create: `apps/frontend/src/app/(app)/referrals/payments/page.tsx`
- Test: `apps/frontend/src/app/(app)/referrals/signups/page.test.tsx`
- Test: `apps/frontend/src/app/(app)/referrals/payments/page.test.tsx`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts`

**Interfaces:**

- Consumes: `routes.referralsPortal.*` and the extended types from Task 3; `api.getRefereePortalLedger()`, which already exists at `apps/frontend/src/lib/api.ts:2215`.
- Produces:
  - `export function useRefereeLedger(): { ledger: RefereeLedger | null; error: string; isLoading: boolean; reload: () => Promise<void> }`
  - `export default function PaymentDetailModal({ payment, labels, onClose }: { payment: RefereePayment; labels: PaymentDetailLabels; onClose: () => void })`
  - `export type PaymentDetailLabels = { title: string; business: string; commission: string; signedUp: string; none: string; close: string }`

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/app/(app)/referrals/signups/page.test.tsx`:

```tsx
'use client';

import { render, screen, waitFor } from '@testing-library/react';
import SignupsPage from './page';

const getRefereePortalLedger = jest.fn();

jest.mock('@/lib/api', () => ({
    api: { getRefereePortalLedger: () => getRefereePortalLedger() },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../../../lib/localization/messages/en');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, string | number>) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
});

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => <span data-testid="icon" /> }));

const ledger = {
    referee: {
        id: 'referee-1',
        name: 'Rahman Traders',
        email: 'rahman@example.com',
        referral_code: 'RAHMA1B2C3',
        deleted_at: null,
    },
    summary: {
        clicks: 40,
        conversion_rate: 5,
        total_referrals: 2,
        pending: 1,
        earned: 1,
        paid: 0,
        reversed: 0,
        total_earned_amount: 399.9,
        total_reversed_amount: 0,
        total_paid_amount: 0,
        balance_due: 399.9,
        overpaid_amount: 0,
    },
    activity: [],
    commissions: [
        {
            id: 'commission-1',
            referee_id: 'referee-1',
            tenant_id: 'tenant-1',
            tenant: { id: 'tenant-1', name: 'Dhaka Retail' },
            discount_pct: 10,
            commission_pct: 10,
            plan_amount: 3999,
            commission_amount: 399.9,
            status: 'EARNED' as const,
            signed_up_at: '2026-07-01T00:00:00.000Z',
            earned_at: '2026-07-03T00:00:00.000Z',
        },
        {
            id: 'commission-2',
            referee_id: 'referee-1',
            tenant_id: 'tenant-2',
            tenant: { id: 'tenant-2', name: 'Chittagong Mart' },
            discount_pct: 10,
            commission_pct: 10,
            plan_amount: null,
            commission_amount: null,
            status: 'PENDING' as const,
            signed_up_at: '2026-07-10T00:00:00.000Z',
            earned_at: null,
        },
    ],
    payments: [],
};

describe('SignupsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getRefereePortalLedger.mockResolvedValue(ledger);
    });

    it('lists the referred businesses with their commission detail', async () => {
        render(<SignupsPage />);

        await waitFor(() => expect(screen.getByText('Dhaka Retail')).toBeInTheDocument());
        expect(screen.getByText('Chittagong Mart')).toBeInTheDocument();
    });

    it('formats money through formatBDT rather than a hand-written taka prefix', async () => {
        const { container } = render(<SignupsPage />);

        await waitFor(() => expect(container.textContent).toContain('399.90'));
        expect(container.textContent).not.toContain('৳399.90');
    });

    it('renders an em dash for a pending commission rather than a bare null', async () => {
        const { container } = render(<SignupsPage />);

        await waitFor(() => expect(screen.getByText('Chittagong Mart')).toBeInTheDocument());
        expect(container.textContent).toContain('—');
        expect(container.textContent).not.toContain('null');
    });

    it('carries the commission note that moved off the dashboard', async () => {
        const { container } = render(<SignupsPage />);

        await waitFor(() => expect(screen.getByText('Dhaka Retail')).toBeInTheDocument());
        expect(container.textContent).toContain('Renewals are not commissioned');
    });
});
```

Create `apps/frontend/src/app/(app)/referrals/payments/page.test.tsx`:

```tsx
'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PaymentsPage from './page';

const getRefereePortalLedger = jest.fn();

jest.mock('@/lib/api', () => ({
    api: { getRefereePortalLedger: () => getRefereePortalLedger() },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../../../lib/localization/messages/en');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: (template: string, values: Record<string, string | number>) =>
            Object.entries(values).reduce(
                (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
                template,
            ),
    };
});

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => <span data-testid="icon" /> }));

const base = {
    referee: {
        id: 'referee-1',
        name: 'Rahman Traders',
        email: 'rahman@example.com',
        referral_code: 'RAHMA1B2C3',
        deleted_at: null,
    },
    summary: {
        clicks: 0,
        conversion_rate: null,
        total_referrals: 0,
        pending: 0,
        earned: 0,
        paid: 1,
        reversed: 0,
        total_earned_amount: 200,
        total_reversed_amount: 0,
        total_paid_amount: 200,
        balance_due: 0,
        overpaid_amount: 0,
    },
    activity: [],
    commissions: [],
};

const payment = {
    id: 'payment-1',
    referee_id: 'referee-1',
    amount: 200,
    method: 'bKash',
    reference: 'TRX1',
    notes: 'July payout',
    paid_at: '2026-07-05T00:00:00.000Z',
    commissions: [
        {
            id: 'commission-1',
            referee_id: 'referee-1',
            tenant_id: 'tenant-1',
            tenant: { id: 'tenant-1', name: 'Dhaka Retail' },
            discount_pct: 10,
            commission_pct: 10,
            plan_amount: 2000,
            commission_amount: 200,
            status: 'PAID' as const,
            signed_up_at: '2026-06-01T00:00:00.000Z',
            earned_at: '2026-06-03T00:00:00.000Z',
        },
    ],
};

describe('PaymentsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getRefereePortalLedger.mockResolvedValue({ ...base, payments: [payment] });
    });

    it('lists each payout with its method and reference', async () => {
        render(<PaymentsPage />);

        await waitFor(() => expect(screen.getByText('bKash')).toBeInTheDocument());
        expect(screen.getByText('TRX1')).toBeInTheDocument();
    });

    it('opens a modal showing which commissions the payout settled', async () => {
        render(<PaymentsPage />);

        await waitFor(() => expect(screen.getByText('bKash')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        expect(screen.getByText('Dhaka Retail')).toBeInTheDocument();
    });

    it('explains an unlinked payout instead of showing an empty modal', async () => {
        getRefereePortalLedger.mockResolvedValue({
            ...base,
            payments: [{ ...payment, commissions: [] }],
        });
        render(<PaymentsPage />);

        await waitFor(() => expect(screen.getByText('bKash')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /view/i }));

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        expect(screen.getByRole('dialog').textContent).toContain('not linked');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/frontend && npx jest "src/app/(app)/referrals"`
Expected: FAIL — "Cannot find module './page'" for both new files. The existing dashboard `page.test.tsx` still passes.

- [ ] **Step 3: Add the i18n keys**

Add to `referralPortal` in all three locale files. English:

```ts
        signupsPage: {
            title: 'Signups',
            subtitle: 'Every business that signed up through your link',
            empty: 'No signups yet. Share your referral code to get started.',
            searchPlaceholder: 'Search businesses…',
            columns: {
                tenant: 'Business',
                status: 'Status',
                planAmount: 'Plan amount',
                commissionPct: 'Commission %',
                commission: 'Commission',
                signedUp: 'Signed up',
                earnedOn: 'Earned on',
            },
            filterPresets: {
                pending: 'Pending',
                earned: 'Earned',
                paid: 'Paid',
                reversed: 'Reversed',
            },
        },
        paymentsPage: {
            title: 'Payment history',
            subtitle: 'Every payout you have received',
            empty: 'No payments recorded yet.',
            searchPlaceholder: 'Search payouts…',
            view: 'View',
            columns: {
                date: 'Date',
                amount: 'Amount',
                method: 'Method',
                reference: 'Reference',
                notes: 'Notes',
                actions: 'Details',
            },
            detail: {
                title: 'Commissions settled by this payout',
                business: 'Business',
                commission: 'Commission',
                signedUp: 'Signed up',
                none: 'This payout is not linked to specific commissions. It predates the link being recorded.',
                close: 'Close',
            },
        },
```

Bangla:

```ts
        signupsPage: {
            title: 'সাইনআপ',
            subtitle: 'আপনার লিঙ্ক থেকে সাইনআপ করা সব ব্যবসা',
            empty: 'এখনও কোনো সাইনআপ নেই। শুরু করতে আপনার রেফারেল কোড শেয়ার করুন।',
            searchPlaceholder: 'ব্যবসা খুঁজুন…',
            columns: {
                tenant: 'ব্যবসা',
                status: 'অবস্থা',
                planAmount: 'প্ল্যানের পরিমাণ',
                commissionPct: 'কমিশন %',
                commission: 'কমিশন',
                signedUp: 'সাইনআপ',
                earnedOn: 'অর্জিত',
            },
            filterPresets: {
                pending: 'অপেক্ষমাণ',
                earned: 'অর্জিত',
                paid: 'পরিশোধিত',
                reversed: 'বাতিল',
            },
        },
        paymentsPage: {
            title: 'পেমেন্ট ইতিহাস',
            subtitle: 'আপনি যত পেমেন্ট পেয়েছেন',
            empty: 'এখনও কোনো পেমেন্ট রেকর্ড হয়নি।',
            searchPlaceholder: 'পেমেন্ট খুঁজুন…',
            view: 'দেখুন',
            columns: {
                date: 'তারিখ',
                amount: 'পরিমাণ',
                method: 'পদ্ধতি',
                reference: 'রেফারেন্স',
                notes: 'নোট',
                actions: 'বিস্তারিত',
            },
            detail: {
                title: 'এই পেমেন্টে নিষ্পত্তি হওয়া কমিশন',
                business: 'ব্যবসা',
                commission: 'কমিশন',
                signedUp: 'সাইনআপ',
                none: 'এই পেমেন্ট নির্দিষ্ট কমিশনের সাথে যুক্ত নয়। এটি লিঙ্ক রেকর্ড হওয়ার আগের।',
                close: 'বন্ধ করুন',
            },
        },
```

Malay:

```ts
        signupsPage: {
            title: 'Pendaftaran',
            subtitle: 'Setiap perniagaan yang mendaftar melalui pautan anda',
            empty: 'Belum ada pendaftaran. Kongsi kod rujukan anda untuk bermula.',
            searchPlaceholder: 'Cari perniagaan…',
            columns: {
                tenant: 'Perniagaan',
                status: 'Status',
                planAmount: 'Jumlah pelan',
                commissionPct: 'Komisen %',
                commission: 'Komisen',
                signedUp: 'Didaftarkan',
                earnedOn: 'Diperoleh pada',
            },
            filterPresets: {
                pending: 'Menunggu',
                earned: 'Diperoleh',
                paid: 'Dibayar',
                reversed: 'Dibatalkan',
            },
        },
        paymentsPage: {
            title: 'Sejarah pembayaran',
            subtitle: 'Setiap pembayaran yang anda terima',
            empty: 'Tiada pembayaran direkodkan lagi.',
            searchPlaceholder: 'Cari pembayaran…',
            view: 'Lihat',
            columns: {
                date: 'Tarikh',
                amount: 'Jumlah',
                method: 'Kaedah',
                reference: 'Rujukan',
                notes: 'Nota',
                actions: 'Butiran',
            },
            detail: {
                title: 'Komisen yang diselesaikan oleh pembayaran ini',
                business: 'Perniagaan',
                commission: 'Komisen',
                signedUp: 'Didaftarkan',
                none: 'Pembayaran ini tidak dipautkan kepada komisen tertentu. Ia mendahului pautan direkodkan.',
                close: 'Tutup',
            },
        },
```

The English `detail.none` string contains "not linked", which the payments test asserts on.

- [ ] **Step 4: Write the shared hook**

Create `apps/frontend/src/app/(app)/referrals/use-referee-ledger.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RefereeLedger } from '@/components/admin/referrals/types';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * The portal's three pages all read the same ledger endpoint. Without this hook
 * the fetch/error/loading block gets copy-pasted three times and drifts.
 */
export function useRefereeLedger() {
    const { t } = useI18n();
    const loadFailed = t.referralPortal.loadFailed;
    const [ledger, setLedger] = useState<RefereeLedger | null>(null);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const reload = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            setLedger(await api.getRefereePortalLedger());
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [loadFailed]);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { ledger, error, isLoading, reload };
}
```

- [ ] **Step 5: Write the payment detail modal**

Create `apps/frontend/src/components/referrals/PaymentDetailModal.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import type { RefereePayment } from '@/components/admin/referrals/types';
import { formatBDT, formatDate } from '@/lib/format';

export type PaymentDetailLabels = {
    title: string;
    business: string;
    commission: string;
    signedUp: string;
    none: string;
    close: string;
};

export default function PaymentDetailModal({
    payment,
    labels,
    onClose,
}: {
    payment: RefereePayment;
    labels: PaymentDetailLabels;
    onClose: () => void;
}) {
    const commissions = payment.commissions ?? [];

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <div className="flex items-center justify-between border-b border-gray-100 p-4">
                <div>
                    <h2 className="text-sm font-semibold text-gray-900">{labels.title}</h2>
                    <p className="text-xs text-gray-500">
                        {formatDate(payment.paid_at)} · {formatBDT(payment.amount)}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={labels.close}
                    className="flex min-h-touch min-w-touch items-center justify-center rounded-lg text-gray-500 hover:bg-gray-50"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="overflow-y-auto p-4">
                {commissions.length === 0 ? (
                    <p className="text-xs text-gray-500">{labels.none}</p>
                ) : (
                    <ul className="space-y-2">
                        <li className="flex items-center justify-between px-3 text-xs font-medium text-gray-500">
                            <span>{labels.business}</span>
                            <span>{labels.commission}</span>
                        </li>
                        {commissions.map((commission) => (
                            <li
                                key={commission.id}
                                className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-gray-900">
                                        {commission.tenant?.name ?? commission.tenant_id}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {labels.signedUp}: {formatDate(commission.signed_up_at)}
                                    </p>
                                </div>
                                <p className="text-sm font-semibold text-emerald-700">
                                    {commission.commission_amount !== null
                                        ? formatBDT(Number(commission.commission_amount))
                                        : '—'}
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </ModalShell>
    );
}
```

- [ ] **Step 6: Write the signups page**

Create `apps/frontend/src/app/(app)/referrals/signups/page.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import { PageShell, StatusBadge } from '@/components/ui';
import type { ReferralCommission } from '@/components/admin/referrals/types';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useRefereeLedger } from '../use-referee-ledger';

const helper = createColumnHelper<ReferralCommission>();

export default function SignupsPage() {
    const { t } = useI18n();
    const m = t.referralPortal;
    const page = m.signupsPage;
    const { ledger, error, isLoading } = useRefereeLedger();

    const columns: ColumnDef<ReferralCommission, unknown>[] = useMemo(() => [
        helper.accessor((row) => row.tenant?.name ?? row.tenant_id, {
            id: 'tenant',
            header: page.columns.tenant,
            cell: (info) => <span className="font-medium text-gray-900">{info.getValue()}</span>,
        }),
        helper.accessor('status', {
            header: page.columns.status,
            cell: (info) => {
                const status = info.getValue();
                const tone = status === 'PAID'
                    ? 'success'
                    : status === 'EARNED'
                        ? 'warning'
                        : status === 'REVERSED'
                            ? 'danger'
                            : 'neutral';
                return <StatusBadge tone={tone}>{m.status[status]}</StatusBadge>;
            },
        }),
        helper.accessor('plan_amount', {
            header: page.columns.planAmount,
            meta: { hideOnMobile: true },
            cell: (info) => {
                const value = info.getValue();
                return value !== null ? formatBDT(Number(value)) : '—';
            },
        }),
        helper.accessor('commission_pct', {
            header: page.columns.commissionPct,
            meta: { hideOnMobile: true },
            cell: (info) => `${Number(info.getValue())}%`,
        }),
        helper.accessor('commission_amount', {
            header: page.columns.commission,
            cell: (info) => {
                const value = info.getValue();
                return value !== null
                    ? <span className="font-semibold text-emerald-700">{formatBDT(Number(value))}</span>
                    : '—';
            },
        }),
        helper.accessor('signed_up_at', {
            header: page.columns.signedUp,
            cell: (info) => formatDate(info.getValue()),
        }),
        helper.accessor('earned_at', {
            header: page.columns.earnedOn,
            meta: { hideOnMobile: true },
            cell: (info) => {
                const value = info.getValue();
                return value ? formatDate(value) : '—';
            },
        }),
    ], [m, page]);

    const filterPresets = useMemo(() => [
        { label: page.filterPresets.pending, filters: [{ id: 'status', value: 'PENDING' }] },
        { label: page.filterPresets.earned, filters: [{ id: 'status', value: 'EARNED' }] },
        { label: page.filterPresets.paid, filters: [{ id: 'status', value: 'PAID' }] },
        { label: page.filterPresets.reversed, filters: [{ id: 'status', value: 'REVERSED' }] },
    ], [page]);

    return (
        <PageShell>
            <PageHeader
                title={page.title}
                subtitle={page.subtitle}
                breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [
                    { label: m.breadcrumb, href: '/referrals' },
                    { label: page.title },
                ])}
            />

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {error}
                </div>
            )}

            {/* The one-shot rule is the question partners ask most, and this is now
                the page where it comes up. */}
            <p className="text-xs text-gray-500">{m.commissionNote}</p>

            <DataTable
                tableId="referee-portal-signups"
                data={ledger?.commissions ?? []}
                columns={columns}
                title={page.title}
                isLoading={isLoading}
                emptyMessage={page.empty}
                emptyIcon={<Users className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={page.searchPlaceholder}
                filterPresets={filterPresets}
            />
        </PageShell>
    );
}
```

- [ ] **Step 7: Write the payments page**

Create `apps/frontend/src/app/(app)/referrals/payments/page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Wallet } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PaymentDetailModal from '@/components/referrals/PaymentDetailModal';
import type { RefereePayment } from '@/components/admin/referrals/types';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useRefereeLedger } from '../use-referee-ledger';

const helper = createColumnHelper<RefereePayment>();

export default function PaymentsPage() {
    const { t } = useI18n();
    const m = t.referralPortal;
    const page = m.paymentsPage;
    const { ledger, error, isLoading } = useRefereeLedger();
    const [selected, setSelected] = useState<RefereePayment | null>(null);

    const columns: ColumnDef<RefereePayment, unknown>[] = useMemo(() => [
        helper.accessor('paid_at', {
            header: page.columns.date,
            cell: (info) => formatDate(info.getValue()),
        }),
        helper.accessor('amount', {
            header: page.columns.amount,
            cell: (info) => (
                <span className="font-semibold text-emerald-700">{formatBDT(Number(info.getValue()))}</span>
            ),
        }),
        helper.accessor('method', {
            header: page.columns.method,
            cell: (info) => info.getValue() ?? '—',
        }),
        helper.accessor('reference', {
            header: page.columns.reference,
            meta: { hideOnMobile: true },
            cell: (info) => info.getValue() ?? '—',
        }),
        helper.accessor('notes', {
            header: page.columns.notes,
            meta: { hideOnMobile: true },
            cell: (info) => info.getValue() ?? '—',
        }),
        helper.display({
            id: 'actions',
            header: page.columns.actions,
            cell: (info) => (
                <button
                    type="button"
                    onClick={() => setSelected(info.row.original)}
                    className="min-h-touch rounded-lg px-2 text-sm font-semibold text-blue-600 hover:underline"
                >
                    {page.view}
                </button>
            ),
        }),
    ], [page]);

    return (
        <PageShell>
            <PageHeader
                title={page.title}
                subtitle={page.subtitle}
                breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [
                    { label: m.breadcrumb, href: '/referrals' },
                    { label: page.title },
                ])}
            />

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {error}
                </div>
            )}

            <DataTable
                tableId="referee-portal-payments"
                data={ledger?.payments ?? []}
                columns={columns}
                title={page.title}
                isLoading={isLoading}
                emptyMessage={page.empty}
                emptyIcon={<Wallet className="h-16 w-16 text-gray-200" />}
                searchPlaceholder={page.searchPlaceholder}
            />

            {selected && (
                <PaymentDetailModal
                    payment={selected}
                    labels={page.detail}
                    onClose={() => setSelected(null)}
                />
            )}
        </PageShell>
    );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/frontend && npx jest "src/app/(app)/referrals"`
Expected: PASS — both new suites. The dashboard `page.test.tsx` also still passes; it is not touched until Task 6.

- [ ] **Step 9: Commit**

```bash
git add "apps/frontend/src/app/(app)/referrals" apps/frontend/src/components/referrals \
  apps/frontend/src/lib/localization/messages/en/core.ts \
  apps/frontend/src/lib/localization/messages/bn/core.ts \
  apps/frontend/src/lib/localization/messages/ms/core.ts
git commit -m "feat(referrals): signups and payment history as their own portal pages"
```

---

## Task 5: The three charts

**Files:**

- Create: `apps/frontend/src/components/referrals/chart-theme.ts`
- Create: `apps/frontend/src/components/referrals/funnel-model.ts`
- Create: `apps/frontend/src/components/referrals/funnel-model.test.ts`
- Create: `apps/frontend/src/components/referrals/ActivityChart.tsx`
- Create: `apps/frontend/src/components/referrals/EarningsChart.tsx`
- Create: `apps/frontend/src/components/referrals/FunnelChart.tsx`
- Create: `apps/frontend/src/components/referrals/ActivityChart.test.tsx`
- Create: `apps/frontend/src/components/referrals/EarningsChart.test.tsx`
- Create: `apps/frontend/src/components/referrals/FunnelChart.test.tsx`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts`

**Interfaces:**

- Consumes: `ReferralActivityPoint` from Task 3; `monotoneCubicPath` and `Point` from `@/lib/charts/smooth-path`; `formatBDT` from `@/lib/format`.
- Produces:
  - `chart-theme.ts`: `export const CHART_BLUE = '#2563eb'`, `CHART_EMERALD = '#047857'`, `CHART_BLUE_FILL = '#eff6ff'`, `CHART_EMERALD_FILL = '#ecfdf5'`, `export function niceStep(value: number): number`, `export function compactNumber(value: number): string`
  - `funnel-model.ts`: `export type FunnelStage = { key: 'clicks' | 'signups' | 'earned' | 'paid'; value: number; dropOffPct: number | null }` and `export function buildFunnel(input: { clicks: number; signups: number; earned: number; paid: number }): FunnelStage[]`
  - `ActivityChart`: `({ points, labels }: { points: ReferralActivityPoint[]; labels: ActivityLabels })` where `ActivityLabels = { clicks: string; signups: string; empty: string; emptyHint: string }`
  - `EarningsChart`: `({ points, locale, labels }: { points: ReferralActivityPoint[]; locale: string; labels: EarningsLabels })` where `EarningsLabels = { earned: string; paid: string; empty: string; emptyHint: string }`
  - `FunnelChart`: `({ stages, labels }: { stages: FunnelStage[]; labels: FunnelLabels })` where `FunnelLabels = { clicks: string; signups: string; earned: string; paid: string; dropOff: string; empty: string }`

- [ ] **Step 1: Write the failing funnel-model test**

Create `apps/frontend/src/components/referrals/funnel-model.test.ts`:

```ts
import { buildFunnel } from './funnel-model';

/**
 * The funnel is the one chart doing arithmetic rather than just plotting given
 * numbers, so the stage rules and the divide-by-zero case are pinned here rather
 * than left to a rendering test to notice.
 */
describe('buildFunnel', () => {
    it('returns four stages in descending funnel order', () => {
        const stages = buildFunnel({ clicks: 100, signups: 10, earned: 4, paid: 2 });

        expect(stages.map((s) => s.key)).toEqual(['clicks', 'signups', 'earned', 'paid']);
        expect(stages.map((s) => s.value)).toEqual([100, 10, 4, 2]);
    });

    it('computes drop-off against the previous stage, with none on the first', () => {
        const stages = buildFunnel({ clicks: 100, signups: 10, earned: 4, paid: 2 });

        expect(stages[0].dropOffPct).toBeNull();
        expect(stages[1].dropOffPct).toBe(90);
        expect(stages[2].dropOffPct).toBe(60);
        expect(stages[3].dropOffPct).toBe(50);
    });

    it('returns null drop-off rather than NaN when the previous stage is zero', () => {
        const stages = buildFunnel({ clicks: 0, signups: 0, earned: 0, paid: 0 });

        expect(stages.every((s) => s.dropOffPct === null)).toBe(true);
        expect(stages.some((s) => Number.isNaN(s.dropOffPct as number))).toBe(false);
    });

    it('never reports a negative drop-off when a later stage exceeds its predecessor', () => {
        // Possible when clicks predate click tracking but the signups they produced
        // are still on the ledger. Clamp rather than print "-200% drop-off".
        const stages = buildFunnel({ clicks: 1, signups: 3, earned: 3, paid: 0 });

        expect(stages[1].dropOffPct).toBe(0);
    });

    it('rounds drop-off to a whole percent', () => {
        const stages = buildFunnel({ clicks: 3, signups: 1, earned: 0, paid: 0 });

        expect(stages[1].dropOffPct).toBe(67);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/frontend && npx jest src/components/referrals/funnel-model`
Expected: FAIL — "Cannot find module './funnel-model'".

- [ ] **Step 3: Write the theme and funnel model**

Create `apps/frontend/src/components/referrals/chart-theme.ts`:

```ts
/**
 * Shared visual vocabulary for the referral partner charts.
 *
 * Exactly two hues, validated against both the light and dark chart surfaces for
 * lightness band, chroma floor, CVD separation, normal-vision separation and
 * contrast. Their tritan separation is ΔE 7.5 — inside the 6–8 floor band — which
 * is why every chart using both MUST also carry a legend and direct labels. Hue
 * alone is not a sufficient encoding here. Do not add a third series colour.
 */
export const CHART_BLUE = '#2563eb';
export const CHART_EMERALD = '#047857';
export const CHART_BLUE_FILL = '#eff6ff';
export const CHART_EMERALD_FILL = '#ecfdf5';

export const CHART_GRID = '#f3f4f6';
export const CHART_AXIS_TEXT = '#9ca3af';

/** Rounds a magnitude up to a 1/2/2.5/5 × 10ⁿ step so axis ticks read cleanly. */
export function niceStep(value: number): number {
    if (value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 2.5) return 2.5 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

/** Axis-tick abbreviation using the lakh convention BD readers expect. */
export function compactNumber(value: number): string {
    const magnitude = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (magnitude >= 100_000) {
        const lakh = magnitude / 100_000;
        return `${sign}${lakh.toFixed(magnitude % 100_000 === 0 ? 0 : 1)}L`;
    }
    if (magnitude >= 1_000) return `${sign}${Math.round(magnitude / 1_000)}k`;
    return String(Math.round(value));
}
```

Create `apps/frontend/src/components/referrals/funnel-model.ts`:

```ts
export type FunnelStageKey = 'clicks' | 'signups' | 'earned' | 'paid';

export type FunnelStage = {
    key: FunnelStageKey;
    value: number;
    /** Percent lost since the previous stage. Null on the first stage, and null
     *  rather than NaN when the previous stage was zero. */
    dropOffPct: number | null;
};

/**
 * Stages are cumulative: `earned` counts commissions that reached EARNED *or*
 * went on to be PAID. Without that the funnel would appear to shrink and then
 * grow, which is not what a funnel means.
 */
export function buildFunnel(input: {
    clicks: number;
    signups: number;
    earned: number;
    paid: number;
}): FunnelStage[] {
    const values: Array<{ key: FunnelStageKey; value: number }> = [
        { key: 'clicks', value: input.clicks },
        { key: 'signups', value: input.signups },
        { key: 'earned', value: input.earned },
        { key: 'paid', value: input.paid },
    ];

    return values.map((stage, index) => {
        if (index === 0) return { ...stage, dropOffPct: null };
        const previous = values[index - 1].value;
        if (previous <= 0) return { ...stage, dropOffPct: null };
        // Clamped at zero: click tracking was added after the first signups, so a
        // partner can legitimately have more signups than recorded clicks, and
        // "-200% drop-off" would be nonsense.
        const lost = Math.max(0, previous - stage.value);
        return { ...stage, dropOffPct: Math.round((lost / previous) * 100) };
    });
}
```

- [ ] **Step 4: Run the funnel-model test to verify it passes**

Run: `cd apps/frontend && npx jest src/components/referrals/funnel-model`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing chart-component tests**

Create `apps/frontend/src/components/referrals/FunnelChart.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import FunnelChart from './FunnelChart';
import { buildFunnel } from './funnel-model';

const labels = {
    clicks: 'Link clicks',
    signups: 'Signups',
    earned: 'Earned',
    paid: 'Paid',
    dropOff: '{pct}% drop-off',
    empty: 'No activity yet.',
};

describe('FunnelChart', () => {
    it('direct-labels every stage with its count', () => {
        render(<FunnelChart stages={buildFunnel({ clicks: 100, signups: 10, earned: 4, paid: 2 })} labels={labels} />);

        expect(screen.getByText('Link clicks')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('prints drop-off between stages', () => {
        render(<FunnelChart stages={buildFunnel({ clicks: 100, signups: 10, earned: 4, paid: 2 })} labels={labels} />);

        expect(screen.getByText('90% drop-off')).toBeInTheDocument();
    });

    it('shows an empty state rather than four zero-width bars', () => {
        render(<FunnelChart stages={buildFunnel({ clicks: 0, signups: 0, earned: 0, paid: 0 })} labels={labels} />);

        expect(screen.getByText('No activity yet.')).toBeInTheDocument();
        expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    });
});
```

Create `apps/frontend/src/components/referrals/ActivityChart.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import ActivityChart from './ActivityChart';
import type { ReferralActivityPoint } from '@/components/admin/referrals/types';

const labels = {
    clicks: 'Link clicks',
    signups: 'Signups',
    empty: 'No activity in the last 12 months.',
    emptyHint: 'Share your referral link to start seeing traffic here.',
};

const point = (month: string, clicks: number, signups: number): ReferralActivityPoint => ({
    month,
    clicks,
    signups,
    earned_amount: 0,
    paid_amount: 0,
});

const months = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

describe('ActivityChart', () => {
    it('renders both panels with a legend, so identity is never colour-alone', () => {
        const points = months.map((m, i) => point(m, i * 3, i % 2));
        render(<ActivityChart points={points} labels={labels} />);

        expect(screen.getByText('Link clicks')).toBeInTheDocument();
        expect(screen.getByText('Signups')).toBeInTheDocument();
        expect(screen.getByTestId('activity-clicks-line')).toBeInTheDocument();
        expect(screen.getAllByTestId('activity-signup-bar').length).toBeGreaterThan(0);
    });

    it('shows an empty state when every bucket is zero', () => {
        render(<ActivityChart points={months.map((m) => point(m, 0, 0))} labels={labels} />);

        expect(screen.getByText('No activity in the last 12 months.')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-clicks-line')).not.toBeInTheDocument();
    });

    it('shows the empty state rather than crashing on an empty array', () => {
        render(<ActivityChart points={[]} labels={labels} />);

        expect(screen.getByText('No activity in the last 12 months.')).toBeInTheDocument();
    });
});
```

Create `apps/frontend/src/components/referrals/EarningsChart.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import EarningsChart from './EarningsChart';
import type { ReferralActivityPoint } from '@/components/admin/referrals/types';

const labels = {
    earned: 'Commission earned',
    paid: 'Paid out',
    empty: 'No earnings yet.',
    emptyHint: 'Commission appears here once a referred business subscribes.',
};

const point = (month: string, earned: number, paid: number): ReferralActivityPoint => ({
    month,
    clicks: 0,
    signups: 0,
    earned_amount: earned,
    paid_amount: paid,
});

describe('EarningsChart', () => {
    it('renders a paired column per month with a legend', () => {
        render(
            <EarningsChart
                points={[point('2026-07', 400, 0), point('2026-08', 0, 400)]}
                locale="en"
                labels={labels}
            />,
        );

        expect(screen.getByText('Commission earned')).toBeInTheDocument();
        expect(screen.getByText('Paid out')).toBeInTheDocument();
        expect(screen.getAllByTestId('earnings-bar').length).toBe(4);
    });

    it('shows an empty state when no month has money in it', () => {
        render(
            <EarningsChart points={[point('2026-07', 0, 0)]} locale="en" labels={labels} />,
        );

        expect(screen.getByText('No earnings yet.')).toBeInTheDocument();
    });
});
```

- [ ] **Step 6: Run the chart tests to verify they fail**

Run: `cd apps/frontend && npx jest src/components/referrals`
Expected: FAIL on the three chart suites with "Cannot find module"; `funnel-model.test.ts` still passes.

- [ ] **Step 7: Write `FunnelChart`**

Create `apps/frontend/src/components/referrals/FunnelChart.tsx`:

```tsx
'use client';

import type { FunnelStage } from './funnel-model';
import { CHART_BLUE } from './chart-theme';

export type FunnelLabels = {
    clicks: string;
    signups: string;
    earned: string;
    paid: string;
    /** Contains a `{pct}` placeholder. */
    dropOff: string;
    empty: string;
};

/**
 * Four descending stages, magnitude by bar length. One hue on purpose: the stages
 * are an ordered sequence, not distinct identities, so this is a sequential job
 * and categorical colour would imply a difference in kind that is not there.
 *
 * Built with divs rather than SVG — the bars are horizontal and text-labelled, so
 * HTML gives correct text wrapping and screen-reader order for free.
 */
export default function FunnelChart({
    stages,
    labels,
}: {
    stages: FunnelStage[];
    labels: FunnelLabels;
}) {
    const top = stages[0]?.value ?? 0;

    if (top <= 0) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                <p className="text-xs font-medium text-gray-400">{labels.empty}</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {stages.map((stage) => (
                <div key={stage.key}>
                    {stage.dropOffPct !== null && (
                        <p className="pb-1 pl-1 text-[11px] text-gray-400">
                            {labels.dropOff.replace('{pct}', String(stage.dropOffPct))}
                        </p>
                    )}
                    <div className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-xs text-gray-600">{labels[stage.key]}</span>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div
                                data-testid="funnel-bar"
                                className="h-5 rounded-r-sm"
                                style={{
                                    background: CHART_BLUE,
                                    // Floor at 2% so a non-zero stage is never invisible.
                                    width: `${Math.max(2, (stage.value / top) * 100)}%`,
                                }}
                            />
                            <span className="shrink-0 text-xs font-semibold text-gray-900">{stage.value}</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
```

- [ ] **Step 8: Write `EarningsChart`**

Create `apps/frontend/src/components/referrals/EarningsChart.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { formatBDT } from '@/lib/format';
import type { ReferralActivityPoint } from '@/components/admin/referrals/types';
import {
    CHART_BLUE,
    CHART_EMERALD,
    CHART_AXIS_TEXT,
    CHART_GRID,
    compactNumber,
    niceStep,
} from './chart-theme';

export type EarningsLabels = {
    earned: string;
    paid: string;
    empty: string;
    emptyHint: string;
};

const VIEW_W = 620;
const VIEW_H = 220;
const PAD_L = 46;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 26;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;
const TICK_COUNT = 4;
/** 2px of surface between the paired columns, per the mark spec. */
const PAIR_GAP = 2;

function monthLabel(month: string): string {
    const [year, m] = month.split('-');
    const date = new Date(Number(year), Number(m) - 1, 1);
    return date.toLocaleDateString('en', { month: 'short' });
}

/**
 * Earned versus paid, per month. Both series are BDT on one shared axis — the
 * whole point is that they are directly comparable, which a second y-scale would
 * destroy.
 */
export default function EarningsChart({
    points,
    locale,
    labels,
}: {
    points: ReferralActivityPoint[];
    locale: string;
    labels: EarningsLabels;
}) {
    const [hovered, setHovered] = useState<number | null>(null);

    const model = useMemo(() => {
        if (points.length === 0) return null;

        const highest = Math.max(...points.flatMap((p) => [p.earned_amount, p.paid_amount]), 0);
        const step = niceStep(highest / TICK_COUNT);
        const top = Math.ceil(highest / step) * step || step;

        const bandWidth = PLOT_W / points.length;
        const barWidth = Math.max(3, (bandWidth - PAIR_GAP) / 2 - 3);

        const ticks: number[] = [];
        for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);

        return {
            top,
            ticks,
            bandWidth,
            barWidth,
            toY: (value: number) => PAD_T + PLOT_H - (value / top) * PLOT_H,
            bandX: (index: number) => PAD_L + bandWidth * index,
        };
    }, [points]);

    const hasMoney = points.some((p) => p.earned_amount !== 0 || p.paid_amount !== 0);

    if (!model || !hasMoney) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                <p className="text-xs font-medium text-gray-400">{labels.empty}</p>
                <p className="mt-1 text-xs text-gray-500">{labels.emptyHint}</p>
            </div>
        );
    }

    const money = (value: number) =>
        formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const active = hovered != null ? points[hovered] : null;

    return (
        <div>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-medium text-gray-600">
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_EMERALD }} />
                    {labels.earned}
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_BLUE }} />
                    {labels.paid}
                </span>
            </div>

            <div className="relative" onMouseLeave={() => setHovered(null)}>
                <svg
                    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                    className="block w-full overflow-visible"
                    role="img"
                    aria-label={`${labels.earned}, ${labels.paid}`}
                >
                    {model.ticks.map((value) => (
                        <g key={value}>
                            <line
                                x1={PAD_L}
                                x2={VIEW_W - PAD_R}
                                y1={model.toY(value)}
                                y2={model.toY(value)}
                                stroke={CHART_GRID}
                                strokeWidth={1}
                            />
                            <text
                                x={PAD_L - 8}
                                y={model.toY(value) + 3.5}
                                textAnchor="end"
                                fontSize={9.5}
                                fill={CHART_AXIS_TEXT}
                            >
                                {compactNumber(value)}
                            </text>
                        </g>
                    ))}

                    {points.map((point, index) => {
                        const left = model.bandX(index) + (model.bandWidth - model.barWidth * 2 - PAIR_GAP) / 2;
                        return [
                            { value: point.earned_amount, color: CHART_EMERALD, x: left },
                            { value: point.paid_amount, color: CHART_BLUE, x: left + model.barWidth + PAIR_GAP },
                        ].map((bar) => (
                            <rect
                                key={`${point.month}-${bar.color}`}
                                data-testid="earnings-bar"
                                x={bar.x}
                                y={model.toY(bar.value)}
                                width={model.barWidth}
                                height={Math.max(0, PAD_T + PLOT_H - model.toY(bar.value))}
                                rx={2}
                                fill={bar.color}
                            />
                        ));
                    })}

                    {points.map((point, index) => (
                        <text
                            key={point.month}
                            x={model.bandX(index) + model.bandWidth / 2}
                            y={VIEW_H - 8}
                            textAnchor="middle"
                            fontSize={9.5}
                            fill={CHART_AXIS_TEXT}
                        >
                            {monthLabel(point.month)}
                        </text>
                    ))}

                    {points.map((point, index) => (
                        <rect
                            key={`hit-${point.month}`}
                            x={model.bandX(index)}
                            y={PAD_T}
                            width={model.bandWidth}
                            height={PLOT_H}
                            fill="transparent"
                            className="cursor-crosshair"
                            onMouseEnter={() => setHovered(index)}
                        />
                    ))}
                </svg>

                {active ? (
                    <div
                        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-2.5 py-2 text-[11px] leading-snug text-white shadow-lg"
                        style={{
                            left: `${((model.bandX(hovered!) + model.bandWidth / 2) / VIEW_W) * 100}%`,
                            top: `${(model.toY(Math.max(active.earned_amount, active.paid_amount)) / VIEW_H) * 100}%`,
                        }}
                    >
                        <p className="font-bold">{monthLabel(active.month)}</p>
                        <p>{labels.earned}: {money(active.earned_amount)}</p>
                        <p>{labels.paid}: {money(active.paid_amount)}</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
```

- [ ] **Step 9: Write `ActivityChart`**

Create `apps/frontend/src/components/referrals/ActivityChart.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { monotoneCubicPath, type Point } from '@/lib/charts/smooth-path';
import type { ReferralActivityPoint } from '@/components/admin/referrals/types';
import {
    CHART_BLUE,
    CHART_BLUE_FILL,
    CHART_EMERALD,
    CHART_AXIS_TEXT,
    CHART_GRID,
    compactNumber,
    niceStep,
} from './chart-theme';

export type ActivityLabels = {
    clicks: string;
    signups: string;
    empty: string;
    emptyHint: string;
};

const VIEW_W = 620;
const VIEW_H = 260;
const PAD_L = 40;
const PAD_R = 10;
const PAD_B = 24;
/** Vertical gap between the two panels. */
const PANEL_GAP = 18;
const TOP_H = 120;
const BOTTOM_H = 74;
const TOP_Y = 8;
const BOTTOM_Y = TOP_Y + TOP_H + PANEL_GAP;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const TICK_COUNT = 3;

function monthLabel(month: string): string {
    const [year, m] = month.split('-');
    return new Date(Number(year), Number(m) - 1, 1).toLocaleDateString('en', { month: 'short' });
}

/**
 * Clicks and signups over twelve months.
 *
 * Two panels sharing one x-axis rather than two series on one plot: they are both
 * counts, but a partner with 200 clicks and 3 signups would see the signup series
 * flattened to the baseline on a shared scale. A second y-axis would be the usual
 * fix and is exactly the wrong one — it makes two incomparable scales look
 * comparable. Separate panels state the scales honestly.
 */
export default function ActivityChart({
    points,
    labels,
}: {
    points: ReferralActivityPoint[];
    labels: ActivityLabels;
}) {
    const [hovered, setHovered] = useState<number | null>(null);

    const model = useMemo(() => {
        if (points.length < 2) return null;

        const clickTop = Math.max(...points.map((p) => p.clicks), 0);
        const clickStep = niceStep(clickTop / TICK_COUNT);
        const clickMax = Math.ceil(clickTop / clickStep) * clickStep || clickStep;

        const signupTop = Math.max(...points.map((p) => p.signups), 0);
        const signupMax = Math.max(1, signupTop);

        const toX = (index: number) => PAD_L + (PLOT_W / (points.length - 1)) * index;
        const clickY = (value: number) => TOP_Y + TOP_H - (value / clickMax) * TOP_H;

        const ticks: number[] = [];
        for (let value = 0; value <= clickMax + clickStep / 2; value += clickStep) ticks.push(value);

        const clicksLine = monotoneCubicPath(
            points.map((p, index): Point => ({ x: toX(index), y: clickY(p.clicks) })),
        );

        // The band width is derived from spacing between points, then narrowed so
        // adjacent bars keep a 2px surface gap.
        const band = PLOT_W / (points.length - 1);

        return {
            ticks,
            toX,
            clickY,
            clicksLine,
            clicksArea: `${clicksLine} L ${toX(points.length - 1)} ${TOP_Y + TOP_H} L ${toX(0)} ${TOP_Y + TOP_H} Z`,
            band,
            barWidth: Math.max(3, band * 0.55),
            signupH: (value: number) => (value / signupMax) * BOTTOM_H,
        };
    }, [points]);

    const hasActivity = points.some((p) => p.clicks !== 0 || p.signups !== 0);

    if (!model || !hasActivity) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                <p className="text-xs font-medium text-gray-400">{labels.empty}</p>
                <p className="mt-1 text-xs text-gray-500">{labels.emptyHint}</p>
            </div>
        );
    }

    const active = hovered != null ? points[hovered] : null;

    return (
        <div>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-medium text-gray-600">
                <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-3.5 rounded-sm" style={{ background: CHART_BLUE }} />
                    {labels.clicks}
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_EMERALD }} />
                    {labels.signups}
                </span>
            </div>

            <div className="relative" onMouseLeave={() => setHovered(null)}>
                <svg
                    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                    className="block w-full overflow-visible"
                    role="img"
                    aria-label={`${labels.clicks}, ${labels.signups}`}
                >
                    {model.ticks.map((value) => (
                        <g key={value}>
                            <line
                                x1={PAD_L}
                                x2={VIEW_W - PAD_R}
                                y1={model.clickY(value)}
                                y2={model.clickY(value)}
                                stroke={CHART_GRID}
                                strokeWidth={1}
                            />
                            <text
                                x={PAD_L - 8}
                                y={model.clickY(value) + 3.5}
                                textAnchor="end"
                                fontSize={9.5}
                                fill={CHART_AXIS_TEXT}
                            >
                                {compactNumber(value)}
                            </text>
                        </g>
                    ))}

                    <path d={model.clicksArea} fill={CHART_BLUE_FILL} opacity={0.85} />
                    <path
                        data-testid="activity-clicks-line"
                        d={model.clicksLine}
                        fill="none"
                        stroke={CHART_BLUE}
                        strokeWidth={2}
                        strokeLinecap="round"
                    />

                    <line
                        x1={PAD_L}
                        x2={VIEW_W - PAD_R}
                        y1={BOTTOM_Y + BOTTOM_H}
                        y2={BOTTOM_Y + BOTTOM_H}
                        stroke="#d1d5db"
                        strokeWidth={1}
                    />

                    {points.map((point, index) => {
                        const height = model.signupH(point.signups);
                        return (
                            <rect
                                key={point.month}
                                data-testid="activity-signup-bar"
                                x={model.toX(index) - model.barWidth / 2}
                                y={BOTTOM_Y + BOTTOM_H - height}
                                width={model.barWidth}
                                height={height}
                                rx={2}
                                fill={CHART_EMERALD}
                            />
                        );
                    })}

                    {points.map((point, index) => (
                        <text
                            key={`label-${point.month}`}
                            x={model.toX(index)}
                            y={VIEW_H - 6}
                            textAnchor="middle"
                            fontSize={9}
                            fill={CHART_AXIS_TEXT}
                        >
                            {monthLabel(point.month)}
                        </text>
                    ))}

                    {hovered != null && (
                        <line
                            x1={model.toX(hovered)}
                            x2={model.toX(hovered)}
                            y1={TOP_Y}
                            y2={BOTTOM_Y + BOTTOM_H}
                            stroke="#d1d5db"
                            strokeWidth={1}
                        />
                    )}

                    {points.map((point, index) => (
                        <rect
                            key={`hit-${point.month}`}
                            x={model.toX(index) - model.band / 2}
                            y={TOP_Y}
                            width={model.band}
                            height={BOTTOM_Y + BOTTOM_H - TOP_Y}
                            fill="transparent"
                            className="cursor-crosshair"
                            onMouseEnter={() => setHovered(index)}
                        />
                    ))}
                </svg>

                {active ? (
                    <div
                        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-2.5 py-2 text-[11px] leading-snug text-white shadow-lg"
                        style={{
                            left: `${(model.toX(hovered!) / VIEW_W) * 100}%`,
                            top: `${(model.clickY(active.clicks) / VIEW_H) * 100}%`,
                        }}
                    >
                        <p className="font-bold">{monthLabel(active.month)}</p>
                        <p>{labels.clicks}: {active.clicks}</p>
                        <p>{labels.signups}: {active.signups}</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
```

- [ ] **Step 10: Add the chart i18n keys**

Add to `referralPortal` in all three locale files. English:

```ts
        charts: {
            activity: {
                title: 'Activity over time',
                clicks: 'Link clicks',
                signups: 'Signups',
                empty: 'No activity in the last 12 months.',
                emptyHint: 'Share your referral link to start seeing traffic here.',
            },
            earnings: {
                title: 'Earnings and payouts',
                earned: 'Commission earned',
                paid: 'Paid out',
                empty: 'No earnings yet.',
                emptyHint: 'Commission appears here once a referred business subscribes.',
            },
            funnel: {
                title: 'Referral funnel',
                clicks: 'Link clicks',
                signups: 'Signups',
                earned: 'Earned',
                paid: 'Paid',
                dropOff: '{pct}% drop-off',
                empty: 'No activity yet.',
            },
        },
```

Bangla:

```ts
        charts: {
            activity: {
                title: 'সময়ভিত্তিক কার্যকলাপ',
                clicks: 'লিঙ্ক ক্লিক',
                signups: 'সাইনআপ',
                empty: 'গত ১২ মাসে কোনো কার্যকলাপ নেই।',
                emptyHint: 'ট্রাফিক দেখতে আপনার রেফারেল লিঙ্ক শেয়ার করুন।',
            },
            earnings: {
                title: 'আয় ও পেমেন্ট',
                earned: 'অর্জিত কমিশন',
                paid: 'পরিশোধিত',
                empty: 'এখনও কোনো আয় নেই।',
                emptyHint: 'রেফার করা ব্যবসা সাবস্ক্রাইব করলে কমিশন এখানে দেখা যাবে।',
            },
            funnel: {
                title: 'রেফারেল ফানেল',
                clicks: 'লিঙ্ক ক্লিক',
                signups: 'সাইনআপ',
                earned: 'অর্জিত',
                paid: 'পরিশোধিত',
                dropOff: '{pct}% হ্রাস',
                empty: 'এখনও কোনো কার্যকলাপ নেই।',
            },
        },
```

Malay:

```ts
        charts: {
            activity: {
                title: 'Aktiviti mengikut masa',
                clicks: 'Klik pautan',
                signups: 'Pendaftaran',
                empty: 'Tiada aktiviti dalam 12 bulan lalu.',
                emptyHint: 'Kongsi pautan rujukan anda untuk mula melihat trafik di sini.',
            },
            earnings: {
                title: 'Pendapatan dan pembayaran',
                earned: 'Komisen diperoleh',
                paid: 'Dibayar',
                empty: 'Tiada pendapatan lagi.',
                emptyHint: 'Komisen muncul di sini apabila perniagaan yang dirujuk melanggan.',
            },
            funnel: {
                title: 'Corong rujukan',
                clicks: 'Klik pautan',
                signups: 'Pendaftaran',
                earned: 'Diperoleh',
                paid: 'Dibayar',
                dropOff: 'susut {pct}%',
                empty: 'Tiada aktiviti lagi.',
            },
        },
```

- [ ] **Step 11: Run the chart tests to verify they pass**

Run: `cd apps/frontend && npx jest src/components/referrals`
Expected: PASS — all four suites.

- [ ] **Step 12: Commit**

```bash
git add apps/frontend/src/components/referrals \
  apps/frontend/src/lib/localization/messages/en/core.ts \
  apps/frontend/src/lib/localization/messages/bn/core.ts \
  apps/frontend/src/lib/localization/messages/ms/core.ts
git commit -m "feat(referrals): activity, earnings and funnel charts for the partner portal"
```

---

## Task 6: Rebuild the dashboard

**Files:**

- Modify: `apps/frontend/src/app/(app)/referrals/page.tsx`
- Modify: `apps/frontend/src/app/(app)/referrals/page.test.tsx`

**Interfaces:**

- Consumes: `useRefereeLedger` (Task 4); `ActivityChart`, `EarningsChart`, `FunnelChart`, `buildFunnel` (Task 5); the `referralPortal.charts.*` i18n keys (Task 5).
- Produces: nothing downstream.

- [ ] **Step 1: Rewrite the dashboard test**

Replace the body of `apps/frontend/src/app/(app)/referrals/page.test.tsx`. Keep the existing mocks at the top of the file (`@/lib/api`, `@/lib/toast`, `@/lib/i18n`, `lucide-react`) exactly as they are, add `activity` to the `ledger` fixture, and replace the `describe` block.

Two mocks must be added alongside the existing ones. `useIsMdUp` reads `matchMedia`, which jsdom does not implement, and the page now renders `next/link`:

```tsx
jest.mock('@/hooks/useMediaQuery', () => ({
    useIsMdUp: () => true,
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
});
```

The `@/lib/i18n` mock in this file returns only `t` and `formatMessage`; the page now also reads `locale`, so add `locale: 'en'` to the `useI18n` return value.

Then the tests:

```tsx
const activity = [
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
].map((month, index) => ({
    month,
    clicks: index * 2,
    signups: index % 3 === 0 ? 1 : 0,
    earned_amount: month === '2026-07' ? 1234.5 : 0,
    paid_amount: month === '2026-07' ? 200 : 0,
}));
```

Add `activity,` and `clicks: 40, conversion_rate: 5,` to the existing `ledger.summary` fixture, and `activity` at the top level of `ledger`.

```tsx
/**
 * The dashboard is now a summary-and-charts page: the two tables moved to
 * /referrals/signups and /referrals/payments. These assert the split held and
 * that the UI-rule fixes made when this page was first cleaned up are still in
 * place — money through formatBDT, the shared badge, the global toast store.
 */
describe('RefereePortalPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getRefereePortalLedger.mockResolvedValue(ledger);
    });

    it('keeps the share cards and the summary tiles', async () => {
        render(<RefereePortalPage />);

        await waitFor(() => expect(screen.getByText('RAHMA1B2C3')).toBeInTheDocument());
        expect(screen.getByText('Balance due')).toBeInTheDocument();
    });

    it('formats money through formatBDT rather than a hand-written taka prefix', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(container.textContent).toContain('1,234.50'));
        expect(container.textContent).not.toContain('৳1234.50');
    });

    it('renders the three charts', async () => {
        render(<RefereePortalPage />);

        await waitFor(() => expect(screen.getByText('Activity over time')).toBeInTheDocument());
        expect(screen.getByText('Earnings and payouts')).toBeInTheDocument();
        expect(screen.getByText('Referral funnel')).toBeInTheDocument();
    });

    it('no longer renders the signups or payments tables', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(screen.getByText('RAHMA1B2C3')).toBeInTheDocument());
        expect(container.querySelector('table')).toBeNull();
        expect(screen.queryByText('Dhaka Retail')).not.toBeInTheDocument();
    });

    it('links to the two list pages so the tables are still reachable', async () => {
        render(<RefereePortalPage />);

        await waitFor(() => expect(screen.getByText('RAHMA1B2C3')).toBeInTheDocument());
        const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
        expect(hrefs).toContain('/referrals/signups');
        expect(hrefs).toContain('/referrals/payments');
    });

    it('does not render a page-local toast banner of its own', async () => {
        const { container } = render(<RefereePortalPage />);

        await waitFor(() => expect(getRefereePortalLedger).toHaveBeenCalled());
        expect(container.querySelector('.bg-emerald-50')).toBeNull();
    });
});
```

The two dropped tests — the status-badge one and the `font-black` cell scan — went with the tables they asserted on. Their subject now lives on the signups page, where the Task 4 suite covers the same ground.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest "src/app/(app)/referrals/page.test.tsx"`
Expected: FAIL — "Unable to find an element with the text: Activity over time", and the table assertions fail because the tables are still rendered.

- [ ] **Step 3: Rewrite the dashboard page**

In `apps/frontend/src/app/(app)/referrals/page.tsx`:

Replace the imports of `DataTable`, `createColumnHelper`, `ColumnDef`, `StatusBadge`, `formatDate`, and the `ReferralCommission` / `RefereePayment` types with the chart imports:

```tsx
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Copy, Gift, Link2, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import ActivityChart from '@/components/referrals/ActivityChart';
import EarningsChart from '@/components/referrals/EarningsChart';
import FunnelChart from '@/components/referrals/FunnelChart';
import { buildFunnel } from '@/components/referrals/funnel-model';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useRefereeLedger } from './use-referee-ledger';
```

Delete the two `createColumnHelper` calls, the local `load` / `useEffect` / state block (replaced by the hook), and both `useMemo` column definitions. The component body becomes:

```tsx
export default function RefereePortalPage() {
    const { t, locale } = useI18n();
    const m = t.referralPortal;
    const isMdUp = useIsMdUp();
    const { ledger, error, isLoading } = useRefereeLedger();

    // Twelve month labels collide below ~500px. Narrowing to six is the honest
    // fix; squeezing or rotating the labels is not.
    const activityPoints = useMemo(
        () => (isMdUp ? ledger?.activity ?? [] : (ledger?.activity ?? []).slice(-6)),
        [ledger?.activity, isMdUp],
    );

    const signupUrl = useMemo(() => {
        if (!ledger?.referee.referral_code || typeof window === 'undefined') return '';
        // /r/<code> records the click, then forwards to /signup?ref=<code>.
        return `${window.location.origin}/r/${encodeURIComponent(ledger.referee.referral_code)}`;
    }, [ledger?.referee.referral_code]);

    const funnel = useMemo(() => buildFunnel({
        clicks: ledger?.summary.clicks ?? 0,
        signups: ledger?.summary.total_referrals ?? 0,
        // Cumulative: a paid commission was earned first, so it still counts here.
        earned: (ledger?.summary.earned ?? 0) + (ledger?.summary.paid ?? 0),
        paid: ledger?.summary.paid ?? 0,
    }), [ledger?.summary]);

    const copyText = async (value: string, message: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(message);
        } catch {
            toast.error(m.copyFailed);
        }
    };
```

Keep the existing `summaryCards` array and the share-card JSX verbatim. Replace the two table blocks at the end of the render with the chart grid plus the links to the list pages:

```tsx
                        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-semibold text-gray-900">{m.charts.activity.title}</h2>
                                <Link
                                    href={routes.referralsPortal.signups}
                                    className="text-xs font-semibold text-blue-600 hover:underline"
                                >
                                    {m.signupsPage.title}
                                </Link>
                            </div>
                            <ActivityChart points={activityPoints} labels={m.charts.activity} />
                        </div>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between">
                                    <h2 className="text-sm font-semibold text-gray-900">{m.charts.earnings.title}</h2>
                                    <Link
                                        href={routes.referralsPortal.payments}
                                        className="text-xs font-semibold text-blue-600 hover:underline"
                                    >
                                        {m.paymentsPage.title}
                                    </Link>
                                </div>
                                <EarningsChart points={ledger.activity} locale={locale} labels={m.charts.earnings} />
                            </div>

                            <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                                <h2 className="mb-3 text-sm font-semibold text-gray-900">{m.charts.funnel.title}</h2>
                                <FunnelChart stages={funnel} labels={m.charts.funnel} />
                            </div>
                        </div>
```

The `error` banner, the `isLoading` spinner, and the `PageHeader` stay exactly as they are. `m.commissionNote` is deleted from this page — it now lives on the signups page.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest "src/app/(app)/referrals"`
Expected: PASS — all three page suites.

- [ ] **Step 5: Run the full check**

```bash
cd apps/frontend && npx tsc --noEmit && npx jest src/components/referrals src/components/Sidebar.test.tsx "src/app/(app)/referrals"
cd apps/backend && npx jest src/referrals
```

Expected: no type errors, all suites pass.

- [ ] **Step 6: Verify the pages in a browser**

The validator checks color, not layout. Start the app and look at the dashboard at desktop width and at 360px. Confirm: no label collisions on the month axis, no horizontal body scroll, the funnel bars are not overflowing their container, and the two charts sit side by side above `lg` and stack below it.

Use the `browser-automation` skill, or `npm run dev` and open `/referrals` as a referee account.

- [ ] **Step 7: Commit**

```bash
git add "apps/frontend/src/app/(app)/referrals/page.tsx" "apps/frontend/src/app/(app)/referrals/page.test.tsx"
git commit -m "feat(referrals): rebuild the partner dashboard around charts"
```

---

## Task 7: Update TODO.md

Required by `CLAUDE.md` after every task, no exceptions.

**Files:**

- Modify: `TODO.md`

- [ ] **Step 1: Update the file**

Check off any referral-portal items already listed. Add to the `## COMPLETED` section:

```markdown
- [x] Referral partner portal: signups and payment history split onto their own pages with menu entries — done 2026-08-06
- [x] Referral partner dashboard: activity, earnings and funnel charts — done 2026-08-06
```

Add any follow-up work the implementation surfaced to the appropriate priority section.

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs: check off the referral portal split and dashboard charts"
```

---

## Notes for the implementer

**The chart palette is fixed and validated.** Two hues, `#2563eb` and `#047857`. They passed the six-check validator against both light and dark surfaces. Do not add a third series color, do not substitute a "nicer" green — a new hue invalidates the check, and the tritan margin is already at the floor. If a chart seems to need a third series, it needs a second chart instead.

**Never add a second y-axis.** It is the single most common charting mistake and it is the reason `ActivityChart` is built as two panels. If a future change makes it tempting, split the panel again.

**`routes.referralsPortal` is an access-control surface.** Four of its call sites gate whether a non-referee gets redirected out of the portal. `npx tsc --noEmit` catches a missed one; run it.

**Locale files must stay in sync.** Every key added to `en/core.ts` must exist in `bn/core.ts` and `ms/core.ts`, with the same nesting. A missing key surfaces as `undefined` rendered into the page for that locale, not as an error.
