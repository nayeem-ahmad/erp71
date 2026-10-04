import * as fs from 'fs';
import * as path from 'path';

/**
 * Every file that writes a table `AuthCacheService` answers from, and what it
 * does about the cache.
 *
 * The cache's security rests on invalidation: a revoked member, a demoted
 * admin, a signed-out session lose access on their next request only because
 * the write that revoked them called `invalidate*`. The TTL bounds a forgotten
 * call to 30 seconds — not nothing, for a removed employee. So this is a
 * ratchet, like `route-authorization.spec.ts`: a new file that writes one of
 * these tables fails here until someone has decided, and written down, whether
 * it changes a cached answer.
 *
 * It works at file granularity. A new write inside a file already listed is not
 * caught — reviewing that is still on whoever adds it, and the reasons below
 * are what they should check it against.
 */
const INVALIDATES = 'invalidates';

const REVIEWED: Record<string, string> = {
    'admin-tenants/admin-tenants.service.ts': INVALIDATES, // promote/demote, admin user edit/delete/reset, tenant delete
    'auth/auth.service.ts': INVALIDATES, // logout, changePassword; signup/provisioning only create new rows
    'careers/careers.service.ts': INVALIDATES, // logout (atv); signup creates a new user
    'employee-portal/employee-login.service.ts': INVALIDATES, // reset, revoke; create makes a new user
    'invitations/invitations.service.ts': INVALIDATES, // role change, accept
    'password-reset/password-reset.service.ts': INVALIDATES, // token versions bumped on reset
    'platform-workspace/platform-workspace.service.ts': INVALIDATES, // admin roster sync, invited-member access
    'storefront/storefront.service.ts': INVALIDATES, // customer logout (stv); the rest create or patch uncached columns
    'stores/stores.service.ts': INVALIDATES, // new branch: owners' access lists change
    'team/team.service.ts': INVALIDATES, // roles, role templates, branch access, permissions, removal
    // Writes only the tenant row, so the scan below does not find it; listed so
    // the check that it calls the cache still runs. The timezone rides on the
    // cached membership. (The other membership field, `deleted_at`, is set only
    // by `AdminTenantsService.deleteTenant`, which invalidates too.)
    'tenants/tenants.service.ts': INVALIDATES,

    'auth/totp.service.ts': 'totp_secret only — not a column JwtStrategy reads',
    'auth/verified-mobile.util.ts': 'mobile, firebase_uid and mobile_verified_at only — not cached',
    'blog/blog.service.ts': 'blog_last_seen_at only — not cached',
    'referrals/referrals.service.ts': 'creates a brand-new user, which nothing can have cached',
    'sales-settings/sales-settings.service.ts': 'TenantUser.invoice_print_prefs only — not cached',
    'team/role-sync.util.ts': 'runs inside its callers\' transactions; they invalidate after commit',
    'team/tenant-role.seed.ts': 'creates the roles of a brand-new tenant',
};

/** Prisma writes to the tables behind `user`, `membership`, `grants`, `storeAccess` and `store`. */
const WRITE =
    /\b(user|tenantUser|tenantUserRole|userStorePermission|userStoreAccess|tenantRole|tenantRolePermission|store)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) return [];
        return [full];
    });
}

describe('AuthCacheService invalidation coverage', () => {
    const root = path.join(__dirname, '..');
    const files = sourceFiles(root).map((file) => ({
        rel: path.relative(root, file).split(path.sep).join('/'),
        text: fs.readFileSync(file, 'utf8'),
    }));
    // The cache itself calls `.user.delete(` on its own map.
    const writers = files.filter(({ rel, text }) => rel !== 'database/auth-cache.service.ts' && WRITE.test(text));

    it('finds the writers, so an empty scan cannot pass for a clean one', () => {
        expect(writers.map(({ rel }) => rel)).toEqual(expect.arrayContaining(['team/team.service.ts', 'auth/auth.service.ts']));
    });

    it('lists every file that writes a table the auth cache answers from', () => {
        const unreviewed = writers.map(({ rel }) => rel).filter((rel) => !(rel in REVIEWED));

        // If this fails: does the new write change who a user is (token
        // versions, email, platform admin, must_change_password), whether they
        // are a member, their roles, their branch access or their permissions?
        // If so, call `authCache.invalidateUser/Member/Tenant` *after* the write
        // commits and list the file as INVALIDATES; if not, list it with why.
        expect(unreviewed).toEqual([]);
    });

    it('has every file listed as invalidating actually call the cache', () => {
        const silent = Object.entries(REVIEWED)
            .filter(([, reason]) => reason === INVALIDATES)
            .map(([rel]) => rel)
            .filter((rel) => !files.find((file) => file.rel === rel)?.text.includes('authCache.invalidate'));

        expect(silent).toEqual([]);
    });

    it('has no stale entries for files that no longer exist', () => {
        const missing = Object.keys(REVIEWED).filter((rel) => !files.some((file) => file.rel === rel));
        expect(missing).toEqual([]);
    });
});
