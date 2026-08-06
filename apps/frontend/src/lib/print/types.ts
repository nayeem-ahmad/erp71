/**
 * Shared print types.
 *
 * `PrintHeaderConfig` is the tenant-designed header that every printed document
 * renders. It is stored as a versioned JSON blob so new options can be added
 * without a migration — always bump `version` and handle the older shape in
 * `resolveHeaderConfig` when that happens.
 */

export type PaperSize = 'A4' | 'A5' | 'Letter' | 'Thermal80' | 'Thermal58';

export const PAPER_SIZES: PaperSize[] = ['A4', 'A5', 'Letter', 'Thermal80', 'Thermal58'];

/** Document families a header template can be assigned to. */
export type PrintDocType =
    | 'SALES_INVOICE'
    | 'POS_RECEIPT'
    | 'QUOTE'
    | 'VOUCHER'
    | 'MONEY_RECEIPT'
    | 'SALES_ORDER'
    | 'SALES_RETURN'
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

export interface HeaderLine {
    /** Free text; may contain {{tokens}} — see TOKENS in header.ts. */
    text: string;
    fontSizePt?: number;
    bold?: boolean;
    italic?: boolean;
    align?: 'left' | 'center' | 'right';
    color?: string;
}

export interface PrintHeaderConfig {
    version: 1;
    layout: HeaderLayout;
    logo: {
        url?: string;
        heightMm: number;
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
    };
    lines: HeaderLine[];
    rule: {
        show: boolean;
        thicknessPx: number;
        color: string;
    };
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

export const DEFAULT_HEADER_CONFIG: PrintHeaderConfig = {
    version: 1,
    layout: 'logo-left',
    logo: { heightMm: 16, showOnThermal: true },
    company: { show: true, fontSizePt: 16, bold: true, color: '#1d4ed8' },
    title: { show: true, fontSizePt: 20, uppercase: true, letterSpacingPx: 2, color: '#1d4ed8' },
    lines: [
        { text: '{{address}}', fontSizePt: 9, color: '#555555' },
        { text: 'Tel: {{phone}}', fontSizePt: 9, color: '#555555' },
    ],
    rule: { show: true, thicknessPx: 2, color: '#1d4ed8' },
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
    fontFamily: 'mono',
    baseFontSizePt: 8,
    spacingMm: 2,
};

export function isThermalPaper(paperSize: PaperSize): boolean {
    return paperSize === 'Thermal80' || paperSize === 'Thermal58';
}

export const FONT_STACKS: Record<PrintFontFamily, string> = {
    sans: "Arial, Helvetica, sans-serif",
    serif: "Georgia, 'Times New Roman', Times, serif",
    mono: "'Courier New', Courier, monospace",
    bengali: "'Noto Sans Bengali', 'SolaimanLipi', 'Nikosh', Arial, sans-serif",
};
