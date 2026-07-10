-- Align the StorePermission enum with the shared-types permission matrix.
-- MANAGE_STORES exists in ROLE_DEFAULT_PERMISSIONS (OWNER), so without it the
-- user-provisioning/seed flow fails when granting owner permissions.
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_STORES';
