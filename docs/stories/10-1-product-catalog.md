# Story 10.1: Product Catalog Management

Status: done

## Story

As a Shop Owner,
I want to add and view products in my inventory,
so that I can manage my stock and have items to sell in the POS.

## Acceptance Criteria

1.  A "Products" dashboard screen exists to list all items. [x]
2.  A user can create a new product with Name, SKU, Price, and Initial Stock. [x]
3.  Data is saved to the `products` and `product_stocks` tables with proper tenant isolation. [x]

## Tasks / Subtasks

- [x] Task 1: Product List UI
  - [x] Implement `src/app/(main)/dashboard/products/page.tsx` with a data table.
  - [x] Fetch products associated with the current `tenant_id`.
- [x] Task 2: Create Product Form
  - [x] Build a modal or page for adding new products.
  - [x] Define Zod schema for product creation.
- [x] Task 3: Backend Actions
  - [x] Create Server Action to handle product insertion.
  - [x] Ensure insertion correctly handles `product_stocks` linkage if applicable.

## Dev Notes

- **Database:** See `docs/architecture/database-schema.md` for `products` table schema.
- **UI:** Keep it clean and accessible. Leverage Shadcn or simple Tailwind components.
- **Tenant ID:** Remember that all queries must filter by the current tenant ID automatically via RLS, but the server action might need to inject it.

### Project Structure Notes

- Keep actions co-located with the feature (e.g. `src/app/(main)/dashboard/products/actions.ts`).

### References

- [Source: docs/architecture/database-schema.md]
- [Source: _bmad-output/planning-artifacts/epics.md]

## Dev Agent Record

### Agent Model Used
Antigravity (simulating Amelia Dev Agent)

### Completion Notes List
- ✅ Task 1: Implemented Product List UI in `page.tsx` displaying a data table.
- ✅ Task 2: Created Product Form `new/page.tsx` using simple Tailwind styles.
- ✅ Task 3: Verified backend actions and Zod schemas existing in `actions.ts`.
- ✅ Updated the live inventory/products page to use the shared dashboard `DataTable` experience already used by Sales, Orders, Quotes, and Returns.
- ✅ Added searchable product columns for SKU, stock, stock value, and stock status with shared toolbar controls.
- ✅ Added row-level delete action while keeping the existing add-product modal workflow intact.
- Files added: `apps/web/src/app/(main)/dashboard/products/page.tsx`, `apps/web/src/app/(main)/dashboard/products/new/page.tsx`.
