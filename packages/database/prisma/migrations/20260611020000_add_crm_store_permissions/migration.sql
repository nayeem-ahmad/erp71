-- Align the StorePermission enum with the shared-types permission matrix.
-- These CRM permissions already exist in ROLE_DEFAULT_PERMISSIONS (granted to MANAGER),
-- so without them the user-provisioning flow fails when seeding a manager's permissions.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_CRM_INTERACTIONS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'CREATE_CRM_INTERACTIONS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_CRM_TASKS';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'VIEW_CUSTOMER_CREDIT';
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_CUSTOMER_CREDIT';
