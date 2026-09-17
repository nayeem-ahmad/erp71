/**
 * A shop's brand colour, turned into something the public storefront can paint
 * with.
 *
 * `Tenant.brand_primary_color` has existed for as long as the storefront has,
 * and until now reached nothing on it: the public pages were hardcoded
 * `gray-900` and white throughout, so every shop's site looked like every other
 * shop's site. The app chrome is deliberately *not* themed this way — the UI
 * rules pin the signed-in product to one accent — but a shop's own website is
 * the one surface where its colour is the whole point.
 *
 * Two things this has to get right, neither of which a Tailwind class can:
 *
 *  - **The value is untrusted.** It comes from a free-text settings field, and
 *    it is interpolated into inline CSS. Anything that is not a plain hex
 *    colour is dropped rather than escaped, so the storefront falls back to its
 *    default palette instead of carrying a tenant's CSS into its own stylesheet.
 *  - **Text on top has to stay readable.** A shop whose brand is pale yellow
 *    gets black labels on its buttons; one whose brand is navy gets white. The
 *    alternative is a button whose text is invisible on the brand the owner
 *    chose deliberately.
 */

/** The storefront's own default, used whenever a shop has set no colour. */
export const STOREFRONT_DEFAULT_ACCENT = '#111827';

export type StorefrontTheme = {
    /** Hex, always safe to interpolate into CSS. */
    accent: string;
    /** `#ffffff` or `#111827` — whichever stays legible on `accent`. */
    accentForeground: string;
};

/**
 * Accepts `#abc` and `#aabbcc`, case-insensitively, and nothing else. No
 * `rgb()`, no named colours, no `var(--x)`: the field is a colour picker's
 * output in practice, and widening it widens what can be injected.
 */
export function normalizeBrandColor(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value) return null;

    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
    if (short) {
        const [, r, g, b] = short;
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }

    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * WCAG relative luminance. The sRGB gamma curve matters here — a naive
 * `(r+g+b)/3` calls mid-green dark and puts white text on it.
 */
function relativeLuminance(hex: string): number {
    const channels = [1, 3, 5].map((offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Black or white, whichever contrasts better with `hex`.
 *
 * The 0.179 threshold is where contrast against white and against black are
 * equal, so it picks the higher-contrast option at every point rather than
 * guessing at a midpoint.
 */
export function readableForeground(hex: string): string {
    return relativeLuminance(hex) > 0.179 ? '#111827' : '#ffffff';
}

/** The resolved theme for one shop, ready to hand to `storefrontThemeStyle`. */
export function storefrontTheme(brandColor: string | null | undefined): StorefrontTheme {
    const accent = normalizeBrandColor(brandColor) ?? STOREFRONT_DEFAULT_ACCENT;
    return { accent, accentForeground: readableForeground(accent) };
}

/**
 * The theme as inline custom properties, set once on the storefront's root
 * element so everything below can read `var(--sf-accent)`.
 *
 * Custom properties rather than per-element inline styles because the accent is
 * read in a dozen places, including inside pseudo-element-free gradients that
 * cannot take a prop.
 */
export function storefrontThemeStyle(theme: StorefrontTheme): React.CSSProperties {
    return {
        '--sf-accent': theme.accent,
        '--sf-accent-foreground': theme.accentForeground,
    } as React.CSSProperties;
}
