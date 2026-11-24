# External APIs

## SSL Wireless / SSLCOMMERZ Hosted Checkout API

- **Purpose:** To process tenant subscription payments for plan upgrades and renewals through a backend-owned hosted checkout flow.
- **Base URL(s):** Sandbox and live URLs are configured through environment variables so the same billing module can be promoted without code changes.
- **Authentication:** `store_id` and `store_passwd`, stored only on the backend.
- **Key Backend Endpoints Used:**

  - `POST /gwprocess/v4/api.php` to initialize checkout and receive the hosted payment page URL.
  - `GET /validator/api/validationserverAPI.php` to validate a returned `val_id` before activating a subscription.

- **Integration Notes:**

  - The backend creates the hosted checkout session and redirects the tenant owner or manager to the SSL Wireless payment page.
  - The Free plan does not initiate hosted checkout; backend activates the free subscription path directly.
  - Success, failure, cancel, and IPN callbacks are processed by the backend, which validates the transaction before changing `TenantSubscription` state.
  - Callback processing is recorded in `BillingEvent` rows so duplicate provider notifications are idempotent and auditable.
  - The billing service still supports a manual fallback path for local development when provider credentials are not configured.

**Plan Catalog Context:**

- Free: BDT 0
- Basic: BDT 499
- Standard: BDT 999
- Premium: BDT 1499

### Storefront payments (each shop's own merchant account)

- **Purpose:** To let a shopper pay for a web order directly into the **shop's own**
  merchant account. ERP71 is never the merchant of record and never settles funds.
- **Where the pieces live:**
  - `StorefrontPaymentProvider` — the platform-admin-managed catalog
    (`Admin → Platform settings → Storefront payment providers`).
  - `TenantStorefrontGateway` — one row per shop per provider. Credentials are
    AES-256-GCM encrypted at rest (`platform-settings/crypto.util`) and masked on read.
  - `StorefrontPayment` — one attempt per order. `(providerCode, providerPaymentId)`
    is unique, which makes replayed callbacks idempotent.
- **Public endpoints:** `POST /storefront/:slug/orders/:orderId/pay` opens the
  session; `POST|GET /storefront/:slug/payments/:providerCode/callback` settles it;
  `GET /storefront/:slug/payments/:paymentId` is the return page's status read.
  The tenant is always resolved from `:slug`, so callbacks cannot cross shops.
- **Adapters:**
  - `SSLCOMMERZ` — built-in, reads the shop's `store_id` / `store_password`.
  - `HOSTED_REDIRECT` — driven entirely by the provider row's `config` JSON
    (`initiate_url`, `field_map`, `validation_url`, dot-path response mapping).
    A gateway that follows the standard "form POST → hosted page → callback with a
    reference → server-to-server validate" shape is onboarded from the admin panel
    with no deploy.
  - A protocol that needs a bespoke handshake (bKash's token grant/execute flow,
    Nagad's signed requests) still needs its own adapter class.
- **Accounting:** once money is real — a verified online payment, or a delivered
  cash-on-delivery order — `StorefrontOrderBillingService` bills the order as an
  ordinary `Sale` through `SalesService.create`: stock leaves a warehouse, the
  tender gets its account, and `autoPostFromRules` writes the Dr <tender> /
  Cr revenue voucher. Two deliberate details: the sale is attributed to a
  physical branch (the owner of the tenant's default sales warehouse) because
  the virtual online branch holds no stock, and loyalty is not re-awarded
  (`awardLoyalty: false`) because the storefront credited points when the order
  was placed. `StorefrontOrder.sale_id` makes billing happen exactly once.

### bKash Payment Gateway API

- **Purpose:** To securely process online payments from customers for orders placed on the e-commerce storefront.
- **Status:** Not built. bKash's token-grant + `payment/create` + `payment/execute`
  handshake needs a dedicated adapter; it is not expressible as a `HOSTED_REDIRECT`
  row. Once the adapter exists, the provider is added from the admin catalog and
  each shop supplies its own merchant credentials — no per-shop code.
- **Documentation:** To be provided. The exact implementation will depend on the official developer documentation from bKash.
- **Base URL(s):** Will include a sandbox URL for testing and a production URL for live payments.
- **Authentication:** Typically via an App Key and App Secret provided by bKash. These will be stored securely as environment variables on the backend.
- **Rate Limits:** To be determined from the official documentation.

**Key Endpoints Used (Example Flow):**

- `POST /token` - To obtain an authentication token for making other API calls.
- `POST /payment/create` - To initiate a payment request and get a payment URL to redirect the user to.
- `POST /payment/execute` - To confirm and execute the payment after the user has approved it on the bKash platform.
- `GET /payment/status` - To query the status of a transaction after the user is redirected back to our site.

**Integration Notes:** The integration will be handled exclusively by the **Backend API** component to ensure security. A dedicated server-side module will be created to encapsulate all interactions with the bKash API, handling the token exchange, payment creation, and execution flow. The frontend will not interact with the bKash API directly.

### Nagad Payment Gateway API

- **Purpose:** To provide a second major option for customers to process online payments, increasing the flexibility of the e-commerce platform.
- **Documentation:** To be provided. The implementation will follow the official developer documentation from Nagad.
- **Base URL(s):** Will include separate sandbox and production URLs.
- **Authentication:** Expected to be via a Merchant ID and API Key provided by Nagad, stored securely on the backend.
- **Rate Limits:** To be determined from the official documentation.

**Key Endpoints Used (Example Flow):**

- `POST /remote-payment-gateway-payment` - To initiate a payment and receive a checkout URL.
- `GET /remote-payment-gateway-payment/{paymentRefId}` - To verify the status of the payment after the user returns to the site.

**Integration Notes:** Similar to the bKash integration, this will be a backend-only responsibility. A dedicated server-side module will be created to handle the specific API flow for Nagad. The frontend will be abstracted from the details of which payment gateway is being used.

### SMS Gateway API (Generic)

- **Purpose:** To send automated transaction alerts (Sales, Payments) to customers.
- **Documentation:** Dependent on the selected local provider (e.g., Twilio, GreenWeb, Diana Host).
- **Base URL(s):** Provider-specific.
- **Authentication:** API Key/Secret stored in environment variables.
- **Rate Limits:** Dependent on the provider plan.

**Key Endpoints Used (Example Flow):**

- `POST /send-sms` - To dispatch a single SMS message.
- `GET /balance` - To check the remaining SMS credit balance.

**Integration Notes:**

- Sending will be handled asynchronously via the **Background Job Queue** (see Scalability Epic) to prevent blocking the main sales flow.
- A `NotificationService` wrapper will be created to abstract the specific provider, allowing us to switch providers without changing business logic.
