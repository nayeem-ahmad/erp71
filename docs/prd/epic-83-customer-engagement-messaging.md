# Epic 83: Customer Engagement & Messaging

**Goal:** Provide a direct and automated communication channel with customers through SMS, email, and push notifications to improve engagement and provide transactional transparency.

---

**Story 1.6: Customer SMS Notification**
*   **As a** Shop Owner, **I want my** customers to receive an SMS notification when they make a purchase or payment, **so that** they have an immediate record of the transaction.
*   **Acceptance Criteria:**
    1.  When a new sale is completed, the system checks if a customer phone number is associated with the sale.
    2.  If a phone number is present, the system sends an SMS containing the store name, total amount, and transaction ID.
    3.  The system handles SMS sending asynchronously to avoid delaying the POS response.
    4.  (Optional for MVP) If the SMS fails, the error is logged, but the sale remains valid.

---

**Story 1.7: Customer Interaction Log**
*   **As a** Shop Owner, **I want to** log every call, SMS, WhatsApp message, email, visit, or note with an existing customer, **so that** I have a service history and know how long it's been since we last spoke.
*   **Acceptance Criteria:**
    1.  Staff can log an interaction (channel, direction, summary, outcome) against a customer.
    2.  Logging an interaction refreshes the customer's "last contacted" timestamp, which feeds the automated reorder-reminder task (Epic 85, Story 3).
*   Status: Done — `apps/backend/src/crm-interactions/`, "Interactions" tab on `apps/frontend/src/app/(app)/sales/customers/[id]/page.tsx`.

---

**Story 2: Automated Loyalty Points Balance Updates**
*   **As a** Store Manager, **I want to** automatically notify customers via SMS/Email when their loyalty points balance changes, **so that** they feel rewarded and are encouraged to return.
*   **Acceptance Criteria:**
    1.  The system triggers a message whenever points are earned or redeemed.
    2.  The notification includes the new total balance and a brief "Thank you" or "Points earned" message.
    3.  Messaging is throttled to prevent multiple notifications for rapid successive transactions.
