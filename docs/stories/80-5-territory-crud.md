# Story 80.5: Territory CRUD

Status: complete

## Story

As a Shop Owner or Manager,
I want to define and manage Territories (e.g. "Gulshan", "Dhanmondi", "Mirpur", "Chittagong"),
so that I can assign customers to geographic regions for delivery planning, sales coverage, and regional reporting.

## Acceptance Criteria

1. A `Territory` model exists in Prisma, scoped to `Tenant`. [ ]
2. Territories support a parent-child hierarchy (optional `parent_id` self-reference). [ ]
3. CRUD API endpoints exist: `POST`, `GET`, `GET :id`, `PATCH :id`, `DELETE :id` under `/territories`. [ ]
4. Territory name is unique per tenant (within the same parent). [ ]
5. Deleting a territory that has associated customers or child territories is blocked with a clear error. [ ]
6. A "Territories" management UI exists under the Settings menu. [ ]
7. Territories are available as a dropdown when creating/editing a Customer (Story 80.1). [ ]
8. The `GET` list endpoint returns territories in a flat list with `parent_id` so the frontend can render a tree if desired. [ ]

## Data Model

### Territory

| Field | Type | Notes |
| --- | --- | --- |
| id | UUID (PK) | auto |
| tenant_id | FK → Tenant | required |
| name | String | required |
| parent_id | FK → Territory? | optional self-reference for hierarchy |
| description | String? | optional |
| created_at | DateTime | auto |
| updated_at | DateTime | auto-updated |

### Constraints

- `@@unique([tenant_id, name, parent_id])` — name unique within same parent (use a default sentinel for null parent if DB requires)

### Relations

- `Territory` has many `Customer` (via `Customer.territory_id`)
- `Territory` has many `Territory` children (self-relation via `parent_id`)

## Tasks / Subtasks

- [ ] Task 1: Database Schema
  - [ ] Add `Territory` model to `schema.prisma` with self-referencing `parent_id`.
  - [ ] Add `territory_id` FK on `Customer` (nullable).
  - [ ] Add relation: `Territory` has many `Customer`.
  - [ ] Generate and run Prisma migration.

- [ ] Task 2: Backend API
  - [ ] Create NestJS module `territories` with controller, service, DTOs.
  - [ ] `CreateTerritoryDto`: name (required), parent_id (optional), description (optional).
  - [ ] `UpdateTerritoryDto`: partial of create.
  - [ ] Implement unique name validation per tenant + parent.
  - [ ] Implement delete guard — reject if children or customers reference this territory.
  - [ ] `GET /territories` returns flat list with `parent_id` and `_count.customers`.

- [ ] Task 3: Frontend UI
  - [ ] Add a "Territories" page under Settings navigation.
  - [ ] List view — optionally render as indented tree using `parent_id`.
  - [ ] Add/Edit modal: Name, Parent Territory (dropdown), Description.
  - [ ] Delete button with confirmation (blocked if children or customers exist).

## Dev Notes

- **Hierarchy**: Start with a simple flat list + optional parent. The frontend can visually indent children but doesn't need a full tree component for MVP.
- **Ordering**: This story should be implemented before or in parallel with the 80.1 revision, since 80.1 references `Territory` as a foreign key.
- **Seed data**: Add sample territories to `seed.ts` (e.g. "Dhaka" → "Gulshan", "Dhanmondi", "Mirpur"; "Chittagong").

### References

- [Source: docs/prd/epic-80-customer-segmentation.md]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Completion Notes List

- ✅ Standardized the Territories page onto the shared dashboard `DataTable` component.
- ✅ The list now exposes parent, level, customer count, and sub-territory count while preserving the flat API model.
- ✅ Preserved the existing territory create/edit form workflow and row-level edit/delete controls in the new list shell.
