# HR Reports submenu — proposal

**Status:** the recommended first cut of eight is **built and merged**. Tier 3
remains a proposal; the open questions below are tracked in `TODO.md`.
**Asked as:** "For HR, propose some reports to go under an *HR Reports* submenu
group", then "go for the recommended first cut of eight".

**What shipped:** all five Tier-1 reports plus Attendance Summary, Leave Balance
& Liability and Payroll Cost Summary, behind a flat `hr.reports` subgroup between
Recruitment and HR Setup. Backend aggregates live in a new `hr-reports` module.
Of the four open questions below, one was answered in the build — the money
columns are gated **page-side** (the leave report drops them rather than 403ing)
— and nav-level gating, export, and the Service Book's second home are all open.

---

## Problem

HR has no reports at all, and `TODO.md` has carried the gap since the menu
restructure:

> **No HR Reports group and no payroll UI** — both deferred out of the HR menu
> restructure because they have nothing behind them. There is no HR report page
> anywhere in the frontend […] Both groups were designed to absorb these later
> without a second restructure.

Sales has eleven report links, Inventory four, Purchases three, Accounting a
full statement set, and Projects picked up its first with Hour Logs. HR has
none — so every people question ("who was late this month", "what do we owe in
unused leave", "what did payroll cost by department") is answered by exporting
a list screen and pivoting it by hand, or not answered.

The gap is not evenly deep, and that is the finding this proposal turns on.

---

## What is already built

**Five statutory reports exist server-side with zero frontend consumers.**
`apps/backend/src/payroll/statutory-reports.controller.ts` shipped as Phase 13
of the HRIS plan and has never been surfaced. A grep of `apps/frontend/src` for
`statutory`, `wages-register`, `provident`, `employee-register` and
`service-book` returns nothing — the endpoints are reachable only by someone
holding a bearer token and a curl command.

| Endpoint | Returns |
|---|---|
| `GET /payroll/statutory/wages-register?year&month` | Per-employee wage row for one month: code, name, designation, department, scheduled/present days, overtime minutes, earnings and deductions |
| `GET /payroll/statutory/employee-register` | Full roster: code, name, phone, joining date, status, last working day, exit reason, department, designation |
| `GET /payroll/statutory/tax-deduction?startYear&employeeId` | AIT deducted per employee across a July–June income year |
| `GET /payroll/statutory/provident-fund?startYear` | PF deducted per employee across the same income year |
| `GET /payroll/statutory/service-book/:employeeId` | One employee's history: salary structures, leave, settled payroll lines |

All five are gated `VIEW_PAYROLL` at the controller. The four money reports go
through one `settledLines()` helper, so they read **settled payroll lines only**
and are correct-by-construction against frozen runs. The employee register is
the exception in spirit — it is roster data off `Employee` — and the controller
comment says why it lives here anyway: it is produced for the same inspection,
and splitting it across two permissions would mean an inspection pack nobody has
the rights to assemble in one go.

Other aggregates that already exist and can be borrowed rather than rebuilt:
`GET /attendance/month-snapshot`, `GET /attendance/summary/:employeeId`,
`GET /recruitment/summary`, `GET /salary-payments/summary`, and
`GET /payroll/runs/:id/disbursement-file`.

**The data behind the rest is unusually complete.** `AttendanceRecord` stores
`late_minutes`, `early_leave_minutes`, `worked_minutes` and `overtime_minutes`
per day, derived at write time so a later schedule change cannot rewrite
history. `AttendanceMonthSnapshot` pre-aggregates present/absent/half/leave/
holiday/late/scheduled days plus worked, late and approved-overtime minutes per
employee per month, with `frozen_at` marking the ones payroll consumed. That is
a purpose-built reporting table nothing currently reads for reporting.

---

## Proposed group

A single `hr.reports` subgroup, placed **between Recruitment and HR Setup** —
matching Sales and Inventory, where reports sit above setup:

```
HR
├── Overview
├── Employees
├── Attendance & Leave
├── Payroll
├── Recruitment
├── HR Reports          ← new, sortOrder 5
└── HR Setup            ← shifts 5 → 6
```

**One nesting level only.** `buildChildren` in `apps/frontend/src/lib/nav-resolver.ts`
filters a subgroup's children to links (`!('type' in child)`), so a subgroup
nested inside a subgroup is silently dropped, not rendered. HR Reports must be
a flat list — grouping the five statutory registers under their own
"Statutory" child is not available without a resolver change.

Group size is not a constraint: `sales.reports` already holds eleven links.

---

## The reports

### Tier 1 — page only, backend already done (5)

The cheapest real reports in the codebase. Each is a filter bar plus a table
over an endpoint that already returns exactly the right shape.

| Report | Route | Source | Perm |
|---|---|---|---|
| **Wages Register** | `/hr/reports/wages-register` | `payroll/statutory/wages-register` | `VIEW_PAYROLL` |
| **Employee Register** | `/hr/reports/employee-register` | `payroll/statutory/employee-register` | `VIEW_PAYROLL` |
| **Tax Deduction Statement** | `/hr/reports/tax-deduction` | `payroll/statutory/tax-deduction` | `VIEW_PAYROLL` |
| **Provident Fund Register** | `/hr/reports/provident-fund` | `payroll/statutory/provident-fund` | `VIEW_PAYROLL` |
| **Service Book** | `/hr/reports/service-book` | `payroll/statutory/service-book/:id` | `VIEW_PAYROLL` |

Wages Register and Employee Register are the two a Bangladeshi labour
inspection actually asks for, which makes them the highest-value pair in the
whole list — and they need no backend work at all.

Service Book is per-employee rather than per-period. It still earns a menu
entry (with an employee picker) because it is produced for the same inspection
pack as the other four, but it should *also* be linked from the employee detail
page, where someone already has the employee in hand.

### Tier 2 — new aggregate endpoint + page (6)

The reports a shop runs every month. All six read tables that already exist;
none needs a migration.

1. **Attendance Summary** — `/hr/reports/attendance`
   Pivot `AttendanceMonthSnapshot` by employee, department or month. KPI row:
   attendance %, present days, absent days, late days, worked hours, approved
   overtime hours. This is the same shape as `/projects/hour-logs/report`,
   which is the pattern to copy — one dimension selector, a KPI row, and
   share-of-total bars. `VIEW_HR`.

2. **Late & Early-Leave Report** — `/hr/reports/lateness`
   `AttendanceRecord.late_minutes` / `early_leave_minutes` over a date range,
   ranked worst-first, with a "more than N minutes" threshold and a
   per-employee day count. The discipline conversation currently has no
   evidence behind it. `VIEW_HR`.

3. **Leave Balance & Liability** — `/hr/reports/leave-balance`
   `LeaveBalance` × `LeaveType` per employee: entitled, used, remaining,
   carry-forward cap. Then the column nobody can produce today — remaining days
   × daily rate = **accrued leave liability in BDT**, for the types where
   `allows_encashment` is set. That is a real balance-sheet number the business
   currently cannot see. `VIEW_HR` for days, `VIEW_PAYROLL` for the money
   column.

4. **Leave Taken & Pending Approvals** — `/hr/reports/leaves`
   `LeaveRequest` grouped by type, department and month, plus an approval-aging
   panel (`status = PENDING`, days since `created_at`). Requests sitting
   unapproved for three weeks are invisible today. `VIEW_HR`.

5. **Payroll Cost Summary** — `/hr/reports/payroll-cost`
   `PayrollLine` rolled up by department, designation or month: gross earnings,
   overtime, absence deduction, structure deductions, adjustments, net pay,
   with month-over-month movement. Settled runs only, matching the statutory
   reports. `VIEW_PAYROLL`.

6. **Headcount & Attrition** — `/hr/reports/headcount`
   Joiners and leavers per month from `date_of_joining` / `last_working_day`,
   turnover %, average tenure, headcount by department, and leavers grouped by
   `exit_reason`. Phase 12 added those exit fields specifically so this could
   be asked; nothing asks it yet. `VIEW_HR`.

### Tier 3 — housekeeping, cheap and high relief (6)

Worth listing so the group is designed to hold them, but not worth blocking the
first cut on.

7. **Document Expiry** — `EmployeeDocument.expires_on` in expired / 30 / 60 / 90
   day buckets. A reminder cron already writes `expiry_notified_at`; there is
   no screen showing the same thing.
8. **Asset Custody** — `AssetAssignment where returned_on is null`, flagging
   rows with no `acknowledged_at`. The report an offboarding checklist needs.
9. **Onboarding / Offboarding Checklist Status** — `EmployeeChecklistItem`
   completion per employee, by `kind`.
10. **Recruitment Funnel & Time-to-Hire** — stage counts, time-in-stage from
    `stage_changed_at`, source effectiveness, and applied-to-joined days via
    `JobApplication.hired_employee_id`. That link exists precisely so "which
    channel produced staff who stayed" is answerable.
11. **Overtime Register** — observed `overtime_minutes` against approved
    `OvertimeRecord`, costed. The gap between the two is the interesting number.
12. **Expense Claim Reimbursement** — `ExpenseClaim` by status with aging on
    submitted-but-unpaid.

---

## Recommended first cut

**The five Tier-1 reports, plus Attendance Summary, Leave Balance & Liability,
and Payroll Cost Summary — eight links.**

The rationale is the cost curve: five of the eight are pure frontend work
against endpoints that already return the right shape, and the three that need
a backend aggregate are the three questions a retailer asks every month. It
also lands the group with enough in it to justify existing, which is the
objection that deferred it last time.

Tier 3 then lands as follow-ups without a second restructure — the same
property the menu restructure was designed for.

---

## Mechanics

**Registry and layout** — `packages/shared-types/navigation.ts`:

```ts
'hr.reports': { id: 'hr.reports', kind: 'subgroup', icon: 'BarChart3', labelKey: 'hr.hub.reports' },
'hr.reports.wages-register': { …, icon: 'ScrollText', href: '/hr/reports/wages-register' },
// … one entry per report
```

```ts
layoutNode('hr.reports', 'hr', 5),
layoutNode('hr.reports.wages-register', 'hr.reports', 0),
// …
layoutNode('hr.setup', 'hr', 6),   // was 5
```

**Icons — check before naming.** `NAV_ICON_MAP` is an allow-list, and the
restructure spec records that a name missing from it fails *silently* to the
`LayoutDashboard` fallback rather than erroring. Confirmed present and
sufficient for all twelve reports: `BarChart3`, `ScrollText`, `FileText`,
`FileSearch`, `BookOpen`, `Landmark`, `Users`, `UserPlus`, `CalendarOff`,
`Clock`, `AlertTriangle`, `Receipt`, `HandCoins`, `Wallet`, `Calculator`,
`TrendingUp`, `ClipboardCheck`, `Boxes`. Confirmed **absent**, so do not reach
for them without adding them first: `FileSpreadsheet`, `UserMinus`.

**`advancedOnly`** — `sales.reports` carries `advancedOnly: true` on the
subgroup, with the links omitting it so no "Advanced" badge renders on each
child. HR Reports should mirror that only if these are considered advanced;
the wages and employee registers are compliance basics, so the recommendation
is **not** to gate the group.

**Routes** — add an `hrReports` block to `apps/frontend/src/lib/routes.ts`
alongside the existing `hr` block.

**Hub page** — `hr/page.tsx` is grouped into the same five sections as the
sidebar and must gain a sixth, or it goes back to disagreeing with the menu —
the exact defect the restructure fixed.

**i18n** — `hr.hub.reports` plus one `sidebar.items.*` key and one
`hub.links.*` title/description per report, in en / bn / ms.

**Deploy** — new nav nodes need a `sync-nav-layout.ts --nodes=hr.reports,…`
run after deploy, or tenants with a saved `tenant_layout` will not see the
group. Same step the Hour Logs submenu needed.

---

## Open questions

1. **The sidebar does no permission gating.** `sidebar-nav-filter.ts` filters on
   `advancedOnly` and entitlement, never on permissions. Five of the proposed
   reports are `VIEW_PAYROLL`, so a store manager holding only `VIEW_HR` would
   see five links that 403 when clicked.

   The page half of this is cheap — `hasPermission(permissions, 'VIEW_PAYROLL')`
   already exists and is used by `AddEmployeeModal`, `hr/employees/[id]` and
   `HrDashboard`; `/hr/salary-payments` simply never adopted it. So each payroll
   report can gate itself at launch for the cost of one import.

   The nav half is a real decision: hiding a link needs permission awareness in
   the sidebar filter, which nothing has today. Five dead links is the point
   where that stops being theoretical, so this group is a reasonable place to
   add it — but it is scope beyond the reports themselves and should be called
   either way rather than discovered during build.

2. **Where does Service Book belong?** It is per-employee, unlike everything
   else in the group. Menu entry with a picker, employee-detail tab, or both.

3. **Does Leave Liability need the money column at launch?** It needs a daily
   rate, which means resolving `EmployeeSalaryStructure` — the most expensive
   part of an otherwise cheap report. Shipping days-only first is defensible.

4. **Export.** None of these are useful to an inspector on screen. Whether CSV
   or print is in scope for the first cut should be settled before build, not
   after — the statutory five in particular exist to be handed over on paper.
