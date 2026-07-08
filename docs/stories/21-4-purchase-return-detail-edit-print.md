# Story 21.4: Purchase Return Detail, Edit & Print Workflow

Status: review

## Story

As a Procurement Manager,
I want to inspect, edit, print, and delete purchase returns after creation,
so that supplier-facing return documentation and operational corrections remain manageable.

## Acceptance Criteria

1. The purchase returns list exposes view, print, edit, and delete actions consistent with Sales and Purchases. [x]
2. A detail screen shows supplier context, original purchase reference, itemized totals, notes, and return metadata. [x]
3. Edit mode allows constrained quantity updates using the same caps enforced during creation. [x]
4. Delete actions are guarded by confirmation and refresh the list and detail state after success. [x]
5. The detail view includes print-friendly output suitable for supplier return notes or future credit memo documentation. [x]

## Tasks / Subtasks

- [x] Task 1: Detail page
  - [x] Create a detail route for purchase returns with summary and item breakdown sections.
  - [x] Show supplier and source purchase identifiers prominently.
  - [x] Include return status metadata, notes, totals, and created timestamps in the summary block.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/purchase-returns/[id]/page.tsx`
- [x] Task 2: Edit and delete flows
  - [x] Add edit mode with constrained quantity changes.
  - [x] Add delete confirmation and post-action refresh behavior.
  - [x] Ensure edit forms reload fresh detail data after save and route back safely after delete.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/purchase-returns/[id]/page.tsx`, `apps/frontend/src/lib/api.ts`
- [x] Task 3: Print-friendly document output
  - [x] Add browser print support for supplier-facing return documentation.
  - [x] Leave layout room for future credit memo or payable references.
  - [x] Reuse the repo’s existing print-preview layout conventions from returns, orders, and quotations.
  - [ ] Likely file targets: `apps/frontend/src/app/dashboard/purchase-returns/[id]/page.tsx`, `apps/frontend/src/app/dashboard/returns/[id]/page.tsx`

## Dev Notes

- **Dependencies:** Depends on Stories 21.1 through 21.3.
- **UX Pattern:** Mirror the sales return, order, and quotation detail pages for consistency.
- **Forward Compatibility:** Keep naming and layout neutral enough to support supplier credit memo fields later without reworking the document structure.

### Project Structure Notes

- Detail routes should live under `apps/frontend/src/app/dashboard/purchase-returns/[id]`.
- If list-level row actions live in the list page rather than shared table helpers, update both the list route and the detail route together.

### References

- [Source: docs/prd/requirements.md]
- [Source: apps/frontend/src/app/dashboard/returns]
- [Source: apps/frontend/src/app/dashboard/orders]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- Added purchase return detail page actions for edit, print, and delete with a richer summary layout and print-preview output.
- Added constrained edit mode using source purchase line history so quantities remain capped by previously returned amounts.
- Expanded list page row actions to include view, edit, print, and delete, matching the story requirements.
- Extended backend purchase return detail loading to include source purchase items and return history needed by the edit workflow.
- Added frontend detail-page coverage for read, edit-save, and delete flows.
