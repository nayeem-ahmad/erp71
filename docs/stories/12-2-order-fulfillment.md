# Story 12.2: Order Fulfillment Workflow

Status: done

## Story

As an Inventory Manager,
I want to progress an order's status and automatically deduct stock upon delivery,
so that inventory remains globally accurate only when goods physically depart.

## Acceptance Criteria

1.  A `PATCH /sales-orders/:id/status` endpoint manages transitions from `CONFIRMED` -> `PROCESSING` -> `DELIVERED`. [x]
2.  Switching status to `DELIVERED` automatically increments total_spent for the associated customer and decrements stock. [x]
3.  Delivered orders cannot be edited or deleted through the maintenance endpoints. [x]

## Dev Agent Record

### Agent Model Used

Antigravity

### Completion Notes List

- Locked status transitions natively behind Nest boundary checking.
- Tied the `updateMany` atomic decrement trigger directly to the `DELIVERED` workflow state mapping.
- Added safeguards so delivered orders are immutable from update/delete flows while draft and processing orders remain maintainable.
