/**
 * Shared print types.
 *
 * `PrintHeaderConfig` is the tenant-designed letterhead — header band, optional
 * footer band, and the imagery and typography of both — that every printed
 * document renders. It is stored as a versioned JSON blob so new options can be
 * added without a migration — always bump `version` and handle the older shape
 * in `resolveHeaderConfig` when that happens.
 */

export type PaperSize = 'A4' | 'A5' | 'Letter' | 'Thermal80' | 'Thermal58';

export const PAPER_SIZES: PaperSize[] = ['A4', 'A5', 'Letter', 'Thermal80', 'Thermal58'];

/**
 * The `@page` margin each paper size prints with, in mm.
 *
 * Shared with the renderer because a bleeding footer cancels this margin out
 * with a negative one — the two have to be the same number or the band lands
 * short of the paper edge.
 */
export const PAGE_MARGIN_MM: Record<PaperSize, number> = {
    A4: 15,
    A5: 10,
    Letter: 15,
    Thermal80: 4,
    Thermal58: 3,
};

/**
 * Menu label for a paper size. The two thermal rolls are the only ones whose
 * name does not say how wide they are, and picking the wrong roll is the one
 * mistake that wastes a whole print.
 */
export function paperSizeLabel(size: PaperSize): string {
    if (size === 'Thermal80') return '80mm Thermal';
    if (size === 'Thermal58') return '58mm Thermal';
    return size;
}

/** Document families a header template can be assigned to. */
export type PrintDocType =
    | 'SALES_INVOICE'
    | 'POS_RECEIPT'
    | 'QUOTE'
    | 'PROFORMA_INVOICE'
    | 'VOUCHER'
    | 'MONEY_RECEIPT'
    | 'SALES_ORDER'
    | 'SALES_RETURN'
    | 'DELIVERY_CHALLAN'
    | 'PURCHASE_ORDER'
    | 'PURCHASE_RETURN'
    | 'LIST_REPORT'
    | 'PAYSLIP';

export type HeaderLayout =
    | 'logo-left'      // logo + company on the left, document block on the right
    | 'logo-right'     // mirrored
    | 'logo-center'    // logo beside a centred company block
    | 'logo-above'     // logo stacked above a centred company block
    | 'text-only';     // no logo

export type PrintFontFamily = 'sans' | 'serif' | 'mono' | 'bengali';

/**
 * Where the document title block sits, independently of the logo layout.
 *
 * `beside-*` is the original behaviour — the title shares the header band with
 * the brand. `above-*` and `below-*` give it a row of its own spanning the full
 * width, which is what a centred "TAX INVOICE" banner needs.
 */
export type TitlePosition =
    | 'beside-left'
    | 'beside-right'
    | 'above-left'
    | 'above-center'
    | 'above-right'
    | 'below-left'
    | 'below-center'
    | 'below-right';

export const TITLE_POSITIONS: TitlePosition[] = [
    'above-left',
    'above-center',
    'above-right',
    'beside-left',
    'beside-right',
    'below-left',
    'below-center',
    'below-right',
];

export interface HeaderLine {
    /** Free text; may contain {{tokens}} — see TOKENS in header.ts. */
    text: string;
    fontSizePt?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    align?: 'left' | 'center' | 'right';
    color?: string;
    /** Overrides the template font for this line only. */
    fontFamily?: PrintFontFamily;
    letterSpacingPx?: number;
}

/**
 * An image placed on the letterhead beyond the logo — a signature, a seal, a
 * certification badge, a bank QR code.
 *
 * Images render in a row in the order they are listed, so a footer carrying a
 * signature and a company seal prints them side by side.
 */
export interface TemplateImage {
    /** https:// or data:image/ — anything else is dropped by the renderer. */
    url?: string;
    heightMm: number;
    align?: 'left' | 'center' | 'right';
    /** Printed under the image, e.g. "Authorised Signature". */
    caption?: string;
    /** Narrow rolls rarely render extra imagery legibly — opt in per image. */
    showOnThermal?: boolean;
    /**
     * Stretch the image across the whole band rather than sizing it to its
     * height. The band is the printable width by default and the full paper
     * width when the footer bleeds — see `PrintFooterConfig.bleed`.
     *
     * `heightMm` stops constraining a full-width image: the width wins and the
     * height follows the aspect ratio, which is what a letterhead strip needs.
     */
    fullWidth?: boolean;
}

/**
 * The tenant-designed footer band. Same building blocks as the header — text
 * lines with tokens, plus images — so a tenant can print bank details, terms
 * and a signature block without the app hardcoding any of it.
 */
export interface PrintFooterConfig {
    show: boolean;
    lines: HeaderLine[];
    images: TemplateImage[];
    /** Divider drawn above the footer. */
    rule: {
        show: boolean;
        thicknessPx: number;
        color: string;
    };
    spacingMm: number;
    /**
     * Repeat at the bottom of every printed page rather than printing once
     * after the content. Uses a `<tfoot>` for the same reason the header uses
     * `<thead>` — see print-window.ts.
     */
    repeatOnEveryPage: boolean;
    /**
     * Push the footer down to the bottom edge of the page instead of letting it
     * sit directly under the content. A short invoice then prints its footer on
     * the page bottom rather than halfway up, which is what a pre-printed
     * letterhead looks like.
     *
     * Only meaningful with `repeatOnEveryPage`, which puts the footer in a
     * `<tfoot>` — the one element a browser will pin to the bottom of every
     * printed page. Off it, the footer flows after the content as before.
     */
    pinToPageBottom?: boolean;
    /**
     * Let the footer escape the `@page` margin and run to the true paper edge.
     *
     * Most office printers clip a few millimetres of the sheet, so a bleeding
     * band loses its outermost edge — a full-width strip survives that, a
     * bordered box does not.
     */
    bleed?: boolean;
}

export interface PrintHeaderConfig {
    /**
     * 1 — header only. 2 — adds `images` and `footer`. 3 — adds logo width,
     * title placement, and footer pinning/bleed.
     *
     * Every shape is readable: fields added in a later version are filled from
     * `DEFAULT_HEADER_CONFIG` by `resolveHeaderConfig`, so a stored v1 config
     * renders unchanged and only gains a footer once a tenant designs one.
     * The v3 additions all default to the behaviour v2 already printed.
     */
    version: 1 | 2 | 3;
    layout: HeaderLayout;
    logo: {
        url?: string;
        heightMm: number;
        /**
         * Cap on the logo's printed width. Omitted means uncapped: the logo
         * takes whatever width its aspect ratio asks for at `heightMm`, which
         * is what a wide banner wordmark needs.
         */
        maxWidthMm?: number;
        /**
         * Size the logo by width instead of height — it spans the whole
         * brand column and the height follows the aspect ratio. `heightMm`
         * is then ignored.
         */
        fullWidth?: boolean;
        /** 58mm rolls rarely render a logo legibly — off by default there. */
        showOnThermal: boolean;
    };
    company: {
        show: boolean;
        /** Overrides the company name from the document context when set. */
        nameOverride?: string;
        fontSizePt: number;
        bold: boolean;
        color: string;
    };
    title: {
        show: boolean;
        fontSizePt: number;
        uppercase: boolean;
        letterSpacingPx: number;
        color: string;
        /**
         * Where the title block sits. Absent on stored configs, which predate
         * the control — they keep the layout-derived placement they printed
         * with (see `defaultTitlePosition`).
         */
        position?: TitlePosition;
        /**
         * Fine-tuning nudge from the slot, in mm. Applied as a relative offset,
         * so the title still takes its place in the flow and only its painted
         * position shifts — a tenant cannot push it off the page and lose it.
         */
        offsetXMm?: number;
        offsetYMm?: number;
    };
    lines: HeaderLine[];
    /** Extra header imagery beside the logo — badges, certifications, a QR. */
    images: TemplateImage[];
    rule: {
        show: boolean;
        thicknessPx: number;
        color: string;
    };
    footer: PrintFooterConfig;
    fontFamily: PrintFontFamily;
    baseFontSizePt: number;
    spacingMm: number;
    /** Per-paper-size overrides, merged shallowly over the base config. */
    perPaper?: Partial<Record<PaperSize, DeepPartial<PrintHeaderConfig>>>;
}

export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Values substituted into header {{tokens}} at render time. */
export interface HeaderContext {
    docTitle?: string;
    docNumber?: string;
    docDate?: string;
    companyName?: string;
    storeName?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    vatRegNo?: string;
    tin?: string;
}

/**
 * The footer a tenant gets the first time they switch one on.
 *
 * It reproduces the "Thank you for your business!" line the printers used to
 * hardcode, so enabling the footer starts from what was already printing and
 * is edited from there rather than from a blank band.
 */
export const DEFAULT_FOOTER_CONFIG: PrintFooterConfig = {
    show: false,
    lines: [
        { text: 'Thank you for your business.', fontSizePt: 9, align: 'center', color: '#666666' },
    ],
    images: [],
    rule: { show: true, thicknessPx: 1, color: '#d1d5db' },
    spacingMm: 4,
    repeatOnEveryPage: false,
    pinToPageBottom: false,
    bleed: false,
};

export const DEFAULT_HEADER_CONFIG: PrintHeaderConfig = {
    version: 3,
    layout: 'logo-left',
    logo: { heightMm: 16, showOnThermal: true },
    company: { show: true, fontSizePt: 16, bold: true, color: '#1d4ed8' },
    title: {
        show: true,
        fontSizePt: 20,
        uppercase: true,
        letterSpacingPx: 2,
        color: '#1d4ed8',
        offsetXMm: 0,
        offsetYMm: 0,
    },
    lines: [
        { text: '{{address}}', fontSizePt: 9, color: '#555555' },
        { text: 'Tel: {{phone}}', fontSizePt: 9, color: '#555555' },
    ],
    images: [],
    rule: { show: true, thicknessPx: 2, color: '#1d4ed8' },
    footer: DEFAULT_FOOTER_CONFIG,
    fontFamily: 'sans',
    baseFontSizePt: 10,
    spacingMm: 4,
};

/** Thermal rolls get a centred, monospace, no-frills variant of the header. */
export const DEFAULT_THERMAL_OVERRIDES: DeepPartial<PrintHeaderConfig> = {
    layout: 'logo-above',
    logo: { heightMm: 10 },
    company: { fontSizePt: 12, color: '#000000' },
    title: { fontSizePt: 10, letterSpacingPx: 0, color: '#000000' },
    rule: { thicknessPx: 1, color: '#000000' },
    footer: { rule: { thicknessPx: 1, color: '#000000' }, spacingMm: 2 },
    fontFamily: 'mono',
    baseFontSizePt: 8,
    spacingMm: 2,
};

/**
 * The placement a config prints with when it has no explicit `title.position`.
 *
 * Reproduces exactly where the title sat before the control existed: beside the
 * brand on the two side-by-side layouts, centred under it on the stacked ones.
 * Stored templates therefore keep printing as they did.
 */
export function defaultTitlePosition(layout: HeaderLayout): TitlePosition {
    if (layout === 'logo-right') return 'beside-left';
    if (layout === 'logo-left') return 'beside-right';
    return 'below-center';
}

export function isThermalPaper(paperSize: PaperSize): boolean {
    return paperSize === 'Thermal80' || paperSize === 'Thermal58';
}

export const FONT_STACKS: Record<PrintFontFamily, string> = {
    sans: "Arial, Helvetica, sans-serif",
    serif: "Georgia, 'Times New Roman', Times, serif",
    mono: "'Courier New', Courier, monospace",
    bengali: "'Noto Sans Bengali', 'SolaimanLipi', 'Nikosh', Arial, sans-serif",
};
