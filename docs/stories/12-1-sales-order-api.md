# Story 12.1: Sales Order API

Status: done

## Story

As a B2B Manager or fulfillment worker,
I want to be able to create, draft, and view customer Sales Orders,
so that I can prepare goods for delivery or pickup at a later date.

## Acceptance Criteria

1.  `SalesOrder`, `SalesOrderItem`, and `OrderDeposit` schema models exist. [x]
2.  CRUD endpoints `GET /sales-orders` and `POST /sales-orders` created. [x]
3.  Orders track their separate statuses `DRAFT` or `CONFIRMED`. [x]
4.  `PATCH /sales-orders/:id` and `DELETE /sales-orders/:id` support order maintenance before delivery. [x]
5.  Orders preserve delivery dates and nested items across create and update operations. [x]

## Dev Agent Record

### Agent Model Used

Antigravity

### Completion Notes List

- Defined database models and pushed via Prisma.
- Exposed strict DTO controllers handling nested order item structures.
- Added backend update and delete support with delivery-date normalization and delivered-order protections.
