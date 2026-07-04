# Epic 01: SaaS Foundation & Infrastructure

**Goal:** This epic focuses on establishing the technical and structural foundation of the ERP71 platform. By the end of this epic, the development environment will be fully operational, and the application will support basic multi-tenant store and user management. This provides the "blank canvas" upon which all retail modules are built.

---
**Story 1.1: Project & Infrastructure Setup**
*   As a DevOps Engineer, I want to set up the initial monorepo, CI/CD pipeline, and cloud infrastructure, so that the development team can start building and deploying the application.
*   **Acceptance Criteria:**
    1.  A Git monorepo is created and accessible to the team.
    2.  A basic CI/CD pipeline is configured to run on commit to the main branch.
    3.  The pipeline can successfully build and deploy a simple "Hello World" or health-check endpoint to the target cloud environment.

---
**Story 1.2: Basic User & Store Setup**
*   As a Shop Owner, I want to sign up for the service and create my store profile, so that I can begin using the application.
*   **Acceptance Criteria:**
    1.  A user can register for a new account with an email and password.
    2.  A registered user can log in to the application.
    3.  Upon first login, the user is prompted to create a store with a name and address.

---
**Story 1.3: Demo-Data Sandbox**
*   As a Shop Owner, I want to load a sample catalog, customers, and sales into my new account, so that I can explore the platform before committing real data, and wipe it before going live.
*   **Acceptance Criteria:**
    1.  From Settings, the Owner can load a fixed demo catalog (~10 products), 5 demo customers, and 3 sample sales into their default warehouse.
    2.  The Owner can clear transactional data only, or clear all data (including master data), each requiring a type-to-confirm step.
*   Status: Done, with a caveat — `POST /tenants/demo-data` / `DELETE /tenants/data?mode=...` (`tenants.controller.ts`), `apps/frontend/src/app/(app)/settings/data/page.tsx`. **There is no demo-vs-real data tagging in the schema** — "Clear Data" deletes everything in the tenant's scope unconditionally, so running it after real transactions have accumulated destroys them too, not just the seeded demo rows.
