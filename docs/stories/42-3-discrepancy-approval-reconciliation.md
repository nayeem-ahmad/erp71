# Story 42.3: Discrepancy Approval and Reconciliation Posting

Status: drafted

## Story

As a Shop Owner or Manager,
I want large stock discrepancies to require approval before posting,
so that physical count corrections are reviewed before they change live inventory.

## Acceptance Criteria

1. Stock-take sessions in `REVIEW` state can be posted only by authorized users. [ ]
2. Posting a session atomically adjusts warehouse stock from expected to actual counts and writes `InventoryMovement` rows tagged as `STOCK_TAKE_ADJUSTMENT`. [ ]
3. Configurable approval thresholds support automatic posting for small differences and manager review for large corrections. [ ]
4. Posted sessions become read-only and expose a reconciliation summary showing net quantity and value impact. [ ]
5. A rejection or return-to-counting path exists for sessions that need correction before posting. [ ]
6. Tests cover approval gating, atomic posting, and read-only behavior after posting. [ ]

## Tasks / Subtasks

- [ ] Task 1: Approval and posting rules
  - [ ] Add approval-threshold evaluation and role checks for stock-take posting.
  - [ ] Implement transactional stock adjustment based on `actual_quantity - expected_quantity` per line.
  - [ ] Stamp movement rows and reconciliation metadata for later ledger and reporting use.
  - [ ] Likely file targets: `apps/backend/src/stock-takes/stock-takes.service.ts`, `apps/backend/src/stock-takes/stock-takes.dto.ts`

- [ ] Task 2: Review and post UX
  - [ ] Add review mode to the stock-take detail page.
  - [ ] Show which lines exceed the approval threshold and require manager action.
  - [ ] Add post and reject actions with clear confirmation copy.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/stock-takes/[id]/page.tsx`

- [ ] Task 3: Settings integration
  - [ ] Read approval thresholds from inventory settings with a safe default if the settings UI is not yet implemented.
  - [ ] Align discrepancy reason usage with the shared reason catalog introduced for inventory adjustments.
  - [ ] Likely file targets: `apps/backend/src/inventory-settings/*`, `apps/frontend/src/lib/api.ts`

- [ ] Task 4: Tests
  - [ ] Add backend posting tests and frontend review-state coverage.
  - [ ] Likely file targets: `apps/backend/src/stock-takes/stock-takes.service.spec.ts`, `apps/frontend/src/app/dashboard/inventory/stock-takes/[id]/page.test.tsx`

## Dev Notes

- Posting must use the immutable stock-take snapshot plus entered actuals. Do not compare against live stock at post time.
- Threshold configuration is formalized in Story 44.3, but this story should define a safe default threshold contract now.

## Dependencies

- Depends on Stories 42.1 and 42.2.
- Integrates with Story 44.3 when settings are available.

### References

- [Source: docs/prd/epic-42-inventory-discrepancy-entry.md]
- [Source: docs/prd/epic-44-inventory-settings.md]
