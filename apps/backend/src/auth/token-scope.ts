/**
 * Which surface a JWT was minted for.
 *
 * Owner/staff and storefront customers are the same `User` row and were, until
 * this was introduced, handed byte-identical tokens: a token issued by
 * `POST /storefront/:slug/auth/login` was a fully valid ERP token. The scope
 * claim keeps the two apart so each guard can reject the other's tokens.
 */
export const AUTH_SCOPE_APP = 'app' as const;
export const AUTH_SCOPE_STOREFRONT = 'storefront' as const;

export type AuthScope = typeof AUTH_SCOPE_APP | typeof AUTH_SCOPE_STOREFRONT;

/**
 * Tokens signed before the scope claim existed carry no `scope`. They were all
 * ERP tokens minted through `AuthService`, so treat the absence as `app` rather
 * than logging every open session out on deploy.
 */
export function resolveAuthScope(rawScope: unknown): AuthScope {
    return rawScope === AUTH_SCOPE_STOREFRONT ? AUTH_SCOPE_STOREFRONT : AUTH_SCOPE_APP;
}

export function isStorefrontScope(scope: unknown): boolean {
    return resolveAuthScope(scope) === AUTH_SCOPE_STOREFRONT;
}
