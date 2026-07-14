# Grocery SaaS UI/UX Specification

> **⚠️ PARTIALLY SUPERSEDED (2026-07-14):** The visual design sections of this document (Branding & Style Guide — color palette, typography, buttons) no longer reflect the implemented product and are superseded by **`docs/ui-design-guidelines.md`**, the ratified design system (blue-600 primary, semantic success/warning/danger tokens, Inter + Noto Sans Bengali, compact density). The UX goals, personas, IA, and user-flow sections below remain valid.

This document defines the user experience goals, information architecture, user flows, and visual design specifications for Grocery SaaS's user interface. It serves as the foundation for visual design and frontend development, ensuring a cohesive and user-centered experience.

## Overall UX Goals & Principles

### Target User Personas
- **Shop Owner:** Small grocery shop owners in diverse regions, potentially with limited technical literacy. They prioritize ease of use, quick transactions, and clear inventory management.
- **Shop Employee:** Staff assisting customers, needing efficient POS operations and stock checking.
- **Customer (E-commerce):** End-users browsing and purchasing groceries online, expecting a smooth, intuitive shopping experience.

### Usability Goals
- **Ease of Learning:** New users (especially shop owners) should be able to complete core tasks (e.g., a sale, adding inventory) within 5-10 minutes of first use.
- **Efficiency of Use:** Experienced users should be able to perform frequent tasks (e.g., processing multiple sales, updating stock levels) with minimal clicks and rapid response times.
- **Error Prevention:** The system should guide users to prevent common mistakes, with clear validation and confirmation for critical or destructive actions.
- **Memorability:** Infrequent users should be able to return to the system and easily recall how to perform tasks without extensive relearning.

### Design Principles
1.  **Radical Simplicity:** Prioritize clear, uncluttered interfaces and straightforward workflows over feature complexity.
2.  **Reliability & Trust:** Ensure consistent performance and accurate data, building user confidence.
3.  **Contextual Guidance:** Provide just-in-time help and clear feedback, especially for less tech-savvy users.
4.  **Mobile-First & Responsive:** Design for optimal experience across various devices, from mobile phones to tablets and desktops.
5.  **Accessibility by Default:** Adhere to WCAG AA standards to ensure usability for all users.

### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2025-10-17 | 1.0 | Initial Draft | Sally (UX Expert) |
| 2025-11-26 | 2.0 | Updated with SMS Notification flows and detailed screen layouts | Sally (UX Expert) |

## Global UI Patterns

### Standard Data Table (List View)
Every module containing a list of records (e.g., Products, Sales, Customers) MUST implement a consistent Data Table component with the following features:

1.  **Toolbar Actions:**
    *   **Global Search:** A persistent search bar that filters the list in real-time.
    *   **Column Management:** A dropdown to hide/show specific columns and re-order them via drag-and-drop.
    *   **Export:** Buttons to export the currently filtered/sorted view to **CSV** or **Excel**.

2.  **Table Functionality:**
    *   **Sorting:** All columns should be sortable (Ascending/Descending) by clicking the column header.
    *   **Column Resizing:** Users must be able to click and drag the edge of a column header to change its width.
    *   **Multi-Select:** A checkbox in the header to "Select All" and a checkbox in each row to select one or more records for bulk actions.
    *   **Persistent State:** (Optional/Preferred) The system should remember the user's hidden columns and preferred column widths.

3.  **Actions Column:**
    *   A dedicated column (usually the last) containing icon-based buttons for row-level actions (e.g., `View`, `Edit`, `Delete`, `Print`).
    *   Actions should show a tooltip on hover and a confirmation modal for destructive actions like `Delete`.

4.  **Pagination & Density:**
    *   **Rows Per Page:** A dropdown at the bottom of the table to select results per page: `10`, `20`, `50`, `100`, or `All`.
    *   **Navigation:** Standard "Next", "Previous", and "Page Number" controls.

5.  **Visual Feedback:**
    *   **Loading States:** A skeleton screen or progress bar when data is fetching.
    *   **Empty States:** A clear illustration or message when no results match the search or filter.

### Standard Form & Entry Patterns
Every data entry interface (e.g., Add Product, Create Sale, Record Expense) MUST adhere to the following behavioral standards:

1.  **Advanced Dropdowns (Select Inputs):**
    *   **Searchable:** All dropdowns with more than 5 items must include a search/filter box within the menu.
    *   **Logical Sorting:** Items must be sorted alphabetically by name, or by frequency of use where applicable.
    *   **Multi-Select:** Support for selecting multiple items (with "Select All" / "Clear All" shortcuts) where required by the data model.
    *   **Create New (Inline):** If a user cannot find an item (e.g., a new Supplier or Product Group), the dropdown must provide a " + Add New [Item]" option that opens a quick-entry modal without leaving the current form.

2.  **Serial Numbers & Identifiers:**
    *   **Unique & Auto-generated:** Fields like Invoice # or Adjustment # must be automatically generated using a sequential or patterned logic.
    *   **Editable:** Auto-generated numbers must remain editable by the user (with a warning if they change it) to allow for manual corrections or specific numbering schemes.
    *   **Validation:** Immediate "duplicate" check on blur to ensure uniqueness within the store.

3.  **Entry Metadata:**
    *   **Date & Time:** Always default to the current system time (`now()`) upon form load.
    *   **Manual Reference Number:** Every transaction entry must include a dedicated "Reference Number" field to allow users to link the digital record to their manual/paper-based system.

4.  **Form Validation & UX:**
    *   **Inline Validation:** Show error messages immediately as the user types or leaves a field.
    *   **Required Indicators:** Clearly mark required fields with an asterisk (`*`).
    *   **Dirty State:** Show a "You have unsaved changes" confirmation if the user attempts to navigate away from a partially filled form.

## Information Architecture (IA)


### Site Map / Screen Inventory

```mermaid
graph TD
    A[Login/Auth] --> B[Dashboard]
    B --> C[POS (Point of Sale)]
    B --> D[Inventory Management]
    B --> E[Sales & Reports]
    B --> F[Customers]
    B --> G[Settings]
    B --> H[Notification Center]
    D --> D1[Products List]
    D --> D2[Suppliers]
    D --> D3[Stock Adjustments]
    E --> E1[Daily Sales]
    E --> E2[Order History]
    E --> E3[Analytics]
    F --> F1[Customer List]
    F --> F2[Loyalty Programs]
    G --> G1[User Management]
    G --> G2[Store Profile]
    G --> G3[Payment Methods]
    G --> G4[Integrations (SMS/Payment)]
```

### Navigation Structure

**Primary Navigation:** A persistent sidebar (desktop) or bottom tab bar (mobile) providing quick access to major modules: Dashboard, POS, Inventory, Sales, Customers, Settings.

**Secondary Navigation:** Contextual navigation within each major module (e.g., tabs for Products/Suppliers within Inventory).

**Breadcrumb Strategy:** Clear breadcrumbs (e.g., "Inventory > Products > Add Product") to indicate location and allow easy upward navigation.

## User Flows

### Flow: Complete a Sale with SMS Notification

**User Goal:** Process a customer purchase quickly and ensure they receive a digital receipt via SMS.

**Entry Points:** POS Screen

**Success Criteria:** Sale recorded, inventory updated, SMS sent to customer.

#### Flow Diagram
```mermaid
graph TD
    A[Start: POS Screen] --> B{Add Items to Cart}
    B --> C[Review Cart Total]
    C --> D{Select Payment Method}
    D --> E[Enter Customer Phone (Optional)]
    E --> F[Confirm Payment]
    F --> G{Payment Successful?}
    G -- Yes --> H[Show Success Screen]
    G -- No --> I[Show Error & Retry]
    H --> J[System Sends SMS Async]
    H --> K[Print Receipt (Optional)]
    H --> L[Return to New Sale]
```

#### Edge Cases & Error Handling:
- **Invalid Phone Number:** Validate phone number format before submission. If invalid, show inline error "Please enter a valid mobile number".
- **SMS Service Down:** If SMS fails silently in background, do not block the UI. Log the error for admin review.
- **Payment Failure:** Clear error message explaining why (e.g., "Insufficient Funds", "Network Error") and allow retry.

**Notes:** The SMS step is automated on the backend; the UI only needs to collect the phone number.

### Flow: Manage Inventory (Add Product)

**User Goal:** Add a new product to the store inventory.

**Entry Points:** Inventory Dashboard > "Add Product" Button

**Success Criteria:** Product saved to database and visible in list.

#### Flow Diagram
```mermaid
graph TD
    A[Inventory Screen] --> B[Click 'Add Product']
    B --> C[Fill Product Details Form]
    C --> D{Validate Inputs}
    D -- Valid --> E[Save Product]
    D -- Invalid --> F[Show Inline Errors]
    E --> G[Show Success Toast]
    E --> H[Redirect to Product List]
```

#### Edge Cases & Error Handling:
- **Duplicate SKU:** If SKU exists, show error "Product with this SKU already exists".
- **Unsaved Changes:** If user tries to leave form with unsaved data, show confirmation modal "Discard changes?".

## Wireframes & Mockups

**Primary Design Files:** [Figma Project Link Placeholder]

### Key Screen Layouts

#### Screen: Point of Sale (POS)
**Purpose:** The core interface for processing sales. Optimized for speed and touch interaction.

**Key Elements:**
- **Product Grid/List:** Left/Center panel showing available products with images and prices. Search bar at top.
- **Cart Panel:** Right sidebar (or slide-up on mobile) showing added items, quantities, subtotals, and tax.
- **Customer Input:** Field to enter/search customer name or mobile number (for SMS).
- **Payment Action Bar:** Large "Pay" button and quick payment method toggles (Cash, Card, Mobile Pay).

**Interaction Notes:** Tapping a product adds 1 unit. Long-press allows quantity edit. "Pay" triggers the Payment Modal.

#### Screen: Inventory List
**Purpose:** View and manage stock levels.

**Key Elements:**
- **Filter/Search Bar:** Filter by category, low stock status, or search by name/SKU.
- **Data Table:** Columns for Image, Name, SKU, Price, Current Stock, Status (In Stock/Low Stock).
- **Quick Actions:** "Edit" and "Adjust Stock" buttons per row.
- **Low Stock Indicator:** Red badge or row highlight for items below reorder level.

**Interaction Notes:** "Adjust Stock" opens a quick modal to +/- quantity without leaving the list.

## Component Library / Design System

**Design System Approach:** We will build a custom system using **Shadcn/UI** (based on Radix UI) + **Tailwind CSS**. This provides accessible, unstyled primitives that we can style to match our "Radical Simplicity" aesthetic.

### Core Components

#### Component: Action Button
**Purpose:** Primary user interaction trigger.

**Variants:**
- **Primary:** Solid Green (#4CAF50). Used for "Pay", "Save", "Confirm".
- **Secondary:** Outlined/Ghost. Used for "Cancel", "Back", "Export".
- **Destructive:** Solid Red (#F44336). Used for "Delete", "Void Sale".

**States:** Default, Hover (slightly darker), Active (pressed), Disabled (greyed out, no interaction), Loading (spinner replaces text).

**Usage Guidelines:** Use Primary only once per view for the main action.

#### Component: Status Badge
**Purpose:** Indicate state of an entity (Order, Product).

**Variants:**
- **Success:** Green bg/text. (e.g., "Paid", "In Stock")
- **Warning:** Orange bg/text. (e.g., "Low Stock", "Pending")
- **Error:** Red bg/text. (e.g., "Cancelled", "Out of Stock")

**Usage Guidelines:** Place next to the entity name or in a status column.

## Branding & Style Guide

> **Superseded.** The palette (green #4CAF50 primary, Roboto/Open Sans, 16px body) specified in earlier revisions of this section was never implemented. The authoritative style guide is **`docs/ui-design-guidelines.md`** (§2.2 color system, §2.3 typography, §2.4 shape/elevation/spacing, §2.7 components). Iconography remains Lucide React, as originally specified.

## Accessibility Requirements

**Standard:** WCAG 2.1 Level AA

**Key Requirements:**
- **Visual:** Minimum 4.5:1 contrast for text. Visible focus rings on all interactive elements.
- **Interaction:** Full keyboard navigability (Tab, Enter, Space, Esc). Touch targets min 44x44px.
- **Content:** All images must have `alt` text. Forms must have associated `<label>` elements.

**Testing Strategy:** Automated audit via `axe-core` in CI/CD + Manual keyboard testing for every new feature.

## Responsiveness Strategy

### Breakpoints
- **Mobile:** < 576px (Smartphones)
- **Tablet:** 577px - 992px (Tablets/iPads)
- **Desktop:** > 993px (Laptops/Monitors)

### Adaptation Patterns
- **Layout:** Single column on mobile, multi-column on desktop. Sidebars become bottom tabs or hamburger menus on mobile.
- **Tables:** On mobile, complex tables transform into "Card Lists" to avoid horizontal scrolling.
- **Navigation:** "App-like" bottom navigation for core actions on mobile.

## Animation & Micro-interactions

**Motion Principles:** Quick, subtle, informative. Max 300ms duration.

**Key Animations:**
- **Modal Slide-up:** Slide up from bottom on mobile, fade in/scale up on desktop. (300ms, ease-out)
- **Toast Notification:** Slide in from top-right (desktop) or top-center (mobile). Auto-dismiss after 3s.
- **Button Feedback:** Subtle scale down (0.95x) on press.

## Performance Considerations

- **Page Load:** < 2s FCP on 3G.
- **Interaction:** < 100ms response to taps.
- **Design Strategies:**
    - Lazy load below-the-fold images.
    - Skeleton screens instead of spinners for initial data load.
    - Optimistic UI updates for "Add to Cart" and "Like" actions.

## Next Steps

### Immediate Actions
1.  Create high-fidelity Figma mockups for the **POS** and **Inventory** screens based on these layouts.
2.  Prototype the **SMS Notification flow** to test user understanding of the "optional" phone number field.
3.  Review this spec with the Lead Developer to confirm component feasibility.

### Design Handoff Checklist
- [ ] All user flows documented
- [ ] Component inventory complete
- [ ] Accessibility requirements defined
- [ ] Responsive strategy clear
- [ ] Brand guidelines incorporated
- [ ] Performance goals established

## Checklist Results
*(Pending Checklist Execution)*
