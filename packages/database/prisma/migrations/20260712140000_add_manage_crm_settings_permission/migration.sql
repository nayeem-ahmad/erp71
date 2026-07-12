-- Add MANAGE_CRM_SETTINGS to the StorePermission enum (gates CRM custom-field management).
ALTER TYPE "StorePermission" ADD VALUE IF NOT EXISTS 'MANAGE_CRM_SETTINGS';
