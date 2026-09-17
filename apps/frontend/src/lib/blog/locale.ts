/**
 * Language handling for the public blog.
 *
 * The platform's locale registry (`@erp71/shared-types/locales`) lists more
 * languages than the blog publishes in, and the backend will happily serve any
 * of them — `pickTranslation` falls back to English for a locale with no
 * translation row. That fallback is the problem rather than the safety net: it
 * means `?lang=ms` renders an English page under a URL that looks like a Malay
 * one, which is exactly the duplicate content a crawler penalises. So the blog
 * narrows the set to the two it actually writes in, and anything else resolves
 * to English under the clean URL.
 *
 * The strings here are the blog's own chrome, kept local rather than pushed
 * into `lib/localization/messages`. Those catalogs serve the signed-in app and
 * are loaded through a client-side provider; these pages are server components
 * whose whole point is to render into the initial HTML for a crawler. Ten
 * strings do not justify pulling that machinery onto a marketing page.
 */

export const BLOG_LOCALES = ['en', 'bn'] as const;

export type BlogLocale = (typeof BLOG_LOCALES)[number];

export const DEFAULT_BLOG_LOCALE: BlogLocale = 'en';

/**
 * The reader's language, from `?lang=`.
 *
 * Total by construction: every value that is not a language the blog publishes
 * — junk, an unpublished platform locale, or nothing at all — is English.
 */
export function resolveBlogLocale(value: string | undefined | null): BlogLocale {
    return (BLOG_LOCALES as readonly string[]).includes(value ?? '')
        ? (value as BlogLocale)
        : DEFAULT_BLOG_LOCALE;
}

/**
 * A blog URL carrying the reader's language.
 *
 * English is the bare URL rather than `?lang=en`, so the canonical form of a
 * page is the one without a param and the two languages cannot both claim it.
 */
export function blogHref(path: string, locale: BlogLocale): string {
    if (locale === DEFAULT_BLOG_LOCALE) return path;
    return `${path}${path.includes('?') ? '&' : '?'}lang=${locale}`;
}

/** Bengali digits, for the counts that appear inside a Bangla sentence. */
function bnDigits(value: number): string {
    return String(value).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
}

type BlogCatalog = {
    blogTitle: string;
    blogTagline: string;
    allPosts: string;
    categories: string;
    latestPosts: string;
    morePosts: string;
    rssFeed: string;
    backToBlog: string;
    backToAllPosts: string;
    noPosts: string;
    noPostsInCategory: string;
    notAvailableTitle: string;
    notAvailableBody: string;
    newer: string;
    older: string;
    by: string;
    updated: string;
    language: string;
    readingTime: (minutes: number) => string;
    pageOf: (page: number, total: number) => string;
};

const CATALOGS: Record<BlogLocale, BlogCatalog> = {
    en: {
        blogTitle: 'The ERP71 blog',
        blogTagline: 'Practical writing for shop owners — stock, cash, staff and the software in between.',
        allPosts: 'All posts',
        categories: 'Categories',
        latestPosts: 'Latest posts',
        morePosts: 'More posts',
        rssFeed: 'RSS feed →',
        backToBlog: '← Back to the blog',
        backToAllPosts: '← All posts',
        noPosts: 'No posts yet. Check back soon.',
        noPostsInCategory: 'No posts in this category yet.',
        notAvailableTitle: "This post isn't available",
        notAvailableBody: 'It may have been removed or the link may be out of date.',
        newer: '← Newer',
        older: 'Older →',
        by: 'By',
        updated: 'Updated',
        language: 'Language',
        readingTime: (minutes) => `${minutes} min read`,
        pageOf: (page, total) => `Page ${page} of ${total}`,
    },
    bn: {
        blogTitle: 'ইআরপি৭১ ব্লগ',
        blogTagline: 'দোকান মালিকদের জন্য কাজে লাগার লেখা — স্টক, নগদ, কর্মী এবং এর মাঝের সফটওয়্যার।',
        allPosts: 'সব লেখা',
        categories: 'বিভাগ',
        latestPosts: 'সাম্প্রতিক লেখা',
        morePosts: 'আরও লেখা',
        rssFeed: 'আরএসএস ফিড →',
        backToBlog: '← ব্লগে ফিরে যান',
        backToAllPosts: '← সব লেখা',
        noPosts: 'এখনও কোনো লেখা নেই। শীঘ্রই আবার দেখুন।',
        noPostsInCategory: 'এই বিভাগে এখনও কোনো লেখা নেই।',
        notAvailableTitle: 'এই লেখাটি পাওয়া যাচ্ছে না',
        notAvailableBody: 'এটি সরিয়ে ফেলা হয়ে থাকতে পারে, অথবা লিংকটি পুরনো হয়ে গেছে।',
        newer: '← নতুন',
        older: 'পুরনো →',
        by: 'লিখেছেন',
        updated: 'হালনাগাদ',
        language: 'ভাষা',
        readingTime: (minutes) => `${bnDigits(minutes)} মিনিটের পড়া`,
        pageOf: (page, total) => `পৃষ্ঠা ${bnDigits(page)} / ${bnDigits(total)}`,
    },
};

/** The blog's own chrome strings in the reader's language. */
export function blogStrings(locale: BlogLocale): BlogCatalog {
    return CATALOGS[locale];
}
