import { canPlatformRoleOpenPath, PlatformRole, resolvePlatformRole } from './index';

describe('resolvePlatformRole', () => {
    it('lets the admin flag win over a stored role', () => {
        expect(resolvePlatformRole({ isPlatformAdmin: true, platformRole: 'SUPPORT_ENGINEER' })).toBe(PlatformRole.ADMIN);
    });

    it('reads a stored restricted role', () => {
        expect(resolvePlatformRole({ isPlatformAdmin: false, platformRole: 'SUPPORT_ENGINEER' })).toBe(
            PlatformRole.SUPPORT_ENGINEER,
        );
    });

    it('gives no seat to everyone else, including a stored ADMIN string', () => {
        expect(resolvePlatformRole({})).toBeNull();
        expect(resolvePlatformRole({ isPlatformAdmin: false, platformRole: null })).toBeNull();
        expect(resolvePlatformRole({ isPlatformAdmin: false, platformRole: 'ADMIN' })).toBeNull();
    });
});

describe('canPlatformRoleOpenPath', () => {
    it('opens everything for an admin and nothing without a role', () => {
        expect(canPlatformRoleOpenPath(PlatformRole.ADMIN, '/admin/platform-settings/payments')).toBe(true);
        expect(canPlatformRoleOpenPath(null, '/admin')).toBe(false);
    });

    it.each([
        '/admin',
        '/admin/',
        '/admin/support',
        '/admin/support?thread=1',
        '/admin/feedback',
        '/admin/system-health',
        '/admin/tenants',
        '/admin/tenants/abc-123',
    ])('lets a support engineer open %s', (path) => {
        expect(canPlatformRoleOpenPath(PlatformRole.SUPPORT_ENGINEER, path)).toBe(true);
    });

    it.each([
        '/admin/users',
        '/admin/meet71',
        '/admin/tenants/ledger',
        '/admin/tenants/reminders',
        '/admin/tenants/payments',
        '/admin/tenants/abc-123/external-sync',
        '/admin/activation-requests',
        '/admin/accounting',
        '/admin/audit-logs',
        '/admin/platform-settings',
        '/admin/supporters',
        '/status',
    ])('keeps a support engineer out of %s', (path) => {
        expect(canPlatformRoleOpenPath(PlatformRole.SUPPORT_ENGINEER, path)).toBe(false);
    });
});
