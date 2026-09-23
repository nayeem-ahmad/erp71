# Parameter-driven approval workflow — design plan

Status: **proposed, 2026-09-12.** Nothing here is built. Written in answer to
"how can we add a workflow feature where entries are approved by different
approvers, and the approval authority depends on various parameters of the
entry."

The short version:

> **One `ApprovalRequest` engine, driven by a per-tenant rule table, that routes
> on a flat "fact" object each module publishes for its own documents — and that
> writes its verdict *back onto the document's existing status column* so no
> existing query, report or index changes.**

That last clause is the whole reason this is shippable incrementally. The engine
is additive; a module adopts it in one small PR, and a tenant who never
configures a policy sees no behaviour change at all.

---

## 1. What already exists

Approval is not a new idea in this codebase. It has been solved **thirteen
separate times**, each slightly differently, and none of the thirteen can route
on the parameters of the entry. Eleven are tenant-scoped — an entry a tenant's
own people approve — and those are what an engine here would cover; the table
below is those eleven. The remaining two sit at the platform-admin tier and are
out of scope by the same rule that excludes anything cross-tenant; §1.1 lists
them so the count is honest rather than convenient.

| Entry | Where | Approval state | Permission | Routing |
|---|---|---|---|---|
| Voucher | `schema.prisma:3619` | `approval_status`, `approved_by`, `approved_at`, `rejection_reason` | `APPROVE_VOUCHER` | tenant-wide on/off flag, anyone holding the permission |
| Leave request | `schema.prisma:5547` | `status`, `approved_by`, `approved_at`, `approver_note`, `approvals_given`, `LeaveRequestApproval[]` (`:5586`, its own `approver_id`) | `MANAGE_HR` | N levels from `LeaveType.approval_levels` (`:4835`), anyone holding the permission |
| Expense claim | `schema.prisma:5148` | `status`, `approved_by`, `approved_at`, `approver_note` | `MANAGE_HR` | single approver |
| Warehouse transfer | `schema.prisma:1796` | `requires_approval`, `approved_by`, `approval_date` | `APPROVE_GOODS_TRANSFER` | single approver |
| Product demand | `schema.prisma:1974` | `reviewed_by`, `reviewed_at`, per-line `quantity_approved` | `APPROVE_PRODUCT_DEMAND` | single reviewer |
| CRM activity | `schema.prisma:3249` | `is_approved`, `approved_by`, `approved_at` | `APPROVE_CRM_ACTIVITY` | single approver |
| Payroll run | `schema.prisma:5230` | `status`, `approved_by`, `approved_at` | `MANAGE_HR` | single approver |
| Overtime record | `schema.prisma:5457` | `status` (`PENDING \| APPROVED \| REJECTED`), `approved_by`, `approved_at` | **none** — `JwtAuthGuard` only | single reviewer, who may approve *fewer* minutes than were recorded |
| Stock take | `InventorySettings`, `schema.prisma:1768` | `discrepancy_approval_threshold`; `StockTakeSession.status` (`:1922`) | — | a threshold, hard-coded in shape |
| Warranty claim | `schema.prisma:4389` | `status` includes `APPROVED`, but **no approver column** | **none** — `JwtAuthGuard` only | unrecorded — nobody is stored as having approved it |
| Fund transfer | `schema.prisma:4357` | *none* | `APPROVE_FUND_TRANSFER` — **granted but never enforced**, see below | none |

Eleven columns record who signed: seven `approved_by` (voucher, leave request,
expense claim, warehouse transfer, CRM activity, payroll run, overtime record),
three `reviewed_by` (`ProductDemand`, plus the two platform-admin flows in §1.1),
and `LeaveRequestApproval.approver_id` for the per-level rows. Two of the eleven
tenant flows — warranty claim and fund transfer — record nobody at all.

Count columns, not occurrences: `grep -cE '^\s+approved_by\s' schema.prisma`
gives 7, where a plain `grep -o approved_by | wc -l` gives 12 by also counting
three relation fields that name the column and two doc comments. That mistake
stood in this document through eighteen re-checks — see the note at the end.

### 1.1 Two more at the platform-admin tier

Both are maker-checker flows on the same pattern, and both are **out of scope**
for the engine proposed here: the approver is an Anthropic-side platform admin,
not anyone in the tenant, and §8.1 rules out anything cross-tenant. They are
listed because "solved eleven times" was not true — it was thirteen — and
because each is a worked example of the shape the engine is meant to replace.

| Entry | Where | Approval state | Guard |
|---|---|---|---|
| Referee payout request | `RefereePayoutRequest` | `status`, `reviewed_by` (*"platform admin user id"*), `reviewed_at`, `decision_note` | `JwtAuthGuard` + `PlatformAdminGuard` |
| Activation request | `ActivationRequest` | `status` (`PENDING \| VERIFIED \| REJECTED`), `reviewed_by`, `reviewed_at`, `review_note` | `JwtAuthGuard` + `PlatformAdminGuard` |

`RefereePayoutRequest` is not new — it predates this document, and the original
survey simply missed it, the same way it missed `OvertimeRecord`. Both are
properly guarded, so neither joins the three unguarded endpoints below.

### 1.2 Three of the eleven have no approval authority check

The fragmentation is not only that the same problem was solved eleven times. In
three of those eleven, *anyone signed in can approve*:

- **`APPROVE_FUND_TRANSFER` is defined, labelled and granted to two roles in
  `packages/shared-types/index.ts:67,615,932,1017` and is not referenced by a
  single line of backend code.** `FundTransfer` has no approval column and no
  guard consults the permission. A tenant can tick "Approve fund transfers" in
  the role editor today and it does nothing.
- **Overtime review** (`attendance.controller.ts:106`,
  `PATCH attendance/overtime/:id/review`) carries no `@RequireStorePermission`
  at all — only the controller-level `JwtAuthGuard` and a plan check. Any signed-in
  user can approve overtime minutes, and the service stamps their id into
  `approved_by`.
- **Warranty claim status** (`warranty-claims.controller.ts:43`,
  `PATCH warranty-claims/:id/status`) is likewise `JwtAuthGuard`-only, and
  `APPROVED` is one of its six valid statuses. One correction to this one,
  found 2026-09-22: until that date `UpdateWarrantyClaimStatusDto` carried no
  class-validator decorators, so the global pipe's whitelist was empty and the
  endpoint rejected *every* request (§6.8). "Anyone signed in can approve a
  warranty claim" was therefore true of the authorization and false of the
  behaviour — nobody could call it at all. The DTO is decorated now, so the
  endpoint works and the missing permission check is live rather than
  theoretical. That makes it more urgent, not less.

Each is worth fixing on its own, independent of this plan. They also make those
three the cleanest Phase 4 adoptions, since there is no approval behaviour to
preserve — for fund transfers, none exists at all.

The **voucher** flow is the most mature and is the right template to generalise
from:

- `apps/backend/src/accounting/voucher-approval.util.ts` — pure, defaulted,
  spec'd (`voucher-approval.spec.ts`). Three tenant flags, an
  `initialApprovalStatus()` decision function, and an `approvalVoucherFilter()`
  that returns an **empty** `where` fragment when the feature is off, so
  tenants who never enable it pay nothing.
- `apps/backend/src/accounting/accounting.controller.ts:264–283` — approve,
  reject, bulk-approve, bulk-reject, all behind
  `@RequireStorePermission(VIEW_LEDGER, APPROVE_VOUCHER)`.
- `apps/frontend/src/hooks/usePendingVoucherCount.ts` — the sidebar badge, which
  **stops polling** once it learns the tenant has approval off.

Three lessons from it that the generic engine must inherit, not relitigate:

1. **Off by default, and off must be free.** No new query on the hot path for a
   tenant with no policy.
2. **Never queue machine-generated documents behind a human by default.**
   `auto_approve_system_vouchers` (`schema.prisma:3558`) exists because holding
   back auto-posted vouchers stalls sales, purchases and payroll.
3. **Pure util + spec, service on top.** `voucher-approval.util.ts`,
   `leave-policy.util.ts`, `posting-status.util.ts` are all pure functions with
   their own spec files. The rule evaluator belongs in that layer.

### 1.3 What is missing today

No flow anywhere can express *"a voucher under ৳50,000 is the branch manager's
call; over ৳500,000 it needs the owner."* Every one of the eleven is
"whoever holds the permission, once" — or, for leave, "whoever holds the
permission, N times", or, for three of them, "whoever is signed in". Authority
does not vary with the entry.

**The bad-debt write-off, added to `dev` on 2026-09-18, is what that costs.**
`WRITE_OFF_CUSTOMER_DEBT` is a new permission guarding three endpoints in
`customers.controller.ts:186,198,207` — and unlike `APPROVE_FUND_TRANSFER` it is
properly enforced at every one. The schema comment introducing it says exactly
why it deserved its own permission:

> Forgiving a receivable: the one AR action that destroys money with no
> counterparty and no document from the other side.

It is the sharpest case in the codebase for routing on the entry, and it has no
routing at all: **no approver column, no approval status, and no amount
threshold anywhere in the module.** The permission is binary, so a shop that
wants its counter staff to clear ৳50 of rounding must also let them forgive
৳2,00,000 — and the only record of either is the write-off row itself.

This is the pattern the plan exists to stop. Splitting the permission was the
right call and is not the missing piece; a twelfth bespoke threshold column
would not be either. What the write-off wants is one rule — *under ৳1,000 the
manager, above it the owner* — expressed the same way as every other rule in the
tenant, which is what §2 onwards is for. It is the cleanest Phase 4 adoption
after fund transfers: recent, small, permission-guarded already, and with no
legacy approval behaviour to preserve.

Also missing, and needed for people-based routing:

- **`Employee.manager_id`** — there is no reporting line on `Employee`
  (`schema.prisma:4738`). `hiring_manager_id` on `JobPost` and `manager_id` on
  `Project` are the only manager fields in the schema, and neither is a
  hierarchy.
- **`Department.head_employee_id`** — `Department` (`schema.prisma:4708`) is a
  name and nothing else.

---

## 2. The model

Four tables. Two are configuration, two are runtime.

```
ApprovalPolicy   (per tenant, per entity type — the on switch)
  └── ApprovalRule      (ordered, conditional — "which chain does this entry get?")
        └── ApprovalStep    (ordered — "who signs at level 2, and how many of them?")

ApprovalRequest  (one per submitted document — the live instance)
  └── ApprovalAction   (one per decision — the audit trail)
```

### 2.1 Configuration

```prisma
/// Turns approval on for one document type in one tenant, and owns the rules
/// that route it. No row for an entity type means approval is off for it —
/// which is why every hot path can short-circuit on a single indexed lookup.
model ApprovalPolicy {
  id          String  @id @default(uuid())
  tenant_id   String
  /// VOUCHER | PURCHASE_ORDER | EXPENSE_CLAIM | LEAVE_REQUEST | FUND_TRANSFER |
  /// WAREHOUSE_TRANSFER | PRODUCT_DEMAND | SALES_DISCOUNT | PAYROLL_RUN …
  entity_type String
  enabled     Boolean @default(false)

  /// The `auto_approve_system_vouchers` lesson, generalised: documents a module
  /// posts automatically skip the queue unless a tenant deliberately says
  /// otherwise. Default true or sales stall behind an approver.
  auto_approve_system Boolean @default(true)

  /// What happens to an entry no rule matches. AUTO_APPROVE keeps the tenant
  /// moving; REQUIRE_DEFAULT sends it down `default_*` below. AUTO_APPROVE is
  /// the safe default — a half-written matrix must not freeze the business.
  no_match_behaviour String @default("AUTO_APPROVE")

  /// Whether the submitter may sign their own entry when they happen to hold
  /// the permission. Per-step override exists; this is the tenant's stance.
  allow_self_approval Boolean @default(false)

  /// Reports and lists default to approved-only. Generalises
  /// `AccountingSettings.reports_approved_only` (schema.prisma:3561).
  reports_approved_only Boolean @default(false)

  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt
  deleted_at DateTime?

  tenant Tenant         @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  rules  ApprovalRule[]

  @@unique([tenant_id, entity_type])
  @@index([tenant_id, enabled])
  @@map("approval_policies")
}

/// One conditional route. Rules are tried in `priority` order and the FIRST
/// match supplies the chain — first-match-wins, not merge, because a merged
/// chain is unexplainable to the shopkeeper who has to answer "why is this
/// waiting on three people?"
model ApprovalRule {
  id        String @id @default(uuid())
  tenant_id String
  policy_id String
  name      String
  priority  Int    @default(100)
  enabled   Boolean @default(true)

  /// The predicate, as JSON — see §3. Null means "always matches", which is how
  /// a catch-all final rule is written.
  conditions Json?

  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt
  deleted_at DateTime?

  tenant Tenant         @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  policy ApprovalPolicy @relation(fields: [policy_id], references: [id], onDelete: Cascade)
  steps  ApprovalStep[]

  @@index([tenant_id, policy_id, priority])
  @@map("approval_rules")
}

/// One level of a chain.
model ApprovalStep {
  id        String @id @default(uuid())
  tenant_id String
  rule_id   String
  sequence  Int

  /// PERMISSION | TENANT_ROLE | USER | EMPLOYEE_MANAGER | DEPARTMENT_HEAD |
  /// STORE_MANAGER — see §4.
  approver_type String
  /// The permission name, role name or user id the type needs. Null for the
  /// derived types, which read the org chart instead.
  approver_ref  String?

  /// Quorum. 1 is "any one of them"; 2 is "any two of the eligible set".
  min_approvals Int     @default(1)
  /// Per-step override of the policy's stance on the submitter signing.
  allow_self    Boolean @default(false)

  /// Hours before this step is considered late. Null = no SLA. Escalation is
  /// Phase 5; the column lands now so the editor UI is not rebuilt later.
  sla_hours   Int?
  escalate_to String?

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  tenant Tenant       @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  rule   ApprovalRule @relation(fields: [rule_id], references: [id], onDelete: Cascade)

  @@unique([rule_id, sequence])
  @@index([tenant_id, rule_id])
  @@map("approval_steps")
}
```

### 2.2 Runtime

```prisma
/// The live approval of one document. Addressed by (entity_type, entity_id)
/// rather than by a foreign key per module, so adopting the engine costs a
/// module no schema change at all.
model ApprovalRequest {
  id          String @id @default(uuid())
  tenant_id   String
  entity_type String
  entity_id   String
  store_id    String?

  /// PENDING | APPROVED | REJECTED | CANCELLED
  status       String @default("PENDING")
  /// Which step is waiting. 1-based; equals the chain length + 1 once complete.
  current_step Int    @default(1)
  total_steps  Int

  /// The rule that routed it, and the facts it was routed ON, snapshotted.
  /// Snapshotted because the matrix will be edited while entries are in flight,
  /// and "why did this go to Karim?" must stay answerable afterwards.
  matched_rule_id String?
  facts           Json
  /// Hash of `facts`. An edit that changes it invalidates the chain — see §6.2.
  facts_hash      String

  submitted_by String
  submitted_at DateTime  @default(now())
  decided_at   DateTime?

  tenant  Tenant           @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  actions ApprovalAction[]

  @@unique([tenant_id, entity_type, entity_id])
  @@index([tenant_id, status, entity_type])
  @@index([tenant_id, entity_type, entity_id])
  @@map("approval_requests")
}

/// One decision. Append-only; a re-routed chain voids prior actions by marking
/// them superseded rather than deleting them.
model ApprovalAction {
  id         String @id @default(uuid())
  tenant_id  String
  request_id String
  step       Int

  /// APPROVED | REJECTED | DELEGATED | COMMENTED | AUTO_APPROVED | SUPERSEDED
  decision    String
  /// User id, not a relation — the rest of the schema records actors this way
  /// (see the note at schema.prisma:1990) and a deleted user must not take the
  /// history with them.
  approver_id String?
  /// Snapshot of who they were at the time, for the same reason.
  approver_name String?
  note        String?
  decided_at  DateTime @default(now())

  tenant  Tenant          @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  request ApprovalRequest @relation(fields: [request_id], references: [id], onDelete: Cascade)

  @@unique([request_id, step, approver_id])
  @@index([tenant_id, request_id])
  @@map("approval_actions")
}
```

The `@@unique([request_id, step, approver_id])` is not decoration: it is what
stops two approvers double-signing the same step in a race.

---

## 3. "Various parameters" — the fact object

This is the part the question actually turns on, so it gets the most care.

**Each module publishes a flat, typed `facts` object for its entry.** Rules are
written against facts, never against Prisma rows. The engine knows nothing about
vouchers.

```ts
// apps/backend/src/approvals/approval-facts.ts
export interface ApprovalFacts {
    // Universal — every entity type supplies these.
    entityType: string;
    amount: number;          // ALWAYS BDT, normalised — see §6.3
    storeId: string | null;
    departmentId: string | null;
    createdById: string;
    createdByEmployeeId: string | null;
    isSystemGenerated: boolean;

    // Type-specific — a sparse bag, declared per module.
    [key: string]: FactValue;
}
```

Type-specific facts, by module:

| Entity | Facts beyond the universal set |
|---|---|
| Voucher | `voucherType`, `accountCodes[]`, `isBackdated`, `fiscalPeriodId` |
| Purchase order | `supplierId`, `categoryIds[]`, `lineCount`, `isImport`, `currency` |
| Expense claim | `expenseCategoryId`, `hasAttachment`, `daysSinceIncurred` |
| Leave request | `leaveTypeId`, `days`, `isHalfDay`, `noticeDays` |
| Sales discount | `discountPercent`, `customerId`, `customerGroupId`, `belowCost` |
| Warehouse transfer | `sourceStoreId`, `destinationStoreId`, `isCrossBranch`, `totalQty` |
| Fund transfer | `sourceStoreId`, `destinationStoreId`, `method` |
| Payroll run | `employeeCount`, `periodMonth` |

### 3.1 The condition DSL

JSON, with a closed operator set:

```json
{
  "all": [
    { "fact": "amount",  "op": "gte", "value": 50000 },
    { "fact": "amount",  "op": "lt",  "value": 500000 },
    { "any": [
      { "fact": "storeId",     "op": "in", "value": ["store-dhanmondi", "store-gulshan"] },
      { "fact": "voucherType", "op": "eq", "value": "PAYMENT" }
    ]}
  ]
}
```

Nodes: `all`, `any`, `not`, and leaves. Operators: `eq`, `ne`, `gt`, `gte`,
`lt`, `lte`, `in`, `nin`, `between`, `contains` (for array facts), `is_null`,
`is_true`.

**Why JSON and not an expression string.** Tenant-authored text evaluated as
code is remote code execution in a multi-tenant SaaS — `eval`, `new Function`,
and every "safe" expression library that has had a sandbox escape. A closed
operator set cannot execute anything, renders directly as a form in the policy
editor, and is trivially unit-testable. There is no version of this feature
where a shopkeeper types JavaScript.

The evaluator is a pure function in the util layer, alongside
`voucher-approval.util.ts`:

```ts
// apps/backend/src/approvals/condition.util.ts
export function evaluateConditions(node: ConditionNode | null, facts: ApprovalFacts): boolean;

// apps/backend/src/approvals/rule-match.util.ts
export function matchRule(rules: RuleShape[], facts: ApprovalFacts): RuleShape | null;
```

Both get `.spec.ts` files. `matchRule` sorts by `priority`, skips disabled and
soft-deleted rules, and returns the first whose `conditions` evaluate true —
with `conditions: null` matching everything, which is how the catch-all row at
`priority: 999` is written.

---

## 4. Who signs — approver resolution

`ApprovalStep.approver_type` maps onto data that mostly **already exists**:

| Type | Resolves to | Source |
|---|---|---|
| `PERMISSION` | everyone holding `approver_ref` on the entry's store | `UserStorePermission` (`schema.prisma:4318`) — the existing matrix |
| `TENANT_ROLE` | everyone holding that tenant role | `TenantUser.tenant_role_id` → `TenantRole`, **and** `TenantUser.roles[]` — *not* `TenantUser.role` (`schema.prisma:1263`); see below |
| `USER` | one named user | `approver_ref` is the user id |
| `EMPLOYEE_MANAGER` | the submitter's manager | **needs new `Employee.manager_id`**; resolves to an `Employee`, see below |
| `DEPARTMENT_HEAD` | head of the entry's department | **needs new `Department.head_employee_id`**; same |
| `STORE_MANAGER` | manager of the entry's store | `UserStorePermission` + a manager permission |

```ts
resolveApprovers(step: ApprovalStep, facts: ApprovalFacts, ctx: TenantContext): Promise<string[]>
```

**Resolved at decision time, not at submission time.** If the branch manager
resigns the week after an entry is submitted, a submission-time snapshot leaves
that entry stranded on a departed user. Resolving late means the successor
inherits the queue for free.

The two new org-chart columns are worth adding on their own merits — a reporting
line is the missing piece in half the HR module — but they are only needed for
the two derived types. `PERMISSION` and `TENANT_ROLE` cover the common
Bangladeshi SME shape ("the owner signs anything over five lakh") with zero new
data, so **Phase 2 can ship without touching `Employee` at all.**

**`TENANT_ROLE` must resolve against `tenant_role_id` and `roles[]`, never
against `TenantUser.role`.** The `role` column is a coarse `UserRole` enum
(`@default(CASHIER)`) that **every module role collapses into**: a Sales User and
a Project User both read `CASHIER`, and swapping one for the other does not
change it. A rule written against `role` would therefore fail to distinguish the
very people a tenant wants to distinguish. The member's actual role is
`tenant_role_id` → `TenantRole`, and a member may hold **several** — `roles` is a
`TenantUserRole[]` whose effective permissions are the union of all of them — so
`TENANT_ROLE` matches if *any* held role matches.

`PERMISSION` needs no such join: `UserStorePermission` **is** that union, already
materialized. `team/role-sync.util.ts` rewrites those rows for every affected
member whenever a role changes, in the same transaction as the role set and the
coarse enum, so a single indexed read of `UserStorePermission` answers "may this
person approve here" across every role they hold. That is what keeps
`PERMISSION` — the type most rules will use — free on the hot path, which is
lesson 1 of §1.

Two corollaries the resolver has to encode:

- **An owner's `tenant_role` is null by design** — their coarse bucket `OWNER` is
  the right label. So "the owner signs anything over five lakh", the single most
  likely first rule any tenant writes, is the one case that *does* read `role`.
  `TENANT_ROLE` therefore matches a named `TenantRole` **or** the `OWNER` bucket
  when `tenant_role_id` is null, and the policy editor should offer "Owner" as a
  first-class choice rather than a role name the tenant has to have created.
- The owner fallback in §4.1, which rescues an empty eligible set, is resolved
  the same way and is not affected by a tenant having no named roles at all.

`dev` hit the display half of this on 2026-09-18 (`785cbcb`): the sidebar showed
"CASHIER" for every non-owner because it read `role`. The engine would have hit
the authorization half, which is worse — a rule that silently matches more people
than the tenant meant.

**An `Employee` is not necessarily a user, so the two derived types can resolve
to somebody who cannot sign.** `Employee.user_id` is `String?` — nullable — so a
person on the payroll may have no login at all, which is the normal case for
shop-floor staff paid through HR but never given the app. `EMPLOYEE_MANAGER` and
`DEPARTMENT_HEAD` both resolve to an `Employee`, while every approval in the
system is performed by a *user*: `approved_by` holds a user id and
`UserStorePermission` is keyed by one. So a chain routed to "the submitter's
manager" can land on a manager with no account and stall there — the same
dead-end shape as the self-approval deadlock in §4.1, and it must be handled the
same way: detect it when the request is opened, not when someone eventually
notices the entry has been sitting for a week.

The codebase already treats the two as distinct rather than interchangeable. The
projects module addresses an assignee by a `user:<id>` or `employee:<id>` key
(`projects.service.ts:450,459`) precisely because an employee may have no user
behind them. `resolveApprovers()` returns user ids, so both derived types must
resolve `Employee → Employee.user_id` and treat a null as *unresolvable*: fall
back to the next eligible approver or the owner, and refuse to save a rule whose
only approver is an employee with no account. A policy editor that lets a tenant
pick such a manager, and only fails at submission time, moves the error from
configuration to operation — which is where it costs the most.

### 4.1 The self-approval trap

The submitter very often holds the approving permission — in a five-person shop,
the person entering the voucher *is* one of the two people who can approve it.
Two rules:

- `allow_self` defaults **false**, so the eligible set has the submitter removed.
- If that empties the set, the step has **no eligible approver** and the entry
  would deadlock. The engine must detect this at `open()` time and fall back —
  escalate to the tenant owner, and surface it in the policy editor as a
  validation warning ("no one but the submitter can sign this step").

Getting this wrong is how an approval feature becomes the thing everybody
disables.

---

## 5. The integration seam

One service. A module adopting it touches **three lines** and its own module
imports — no schema change on the document.

```ts
// 1. At create/submit — returns whether the entry may take effect now.
const gate = await this.approvals.open({
    entityType: 'VOUCHER',
    entityId: voucher.id,
    facts: voucherFacts(voucher),
    ctx,
});
// gate.status: 'AUTO_APPROVED' | 'PENDING'

// 2. At list/report time — the where-fragment, empty when the feature is off.
//    Same shape and same free-when-disabled property as approvalVoucherFilter().
const where = { ...base, ...this.approvals.filterFor('VOUCHER', policy, approvedOnly) };

// 3. At the point of an irreversible effect.
await this.approvals.assertApproved('VOUCHER', voucher.id);
```

And one hook the other way, for when the chain finishes:

```ts
// apps/backend/src/approvals/approval-completed.event.ts
export interface ApprovalCompletedEvent {
    entityType: string;
    entityId: string;
    tenantId: string;
    decision: 'APPROVED' | 'REJECTED';
}
```

Modules register a handler keyed by `entityType`. The handler calls the module's
own existing service method — `approveVoucher()`, not a raw update of
`Voucher.approval_status` — so the module's invariants come with it; see §5.1.
The purchasing handler releases the PO, the HR handler writes the leave days
into `AttendanceRecord`.

### 5.1 The decision that makes this safe

**The engine writes back to the document's own status column. Nothing reads
`ApprovalRequest` to answer "is this approved?"**

`Voucher.approval_status` stays exactly where it is, means exactly what it
means, and keeps its index (`schema.prisma:3660`). Every existing report, filter
and `approvalVoucherFilter()` call keeps working untouched. `ApprovalRequest`
holds only the *process* — which step, who is waiting, what was decided and why.

Without this, adopting the engine would mean rewriting every accounting report
in the same PR, and it would never ship.

**But the write-back must go through the module, never straight at the column.**
This is the sharp edge of the decision above, and `dev` has just demonstrated
why. `approveVoucher()` now calls

```ts
await assertFiscalPeriodOpen(this.db, tenantId, existing.date, 'accept approvals');
```

immediately before it sets `approval_status = APPROVED` — one of the four doors
into a closed month that were closed in `d3525ad`. An engine that owned the
column and wrote `prisma.voucher.update({ data: { approval_status: 'APPROVED' } })`
from its own generic service would be a fifth door: a voucher dated inside a
locked period, un-approvable from the accounting screen, would approve happily
from the unified `/approvals` queue.

So each module registers a **commit hook** rather than surrendering its column:

```ts
this.approvals.register('VOUCHER', {
  facts: voucherFacts,
  onApproved: (id, userId) => this.accounting.approveVoucher(tenantId, id, userId),
  onRejected: (id, userId, reason) => this.accounting.rejectVoucher(tenantId, id, userId, reason),
});
```

The engine decides *whether* the chain is complete; the module decides *what
approval means* and keeps its own invariants — the period lock, the
already-approved guard, the audit stamp. The generic queue then inherits every
guard the module grows later, for free, instead of drifting away from it. Any
invariant living in the service and not in the column is one a column-writing
engine would silently lose, and `assertFiscalPeriodOpen` now has nine call
sites.

---

## 6. What will bite

### 6.1 Two approvers click at once
`@@unique([request_id, step, approver_id])` stops the same person twice; a
conditional update on `current_step` (`WHERE current_step = $expected`) inside
the transaction stops two different people advancing the chain twice. Both, not
either.

### 6.2 The entry is edited after submission
An approver signs off ৳40,000 and the submitter then edits it to ৳400,000. The
engine stores `facts_hash`; the module recomputes facts on update and calls
`approvals.revalidate()`. If the hash changed, prior actions are marked
`SUPERSEDED`, the rule is re-matched, and the chain restarts at step 1. Silently
keeping the old approvals is a fraud vector, not a convenience.

### 6.3 Money
`amount` must be normalised to BDT before any comparison. Vouchers are
`Decimal(12,2)`; imports and proforma invoices are genuinely foreign-currency
(see `docs/lc-imports-and-proforma-invoice-plan.md`). A rule reading "over
50,000" that silently compares USD to a BDT threshold approves a ৳6,000,000
purchase. Convert at fact-extraction time, store the original alongside as
`amountOriginal`/`currency` for display, and never compare the original.

### 6.4 Deleted approvers
`approver_id` is a plain string, not a relation — matching how the schema
already handles actors (`schema.prisma:1990`) — plus `approver_name` snapshotted
on the action, so the history survives the user row.

### 6.5 Performance
The sidebar badge polls every 60s (`usePendingVoucherCount.ts`). Generalise it,
but keep the two properties it already has: the count query is served by
`@@index([tenant_id, status, entity_type])`, and it short-circuits to 0 without
touching the table when the tenant has no enabled policy. A tenant with the
feature off must pay exactly one request per session.

### 6.6 Reports
`AccountingSettings.reports_approved_only` already exists and already has the
per-request override (`resolveApprovedOnly()`). Move that pattern onto
`ApprovalPolicy.reports_approved_only`, keeping the accounting flag as the
migration source. Do not build a second mechanism next to it.

### 6.7 The matrix nobody can read
A rule table that grows past ~15 rows becomes unauditable. The policy editor
needs a **"test this entry" panel**: paste or pick a real document, see which
rule matched and which chain it produced, before saving. Cheap to build on top
of a pure `matchRule` — it is the same function the runtime calls — and it is
the difference between a feature tenants configure and one they ask support to
configure for them.

### 6.8 The save that 400s because the DTO does not know a key
`main.ts:35` runs the global pipe as
`new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`,
so a body property no DTO declares rejects the **whole request**, not just that
field. A rule carries a nested condition tree whose shape is recursive and
whose operand keys come from each module's fact object, which is exactly what a
flat DTO cannot whitelist: the condition blob needs a recursive
`@ValidateNested` DTO or an explicit validator over a raw JSON column, not a
hand-listed set of properties.

This is not hypothetical. `PlanFeaturesDto` declared a hand-listed subset of the
entitlement registry, so once a key was registered without being added there,
**every** `PUT /admin/subscription-plans/:code` returned
`property teamChat should not exist` — every plan, for as long as the drift
existed, and both spec files hand-listed the same stale keys so the suite
asserted a payload the real editor never sent.

The sharper form of the rule surfaced on 2026-09-22, and it is worse than a
stale key list: **the decorators are the whitelist**. Whitelisting is driven
entirely by class-validator metadata, and a TypeScript type annotation leaves no
metadata behind at runtime — so a DTO carrying no decorators whitelists
*nothing*, and every property of every request to it is rejected. Five files
were in that state, and each one's `@Body()`-bound endpoints were simply dead:
opening and closing a till both 400'd, as did adding a counter, and as did the
warranty-claim status endpoint this document surveys in §1. A DTO is not a type;
it is a runtime schema, and an undecorated one is an empty schema.

The billing callbacks in the same fix show the opposite failure, which matters
here because the engine has a payload of the same shape. SSL Wireless sends more
fields than `BillingCallbackDto` declares, so strict whitelisting would have
400'd genuine payment notifications — those bindings take a route-level pipe
that strips unknown fields instead of rejecting them. A rule's condition tree is
the same kind of payload: its operand keys come from a registry the DTO cannot
enumerate, so it belongs behind an explicit validator over the raw JSON, not
behind the global pipe's whitelist.

The lesson transfers directly to `register()`: a module that registers a fact
the rule validator does not know about must fail the suite, not the tenant's
save. Derive the fixtures from the registry rather than restating it.

### 6.9 A back-fill migration will not run in production

Production applies the schema with `prisma db push`, never `prisma migrate
deploy` — `deploy.yaml:68` and `deploy.yaml:168`, `scripts/deploy-erp71.sh:99`, and the
backend `Dockerfile`, which says so outright and then chains one `sync:*` step
for every migration the deploy skips. That chain only grows — nineteen steps in
the `Dockerfile` as of 2026-09-23, against the twenty `sync:*` scripts
`packages/database/package.json` defines — so read the `CMD` line rather than
trusting a count written down here.

So `db push` adds a new column and nothing fills it. Any back-fill this plan
needs — Phase 2 turning `require_voucher_approval` into an `ApprovalPolicy` row
for every tenant that has it set — has to be an idempotent `sync:` script wired
into the `Dockerfile` chain, and a migration written alongside it is for local
development only.

This is not a hypothetical either, and the example is a day old. `#696` added
`TenantSubscription.activated_at` with the backfill in
`migrations/20260920120000_activation_requests/migration.sql`, and no `sync:`
step. On deploy `activated_at` is therefore null for every existing tenant, and
`isPendingActivation()` (`billing/activation-state.util.ts`) returns true for any
subscription that is not `ACTIVE` or `TRIALING` and has no `activated_at` — so
every lapsed paying tenant would be sent to "you have never activated, here is
how to pay for your first period" instead of dunning. That is precisely the
outcome the commit message says the backfill exists to prevent. Filed in
`TODO.md`; it is not this plan's to fix, but it is the clearest possible warning
against Phase 2 doing the same thing.

It recurred two days later, and that time it was caught before the deploy rather
than after. `#702` ("backfill board slugs and task references before db push")
added `Board.slug` and `Task.reference` as NOT NULL, and its commit message
reconstructs this section from first principles — production "never runs `prisma
migrate deploy`", so `db push` "would go straight to NOT NULL. Postgres refuses,
and because db push sits at the head of the container's && chain the backend
never boots" — reproduced on a scratch database as `ERROR: column "slug" of
relation "boards" contains null values`.

That case supplies the half of the rule `#696` does not: **where** in the chain a
`sync:` step belongs depends on what `db push` is about to do.

- A back-fill that fills a column `db push` has *already added* runs **after**
  it, because the column has to exist first. Fourteen of the nineteen steps are
  this kind, and getting one wrong leaves a null column — bad data, live site.
- A back-fill that has to make existing rows *satisfy a constraint* `db push` is
  about to create — a NOT NULL column, or a unique index — runs **before** it.
  `db push` precedes `main.js` in the same `&&` chain, so when Postgres refuses
  the DDL the container never reaches the backend at all: a full outage, not bad
  data. Five steps are this kind — `sync:user-mobile-unique`,
  `sync:store-name-unique`, `sync:warehouse-name-unique`, and `#702`'s two.
  (The Dockerfile comment introducing the first of them still calls it "the one
  step that runs BEFORE db push"; four more have joined it since, so the comment
  is stale even though the `CMD` line is correct.)

For this plan that settles Phase 2's placement, and both halves land on the
safe side. The back-fill reads `require_voucher_approval` and writes rows into
`ApprovalPolicy` — a table `db push` has just created — so it belongs **after**
`db push`, with the other fourteen. And the outage half does not arise here at
all: §2 adds no column and no unique index to any *existing* table, so there are
no rows for a NOT NULL or a `@@unique` to be refused over. All four tables are
new and therefore empty, `ApprovalRequest`'s two `@@unique`s included. That is a
consequence of the §5.1 seam — a module keeps its own status column and gains no
schema change by adopting the engine — rather than luck, and it is worth
defending: the day this design reaches for a NOT NULL column on `vouchers`, its
back-fill moves in front of `db push`.

---

## 7. Permissions

Add to `packages/shared-types/index.ts` (per the convention in `CLAUDE.md` —
permissions are defined there first):

| Permission | Held by | For |
|---|---|---|
| `MANAGE_APPROVAL_POLICIES` | OWNER, ADMIN | configuring the matrix |
| `VIEW_APPROVAL_QUEUE` | anyone who approves anything | the unified queue page |

The existing `APPROVE_VOUCHER`, `APPROVE_GOODS_TRANSFER`,
`APPROVE_PRODUCT_DEMAND`, `APPROVE_FUND_TRANSFER`, `APPROVE_CRM_ACTIVITY`
**stay, unchanged**. They remain the *capability* — may this person approve this
kind of thing at all — and the policy decides *which of them* is on the hook for
a given entry. The engine composes with the permission matrix; it does not
replace it. This also means `StorePermissionGuard` needs no changes.

---

## 8. Phases

| Phase | Scope | Ships |
|---|---|---|
| **1** | Engine, dark. 4 tables + migration, `ApprovalsModule`, `condition.util.ts` + `rule-match.util.ts` + resolver, all spec'd. Wired to nothing. | no behaviour change |
| **2** | Voucher pilot. `require_voucher_approval` becomes an `ApprovalPolicy` row; "no rules" degenerates to today's behaviour (one step, anyone with `APPROVE_VOUCHER`). Back-fill in a **sync script**, not a migration — see §6.9. | amount-banded voucher approval |
| **3** | UI. Unified `/approvals` queue (`PageShell` + `PageHeader`), generalised badge hook, policy editor with the test panel, per-entity deep links. | the feature becomes visible |
| **4** | Adoption, one small PR each: purchase orders, expense claims, fund transfers, **bad-debt write-offs**, warehouse transfers, product demands, overtime records, warranty claims, sales discounts. | eleven bespoke flows become one |
| **5** | Delegation / out-of-office, SLA escalation, parallel + quorum steps, approve-from-notification on mobile. | the long tail |

Phases 1 and 2 are the real work. Phase 4 is repetitive and cheap *because* of
§5.1 — each module publishes facts, calls `open()`, handles the event, and keeps
its own status column.

**Start with vouchers**, not purchase orders: the flow already exists end to end
(backend, permission, frontend page, badge, tests), so Phase 2 is a
generalisation with a working reference implementation and real tests to keep
green — not a greenfield build.

### 8.1 Deliberately out of scope

- **A visual workflow designer** (drag-and-drop boxes and arrows). Ordered steps
  with conditions cover every approval an SME retailer actually runs. A DAG
  designer is a quarter of work for the tenants who would never open it.
- **Approval on master data** (products, customers, price lists). The question
  is about entries. Master-data governance is a different feature with different
  ergonomics — do not let the engine grow into it by accident.
- **Cross-tenant or platform-level approval.** Every rule is tenant-scoped, per
  `TenantInterceptor`.
