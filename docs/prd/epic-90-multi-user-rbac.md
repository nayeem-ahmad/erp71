# Epic 90: Multi-user Role-Based Access Control (RBAC)

### Epic Goal
Secure the platform by ensuring users only have access to the features and data required for their specific role.

### Epic Description
**Stories:**
1. **Story 1: Role Definition** - Create default roles (Owner, Manager, Cashier, Accountant).
2. **Story 2: Permission Mapping** - Define which API routes and UI components are accessible per role.
3. **Story 3: User-to-Role Assignment** - Interface for store owners to manage staff access.
4. **Story 4: Custom Tenant Roles** - Let a store Owner define their own named role templates (beyond the four defaults), built on top of the `StorePermission` matrix, with edits auto-syncing to every member already assigned that role. Implemented 2026-07-02 (`TenantRole`/`TenantRolePermission` models, `apps/backend/src/team/role-sync.util.ts`, `/team/roles` CRUD, Roles tab on `/team`); see `docs/superpowers/specs/2026-07-02-custom-tenant-roles-design.md`. Documented here after the fact — no functional changes accompany this entry.
