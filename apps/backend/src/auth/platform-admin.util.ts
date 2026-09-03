const DEFAULT_PLATFORM_ADMIN_EMAILS = ['nayeem.ahmad@gmail.com'];

export function getPlatformAdminEmails() {
    const configured = process.env.PLATFORM_ADMIN_EMAILS
        ?.split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);

    return configured && configured.length > 0 ? configured : DEFAULT_PLATFORM_ADMIN_EMAILS;
}

export function isPlatformAdminEmail(email?: string | null) {
    if (!email) {
        return false;
    }

    return getPlatformAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * A Prisma `where` for "every platform admin".
 *
 * Two things make someone one: the `is_platform_admin` column, and the bootstrap
 * email whitelist that exists so a fresh deployment has an admin before anyone
 * can set that column. `PlatformAdminGuard` accepts either, so anything that
 * enumerates admins has to accept either too.
 */
export function platformAdminUserWhere() {
    return {
        OR: [
            { is_platform_admin: true },
            ...getPlatformAdminEmails().map((email) => ({
                email: { equals: email, mode: 'insensitive' as const },
            })),
        ],
    };
}
