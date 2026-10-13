# Transaction date filter on list pages

Date: 2026-10-13. Status: approved design, awaiting spec review.

## Why

Transaction lists filter by **Created**, the moment a row was entered (`created_at`). Shopkeepers think in transaction dates, and on some lists the two differ:

- A sale can be backdated on entry, and Dizi/Express sync stores the source system's date in `sale_date` while `created_at` is the time of the sync. "Created · Today" on a synced tenant's sales list shows last month's sales, and the table's Date column (which already shows `sale_date`) contradicts the filter.
- Users also want a time window, for example a night shift from 18:00 to 02:00 the next morning.

## Principle

- Every list that stores a transaction date gets a **Date** filter on that date.
- **Created stays** on every list, unchanged, as a separate filter. It answers a different question ("what was entered when").
- Times are optional. A bound without a time means the whole day, exactly as today.

## Scope

This spec covers the lists that already store a transaction date separately from `created_at`:

| List | Date filters | Time inputs | Server change |
|---|---|---|---|
| Sales list | `Sale.sale_date` | Yes | New `dateFrom` / `dateTo` |
| Vouchers | `Voucher.date` | No (its existing `from` / `to` filter is date-only) | None: existing `from` / `to` |
| Expenses | `ExpenseEntry.expense_date` (`@db.Date`) | No | None: existing `from` / `to` |
| Loans | `Loan.start_date` (`@db.Date`) | No | New `dateFrom` / `dateTo` |

### Not in this spec: purchases, returns and payments (project 2)

Purchases, sales returns, purchase returns and customer/supplier payments have no transaction-date column. `created_at` already holds the transaction date:

- The "Payment date" a user types is written into `created_at` (`customers.service.ts` ~1066, `suppliers.service.ts` ~1051).
- Sync writes the source date into `created_at` for purchases and payments.
- The purchase detail page shows `created_at` as the purchase date.

A separate Date filter there needs new columns, a backfill from `created_at`, every write path (entry forms, sync, imports) moved to the new column, and the purchase/supplier reports and ledgers moved with it. The original entry time of existing rows was never stored, so old rows will have Date equal to Created. That is project 2, with its own spec. Until then these lists keep only their Created chip.

## The filter chip

The existing `CreatedRangeFilter` (`apps/frontend/src/components/data-table/CreatedRangeFilter.tsx`) becomes the general component:

- It is exported as `DateRangeFilter`. `CreatedRangeFilter` stays as an alias, so its ~30 existing callers do not change.
- It takes a new `withTime` prop. When it is on, From and To each get an optional time input stacked under the date, which keeps the popover at `w-64` and fits 360px. When it is off, nothing changes.
- A time input is disabled until its date is set. An empty time means the whole day.
- Each bound is stored as `YYYY-MM-DD`, or as `YYYY-MM-DDTHH:mm` when a time is set. Both are the tenant's wall clock.
- Presets (Today, Yesterday, Last 7 days, This month) stay whole days.
- If From is after To, an inline error shows under To and Apply does not close the popover. No toast and no `alert()`.
- Chip text examples: `Date · 12 Oct`, `Date · 1 Oct – 7 Oct`, `Date · 12 Oct 18:00 – 13 Oct 02:00`.
- In the filter bar the Date chip comes before the Created chip.

The `created-range.ts` helpers follow suit: `formatCreatedRangeLabel` learns to print times, and a new `applyDateRangeQuery` returns `{ dateFrom, dateTo }`, alongside `applyCreatedRangeQuery` and `applyDueRangeQuery`.

## Server

### Timestamp columns: `zonedDayRange`

`zonedDayRange(from, to, timeZone)` in `apps/backend/src/common/tenant-time.util.ts` accepts each bound in either form:

| Bound | `from` becomes | `to` becomes |
|---|---|---|
| `YYYY-MM-DD` | Start of that day in the tenant's zone (unchanged) | End of that day in the tenant's zone (unchanged) |
| `YYYY-MM-DDTHH:mm` | That minute in the tenant's zone | End of that minute (`HH:mm:59.999`), inclusive |
| Anything else, including `25:00` | Ignored (unchanged) | Ignored (unchanged) |

Every existing caller sends dates only, so their results do not change. Tests pin this.

**Sales list.** `GET /sales` takes `dateFrom` / `dateTo` as two more `@Query` parameters. They filter `sale_date: zonedDayRange(dateFrom, dateTo, timezone)`. They combine with `createdFrom` / `createdTo` using AND.

### Date-only columns: `calendarDateRange`

A `@db.Date` value is stored as UTC midnight. Comparing it against a zoned range misses rows in zones west of UTC, so date-only columns compare calendar dates directly: `gte` / `lte` on `new Date('YYYY-MM-DD')`. This is what expenses already do. A new `calendarDateRange(from, to)` in `common/` provides this, and it ignores anything that is not `YYYY-MM-DD`.

**Loans list.** `ListLoansQueryDto` declares `dateFrom` / `dateTo`; the route binds to the DTO and the global pipe forbids undeclared keys. They filter `start_date: calendarDateRange(dateFrom, dateTo)`.

**Vouchers and expenses.** No server change. Their `from` / `to` filtering stays as it is.

## Pages

- **Sales list.** Gets a Date chip with `withTime`, filtering `sale_date`. The Date column switches from `formatDate` to `formatDateTime` so a filtered time is visible. One exception: a `sale_date` at exactly UTC midnight shows the date only, because that is how synced sales store a date that has no time (`parseProviderDate`). Known limitation: a time window treats synced sales as falling at UTC midnight (06:00 in Dhaka).
- **Vouchers.** The two plain From/To date inputs are replaced by a Date chip without times, sending the existing `from` / `to`. The approval-queue mode (`?approvalStatus=PENDING`) is unaffected.
- **Expenses.** Same as vouchers.
- **Loans.** Gets a Date chip without times, sending `dateFrom` / `dateTo`.

Filters stay in component state, as they are today. They are not added to the URL.

## Copy

These keys are added under `common.createdRange` in all 9 locales:

- `time`: "Time"
- `fromAfterTo`: "From must be on or before To"

The chip label reuses `common.date` ("Date").

## Testing

### Backend

- `tenant-time.util.spec.ts`: date-time bounds in `Asia/Dhaka` and in a zone with daylight saving (`America/New_York` across a change); `to` is inclusive through `:59.999`; date-only results are unchanged; malformed times are ignored.
- `calendarDateRange`: date-only bounds; anything else is ignored.
- `sales.service.spec.ts`: `dateFrom` / `dateTo` filter `sale_date`; `createdFrom` / `createdTo` still filter `created_at`; both together combine with AND.
- `loans.service.spec.ts`: `dateFrom` / `dateTo` filter `start_date`. The DTO accepts both keys.

### Frontend

- `CreatedRangeFilter.test.tsx`: with `withTime`, the time inputs render and stay disabled until a date is set; the From-after-To error shows; the chip label shows times; presets are unchanged. Without `withTime`, behaviour is unchanged.
- `created-range` helpers: labels with times, and `applyDateRangeQuery`.
- `sales/list/page.test.tsx`: the Date chip sends `dateFrom` / `dateTo`, and the Created chip still sends `createdFrom` / `createdTo`.
- `accounting/vouchers/page.test.tsx`: the Date chip sends `from` / `to`. Expenses and loans have no page tests; add one each.
- Run with `--runTestsByPath`, because `(app)` in a jest path is a regex group, and with `--maxWorkers=2`.
- Browser check at 360px and at desktop width through a preview route: the popover with time inputs fits, and there is no horizontal scroll.

## Rollout

One PR to `dev`, in four commits that can each ship on their own:

1. Shared pieces: the server range helpers, the chip's `withTime`, the helpers, and the copy.
2. Sales list.
3. Vouchers and expenses.
4. Loans.

## Out of scope

- Project 2: transaction-date columns for purchases, returns and payments.
- Time inputs on Created chips.
- Putting filters in the URL.
- Filters on the due, valid-until and delivery dates of orders and quotations.
