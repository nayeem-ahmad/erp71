import { SetMetadata } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';

export const STORE_PERMISSIONS_KEY = 'store_permissions';
export const STORE_PERMISSIONS_ANY_KEY = 'store_permissions_any';

/**
 * Require **all** of the given StorePermissions on the current store context.
 * OWNER role automatically passes all checks.
 */
export const RequireStorePermission = (...permissions: StorePermission[]) =>
    SetMetadata(STORE_PERMISSIONS_KEY, permissions);

/**
 * Require **any one** of the given StorePermissions.
 *
 * For routes several roles legitimately use — a sale is read by whoever makes
 * sales, orders, quotes or returns — where "all of" would lock most of them out
 * and "none" (what an undecorated route means) opens it to every member. Declared
 * on a handler it replaces, rather than adds to, an any-of set declared on the
 * class; combined with `RequireStorePermission` on the same target, both apply.
 */
export const RequireAnyStorePermission = (...permissions: StorePermission[]) =>
    SetMetadata(STORE_PERMISSIONS_ANY_KEY, permissions);
