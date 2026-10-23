/**
 * The language a brand-new account starts in: the workspace's own, so a Bangla
 * shop's new cashier does not land in English. `default_locale` is only honoured
 * while the workspace has localization on (TenantsService refuses a non-en
 * default otherwise), so a stale value left behind after switching it off still
 * resolves to `en`.
 */
export function newAccountLocale(tenant: {
    default_locale: string;
    localization_enabled: boolean;
}): string {
    if (!tenant.localization_enabled) return 'en';
    return tenant.default_locale || 'en';
}
