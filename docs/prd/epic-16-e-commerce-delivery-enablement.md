# Epic 16: E-commerce & Delivery Enablement

**Expanded Goal:** This epic introduces a major new sales channel for the business. It enables shop owners to create and manage their own customer-facing online store, accept orders, and manage the entire fulfillment and delivery process, transforming their brick-and-mortar operation into a multi-channel retail business.

---
**Story 3.1: E-commerce Storefront Setup**
*   As a Store Owner, I want to enable and configure my public e-commerce storefront, so that my customers can browse my products online.
*   **Acceptance Criteria:**
    1.  An Admin can enable the storefront from a new "E-commerce" settings page.
    2.  When enabled, the storefront is available at a unique, publicly accessible URL.
    3.  Products from the inventory that are marked as "available online" are displayed on the storefront with their name and price.

---
**Story 3.2: Customer Registration & Shopping Cart**
*   As a Shopper, I want to create an account on the storefront and add items to a shopping cart, so that I can prepare to place an order.
*   **Acceptance Criteria:**
    1.  A new customer can register for an account directly on the storefront website.
    2.  A logged-in customer can add products to a persistent shopping cart.
    3.  The cart view correctly displays the selected items and the total price.

---
**Story 3.3: Online Checkout & Order Placement**
*   As a Shopper, I want to check out and pay for my order online, so that I can complete my purchase.
*   **Acceptance Criteria:**
    1.  From the cart, a customer can proceed to a checkout page.
    2.  The customer can enter or select a delivery address.
    3.  The customer can pay for the order using the integrated bKash/Nagad payment gateway.
    4.  A successful payment creates a new order in the system and shows the customer a confirmation page.

---
**Story 3.4: Online Order Management**
*   As a Store Owner, I want to see and manage new online orders from within the main application, so that I can prepare them for fulfillment.
*   **Acceptance Criteria:**
    1.  A new "Online Orders" section is available to Admin users.
    2.  New, paid orders from the storefront appear in a list with a "New" status.
    3.  The owner can view the order details, including the customer's information, the items ordered, and the delivery address.
    4.  The owner can update an order's status to "Processing".

---
**Story 3.5: Basic Delivery Management**
*   As a Store Owner, I want to manage the delivery of an online order, so that the customer receives their items.
*   **Acceptance Criteria:**
    1.  The owner can update an order's status from "Processing" to "Out for Delivery" and then to "Delivered".
    2.  The owner can assign an order to a delivery person (from a simple list of delivery people managed in settings).
    3.  The customer can view the current status of their order in their account's order history page on the storefront.

---
**Story 3.6: Storefront Branding & Customization**
*   As a Store Owner, I want to customize my storefront's look (banner, hero image/headline, brand color, logo, favicon), so that it feels like my own store rather than a generic template.
*   **Acceptance Criteria:**
    1.  The Owner can set a banner, hero image/headline, primary brand color, logo, and favicon from storefront settings.
    2.  The public storefront renders using these branding fields.
*   Status: Done — `Tenant` branding fields (`storefront_banner`, `storefront_hero_image`, `brand_primary_color`, `brand_logo_url`, etc.), `apps/frontend/src/app/(app)/storefront/settings/page.tsx`.

---
**Story 3.7: Per-Customer Price-List Resolution on Storefront**
*   As a Shopper who belongs to a customer group with negotiated pricing, I want to see my group's prices when I browse and check out, so that I get the rates I was promised.
*   **Acceptance Criteria:**
    1.  A logged-in customer assigned to a `CustomerGroup` with an active linked price list sees that price list's prices throughout browsing and checkout.
    2.  Anonymous shoppers, and customers without an applicable group/price list, fall back to the tenant's default active price list.
*   Status: Done — `resolvePriceListForUser`/`resolvePriceListForCustomer` in `apps/backend/src/storefront/storefront.service.ts` and `apps/backend/src/price-lists/price-lists.service.ts`. Note: this resolution is storefront-only — in-store POS checkout does not currently apply customer-group price lists (see Epic 80, Story 4).

---
**Story 3.8: Product Storefront Content (Description & Image Gallery)**
*   As a Store Owner, I want to write a rich storefront description and upload a gallery of extra product photos, so that my online listing looks as complete as the physical product deserves.
*   **Acceptance Criteria:**
    1.  The Add/Edit Product modal has a dedicated "Storefront (Ecommerce)" tab, separate from the basic inventory fields.
    2.  The Owner can write a free-text storefront description and mark the product as "trending" for the storefront homepage.
    3.  The Owner can upload multiple gallery images for the product, in addition to the single primary product image.
*   Status: Done — "Storefront (Ecommerce)" tab in `apps/frontend/src/app/(app)/inventory/AddProductModal.tsx` (`activeTab === 'storefront'`), backed by `Product.description` and `Product.images_gallery` (`packages/database/prisma/schema.prisma`).

---
