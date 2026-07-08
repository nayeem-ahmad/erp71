# Story 13.1: Quotation API & Versioning

Status: done

## Story

As a B2B Sales Rep,
I want to build formal price quotes tracking their expiration dates,
so that clients can verify total numbers before we commit the items into a Sales Order.

## Acceptance Criteria

1.  `Quotation` and `QuotationItem` models exist mapping uniquely via `quote_number`. [x]
2.  `POST /sales-quotations` accepts items and a `valid_until` date. [x]
3.  `POST /sales-quotations/:id/revise` duplicates the existing quote, bumps its `version`, links back to the original tree via `original_quote_id`, and marks the former quote's status as `REVISED`. [x]
4.  `POST /sales-quotations/:id/convert` converts a confirmed standard quote directly into a `SalesOrder` mirroring the quantities and pricing perfectly. [x]
5.  `PATCH /sales-quotations/:id` and `DELETE /sales-quotations/:id` support quotation maintenance while preventing edits to converted or revised records. [x]

## Dev Agent Record

### Agent Model Used

Antigravity

### Completion Notes List

- Implemented Quotation schema natively inside Prisma.
- Built deeply nested module endpoints encapsulating both Version cloning logic (revising a quote) and the bridge directly to `SalesOrdersService` (converting quotes natively into orders).
- Added quotation update and delete endpoints with business-rule guards for revised and converted quotations.
