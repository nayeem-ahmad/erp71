import { canViewPlatformPath, isPlatformAdminOnlyPath, platformRoleOf } from './platform-admin-paths';

describe('isPlatformAdminOnlyPath', () => {
    it('covers the platform status page', () => {
        expect(isPlatformAdminOnlyPath('/status')).toBe(true);
    });

    it('covers the admin console and everything under it', () => {
        expect(isPlatformAdminOnlyPath('/admin')).toBe(true);
        expect(isPlatformAdminOnlyPath('/admin/system-health')).toBe(true);
        expect(isPlatformAdminOnlyPath('/admin/tenants/abc')).toBe(true);
    });

    it('leaves tenant paths alone', () => {
        expect(isPlatformAdminOnlyPath('/dashboard')).toBe(false);
        expect(isPlatformAdminOnlyPath('/settings')).toBe(false);
        // A tenant route that merely starts with the same characters.
        expect(isPlatformAdminOnlyPath('/administration')).toBe(false);
        expect(isPlatformAdminOnlyPath('/status-board')).toBe(false);
    });
});

describe('platformRoleOf', () => {
    it('reads the role the server sends', () => {
        expect(platformRoleOf({ platform_role: 'SUPPORT_ENGINEER', is_platform_admin: false })).toBe('SUPPORT_ENGINEER');
        expect(platformRoleOf({ platform_role: 'ADMIN', is_platform_admin: true })).toBe('ADMIN');
    });

    it('falls back to the admin flag for an older cached session', () => {
        expect(platformRoleOf({ is_platform_admin: true })).toBe('ADMIN');
        expect(platformRoleOf({ is_platform_admin: false })).toBeNull();
        expect(platformRoleOf(null)).toBeNull();
    });
});

describe('canViewPlatformPath', () => {
    it('leaves non-console paths alone', () => {
        expect(canViewPlatformPath(null, '/dashboard')).toBe(true);
    });

    it('keeps the status page for full admins', () => {
        expect(canViewPlatformPath('ADMIN', '/status')).toBe(true);
        expect(canViewPlatformPath('SUPPORT_ENGINEER', '/status')).toBe(false);
    });

    it('opens only the support pages of the console to a support engineer', () => {
        expect(canViewPlatformPath('SUPPORT_ENGINEER', '/admin/support')).toBe(true);
        expect(canViewPlatformPath('SUPPORT_ENGINEER', '/admin/tenants/t-1')).toBe(true);
        expect(canViewPlatformPath('SUPPORT_ENGINEER', '/admin/users')).toBe(false);
        expect(canViewPlatformPath('SUPPORT_ENGINEER', '/admin/platform-settings/payments')).toBe(false);
        expect(canViewPlatformPath(null, '/admin')).toBe(false);
    });
});
