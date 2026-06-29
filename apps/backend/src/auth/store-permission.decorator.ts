import { SetMetadata } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';

export const STORE_PERMISSIONS_KEY = 'store_permissions';

/**
 * Require one or more StorePermissions on the current store context.
 * OWNER role automatically passes all checks.
 */
export const RequireStorePermission = (...permissions: StorePermission[]) =>
    SetMetadata(STORE_PERMISSIONS_KEY, permissions);
