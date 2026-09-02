import { isPlatformAdminOnlyPath } from './platform-admin-paths';

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
