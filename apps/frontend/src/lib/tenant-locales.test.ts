import {
    clampLocaleToTenant,
    getTenantEnabledLocales,
    shouldShowLanguageSwitcher,
} from './tenant-locales';

describe('tenant-locales', () => {
    it('defaults to English only', () => {
        expect(getTenantEnabledLocales({ localization_enabled: false })).toEqual(['en']);
        expect(shouldShowLanguageSwitcher({ localization_enabled: false })).toBe(false);
    });

    it('exposes English and secondary locale when enabled', () => {
        const tenant = { localization_enabled: true, secondary_locale: 'bn' };
        expect(getTenantEnabledLocales(tenant)).toEqual(['en', 'bn']);
        expect(shouldShowLanguageSwitcher(tenant)).toBe(true);
    });

    it('clamps disallowed locales back to English', () => {
        const tenant = { localization_enabled: false };
        expect(clampLocaleToTenant('bn', tenant)).toBe('en');
    });

    it('keeps allowed secondary locale', () => {
        const tenant = { localization_enabled: true, secondary_locale: 'ms' };
        expect(clampLocaleToTenant('ms', tenant)).toBe('ms');
    });
});