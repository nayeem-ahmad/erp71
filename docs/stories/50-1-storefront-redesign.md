# Story 50.1: Public Storefront Redesign

Status: done

## Story

As a Merchant,
I want my public storefront to have a modern, category-driven layout with a dedicated shop experience, configurable hero content, and curated featured products/categories,
so that my customers have a beautiful and engaging shopping experience and I can highlight what matters most.

## Acceptance Criteria

1. The storefront API endpoint returns category data with `is_featured` and images, trending products driven by `is_featured`, and storefront settings including hero image and headline.

2. The public storefront page `store/[slug]` implements a configurable hero image and headline, a `Shop Now` button that navigates to the Shop page, a Shop By Category grid that shows only featured categories with dynamic images, no `View All` link, no Newsletter section, and a footer Shop column with `All Products` plus the same featured categories.

3. The dedicated Shop page `store/[slug]/shop` implements a product grid with add-to-cart and checkout, category filtering, price range filtering, basic search by product/category text, a sort dropdown, and URL-synced state for shareable links using `category`, `q`, `sort`, and `max`.

4. Product badges and crossed-out prices are driven by real data rather than random or hardcoded values.

5. Merchants can mark products as Featured from the inventory product create/edit UI to control Trending products.

6. All changes are configurable from Storefront Settings and inventory/category management UI, including hero image, headline, featured categories, and featured products.

## Tasks / Subtasks

- [x] Task 1: Schema & API Updates
  - [x] Add `hero_image`, `hero_headline` to StorefrontSettings (DB, API, dashboard UI).
  - [x] Add `is_featured` and `image_url` to ProductGroup (category) model.
  - [x] Add `is_featured` and `compare_at_price` to Product model.
  - [x] Update API to return only featured categories for Shop By Category grid.
  - [x] Update API to return trending products based on `is_featured` or similar logic.
- [x] Task 2: Storefront UI Redesign
  - [x] Make hero image and headline dynamic/configurable.
  - [x] Make "Shop Now" button navigate to Shop page.
  - [x] Add dedicated Shop page for full catalog browsing and checkout.
  - [x] Make category images and selection dynamic (featured only, no View All).
  - [x] Add shop filtering, sorting, and search with URL-synced state.
  - [x] Remove Newsletter section.
  - [x] Update footer Shop column as described.
  - [x] Make product badges and crossed-out prices dynamic.
- [x] Task 3: Storefront Settings UI
  - [x] Allow merchant to upload/select hero image and set headline.
  - [x] Allow merchant to select featured categories.
  - [x] Allow merchant to mark products as Featured from inventory add/edit product UI.
- [ ] Task 4: Tests
  - [ ] Update frontend and backend tests for all new features and settings.

## Dev Notes

- **Quick Wins:**
  1. Add `hero_image`, `hero_headline` fields to `storefront-settings` (configurable from dashboard).
  2. Add `is_featured` boolean to `Product` and `ProductGroup` to drive Trending and Category grid.
  3. Add `compare_at_price` to `Product` for sale badge/strikethrough.
  4. Add `image_url` to `ProductGroup` for real category images.
- **Tailwind:** Use the Tailwind utility classes found in the provided MHTML design for the structure and spacing.
- **Data Mocking:** If the backend isn't ready immediately, use mock data in the frontend to scaffold the UI first.
- **Cart State:** Do not break the existing cart and checkout logic. The UI structure is changing, but the underlying state management remains the same.

### Project Structure Notes

- Frontend: `apps/frontend/src/app/store/[slug]/page.tsx`
- Frontend Shop: `apps/frontend/src/app/store/[slug]/shop/page.tsx`
- Inventory Product UI: `apps/frontend/src/app/dashboard/inventory/AddProductModal.tsx`
- Backend: `apps/backend/src/storefront/`

## Implementation Notes

- The storefront landing page now focuses on hero, featured categories, and trending products.
- The full catalog experience lives on the dedicated Shop route.
- Shop filter state is URL-driven for shareable/refreshed links.
- Featured products are controlled from the inventory product create/edit modal.
- Test coverage for the new Shop filtering/sorting/query-param behavior remains to be added.

### References

- [Source: docs/store.mhtml]
