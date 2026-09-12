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

Approval is not a new idea in this codebase. It has been solved **ten separate
times**, each slightly differently, and none of the ten can route on the
parameters of the entry.

| Entry | Where | Approval state | Permission | Routing |
|---|---|---|---|---|
| Voucher | `schema.prisma:3410` | `approval_status`, `approved_by`, `approved_at`, `rejection_reason` | `APPROVE_VOUCHER` | tenant-wide on/off flag, anyone holding the permission |
| Leave request | `schema.prisma:5201` | `status`, `approvals_given`, `LeaveRequestApproval[]` (`:5240`) | `MANAGE_HR` | N levels from `LeaveType.approval_levels` (`:4489`), anyone holding the permission |
| Expense claim | `schema.prisma:4802` | `status`, `approved_by`, `approved_at`, `approver_note` | `MANAGE_HR` | single approver |
| Warehouse transfer | `schema.prisma:1691` | `requires_approval`, `approved_by`, `approval_date` | `APPROVE_GOODS_TRANSFER` | single approver |
| Product demand | `schema.prisma:1824` | `reviewed_by`, `reviewed_at`, per-line `quantity_approved` | `APPROVE_PRODUCT_DEMAND` | single approver |
| CRM activity | `schema.prisma:3040` | `is_approved`, `approved_by`, `approved_at` | `APPROVE_CRM_ACTIVITY` | single approver |
| Fund transfer | `schema.prisma:4011` | *none* | `APPROVE_FUND_TRANSFER` — **granted but never enforced**, see below | none |
| Payroll run | `schema.prisma:4884` | `status`, `approved_by`, `approved_at` | — | single approver |
| Stock take | `InventorySettings`, `schema.prisma:1671` | `discrepancy_approval_threshold` | — | a threshold, hard-coded in shape |
| Warranty claim | `schema.prisma:4043` | status enum incl. `APPROVED` | — | single approver |

Twelve `approved_by` columns across the schema.

One of the ten is not an approval flow at all: **`APPROVE_FUND_TRANSFER` is
defined, labelled and granted to two roles in
`packages/shared-types/index.ts:67,615,932,1017` and is not referenced by a
single line of backend code.** `FundTransfer` has no approval column and no
guard consults the permission. A tenant can tick "Approve fund transfers" in the
role editor today and it does nothing. Worth fixing on its own; it also makes
fund transfers the cleanest Phase 4 adoption, since there is no legacy
behaviour to preserve.

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
   `auto_approve_system_vouchers` (`schema.prisma:3349`) exists because holding
   back auto-posted vouchers stalls sales, purchases and payroll.
3. **Pure util + spec, service on top.** `voucher-approval.util.ts`,
   `leave-policy.util.ts`, `posting-status.util.ts` are all pure functions with
   their own spec files. The rule evaluator belongs in that layer.

### 1.1 What is missing today

No flow anywhere can express *"a voucher under ৳50,000 is the branch manager's
call; over ৳500,000 it needs the owner."* Every one of the ten is
"whoever holds the permission, once" — or, for leave, "whoever holds the
permission, N times." Authority does not vary with the entry.

Also missing, and needed for people-based routing:

- **`Employee.manager_id`** — there is no reporting line on `Employee`
  (`schema.prisma:4392`). `hiring_manager_id` on `JobPost` and `manager_id` on
  `Project` are the only manager fields in the schema, and neither is a
  hierarchy.
- **`Department.head_employee_id`** — `Department` (`schema.prisma:4362`) is a
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
  /// `AccountingSettings.reports_approved_only` (schema.prisma:3352).
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
  /// (see the note at schema.prisma:1840) and a deleted user must not take the
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
| `PERMISSION` | everyone holding `approver_ref` on the entry's store | `UserStorePermission` (`schema.prisma:3972`) — the existing matrix |
| `TENANT_ROLE` | everyone with that tenant role | `TenantUser.role` (`schema.prisma:1195`) |
| `USER` | one named user | `approver_ref` is the user id |
| `EMPLOYEE_MANAGER` | the submitter's manager | **needs new `Employee.manager_id`** |
| `DEPARTMENT_HEAD` | head of the entry's department | **needs new `Department.head_employee_id`** |
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

Modules register a handler keyed by `entityType`; the accounting handler flips
`Voucher.approval_status`, the purchasing handler releases the PO, the HR
handler writes the leave days into `AttendanceRecord`.

### 5.1 The decision that makes this safe

**The engine writes back to the document's own status column. Nothing reads
`ApprovalRequest` to answer "is this approved?"**

`Voucher.approval_status` stays exactly where it is, means exactly what it
means, and keeps its index (`schema.prisma:3451`). Every existing report, filter
and `approvalVoucherFilter()` call keeps working untouched. `ApprovalRequest`
holds only the *process* — which step, who is waiting, what was decided and why.

Without this, adopting the engine would mean rewriting every accounting report
in the same PR, and it would never ship.

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
already handles actors (`schema.prisma:1840`) — plus `approver_name` snapshotted
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
| **2** | Voucher pilot. `require_voucher_approval` becomes an `ApprovalPolicy` row; "no rules" degenerates to today's behaviour (one step, anyone with `APPROVE_VOUCHER`). Back-fill migration. | amount-banded voucher approval |
| **3** | UI. Unified `/approvals` queue (`PageShell` + `PageHeader`), generalised badge hook, policy editor with the test panel, per-entity deep links. | the feature becomes visible |
| **4** | Adoption, one small PR each: purchase orders, expense claims, fund transfers, warehouse transfers, product demands, sales discounts. | ten bespoke flows become one |
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
