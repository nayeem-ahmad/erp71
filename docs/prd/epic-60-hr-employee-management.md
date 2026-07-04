# Epic 60: HR & Employee Management

**Goal:** Establish a simple, unified structure for managing the people in a small retail business, from organizational hierarchy to digital employee records.

---

**Story 1: Organizational Structure Setup**
*   **As a** Shop Owner, **I want to** define my departments (e.g., Sales, Inventory) and designations (e.g., Cashier, Manager), **so that** I can organize my staff according to my business needs.
*   **Acceptance Criteria:**
    1.  A simple interface to add/edit/delete Departments and Designations.
    2.  The system prevents deleting designations currently assigned to employees.

---

**Story 2: Digital Employee Profiles**
*   **As a** Store Manager, **I want to** maintain a central digital record for each employee, **so that** I have their contact info, joining date, and NID on file.
*   **Acceptance Criteria:**
    1.  A "Staff Directory" showing all active and inactive employees.
    2.  A profile form capturing: Name, Email, Phone, NID, Date of Joining, Department, and Designation.
    3.  Ability to upload a profile photo and relevant documents (placeholders).

---

**Story 3: System Access Control**
*   **As a** Shop Owner, **I want to** link an employee record to a system user account, **so that** I can control who can log in to the POS or the dashboard.
*   **Acceptance Criteria:**
    1.  An admin can link an employee profile to a specific `User` (RBAC).
    2.  The system identifies the employee's role based on their designation for default permissions.

---

**Story 4: Employee Bulk Import**
*   **As a** Shop Owner, **I want to** bulk-upload employees from a spreadsheet, **so that** I don't have to add my whole existing staff roster one by one.
*   **Acceptance Criteria:**
    1.  A CSV/spreadsheet upload accepts name (required), phone, email, joining date, and salary.
    2.  Rows are matched against existing employees by phone number; skip or update-existing modes are supported, with per-row error reporting.
*   Status: Done — `EmployeesService.importRows()`, shared `apps/backend/src/common/import.util.ts` engine, "Import" button on `apps/frontend/src/app/(app)/hr/employees/page.tsx`. Note: NID is not importable via CSV — it can only be set through the individual employee form.

---

**Story 5: NID Field Encryption**
*   **As a** Shop Owner, **I want** employee (and customer) National ID numbers encrypted at rest, **so that** sensitive personal data is protected if the database is ever compromised.
*   **Acceptance Criteria:**
    1.  NID values are encrypted before being written to the database and transparently decrypted when read back through the API.
    2.  Encryption is mandatory in production (the app refuses to start without a configured key).
*   Status: Done — `apps/backend/src/common/encryption.service.ts` (AES-256-GCM), applied to `Employee.nid` and `Customer.nid`.
