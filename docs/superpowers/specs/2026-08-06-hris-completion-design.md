# HRIS completion — phased plan

Status: **proposal, not yet built.** Written 2026-08-06.

Covers all 13 gaps recorded in `TODO.md` under *HRIS gap analysis vs Shomvob HR*.
Read that section first — this document is the sequencing, not the gap list.

Goal: an employee opens the app, sees their own attendance, applies for leave,
claims an expense, and downloads a payslip — and HR runs payroll for everyone in
one action instead of one POST per person per month.

---

## 0. Constraints that shape the whole plan

Four facts about this codebase drive the ordering more than feature priority does.

**Production applies the schema with `prisma db push`, never `migrate deploy`**
(`apps/backend/Dockerfile`). Every migration file is documentation as far as
production is concerned, and **any migration that moves data silently does
nothing there.** Three phases below carry backfills (2, 5, 11). Each must be
written as an idempotent boot-time sync — the pattern the four existing
`sync:*` scripts and `seedProjectColumns` already use — not as a migration
step. This has already bitten twice (conversation channels, Phase 3L board
columns); it is written down here so it does not bite a third time.

**`EmployeesController` guards with `JwtAuthGuard` alone.** Any authenticated
user in the tenant can read every salary figure today. Nothing employee-facing
can be built on top of that, which is why Phase 0 exists and is not optional.

**The referral-partner pattern is the template for an employee login** — same
login page, same token, a `user_id` link on the domain row, a guard that
resolves that row from `request.user`, and a route inside the existing `(app)`
shell activated by `active_context`. `docs/investor-portal-plan.md` §2–3 works
through why this beats a separate token scope for admin-provisioned users, and
an employee is admin-provisioned in exactly the same way an investor is. That
analysis is not repeated here; Phase 1 follows its conclusion.

**The accounting side of payroll is already correct.** `salary_accrual` and
`salary_payment` are live `PostingRuleEventType` values posting against Salary
Payable, and `Employee` is a party type on the GL-derived ledger. No phase below
needs new posting machinery — payroll gets *richer inputs* to an accrual that
already works, which is why the payroll track is safe to leave until after the
time track.

---

## 1. Track shape

Five tracks, fourteen phases. Tracks A and B are strictly ordered; C depends on
B; D is largely independent and can run in parallel with C once A has landed; E
is last because it consumes everything above.

```
A. Foundation        0 ─ 1
B. Time              2 ─ 3 ─ 4
C. Payroll                     5 ─ 6 ─ 7
D. Employee modules      8   9   10   11        (parallel, needs A only)
E. Lifecycle                            12 ─ 13
```

The critical path to something an employee would recognise as a product is
**0 → 1 → 2 → 3**. Everything after that is depth.

---

## Track A — Foundation and access

### Phase 0 — Lock down what exists

Not a feature. A prerequisite that has to land before any employee can hold a
token.

- Guard `EmployeesController` with `VIEW_HR` / `MANAGE_HR` instead of bare
  `JwtAuthGuard`. Add `MANAGE_HR` to `packages/shared-types/index.ts` (only
  `VIEW_HR` and `VIEW_PAYROLL` exist today).
- **This silently revokes the employee list from everyone who has it now**, so it
  needs a grant of `VIEW_HR` to existing tenant users first — a boot-time sync,
  per §0, not a migration.
- Strip `basic_salary` from the employee list/detail payloads unless the caller
  holds `VIEW_PAYROLL`. Today the HR dashboard is stricter than the endpoints it
  summarises, which is backwards.

Exit: no salary figure is readable without `VIEW_PAYROLL`, verified by a
controller spec per endpoint.

### Phase 1 — Employee identity and the self-service shell

The single largest gap, and the one every employee-facing phase hangs off.

- `EmployeeGuard` modelled on `apps/backend/src/referrals/referee.guard.ts` —
  resolves the `Employee` row from `request.user` via the existing
  `Employee.user_id` and attaches it. No new token scope.
- `employee-portal` module: `GET /employee-portal/me`, `/summary`. Invite and
  revoke endpoints behind `MANAGE_HR`. `Employee.portal_access` boolean.
- Frontend: `active_context === 'employee'` threaded through
  `auth-session.ts` → `select-account` → `(app)/layout.tsx` → `Sidebar.tsx`,
  same four touch points the investor plan enumerates.
- **The security tests belong in this phase, not after it.** The invariant the
  whole design rests on: an employee-context user still has a `TenantUser` row
  (unlike an investor), so `TenantInterceptor` *does* set `request.tenantId` and
  an employee token is **not** structurally inert against staff endpoints the
  way a referee token is. That is the one place this diverges from the referee
  precedent and it is the thing most likely to be got wrong. Every staff
  controller reachable by an employee-context token must be pinned by a test
  asserting it 403s.

Exit: an employee logs in, sees a portal with their own profile and nothing
else, and cannot reach a staff endpoint.

---

## Track B — Time and attendance

### Phase 2 — Calendar and schedules

Attendance today has no baseline to be measured against, which is why lateness
and overtime are both uncomputable. This phase supplies the baseline and ships
no user-visible attendance change.

- `Holiday` — tenant-level calendar (date, name, optional store scope). Replaces
  hand-setting `HOLIDAY` on 40 employee-days to mark Eid.
- `WorkSchedule` (name, per-weekday start/end/break, weekly off days) and
  `EmployeeSchedule` assigning one to an employee with an effective date.
- Backfill: every existing tenant gets a default 9–6 Sun–Thu schedule and every
  employee is assigned it, **as a boot-time sync** (§0). Nothing moves on the day
  this ships.
- Extend `AttendanceStatus` with `LATE`, `EARLY_LEAVE`, `ON_LEAVE`. Enum
  additions are additive and `db push`-safe; existing rows keep their values.

Exit: every employee has an expected start time, and Eid is one row.

### Phase 3 — Capture, and the mobile answer

This is where attendance stops being a data model and becomes a product, and
where the "no mobile app" gap gets its cheap answer.

- `POST /employee-portal/attendance/check-in` / `check-out`, writing the same
  `AttendanceRecord` the admin path writes. Status derived from the Phase 2
  schedule rather than typed by a human.
- Geofencing off `Store` coordinates, with the radius a tenant setting. Device
  fingerprint recorded. Deliberately **not** biometric — that needs hardware
  integration and belongs in its own phase if anyone asks.
- Leave↔attendance reconciliation: approving a `LeaveRequest` writes `ON_LEAVE`
  rows across its date span. Today the two models do not talk at all, which
  means the attendance report contradicts the leave report.
- **Mobile: a PWA over the Phase 1 portal, not Flutter.** `apps/mobile` is an
  empty directory and staying that way is the right call for now — the ESS
  surface is a handful of screens, the frontend is already mobile-first per the
  UI rules, and a PWA ships in one phase where a Flutter app is a project.
  Revisit only if push notifications or offline check-in become requirements;
  both are real possibilities for a factory floor, neither is proven yet.

Exit: an employee clocks in from their phone, and an admin never types a clock
time again.

### Phase 4 — Overtime

- Computed from Phase 2 schedule versus Phase 3 actuals. `OvertimeRecord` with
  its own approval, because unapproved overtime must not reach payroll.
- Monthly attendance snapshot per employee — present/absent/late/leave days and
  approved OT hours — as the input contract the payroll run reads. Freezing it
  is what stops a payroll re-run from silently changing last month's pay.

Exit: overtime hours exist as an approved, frozen number. **This is the payroll
track's precondition** — overtime is a legally mandated pay component under the
Bangladesh Labour Act, so a payroll run built before it would be wrong from day
one and would need rebuilding.

---

## Track C — Payroll

### Phase 5 — Salary structure

- `SalaryComponent` (name, EARNING | DEDUCTION, fixed amount or percentage of
  basic, taxable flag). Seeded with the standard Bangladeshi split: basic, house
  rent, medical, conveyance.
- `EmployeeSalaryStructure` — components per employee with an effective date, so
  a revision is a new row and history survives. `Employee.basic_salary` stays as
  the fallback for anyone without a structure; it is not dropped.
- Bank and mobile-money disbursement details on the employee, encrypted through
  the existing `EncryptionService` that already handles NID.
- Backfill: every employee's current `basic_salary` becomes a one-component
  structure, boot-time sync (§0).

Exit: gross pay is composed rather than typed.

### Phase 6 — Payroll run and payslips

- `PayrollRun` (tenant, period, status) and `PayrollLine` (employee, each earning
  and deduction, gross, net) — draft → approve → pay. Draft is recomputable;
  approved is frozen.
- Inputs: Phase 5 structure, Phase 4 attendance/OT snapshot, unpaid leave
  deduction, and loan/advance instalments. `Loan` exists with a `RECEIVABLE`
  direction, so a staff advance is already representable — it just needs
  wiring as a payroll deduction rather than a separate repayment.
- Statutory components as configurable deductions: provident fund, AIT. Festival
  bonus as an off-cycle run of the same model.
- **Payslips.** A new `PrintDocType` value and template — `doc_types` is a plain
  `String[]` on `print_templates`, so this needs no schema change, and the
  existing print-template editor and `openPrintWindow` path handle rendering.
  Downloadable from the Phase 1 portal by the employee themselves.
- Accrual and payment continue through the existing `salary_accrual` /
  `salary_payment` posting events — one accrual per employee per period is
  already `@@unique`, and `SalaryPayment` already allows instalments against a
  payable balance. **No new posting machinery.**

Exit: HR approves one run and every employee can download what they were paid
and why.

### Phase 7 — Disbursement

- Bank transfer file export and bKash/Nagad disbursement, per-line status
  written back onto the run.
- The payment rails are already integrated for customer payments; this is
  reusing them in the outbound direction, not building them.

Exit: paying 40 people is one file, not 40 forms.

---

## Track D — Employee-facing modules

Independent of B and C. Needs Phase 1 only, so this track can run in parallel
with the payroll track by a second pair of hands.

### Phase 8 — Expense claims and reimbursement

- `ExpenseClaim` + `ExpenseClaimLine`, submitted by the employee from the portal.
  **The approval flow copies `LeaveRequest` almost field for field** —
  `status` / `approved_by` / `approved_at` / `approver_note` — which is the
  cheapest correct answer and keeps two approval UIs consistent.
- Receipt attachments **must** go through `uploadBuffer()` + a `storage_key`
  column, the pattern `crm_contact_attachments` uses. The older `uploadFile()`
  path returns only a URL and leaks Cloudinary storage forever; that liability is
  already logged at the top of `TODO.md` and must not be deepened. Type
  allow-list and size cap needed — this is a tenant-supplied file surface.
- An approved claim settles either as a direct payment or as a Phase 6 payroll
  earning line. Posts through the existing `expense` event.

Exit: `ExpenseEntry` stops being the only expense concept, and an employee can
get their money back without a WhatsApp message.

### Phase 9 — Employee-assigned assets

- `AssetAssignment` linking an employee to a `FixedAsset` **or** to a
  non-capitalised item (a SIM, a uniform — most assigned things are below any
  capitalisation threshold, so this cannot be `FixedAsset`-only).
- Handover, return, condition note, employee acknowledgement from the portal.
- The accounting side of `FixedAsset` needs nothing — depreciation is unaffected
  by who is holding the laptop.

Exit: someone leaving can be checked against what they hold.

### Phase 10 — Policies and documents

- `Policy` / `Notice` — published to employees, with per-employee acknowledgement
  tracking. Acknowledgement is the part with actual value; a PDF on a shared
  drive already solves distribution.
- `EmployeeDocument` — contract, offer letter, NID scan, certificates, with
  expiry dates and an alert cron. Same `uploadBuffer()` + `storage_key`
  requirement as Phase 8. `Employee` currently stores an encrypted NID *string*
  and no files at all.

Exit: HR's filing cabinet is in the system.

### Phase 11 — Leave policy engine

What exists is genuinely adequate for a small shop; this is for tenants with a
real HR function.

- Multi-level and role-based approval routing — `approved_by` is one user today.
- Carry-forward, encashment and accrual-over-the-year rules on `LeaveType`,
  which currently has only `days_per_year`. Year-end carry-forward is a
  boot-time sync (§0), not a cron nobody runs.
- Half-day leave. `LeaveRequest.days` is already a float; nothing in the balance
  maths or the UI treats `0.5` as meaningful, so this is smaller than it sounds.
- Medical-certificate attachments, team leave calendar.

Exit: leave policy is configured rather than enforced by convention.

---

## Track E — Lifecycle and compliance

### Phase 12 — Onboarding, offboarding, final settlement

- Onboarding checklist tied to the Phase 10 documents and Phase 9 assets.
- `EmployeeStatus` grows beyond `ACTIVE | INACTIVE` — resignation, termination,
  end of contract — with a reason and a last working day. Nothing records *why*
  anyone left today.
- **Final settlement is the item that matters**, because it is a money event with
  no home in the system right now: encashed leave, gratuity, outstanding advance
  recovery, unreturned assets, settled as an off-cycle Phase 6 run so it posts
  correctly. Everything it consumes exists only after Tracks C and D.

### Phase 13 — Bangladesh statutory reporting

- PF register, tax-deduction statement, service book, the labour-law registers.
- Depends on Phase 5's component taxability flags and Phase 6's frozen runs —
  there is nothing to report before those exist.
- ERP71 is deliberately Bangladesh-local everywhere else (bKash/Nagad, BDT,
  Bangla locale). HR is the module where that localisation currently stops, and
  this phase is where it resumes.

---

## 2. Explicitly out of scope

**Recruitment, applicant tracking, performance appraisals and training records.**
Recruitment is Shomvob's origin as a jobtech company and their strongest ground;
it is the part of their platform ERP71 is least likely to want to chase, and it
shares no models with anything above. Appraisals and training are real HRIS
features with no ERP pull — they touch no money and no inventory.

Recommendation: leave all four out until a paying tenant asks. Nothing in phases
0–13 forecloses them.

**Biometric device integration.** Phase 3 ships geofenced phone check-in, which
covers retail and field staff. Biometric terminals matter for a factory floor and
need hardware integration per vendor — its own phase, on evidence of demand.

**A Flutter app.** See Phase 3. The PWA is the answer until push notifications or
offline check-in are proven requirements.

---

## 3. If only one track ships

**Do Track A and Track B.** Phases 0–4 turn HR from a set of admin data-entry
screens into something an employee opens on their phone, and that is the whole
difference in product shape between ERP71's HR module and an HRIS. The payroll
depth in Track C is more work for less visible change, and every item in Track D
is additive rather than structural — those can follow demand.

The one thing that should not wait for a track boundary is **Phase 0**, which is
a live permission gap rather than a feature.
