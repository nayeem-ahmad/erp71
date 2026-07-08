# Story 80.1: Customer CRUD API & UI

Status: complete

## Story

As a Shop Owner or Manager,
I want to create, edit, and view rich customer profiles with auto-generated codes, type classification, group/territory assignment, credit limits, and discount settings,
so that I can maintain a structured, segmented customer database to drive sales and reporting workflows.

## Acceptance Criteria

1.  A "Customers" management entry exists under the Settings menu and opens the customer dashboard screen. [x]
2.  A user can create a new customer with all required and optional fields (see Data Model below). [x]
3.  **Customer Code** is auto-generated on create (e.g. `CUST-00001`), editable by user, but must remain unique per tenant. [x]
4.  **Customer Type** is selectable: `Individual` or `Organization`. [x]
5.  **Customer Group** is an optional FK reference to the `CustomerGroup` entity (managed via Story 80.4). [x]
6.  **Territory** is an optional FK reference to the `Territory` entity (managed via Story 80.5). [x]
7.  **Credit Limit** and **Default Discount %** are optional decimal fields. [x]
8.  **Profile Picture** can be uploaded (stored as a URL string). [x]
9.  The backend validates Phone uniqueness per tenant. [x]
10. The backend validates Customer Code uniqueness per tenant. [x]
11. The `Customer` model is linked to `Tenant`, and optionally to `CustomerGroup` and `Territory`. [x]
12. The `Sale` model is optionally associated with a `Customer`. [x]

## Data Model Changes

### Customer (revised)

| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | auto |
| tenant_id | FK → Tenant | required |
| **customer_code** | String | Auto-generated (`CUST-NNNNN`), editable, unique per tenant |
| name | String | required |
| phone | String | required, unique per tenant |
| email | String? | optional |
| address | String? | optional |
| **profile_pic_url** | String? | URL to uploaded image |
| **customer_type** | Enum (`INDIVIDUAL`, `ORGANIZATION`) | default `INDIVIDUAL` |
| **customer_group_id** | FK → CustomerGroup? | optional |
| **territory_id** | FK → Territory? | optional |
| **credit_limit** | Decimal(12,2)? | optional, default null |
| **default_discount_pct** | Decimal(5,2)? | optional, 0-100 range |
| total_spent | Decimal(12,2) | computed, default 0 |
| segment_category | String | default "Regular" |
| created_at | DateTime | auto |

### New unique constraint
- `@@unique([tenant_id, customer_code])`
- Existing `@@unique([tenant_id, phone])` stays

## Tasks / Subtasks

- [x] Task 1: Database Schema Update
  - [x] Add `CustomerType` enum (`INDIVIDUAL`, `ORGANIZATION`) to Prisma schema.
  - [x] Add new columns to `Customer` model: `customer_code`, `profile_pic_url`, `customer_type`, `customer_group_id`, `territory_id`, `credit_limit`, `default_discount_pct`.
  - [x] Add relations to `CustomerGroup` and `Territory` (created in Stories 80.4 & 80.5).
  - [x] Add `@@unique([tenant_id, customer_code])` constraint.
  - [x] Generate and run Prisma migration.

- [x] Task 2: Auto-generation Service Logic
  - [x] Implement `generateCustomerCode(tenantId)` in the service — queries the last code for the tenant and increments. Format: `CUST-00001`.
  - [x] On create: if `customer_code` not supplied, auto-generate. If supplied, validate uniqueness.

- [x] Task 3: Backend API Updates
  - [x] Expand `CreateCustomerDto` with new fields (customer_code optional, customer_type, customer_group_id, territory_id, credit_limit, default_discount_pct, profile_pic_url).
  - [x] Add `UpdateCustomerDto` (partial of CreateCustomerDto).
  - [x] Add `PATCH /customers/:id` endpoint.
  - [x] Update `findAll` to include `customerGroup` and `territory` relations in response.
  - [x] Update `findOne` to include `customerGroup` and `territory` relations.

- [x] Task 4: Frontend UI Updates
  - [x] Update "New Customer" modal: add fields for Customer Type (radio/select), Customer Group (dropdown from API), Territory (dropdown from API), Credit Limit, Default Discount %, Profile Picture upload.
  - [x] Customer Code shown as auto-filled input (editable).
  - [x] Customer list table: show Code, Type, Group, Territory columns.
  - [x] Customer detail page: display all new fields.
  - [x] Add inline edit capability or an "Edit Customer" modal.

## Dev Notes

- **Customer Code** format: `CUST-NNNNN` (zero-padded 5 digits). Query `MAX(customer_code)` per tenant to determine next. If the code is user-edited, validate format is not required — any unique string is acceptable.
- **Profile Pic**: For MVP, accept a URL string. File upload to object storage can be a follow-up.
- **Dependencies**: Stories 80.4 (Customer Group CRUD) and 80.5 (Territory CRUD) should be implemented first or in parallel, since this story references those entities as foreign keys.
- **Seed data**: Update `seed.ts` to assign groups and territories to existing customers.

### References

- [Source: docs/prd/epic-80-customer-segmentation.md]

## Dev Agent Record

### Agent Model Used
GPT-5.4

### Completion Notes List

- ✅ Standardized the Customers dashboard list onto the shared `DataTable` shell used by Sales.
- ✅ The customer list now exposes code, type, group, territory, total spent, segment, and registration date in a searchable/sortable table.
- ✅ Preserved the existing create-customer modal flow and direct navigation into the customer detail page from the list actions.
- ✅ AddCustomerModal.tsx: Fully implemented with all required fields (Customer Type, Group, Territory, Credit Limit, Discount %, Profile Picture URL).
- ✅ Backend Service: `generateCustomerCode()` auto-generates CUST-NNNNN format with uniqueness validation.
- ✅ Backend DTOs: CreateCustomerDto and UpdateCustomerDto support all new fields with proper validation.
- ✅ Backend Endpoints: POST, GET, GET/:id, PATCH/:id all implemented with tenant isolation and relationship loading.
- ✅ Frontend Detail Page: Customer profile displays all fields including credit utilization, top purchased items, and transaction history.
- ✅ Database Schema: `CustomerType` enum, all new columns, relationships, and unique constraints fully implemented in Prisma.

### File List

- packages/database/prisma/schema.prisma
- packages/shared-types/index.ts
- apps/backend/src/customers/customers.module.ts
- apps/backend/src/customers/customers.controller.ts
- apps/backend/src/customers/customers.service.ts
- apps/backend/src/customers/customer.dto.ts
- apps/backend/src/customers/customers.service.spec.ts
- apps/frontend/src/lib/api.ts
- apps/frontend/src/app/dashboard/customers/AddCustomerModal.tsx
- apps/frontend/src/app/dashboard/customers/page.tsx
- apps/frontend/src/app/dashboard/customers/[id]/page.tsx

### Change Log

- 2026-03-22: Verified all ACs implemented and tasks completed. Updated documentation to accurately reflect full implementation status.
