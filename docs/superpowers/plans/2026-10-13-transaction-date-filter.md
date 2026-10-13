# Transaction Date Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Date filter (optional times) next to Created on the sales, voucher, expense and loan lists.

**Architecture:** The server's `zonedDayRange` learns `YYYY-MM-DDTHH:mm` bounds; a new `calendarDateRange` serves `@db.Date` columns. The existing `CreatedRangeFilter` chip gains `withTime` and is also exported as `DateRangeFilter`. Each list page adds a Date chip before its Created chip.

**Tech Stack:** NestJS + Prisma (backend), Next.js 15 + React Testing Library + jest (frontend).

**Spec:** `docs/superpowers/specs/2026-10-13-transaction-date-filter-design.md`

## Global Constraints

- Created stays on every list, unchanged.
- A bound without a time means the whole day, exactly as today; existing date-only results must not change.
- `to` with a time is inclusive through `HH:mm:59.999`.
- Date-only columns (`expense_date`, `start_date`) compare calendar dates, never a zoned range.
- Inline validation only (no toast, no `alert()`); new copy in all 9 locales.
- Memory: jest with `--runTestsByPath --maxWorkers=2 --workerIdleMemoryLimit=600MB`, one suite group at a time; no parallel agents.

## Review Focus

- A time with no date (date cleared after typing a time) — the bound is dropped, not sent as `T18:00`. Test in Task 3.
- `to` earlier than `from` on the same day with times (`18:00` → `02:00` same date) — inline error. Test in Task 3.
- Malformed times reaching the server (`25:00`, `10:60`) — ignored like other garbage. Test in Task 1.
- A night window across a DST change — exact instants. Test in Task 1.
- A synced sale at UTC midnight shows its date without a fake `06:00`. Test in Task 4.

---

### Task 1: Server range helpers

**Files:**
- Modify: `apps/backend/src/common/tenant-time.util.ts` (`zonedDayRange`)
- Modify: `apps/backend/src/common/created-range.util.ts` (add `calendarDateRange`)
- Test: `apps/backend/src/common/tenant-time.util.spec.ts`, `apps/backend/src/common/created-range.util.spec.ts`

**Interfaces:**
- Produces: `zonedDayRange(from?: string, to?: string, timeZone: string | undefined): { gte?: Date; lte?: Date } | undefined` (same signature, wider input); `calendarDateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined`.

- [ ] Step 1: Add failing tests to the `zonedDayRange` describe:

```ts
it('reads a HH:mm bound as that minute on the Dhaka wall clock, end inclusive', () => {
    expect(zonedDayRange('2026-10-12T18:00', '2026-10-13T02:00', 'Asia/Dhaka')).toEqual({
        gte: new Date('2026-10-12T12:00:00.000Z'),
        lte: new Date('2026-10-12T20:00:59.999Z'),
    });
});

it('mixes a whole-day bound with a timed one', () => {
    expect(zonedDayRange('2026-10-12', '2026-10-12T14:30', 'Asia/Dhaka')).toEqual({
        gte: new Date('2026-10-11T18:00:00.000Z'),
        lte: new Date('2026-10-12T08:30:59.999Z'),
    });
});

it('ignores impossible times like any other garbage', () => {
    expect(zonedDayRange('2026-10-12T25:00', '2026-10-12T10:60', 'Asia/Dhaka')).toBeUndefined();
});

it('keeps a night window exact across a DST change', () => {
    // New York leaves EDT (UTC-4) for EST (UTC-5) on 2026-11-01.
    expect(zonedDayRange('2026-10-31T23:00', '2026-11-01T23:00', 'America/New_York')).toEqual({
        gte: new Date('2026-11-01T03:00:00.000Z'),
        lte: new Date('2026-11-02T04:00:59.999Z'),
    });
});
```

and to `created-range.util.spec.ts`:

```ts
describe('calendarDateRange', () => {
    it('compares @db.Date columns as UTC-midnight calendar days, whatever the zone', () => {
        expect(calendarDateRange('2026-08-12', '2026-08-19')).toEqual({
            gte: new Date('2026-08-12T00:00:00.000Z'),
            lte: new Date('2026-08-19T00:00:00.000Z'),
        });
    });

    it('ignores anything that is not a real YYYY-MM-DD', () => {
        expect(calendarDateRange('2026-02-31', '2026-08-19T10:00')).toBeUndefined();
        expect(calendarDateRange(undefined, '2026-08-19')).toEqual({ lte: new Date('2026-08-19T00:00:00.000Z') });
    });
});
```

- [ ] Step 2: Run `npx jest --runTestsByPath src/common/tenant-time.util.spec.ts src/common/created-range.util.spec.ts --maxWorkers=2` in `apps/backend`. Expect the new tests to fail.
- [ ] Step 3: Implement. In `tenant-time.util.ts`, add `const DATE_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;` and a `zonedMinuteStart(value, zone)` that validates the date with `parseCalendarDate`, rejects hour > 23 / minute > 59, and returns `wallClockToInstant({ ...date, hour, minute }, zone)`. In `zonedDayRange`, a bound that parses as a minute wins: `from` → that instant; `to` → instant + `MINUTE_MS - 1`; otherwise fall through to the existing whole-day logic. In `created-range.util.ts`, add `calendarDateRange` using `isCalendarDate` and `new Date(\`${value}T00:00:00.000Z\`)`.
- [ ] Step 4: Re-run; all pass.
- [ ] Step 5: Commit `feat(lists): accept HH:mm bounds in day-range filters`.

### Task 2: Sales and loans list endpoints

**Files:**
- Modify: `apps/backend/src/sales/sales.controller.ts` (`findAll`), `apps/backend/src/sales/sales.service.ts` (`findAll`)
- Modify: `apps/backend/src/loans/loans.dto.ts` (`ListLoansQueryDto`), `apps/backend/src/loans/loans.service.ts` (`buildLoanWhere`)
- Test: `apps/backend/src/sales/sales.service.spec.ts`, `apps/backend/src/loans/loans.service.spec.ts`

**Interfaces:**
- Consumes: `zonedDayRange`, `calendarDateRange` (Task 1).
- Produces: `GET /sales?dateFrom&dateTo` filters `sale_date`; `GET /loans?dateFrom&dateTo` filters `start_date`.

- [ ] Step 1: Failing tests. Sales (`findAll()` describe):

```ts
it('filters sale_date by dateFrom/dateTo, alongside created_at', async () => {
  db.sale.findMany.mockResolvedValue([]);
  db.sale.count.mockResolvedValue(0);
  db.voucher.findMany.mockResolvedValue([]);

  await service.findAll('tenant-1', {
    timezone: 'Asia/Dhaka',
    dateFrom: '2026-10-12T18:00',
    dateTo: '2026-10-13T02:00',
    createdFrom: '2026-10-13',
    createdTo: '2026-10-13',
  });

  expect(db.sale.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        sale_date: { gte: new Date('2026-10-12T12:00:00.000Z'), lte: new Date('2026-10-12T20:00:59.999Z') },
        created_at: { gte: new Date('2026-10-12T18:00:00.000Z'), lte: new Date('2026-10-13T17:59:59.999Z') },
      }),
    }),
  );
});
```

Loans (`list filters` describe):

```ts
it('filters start_date by calendar day, not by a zoned range', async () => {
    const db = { loan: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } };
    const service = new LoansService(db as any);

    await service.listLoans('tenant-1', { timezone: 'America/New_York', page: 1, limit: 20, dateFrom: '2026-08-12', dateTo: '2026-08-19' });

    expect(db.loan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
            where: expect.objectContaining({
                start_date: { gte: new Date('2026-08-12T00:00:00.000Z'), lte: new Date('2026-08-19T00:00:00.000Z') },
            }),
        }),
    );
});
```

- [ ] Step 2: Run both spec files; expect failures.
- [ ] Step 3: Implement. Sales controller: `@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string`, passed as `dateFrom: dateFrom || undefined, dateTo: dateTo || undefined`. Service opts gain `dateFrom?`/`dateTo?`; `const saleDate = zonedDayRange(opts?.dateFrom, opts?.dateTo, opts?.timezone);` and `...(saleDate ? { sale_date: saleDate } : {})` in `where`. Loans DTO: `@IsOptional() @IsDateString() dateFrom?: string;` and `dateTo`. `buildLoanWhere`: `const start = calendarDateRange(query.dateFrom, query.dateTo); if (start) where.start_date = start;`.
- [ ] Step 4: Re-run; pass.
- [ ] Step 5: Commit `feat(sales,loans): filter the lists by transaction date`.

### Task 3: The chip and its helpers

**Files:**
- Modify: `apps/frontend/src/components/data-table/CreatedRangeFilter.tsx`, `apps/frontend/src/components/data-table/index.ts`
- Modify: `apps/frontend/src/lib/created-range.ts`
- Modify: `apps/frontend/src/lib/localization/messages/{ar,bn,de,en,es,fr,hi,ms,ur}/core.ts` (`common.createdRange.time`, `common.createdRange.fromAfterTo`)
- Test: `apps/frontend/src/components/data-table/CreatedRangeFilter.test.tsx`, `apps/frontend/src/lib/created-range.test.ts`

**Interfaces:**
- Produces: `DateRangeFilter` (same component as `CreatedRangeFilter`) with props `{ value, onChange, now?, label?, withTime?: boolean }`; `applyDateRangeQuery(range): { dateFrom?: string; dateTo?: string }`; `formatCreatedRangeLabel` prints times.

- [ ] Step 1: Failing tests.

```ts
// created-range.test.ts
describe('formatCreatedRangeLabel with times', () => {
    it('prints the minute on each timed bound', () => {
        expect(formatCreatedRangeLabel({ from: '2026-10-12T18:00', to: '2026-10-13T02:00' }, 'Any time')).toBe('12 Oct 18:00 – 13 Oct 02:00');
    });
    it('names the day once when both times fall on it', () => {
        expect(formatCreatedRangeLabel({ from: '2026-10-12T09:00', to: '2026-10-12T13:00' }, 'Any time')).toBe('12 Oct 09:00 – 13:00');
    });
});

describe('applyDateRangeQuery', () => {
    it('sends dateFrom/dateTo so they filter the transaction date, not created_at', () => {
        expect(applyDateRangeQuery({ from: '2026-10-12T18:00', to: '2026-10-13' })).toEqual({ dateFrom: '2026-10-12T18:00', dateTo: '2026-10-13' });
        expect(applyDateRangeQuery(null)).toEqual({});
    });
});
```

```tsx
// CreatedRangeFilter.test.tsx
describe('with times', () => {
    it('has no time inputs unless asked', () => {
        render(<CreatedRangeFilter value={null} onChange={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: /created · any time/i }));
        expect(screen.queryByLabelText('From (Time)')).not.toBeInTheDocument();
    });

    it('keeps a time disabled until its date is set, then applies both', () => {
        const onChange = jest.fn();
        render(<CreatedRangeFilter value={null} label="Date" withTime onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /date · any time/i }));
        expect(screen.getByLabelText('From (Time)')).toBeDisabled();
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-12' } });
        fireEvent.change(screen.getByLabelText('From (Time)'), { target: { value: '18:00' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-13' } });
        fireEvent.change(screen.getByLabelText('To (Time)'), { target: { value: '02:00' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onChange).toHaveBeenCalledWith({ from: '2026-10-12T18:00', to: '2026-10-13T02:00' });
    });

    it('drops a time whose date was cleared', () => {
        const onChange = jest.fn();
        render(<CreatedRangeFilter value={null} label="Date" withTime onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /date · any time/i }));
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-12' } });
        fireEvent.change(screen.getByLabelText('From (Time)'), { target: { value: '18:00' } });
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-13' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onChange).toHaveBeenCalledWith({ from: undefined, to: '2026-10-13' });
    });

    it('refuses a From after To inline and stays open', () => {
        const onChange = jest.fn();
        render(<CreatedRangeFilter value={null} label="Date" withTime onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /date · any time/i }));
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-12' } });
        fireEvent.change(screen.getByLabelText('From (Time)'), { target: { value: '18:00' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-12' } });
        fireEvent.change(screen.getByLabelText('To (Time)'), { target: { value: '02:00' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText('From must be on or before To')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows the chosen times on the chip and seeds the inputs from them', () => {
        render(<CreatedRangeFilter value={{ from: '2026-10-12T18:00', to: '2026-10-13T02:00' }} label="Date" withTime onChange={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: 'Date · 12 Oct 18:00 – 13 Oct 02:00' }));
        expect(screen.getByLabelText('From (Time)')).toHaveValue('18:00');
    });
});
```

- [ ] Step 2: Run `npx jest --runTestsByPath src/components/data-table/CreatedRangeFilter.test.tsx src/lib/created-range.test.ts --maxWorkers=2` in `apps/frontend`; expect failures.
- [ ] Step 3: Implement. `created-range.ts`: `splitBound(v)` → `{ date: v.slice(0, 10), time: v.length > 10 ? v.slice(11, 16) : '' }`; `formatBound` = day-month plus time; label rules as tested; `applyDateRangeQuery` like `applyDueRangeQuery`. Chip: keep `from`/`to` state for dates, add `fromTime`/`toTime`; time `<Input type="time">` under each date with `aria-label={\`${t.common.from} (${copy.time})\`}`, `disabled={!date}`; `joinBound(date, time)` → `undefined` without date, `date` without time, else `` `${date}T${time}` ``; on Apply, when both bounds are set compare `(fromDate + 'T' + (fromTime || '00:00'))` with `(toDate + 'T' + (toTime || '23:59'))` as strings and show `copy.fromAfterTo` under To (`text-xs text-red-600`) instead of applying. Re-seed all four fields from `value` in the existing `useEffect`. Index: `export { default as DateRangeFilter } from './CreatedRangeFilter';`. Copy: insert `time` and `fromAfterTo` after `clear` in each locale.
- [ ] Step 4: Re-run; pass.
- [ ] Step 5: Commit `feat(lists): optional times on the date range chip`.

### Task 4: Sales list

**Files:**
- Modify: `apps/frontend/src/app/(app)/sales/list/page.tsx`, `apps/frontend/src/lib/api.ts` (`getSalesList`)
- Test: `apps/frontend/src/app/(app)/sales/list/page.test.tsx`

**Interfaces:**
- Consumes: `DateRangeFilter`, `applyDateRangeQuery` (Task 3); `GET /sales?dateFrom&dateTo` (Task 2).

- [ ] Step 1: Failing tests: picking Date → Today sends `dateFrom`/`dateTo` (and no `createdFrom`); a sale whose `sale_date` is `2026-10-13T00:00:00.000Z` renders without a time, one at `2026-10-13T09:15:00.000Z` renders with one.
- [ ] Step 2: Run by path; fail.
- [ ] Step 3: Implement: `dateRange` state in `deps`, `...applyDateRangeQuery(dateRange)` in fetch, `<DateRangeFilter label={t.common.date} withTime value={dateRange} onChange={setDateRange} />` before the Created chip; `getSalesList` takes and sends `dateFrom`/`dateTo`; the Date column renders `formatDate` when `getTime() % 86_400_000 === 0`, else `formatDateTime`.
- [ ] Step 4: Re-run; pass.
- [ ] Step 5: Commit `feat(sales): filter the sales list by sale date and time`.

### Task 5: Vouchers, expenses, loans pages

**Files:**
- Modify: `apps/frontend/src/app/(app)/accounting/vouchers/page.tsx`, `.../expenses/page.tsx`, `.../loans/page.tsx`, `apps/frontend/src/lib/api.ts` (`getLoans`)
- Test: `apps/frontend/src/app/(app)/accounting/vouchers/page.test.tsx`; create `.../expenses/page.test.tsx`, `.../loans/page.test.tsx`

- [ ] Step 1: Failing tests: vouchers Date → Today sends `from`/`to` equal to today's tenant date; expenses opens on This month (`from` = first of month) and Date → Today narrows it; loans Date → Today sends `dateFrom`/`dateTo`.
- [ ] Step 2: Run by path; fail.
- [ ] Step 3: Implement: vouchers drop the two `<input type="date">` for `<DateRangeFilter label={t.common.date} …>` (resetting page 1); expenses replace the two labelled inputs with the chip, initial `createdRangeFromPreset('thisMonth')`; loans add the chip and `getLoans` sends `dateFrom`/`dateTo`.
- [ ] Step 4: Re-run; pass.
- [ ] Step 5: Commit `feat(accounting): Date chip on vouchers, expenses and loans`.

### Task 6: Verify and ship

- [ ] Backend `npx tsc --noEmit -p apps/backend` (errors only in upstream files from the stale Prisma client are acceptable; none in touched files).
- [ ] Frontend `npx tsc --noEmit -p apps/frontend`, then `npx next lint --quiet` on the touched files.
- [ ] Re-run every touched suite by path, sequentially.
- [ ] TODO.md: move project 1 to COMPLETED.
- [ ] Rebase on `origin/dev`, push `HEAD:dev`, remove the worktree.
