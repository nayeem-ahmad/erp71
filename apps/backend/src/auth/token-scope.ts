/**
 * Which surface a JWT was minted for.
 *
 * Owner/staff and storefront customers are the same `User` row and were, until
 * this was introduced, handed byte-identical tokens: a token issued by
 * `POST /storefront/:slug/auth/login` was a fully valid ERP token. The scope
 * claim keeps the two apart so each guard can reject the other's tokens.
 *
 * The careers portal is the third such surface and the reason the scope matters
 * most: an applicant is a `User` with no `TenantUser` row anywhere, so nothing
 * about the row itself says "this login is not staff". The scope does.
 */
export const AUTH_SCOPE_APP = 'app' as const;
export const AUTH_SCOPE_STOREFRONT = 'storefront' as const;
export const AUTH_SCOPE_APPLICANT = 'applicant' as const;

export type AuthScope =
    | typeof AUTH_SCOPE_APP
    | typeof AUTH_SCOPE_STOREFRONT
    | typeof AUTH_SCOPE_APPLICANT;

/**
 * Tokens signed before the scope claim existed carry no `scope`. They were all
 * ERP tokens minted through `AuthService`, so treat the absence as `app` rather
 * than logging every open session out on deploy.
 */
export function resolveAuthScope(rawScope: unknown): AuthScope {
    if (rawScope === AUTH_SCOPE_STOREFRONT) return AUTH_SCOPE_STOREFRONT;
    if (rawScope === AUTH_SCOPE_APPLICANT) return AUTH_SCOPE_APPLICANT;
    return AUTH_SCOPE_APP;
}

export function isStorefrontScope(scope: unknown): boolean {
    return resolveAuthScope(scope) === AUTH_SCOPE_STOREFRONT;
}

export function isApplicantScope(scope: unknown): boolean {
    return resolveAuthScope(scope) === AUTH_SCOPE_APPLICANT;
}
