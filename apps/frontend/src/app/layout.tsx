import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';

import './globals.css';
import { siteOrigin } from '../lib/domain-routing';
import { BRAND_FULL_NAME, BRAND_NAME } from '../lib/brand';
import { I18nProvider } from '../lib/i18n';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, getLocaleConfig, resolveLocale } from '../lib/localization/config';

/*
 * Local files, not next/font/google. A Google Fonts CSS hiccup used to throw
 * `Cannot read properties of null (reading '1')` in the google loader and fail
 * both CI Build and the VPS image. Same CSS variables as before.
 */
const inter = localFont({
    src: '../fonts/inter-latin-wght-normal.woff2',
    variable: '--font-inter',
    weight: '100 900',
    declarations: [
        {
            prop: 'unicode-range',
            value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
        },
    ],
});

const notoSansBengali = localFont({
    src: '../fonts/noto-sans-bengali-wght-normal.woff2',
    variable: '--font-bengali',
    weight: '400 700',
    declarations: [
        {
            prop: 'unicode-range',
            value: 'U+0951-0952, U+0964-0965, U+0980-09FE, U+1CD0, U+1CD2, U+1CD5-1CD6, U+1CD8, U+1CE1, U+1CEA, U+1CED, U+1CF2, U+1CF5-1CF7, U+200C-200D, U+20B9, U+25CC, U+A8F1',
        },
    ],
});

/*
 * Arabic script, covering both `ar` and `ur` — Inter has no Arabic glyphs at
 * all, so without this every Urdu and Arabic screen falls through to whatever
 * the OS happens to ship.
 *
 * Naskh rather than Nastaliq, which is a real tradeoff and not an oversight:
 * Urdu readers expect Nastaliq (`Noto Nastaliq Urdu`), but its cascading
 * baseline needs roughly double the line-height, and this UI is deliberately
 * compact (`text-sm`/`text-xs` body, dense tables). Shipping Nastaliq without
 * first re-tuning row heights would break every table in Urdu; shipping Naskh
 * renders correct, readable Urdu in a typeface that is not the preferred one.
 * The Nastaliq pass is tracked as a follow-up and wants a designer looking at
 * real tables, not a font swap.
 */
const notoSansArabic = localFont({
    src: '../fonts/noto-sans-arabic-wght-normal.woff2',
    variable: '--font-arabic',
    weight: '400 700',
    // Preloading made every page — the Bangla and English ones that are nearly
    // all of the traffic — fetch the Arabic files before first paint. Not
    // preloaded, the `@font-face` still loads them the moment Arabic-script
    // text is drawn, which only the `ar` and `ur` interfaces do.
    preload: false,
    declarations: [
        {
            prop: 'unicode-range',
            value: 'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1',
        },
    ],
});

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    themeColor: '#2563eb',
};

const SITE_DESCRIPTION =
    'All-in-one business management platform with sales, inventory, accounting, and integrated BDT payments.';

export const metadata: Metadata = {
    // Without this, og:image resolves against http://localhost:3000 and every
    // shared link points at a card no crawler can fetch. Same origin the
    // sitemap and robots.txt already use.
    metadataBase: new URL(siteOrigin()),
    title: BRAND_FULL_NAME,
    description: SITE_DESCRIPTION,
    // `manifest` is deliberately absent: app/manifest.ts already emits the link
    // tag pointing at /manifest.webmanifest. Naming it here produced a /manifest.json 404.
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: BRAND_NAME,
    },
    // Inherited by every page that doesn't set its own — without this, links
    // shared to Facebook and WhatsApp render with no image at all.
    openGraph: {
        type: 'website',
        siteName: BRAND_NAME,
        title: BRAND_FULL_NAME,
        description: SITE_DESCRIPTION,
    },
    twitter: {
        card: 'summary_large_image',
        title: BRAND_FULL_NAME,
        description: SITE_DESCRIPTION,
    },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    const cookieStore = await cookies();
    const initialLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? DEFAULT_LOCALE);
    const localeInfo = getLocaleConfig(initialLocale);

    /*
     * The font variables belong on `<html>`, not `<body>`.
     *
     * Tailwind's preflight sets `html { font-family: theme('fontFamily.sans') }`,
     * which compiles to `var(--font-inter), var(--font-bengali), var(--font-arabic), ...`.
     * With the `next/font` variable classes on `<body>`, those custom properties
     * are undefined at `<html>`, so the whole declaration is invalid at
     * computed-value time and `font-family` falls back to the browser default —
     * which `<body>` then inherits, since preflight's `body` rule sets only
     * margin and line-height. The intended stack reached exactly those subtrees
     * that happened to carry an explicit `font-sans`; everything else (the
     * storefront, the public quotation view, `/demo`, `/app-entry`, the label
     * sheet, and every dropdown portalled to `document.body`) rendered in the
     * browser's default font. Under `lang="bn"` that default is resolved
     * per-language, so Bangla users saw a system Bengali face applied to Latin
     * text too.
     *
     * `font-sans` on `<body>` is deliberate belt-and-braces: the variables are
     * in scope there either way, so the app keeps its typeface even if the
     * preflight rule is ever lost.
     */
    return (
        <html
            lang={localeInfo.htmlLang}
            dir={localeInfo.dir}
            className={`${inter.variable} ${notoSansBengali.variable} ${notoSansArabic.variable}`}
            suppressHydrationWarning
        >
            <body className="font-sans">
                <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
            </body>
        </html>
    );
}
