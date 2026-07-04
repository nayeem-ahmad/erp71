# Epic 43: Product Categorization & Hierarchy

### Epic Goal
Introduce a multi-level product hierarchy (Group > Subgroup > Product) to enable better inventory organization, reporting, and filtering.

### Epic Description
Currently, products are stored in a flat list. This epic will implement the database structures, APIs, and UI components required to categorize products into Groups and Subgroups.

**Integration Points:**
*   **Data Models:** Updates to `Product`, `ProductGroup`, and `ProductSubGroup` in `docs/architecture/data-models.md`.
*   **Sales Reports:** Future ability to filter sales by group/subgroup.
*   **Inventory Management:** Group-based stock taking and adjustments.

**Success Criteria:**
1. Users can create, edit, and delete Product Groups.
2. Users can create Subgroups within a parent Group.
3. Products can be assigned to a specific Group and Subgroup.
4. The product list can be filtered by Group and Subgroup.

### Stories

1. **Story 1: Categorization API & Schema**
   * **Description:** Implement the `ProductGroup` and `ProductSubGroup` tables and their corresponding CRUD API endpoints. Update the `Product` table with foreign keys.

2. **Story 2: Category Management UI**
   * **Description:** Create a settings interface for store owners to manage their product groups and subgroups.

3. **Story 3: Product-to-Category Mapping UI**
   * **Description:** Update the "Add/Edit Product" forms to allow selecting a Group and Subgroup.

4. **Story 4: Group-based Filtering in Inventory**
   * **Description:** Add dropdown filters to the main Inventory list to allow browsing by category.

5. **Story 5: Brands Directory**
   * **Description:** A flat brand list (name, description, logo, website) independent of the Group/Subgroup hierarchy — a product can optionally carry one `brand_id` alongside its group/subgroup, used for filtering/reporting orthogonal to the category tree.
   * Status: Done — `apps/backend/src/brands/`, `apps/frontend/src/app/(app)/inventory/brands/page.tsx`.

6. **Story 6: Barcode/Label Printing**
   * **Description:** Select products (with a per-label copy count) and print a grid of labels sized for standard label sheets, showing business name, product name, SKU, price, and a barcode graphic.
   * Status: Done, with a caveat — `apps/frontend/src/app/(app)/inventory/labels/page.tsx`, `apps/frontend/src/components/BarcodeLabel.tsx`. The barcode is explicitly a decorative SVG derived from SKU character codes, **not a standards-compliant Code-128/EAN barcode** — it cannot be scanned by a real barcode reader.

7. **Story 7: CSV/Excel Catalog Import**
   * **Description:** Bulk-import products, brands, product groups/subgroups, and warehouses from a spreadsheet. Brands/groups/subgroups/warehouses share a generic wizard (upload → map columns → preview → result, CSV or Excel, skip-vs-upsert). Products use a separate, simpler fixed-column CSV importer with no upsert mode.
   * Status: Done — `apps/frontend/src/components/import-dialog.tsx` (shared wizard), `products.service.ts` `importFromCsv()` (product-specific path).
