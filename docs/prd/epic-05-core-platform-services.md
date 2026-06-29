# Epic 05: Core Platform Services

**Goal:** Provide a unified, scalable infrastructure for cross-cutting services used across the entire ERP71 platform. This epic ensures that modules like Sales, HR, and Inventory can seamlessly store files, send communications, and notify users without reinventing these core utilities.

---

**Story 5.1: Centralized Cloud File Storage (Supabase)**
*   **As a** System Architect, **I want to** configure global storage buckets and security policies in Supabase, **so that** users can securely upload and retrieve product images, employee documents, and store logos.
*   **Acceptance Criteria:**
    1.  Separate storage buckets (e.g., `public-assets`, `private-documents`, `temp-uploads`) are created in Supabase.
    2.  Row-Level Security (RLS) policies are implemented to ensure users can only access files belonging to their store/tenant.
    3.  A reusable frontend component for file uploads with progress tracking and validation (file type/size) is implemented.

---

**Story 5.2: Unified Email Communication Service**
*   **As a** Developer, **I want to** integrate a centralized email provider (e.g., Resend or Postmark) and create a library of standardized templates, **so that** the system can send reliable receipts, RFQs, and account notifications.
*   **Acceptance Criteria:**
    1.  Email provider is configured with verified domains for the SaaS platform.
    2.  A `NotificationService` wrapper is implemented to abstract the provider (per `docs/architecture/external-apis.md`).
    3.  Initial HTML/Text templates for "Welcome Email", "Password Reset", and "Transaction Receipt" are created.
    4.  Email sending is handled asynchronously via a background job queue to prevent API blocking.

---

**Story 5.3: Real-time In-App Notification Center**
*   **As a** Store Manager, **I want to** see a "Notification Center" (bell icon) in the main dashboard, **so that** I am immediately alerted to critical events like low stock, pending approvals, or new online orders.
*   **Acceptance Criteria:**
    1.  A dedicated `Notifications` table is created in the database to store historical alerts per user.
    2.  A real-time subscription (via Supabase Realtime) updates the notification count and list without refreshing the page.
    3.  Users can mark notifications as "read" or "clear all".
    4.  The UI supports different notification types (Info, Warning, Error) with distinct icons.

---

**Story 5.4: Multi-Channel Push Notification Infrastructure**
*   **As a** Shop Owner on the go, **I want to** receive push notifications on my mobile device or browser for high-priority alerts, **so that** I can respond to business needs even when the application is closed.
*   **Acceptance Criteria:**
    1.  Firebase Cloud Messaging (FCM) or a similar service is integrated into the application.
    2.  The PWA Service Worker is configured to listen for and display background push notifications.
    3.  A user-level setting is implemented to opt-in/out of specific notification categories (e.g., Sales, HR, Inventory).
    4.  Notifications correctly deep-link to the relevant screen in the application when clicked.
