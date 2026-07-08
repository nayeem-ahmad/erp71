# Story 80.4: Customer Group CRUD

Status: complete

## Story

As a Shop Owner or Manager,
I want to define and manage Customer Groups (e.g. "Wholesale", "Retail", "Employee", "Government"),
so that I can classify customers for targeted pricing, discounts, and reporting.

## Acceptance Criteria

1. A `CustomerGroup` model exists in Prisma, scoped to `Tenant`. [ ]
2. CRUD API endpoints exist: `POST`, `GET`, `GET :id`, `PATCH :id`, `DELETE :id` under `/customer-groups`. [ ]
3. Group name is unique per tenant. [ ]
4. Deleting a group that has associated customers is blocked with a clear error message. [ ]
5. A "Customer Groups" management UI exists under the Settings menu. [ ]
6. The groups are available as a dropdown when creating/editing a Customer (Story 80.1). [ ]

## Data Model

### CustomerGroup

| Field | Type | Notes |
| --- | --- | --- |
| id | UUID (PK) | auto |
| tenant_id | FK → Tenant | required |
| name | String | required, unique per tenant |
| description | String? | optional |
| default_discount_pct | Decimal(5,2)? | optional group-level default discount |
| created_at | DateTime | auto |
| updated_at | DateTime | auto-updated |

### Constraints

- `@@unique([tenant_id, name])`

## Tasks / Subtasks

- [ ] Task 1: Database Schema
  - [ ] Add `CustomerGroup` model to `schema.prisma`.
  - [ ] Add `customer_group_id` FK on `Customer` (nullable).
  - [ ] Add relation: `CustomerGroup` has many `Customer`.
  - [ ] Generate and run Prisma migration.

- [ ] Task 2: Backend API
  - [ ] Create NestJS module `customer-groups` with controller, service, DTOs.
  - [ ] `CreateCustomerGroupDto`: name (required), description (optional), default_discount_pct (optional).
  - [ ] `UpdateCustomerGroupDto`: partial of create.
  - [ ] Implement unique name validation per tenant.
  - [ ] Implement delete guard — reject if customers reference this group.

- [ ] Task 3: Frontend UI
  - [ ] Add a "Customer Groups" page under Settings navigation.
  - [ ] List table with Name, Description, Discount %, Customer Count.
  - [ ] Add/Edit modal with form fields.
  - [ ] Delete button with confirmation (blocked if customers exist).

## Dev Notes

- **Ordering**: This story should be implemented before or in parallel with the 80.1 revision, since 80.1 references `CustomerGroup` as a foreign key.
- **Seed data**: Add sample groups to `seed.ts` (e.g. "Retail", "Wholesale", "VIP Members").

### References

- [Source: docs/prd/epic-80-customer-segmentation.md]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- ✅ Standardized the Customer Groups list view onto the shared dashboard `DataTable` component.
- ✅ The management page now provides consistent search, sorting, export, and action affordances aligned with Sales.
- ✅ Preserved the existing inline create/edit form workflow while moving row actions into the shared table layout.
