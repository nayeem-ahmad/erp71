# Epic 10: Core Sales & POS Transactions

### Epic Goal
Provide a high-performance, resilient Point of Sale (POS) interface for processing retail transactions with support for multiple payment methods and real-time inventory updates.

### Epic Description
This epic defines the primary revenue-generating loop for the SaaS platform. It expands the MVP to handle sophisticated retail requirements like split payments, tax calculations, and cashier session management.

**Key Features:**
*   **Search & Add:** Rapid product lookup by name, SKU, or category.
*   **Advanced Payments:** Support for multiple payment methods (Cash, bKash, Cards) per sale.
*   **Tax/Discounting:** Apply line-item or transaction-level discounts and calculate VAT/taxes.
*   **Receipt Generation:** Automated SMS receipts and thermal print support.

**Stories:**

**Story 1.3: Basic Product Management**
*   As a Shop Owner, I want to add and view products in my inventory, so that I can manage my stock.
*   **Acceptance Criteria:**
    1.  A logged-in user can access an "Inventory" section.
    2.  The user can create a new product with at least a name, price, and initial stock quantity.
    3.  The user can view a list of all their products with their current stock levels.

**Story 1.5: End-to-End POS Transaction**
*   As a Shop Owner, I want to sell a product through a simple POS interface, so that I can serve my customers and automatically decrement my inventory.
*   **Acceptance Criteria:**
    1.  A user can access a "Point of Sale" screen.
    2.  The user can select a product from their inventory to add to a cart.
    3.  The system displays the total price.
    4.  The user can complete the sale (assuming a simple cash transaction for the MVP).
    5.  Upon completion of the sale, the stock level for the sold product is correctly decreased.

1. **Story 1: POS Interface UI** - Fast, touch-friendly UI for selecting products and managing a cart.
2. **Story 2: Split Payment Logic** - API and UI support for multiple payment records against a single `Sale`.
3. **Story 3: Real-time Stock Lock/Decrement** - Atomically update `ProductStock` per warehouse upon sale completion.
4. **Story 4: Cashier Session Tracking** - Daily register opening/closing and cash reconciliation.

5. **Story 5: Sales History & Management** - UI showing list of already done sales. Any sales entry can be opened for view, edit. It can be print-previewed.

6. **Story 6: Offline-Capable POS** - The POS caches its product catalog into IndexedDB and, when checkout is attempted without connectivity, queues the sale locally instead of failing. Queued sales replay automatically via the browser's Background Sync API when connectivity returns, or through a manual sync loop as a fallback. Status: Done — `apps/frontend/src/lib/pos-db.ts`, `apps/frontend/src/hooks/useOfflineSync.ts`, `apps/frontend/public/sw.js`.

7. **Story 7: Credit-Limit-Aware "Keep Due" Sales** - When a POS sale is under-paid, the backend re-validates (independent of the frontend) that the selected customer has a credit limit and that the new due amount won't push their running balance past it, rejecting the sale with the available headroom shown otherwise. The checkout panel color-codes as allowed-with-due vs. over-limit before the request is even sent. Status: Done — `apps/backend/src/customers/customer-credit.utils.ts` (`assertCustomerCreditForSale`), wired into `sales.service.ts`.

8. **Story 8: Serial Number & Warranty Claim Tracking** - Products flagged `warranty_enabled` require one serial number per unit at checkout; each is recorded as a `ProductSerial` tied to the sale and rejected if already sold elsewhere. Staff can later look up a serial to see its sale/customer/warranty-expiry info and file a `WarrantyClaim` tracked through a status workflow. Status: Done — `sales.service.ts` (serial capture at sale time), `apps/backend/src/warranty-claims/`, `apps/frontend/src/app/(app)/sales/warranty-claims/page.tsx`.
