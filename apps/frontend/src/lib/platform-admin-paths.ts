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
