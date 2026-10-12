import { SetMetadata } from '@nestjs/common';
import type { RestrictedPlatformRole } from '@erp71/shared-types';

export const PLATFORM_ROLES_KEY = 'platform_roles';

/**
 * Opens a `PlatformAdminGuard` route (or a whole controller) to platform-team
 * roles below full admin. Without it a route stays admin-only, so a new admin
 * endpoint is never reachable by a support engineer by accident. On a handler
 * it replaces whatever the controller declares.
 */
export const AllowPlatformRoles = (...roles: RestrictedPlatformRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);
