/**
 * The vocabulary of storefront pages and menu links, kept as plain constants so
 * the DTO validators, the service and the tests all read from one list.
 *
 * Strings rather than a Prisma enum, matching how `BlogStatus` is handled next
 * door: a status here is a small, slowly changing set, and a text column lets a
 * new value ship without a migration that locks the table.
 */

export const StorefrontPageStatus = {
    DRAFT: 'DRAFT',
    PUBLISHED: 'PUBLISHED',
} as const;
export type StorefrontPageStatus = (typeof StorefrontPageStatus)[keyof typeof StorefrontPageStatus];

export const STOREFRONT_PAGE_STATUSES = Object.values(StorefrontPageStatus);

export const StorefrontMenuLinkType = {
    /** Points at one of the shop's own `StorefrontPage` rows. */
    PAGE: 'PAGE',
    /** Points at a built-in storefront destination — `/`, `/shop`, `/blog`. */
    INTERNAL: 'INTERNAL',
    /** Points at an absolute http(s) URL somewhere else entirely. */
    EXTERNAL: 'EXTERNAL',
} as const;
export type StorefrontMenuLinkType =
    (typeof StorefrontMenuLinkType)[keyof typeof StorefrontMenuLinkType];

export const STOREFRONT_MENU_LINK_TYPES = Object.values(StorefrontMenuLinkType);

/**
 * The storefront paths an INTERNAL link may point at, relative to
 * `/store/<slug>`. An allowlist, not a free-text path: an internal link is
 * rendered without the interstitial an external one gets, so letting an owner
 * type any path would make the menu a way to point that trust at anything the
 * app happens to serve.
 */
export const STOREFRONT_INTERNAL_PATHS = ['/', '/shop', '/blog'] as const;
export type StorefrontInternalPath = (typeof STOREFRONT_INTERNAL_PATHS)[number];

/**
 * Slugs that would collide with a real route under `/store/<slug>/`.
 *
 * Pages live at `/store/<slug>/pages/<page>`, so a page slugged `shop` cannot
 * actually shadow the shop route — but a menu whose "Shop" entry and whose
 * "Shop" page both exist is confusing enough to be worth refusing, and the set
 * costs nothing to keep.
 */
export const RESERVED_PAGE_SLUGS = new Set([
    'shop',
    'blog',
    'auth',
    'cart',
    'checkout',
    'p',
    'pages',
    'api',
]);
