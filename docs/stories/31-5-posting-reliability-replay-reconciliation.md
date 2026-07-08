# Story 31.5: Posting Reliability, Replay, and Reconciliation

Status: in-progress

## Story

As an Owner, Manager, or Accountant,
I want visibility and recovery tools for failed auto-posting events,
so that accounting can be reconciled without manual database intervention.

## Acceptance Criteria

1. Posting attempts are logged with status (`pending`, `posted`, `failed`) and error details where relevant. [x]
2. Failed posting events can be retried safely without creating duplicate vouchers. [x]
3. A reconciliation endpoint or report lists operational transactions with missing, failed, or mismatched voucher links. [x]
4. Retry actions are role-restricted and auditable. [x]
5. System-level safeguards exist for transient failures (for example retry queue or background retry policy). [ ]
6. Tests cover retry idempotency, mismatch detection, and visibility for accounting operations users. [ ]

## Tasks / Subtasks

- [x] Task 1: Posting event journal
  - [x] Add persistent posting event records keyed by tenant + source transaction identity.
  - [x] Capture attempt counts, latest status, timestamps, and last failure reason.
  - [ ] Likely file targets: `packages/database/prisma/schema.prisma`, `packages/shared-types/index.ts`

- [x] Task 2: Retry and idempotency controls
  - [x] Add service-level replay/retry command that resolves current rule mapping and attempts posting safely.
  - [x] Enforce duplicate-prevention via idempotency key checks and source-voucher uniqueness.
  - [ ] Likely file targets: `apps/backend/src/accounting/accounting.service.ts`, `apps/backend/src/accounting/accounting.controller.ts`, `apps/backend/src/accounting/accounting.dto.ts`

- [ ] Task 3: Reconciliation API and UI
  - [x] Add API for listing posting exceptions and unresolved mismatches.
  - [ ] Add an accounting operations screen for filtering and replaying failed events.
  - [ ] Likely file targets: `apps/backend/src/accounting/accounting.controller.ts`, `apps/frontend/src/app/dashboard/accounting/reconciliation/page.tsx`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Async robustness
  - [ ] Integrate background retry mechanism for transient posting failures.
  - [ ] Ensure retry jobs are tenant-safe and observable.
  - [ ] Likely file targets: `apps/backend/src/database/database.service.ts`, `apps/backend/src/accounting/*`, `apps/backend/src/notifications/*` (if job framework hooks already exist)

- [ ] Task 5: Tests
  - [x] Add tests for failure capture, replay success, duplicate prevention, and reconciliation queries.
  - [ ] Likely file targets: `apps/backend/src/accounting/accounting.service.spec.ts`, `apps/backend/src/accounting/accounting.controller.spec.ts`, `apps/backend/test/integration.spec.ts`

## Dev Notes

- Keep replay behavior deterministic by binding each source transaction to a single successful voucher identity.
- Reconciliation outputs should be optimized for accountant workflows (age of failure, module, source reference, and retry status).

## Executable Contract

### Data Contract

- Add posting-attempt journal with at minimum:
  - `id`, `tenant_id`, `event_type`, `source_module`, `source_type`, `source_id`, `idempotency_key`, `status`, `attempt_count`, `last_error`, `last_attempt_at`, `created_at`, `updated_at`.
- Status lifecycle:
  - `pending -> posted`
  - `pending -> failed`
  - `failed -> pending -> posted` (on replay)
- Uniqueness guard on `tenant_id + idempotency_key`.

Exact status values:

- `pending`
- `posted`
- `failed`
- `skipped`

Suggested table mapping details:

- `last_error` should store normalized application error codes plus short message.
- `attempt_count` increments for each posting execution, including retries.
- `posted` rows should keep immutable `voucher_id` reference once linked.

### API Contract

- `GET /accounting/reconciliation/posting-exceptions`
  - Filters: `status`, `module`, `from`, `to`, `page`, `limit`.
  - Returns unresolved and historical posting exceptions.
- `POST /accounting/reconciliation/posting-exceptions/:id/retry`
  - Role-restricted replay for failed/skipped postings.
  - Must be idempotent and safe under concurrent retry attempts.

Request/response examples:

`GET /accounting/reconciliation/posting-exceptions?status=failed&page=1&limit=20`

```json
{
  "data": [
    {
      "id": "pe_01HY...",
      "sourceModule": "sales",
      "sourceType": "sale",
      "sourceId": "sale_01HY...",
      "status": "failed",
      "attemptCount": 2,
      "lastError": "POSTING_RULE_NOT_CONFIGURED",
      "lastAttemptAt": "2026-03-22T11:40:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1 }
}
```

`POST /accounting/reconciliation/posting-exceptions/:id/retry`

```json
{
  "status": "posted",
  "voucher": {
    "id": "vch_01HY...",
    "voucher_number": "CR-00046"
  },
  "attemptCount": 3
}
```

Error contract:

- `POSTING_EXCEPTION_NOT_FOUND` -> 404.
- `POSTING_RETRY_NOT_ALLOWED` -> 403.
- `POSTING_RETRY_ALREADY_POSTED` -> 409.
- `POSTING_RETRY_CONFLICT` -> 409.

### Execution Order

1. Add posting journal schema and migration.
2. Write journal records from posting helper across event families.
3. Implement retry service endpoint and concurrency guards.
4. Implement reconciliation query endpoint.
5. Add frontend reconciliation operations page.
6. Add async retry policy for transient failures.
7. Add full test matrix.

Concurrency and replay rules:

- Retry action must take a lock on the posting-exception row before execution.
- If row status is already `posted`, return conflict and do not re-run posting.
- If retry succeeds, set status to `posted`, set voucher link, clear last error.

### Test Plan

- Backend focused: `cd apps/backend && npm test -- --runTestsByPath src/accounting/accounting.service.spec.ts src/accounting/accounting.controller.spec.ts test/integration.spec.ts`
- Frontend focused: `cd apps/frontend && npm test -- --runTestsByPath src/app/dashboard/accounting/reconciliation/page.test.tsx`

### Definition of Done

1. Posting failures are queryable and explainable.
2. Failed events can be retried without duplicate vouchers.
3. Reconciliation API and UI support accountant workflows.
4. Replay actions are role-protected and auditable.

### Operational Runbook Notes

- Accountants can filter by age and module to prioritize unresolved posting failures.
- Retry should be attempted only after configuration issues are fixed (for example missing posting rule).
- All manual retries must leave an audit trail with user identity and timestamp.

## Dependencies

- Depends on Stories 31.2, 31.3, and 31.4 posting flows.
- Supports operational stability and audit goals in Epic 91.

### References

- [Source: docs/prd/epic-31-automated-accounting-integration-posting-rules.md]
- [Source: docs/prd/epic-91-system-audit-logs.md]
