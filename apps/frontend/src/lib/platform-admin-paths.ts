import { canPlatformRoleOpenPath, isPlatformRole, PlatformRole } from '@erp71/shared-types';
import { routes } from './routes';

/**
 * Paths that only a platform admin may ever see — the admin console and the
 * platform status page.
 *
 * The app shell redirects non-admins away from these, but that only happens
 * after hydration and `/auth/me`; the layout uses this to keep the page from
 * rendering at all until the viewer is confirmed, so a tenant user hitting the
 * URL directly never sees the console shell (or its 403ing API calls).
 */
export function isPlatformAdminOnlyPath(pathname: string): boolean {
    return (
        pathname === routes.status
        || pathname === routes.admin.root
        || pathname.startsWith(`${routes.admin.root}/`)
    );
}

/**
 * The console seat `/auth/me` reports: `ADMIN`, a narrower role such as
 * `SUPPORT_ENGINEER`, or null for someone with no seat. Falls back to the admin
 * flag for a cached `me` from before the server sent `platform_role`.
 */
export function platformRoleOf(
    me: { platform_role?: string | null; is_platform_admin?: boolean | null } | null | undefined,
): PlatformRole | null {
    if (!me) return null;
    if (isPlatformRole(me.platform_role)) return me.platform_role;
    return me.is_platform_admin ? PlatformRole.ADMIN : null;
}

/**
 * Whether this viewer may open a platform-admin-only path. `/status` stays with
 * full admins; inside `/admin` the shared role rules decide, so the console
 * never draws a page whose API the guard would refuse.
 */
export function canViewPlatformPath(role: PlatformRole | null, pathname: string): boolean {
    if (!isPlatformAdminOnlyPath(pathname)) return true;
    if (pathname === routes.status) return role === PlatformRole.ADMIN;
    return canPlatformRoleOpenPath(role, pathname);
}
