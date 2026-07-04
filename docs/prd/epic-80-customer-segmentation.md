# Epic 80: Customer Profiles & Segmentation

### Epic Goal
Build a centralized customer database that enables personalized service and data-driven marketing through behavioral segmentation.

### Epic Description
**Key Features:**
*   **Customer 360 View:** Centralized profile with contact info, purchase history, and total value.
*   **Automated Segmentation:** Categorize customers into groups based on activity (e.g., VIP for top spenders, At-Risk for those who haven't visited in 30 days).
*   **Preferences Tracking:** Record favorite product categories or communication preferences.

**Stories:**

1. **Story 1: Customer CRUD API & UI** - Interface to add/edit customer profiles with unique phone number validation.
2. **Story 2: Segment Logic Engine** - Automated background job to update customer segments based on transaction frequency and value.
3. **Story 3: Purchase History Dashboard** - View a customer's lifetime sales and order history in one place.
4. **Story 4: Customer Groups & Price-List-Based Pricing** - Group customers (`CustomerGroup`) and optionally link each group to a `PriceList` of per-product or storewide discounts/overrides; price resolution cascades item absolute price → item discount → list-wide discount → base price. Status: Done on the storefront, **not yet wired into POS** — `apps/backend/src/customer-groups/`, `apps/backend/src/price-lists/`, `apps/frontend/src/app/(app)/sales/customer-groups/page.tsx` and `.../sales/price-lists/page.tsx`. The in-store POS sale flow (`sales.service.ts`) does not currently apply customer-group price lists — only the storefront does (see Epic 16, Story 3.7).
