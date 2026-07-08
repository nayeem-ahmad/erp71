# Story 11.3: Warranty Serial Tracking and Claim Management MVP

Status: in-progress

## Story

As a Store Operator,
I want warranty-enabled products to be tracked by serial number and handled through a simple warranty claim flow,
so that I can serve customers quickly while maintaining accurate stock and claim history.

## Acceptance Criteria

1. Product setup supports a Warranty Enabled checkbox and optional Warranty Duration field. [ ]
2. Purchase, Sale, and Inventory Adjustment flows support serial entry in two modes: single entry and numeric range entry. [ ]
3. The system stores one row per serial and enforces uniqueness within tenant and product context. [ ]
4. Each serial has a stock lifecycle status that at minimum supports In Stock, Sold, Claim In Process, and Returned After Claim. [ ]
5. Sales flow blocks completion if a warranty-enabled serialized item is sold without assigned serials. [ ]
6. Warranty Claim entry supports lookup by serial number and stores basic claim information: customer, contact, issue note, claim date, and claim status. [ ]
7. Warranty Return entry can close a claim and update serial status based on outcome (repaired return, replacement, rejected return). [ ]
8. Core validation rules exist: no duplicate serials, no selling non-stock serials, and no duplicate active claim for the same serial. [ ]
9. Claim list and serial history views are available for basic operational tracking. [ ]

## Tasks / Subtasks

- [x] Task 1: Product warranty metadata
  - [x] Add warranty fields to product schema and DTOs.
  - [x] Update create and edit product UI with Warranty Enabled and Warranty Duration controls.
  - [x] Likely file targets: packages/database/prisma/schema.prisma, apps/backend/src/products, apps/web/src/app/(main)/dashboard/products

- [x] Task 2: Serial master and status lifecycle
  - [x] Introduce serial master table with tenant, store, product, serial, status, and source transaction references.
  - [x] Add unique constraints and indexes for fast serial lookup.
  - [x] Likely file targets: packages/database/prisma/schema.prisma, apps/backend/src/inventory or apps/backend/src/serials

- [ ] Task 3: Transaction integration for serial capture
  - [ ] Add serial input UX to purchase, sale, and adjustment forms.
  - [ ] Implement one-by-one and range-based serial generation/capture.
  - [ ] Wire backend validation and status transitions on transaction commit.
  - [ ] Likely file targets: apps/web/src/app/(main)/dashboard/purchases, apps/web/src/app/(main)/dashboard/sales, apps/backend/src/purchases, apps/backend/src/sales

- [ ] Task 4: Warranty claim MVP module
  - [ ] Implement claim create, list, detail, and close endpoints.
  - [ ] Implement claim intake form with serial lookup and basic claim fields.
  - [ ] Add claim close form for return after claim with outcome and remarks.
  - [ ] Likely file targets: apps/backend/src/warranty-claims, apps/web/src/app/(main)/dashboard/warranty-claims, packages/shared-types/index.ts

- [ ] Task 5: Business rules and guardrails
  - [ ] Prevent duplicate active claim per serial.
  - [ ] Enforce serial existence checks with configurable unknown-serial handling.
  - [ ] Prevent stock-invalid serial operations across sales and claim transitions.
  - [ ] Add unit and integration tests for status transitions and validation failures.

## Pre-requisites

1. Product catalog and transaction modules already running for product, purchase, and sale flows.
2. Inventory movement events are persisted transactionally in backend services.
3. Tenant and store scoping patterns are already enforced in APIs and database access.
4. Role permissions exist for at least two personas: sales or inventory user, and claim processing user.
5. Migration process is available for additive schema deployment.

## Dev Notes

- Scope is intentionally minimum viable for small businesses.
- This story avoids advanced warranty policy engines, SLA automation, vendor reimbursement, and RMA logistics.
- Use additive schema changes only to keep backward compatibility.
- Keep claim states simple in MVP: Open, In Review, Closed.
- Prefer clear audit fields on serial and claim records: created_by, updated_by, timestamps.

### Suggested API Surface (MVP)

1. POST /warranty-claims
2. GET /warranty-claims
3. GET /warranty-claims/:id
4. PATCH /warranty-claims/:id
5. POST /warranty-claims/:id/close
6. GET /serials/:serialNumber/history

### Test Focus

1. Serial uniqueness and duplicate prevention.
2. Range serial ingestion edge cases.
3. Transactional status transitions during purchase, sale, claim open, and claim close.
4. Multi-tenant isolation for serial and claim queries.

### References

- [Source: docs/prd/epic-11-sales-returns-management.md]
- [Source: _bmad-output/implementation-artifacts/11-1-returns-api.md]
- [Source: _bmad-output/implementation-artifacts/11-2-returns-ui.md]

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Completion Notes List

- Story drafted as dev-ready with MVP scope, acceptance criteria, prerequisites, implementation tasks, and test focus.
- Epic alignment chosen based on closest operational flow to customer return handling and post-sale claim processing.
- Implemented product-level warranty metadata end-to-end for backend and web product forms.
- Added product edit page and list-level edit navigation to support warranty field maintenance.
- Regenerated Prisma client after schema changes and passed backend product service test suite.
- Added `ProductSerial` model with lifecycle status and tenant-scoped unique/index strategy for serial tracking groundwork.
- Revalidated core backend service tests for products, sales, and purchases after schema updates.

### File List

- _bmad-output/implementation-artifacts/11-3-warranty-serial-tracking-claims-mvp.md
- packages/database/prisma/schema.prisma
- packages/shared-types/index.ts
- apps/backend/src/products/product.dto.ts
- apps/backend/src/products/products.service.ts
- apps/backend/src/products/products.service.spec.ts
- apps/web/src/app/(main)/dashboard/products/actions.ts
- apps/web/src/app/(main)/dashboard/products/new/page.tsx
- apps/web/src/app/(main)/dashboard/products/page.tsx
- apps/web/src/app/(main)/dashboard/products/[id]/edit/page.tsx
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-03-23: Completed Task 1 (product warranty metadata) with backend test validation.
- 2026-03-23: Completed Task 2 (serial master schema + indexes) and validated key backend regression tests.
