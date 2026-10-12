// ---------------------------------------------------------------------------
// Platform team roles (the admin console's own staff, not tenant members)
// ---------------------------------------------------------------------------

/**
 * A seat in the platform admin console.
 *
 * `ADMIN` is everyone with `User.is_platform_admin` (or a bootstrap email in
 * `PLATFORM_ADMIN_EMAILS`) and can open every console route. The rest are
 * stored in `User.platform_role` and only reach what is listed for them below
 * and, on the API, what declares them with `@AllowPlatformRoles`.
 */
export const PlatformRole = {
  ADMIN: 'ADMIN',
  SUPPORT_ENGINEER: 'SUPPORT_ENGINEER',
} as const;
export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];

/** Every role, admin first. */
export const PLATFORM_ROLES: PlatformRole[] = Object.values(PlatformRole);

/** The roles stored in `User.platform_role` — every role but `ADMIN`. */
export type RestrictedPlatformRole = Exclude<PlatformRole, typeof PlatformRole.ADMIN>;
export const RESTRICTED_PLATFORM_ROLES: RestrictedPlatformRole[] = [PlatformRole.SUPPORT_ENGINEER];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as string[]).includes(value);
}

/**
 * The one role a user holds in the console, or null when they have no seat.
 * The admin flag wins over a stored role, so promoting a support engineer
 * never leaves them half-restricted.
 */
export function resolvePlatformRole(input: {
  isPlatformAdmin?: boolean | null;
  platformRole?: string | null;
}): PlatformRole | null {
  if (input.isPlatformAdmin) return PlatformRole.ADMIN;
  if (input.platformRole && (RESTRICTED_PLATFORM_ROLES as string[]).includes(input.platformRole)) {
    return input.platformRole as RestrictedPlatformRole;
  }
  return null;
}

/**
 * The console pages a support engineer works in: the support inbox, user
 * feedback, the tenant list and a tenant's detail page (to look a customer up
 * and sign in as them), and system health. Nothing that moves money, changes
 * platform settings or manages the platform team.
 */
const SUPPORT_ENGINEER_EXACT_PATHS = new Set(['/admin', '/admin/tenants']);
const SUPPORT_ENGINEER_PATH_PREFIXES = ['/admin/support', '/admin/feedback', '/admin/system-health'];
/** `/admin/tenants/<id>` — but these share its shape and are billing screens. */
const TENANT_BILLING_SEGMENTS = new Set(['ledger', 'reminders', 'payments']);

function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Whether a console role may open a page. Only meaningful for `/admin` paths;
 * anything else is outside the console and answered `true` for an admin and
 * `false` for everyone else.
 */
export function canPlatformRoleOpenPath(role: PlatformRole | null | undefined, pathname: string): boolean {
  if (!role) return false;
  if (role === PlatformRole.ADMIN) return true;

  const path = normalizePath(pathname);
  if (SUPPORT_ENGINEER_EXACT_PATHS.has(path)) return true;
  if (SUPPORT_ENGINEER_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true;
  }
  const tenantDetail = /^\/admin\/tenants\/([^/]+)$/.exec(path);
  return Boolean(tenantDetail && !TENANT_BILLING_SEGMENTS.has(tenantDetail[1]));
}
