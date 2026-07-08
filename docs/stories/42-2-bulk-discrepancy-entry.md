# Story 42.2: Bulk Discrepancy Entry for Stock Take

Status: drafted

## Story

As a Store Manager or Counting Operator,
I want a fast interface to enter actual counts for many products,
so that stock-take discrepancies can be captured without slow one-by-one editing.

## Acceptance Criteria

1. Stock-take detail supports entering `actual_quantity` for many lines in a single workflow. [ ]
2. The UI calculates discrepancy per line as `actual_quantity - expected_quantity` and highlights non-zero rows immediately. [ ]
3. Count entry supports search by product name or SKU and is usable with keyboard-driven workflows. [ ]
4. Bulk save persists draft counts without posting inventory changes yet. [ ]
5. The session summary shows counted lines, uncounted lines, positive discrepancies, and negative discrepancies. [ ]
6. Tests cover discrepancy calculation, draft save, and invalid input handling. [ ]

## Tasks / Subtasks

- [ ] Task 1: Count-entry contracts
  - [ ] Add update DTOs for bulk line submission.
  - [ ] Persist `actual_quantity`, counted timestamp, and optional line note fields.
  - [ ] Likely file targets: `apps/backend/src/stock-takes/stock-takes.dto.ts`, `apps/backend/src/stock-takes/stock-takes.service.ts`

- [ ] Task 2: Bulk entry UX
  - [ ] Build stock-take detail page with searchable grid or table editing experience.
  - [ ] Optimize for barcode scanner or keyboard entry where possible.
  - [ ] Show discrepancy chips and totals without waiting for a full page refresh.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/inventory/stock-takes/[id]/page.tsx`

- [ ] Task 3: Frontend integration and tests
  - [ ] Add API helpers for session detail and bulk line updates.
  - [ ] Add UI tests for live discrepancy math and save behavior.
  - [ ] Likely file targets: `apps/frontend/src/lib/api.ts`, `apps/frontend/src/app/dashboard/inventory/stock-takes/[id]/page.test.tsx`

## Dev Notes

- Keep count entry editable while the session is in `COUNTING` or `REVIEW`, but do not let it mutate live stock.
- This page will be used on tablets and laptops, so prioritize dense but readable row layout over decorative UI.

## Dependencies

- Depends on Story 42.1.
- Blocks Story 42.3.

### References

- [Source: docs/prd/epic-42-inventory-discrepancy-entry.md]
- [Source: apps/frontend/src/components/data-table/DataTable.tsx]
