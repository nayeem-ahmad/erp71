/**
 * Renders the tenant-designed document header to plain HTML + CSS.
 *
 * Pure and DOM-free on purpose: the print windows build an HTML string, the
 * React invoice pages inject the same markup, and the settings preview renders
 * it into an iframe — all from this one renderer, so they can never drift.
 *
 * Nothing here trusts its input: every value that reaches the output is either
 * HTML-escaped or run through a sanitiser (`cssColor`, `num`).
 */

import {
    DEFAULT_HEADER_CONFIG,
    FONT_STACKS,
    isThermalPaper,
    type DeepPartial,
    type HeaderContext,
    type HeaderLine,
    type PaperSize,
    type PrintHeaderConfig,
} from './types';

/* ------------------------------------------------------------------ */
/*  Escaping & sanitising                                              */
/* ------------------------------------------------------------------ */

export function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/** Only literal hex colours reach the stylesheet — never raw user text. */
function cssColor(value: string | undefined, fallback: string): string {
    return value && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
        ? value.trim()
        : fallback;
}

function num(value: number | undefined, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

/** Data and https URLs only — blocks `javascript:` and friends in the logo slot. */
function safeImageUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    return /^(https?:\/\/|data:image\/)/i.test(trimmed) ? trimmed : undefined;
}

/* ------------------------------------------------------------------ */
/*  Tokens                                                             */
/* ------------------------------------------------------------------ */

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** Tokens usable in header lines, shown as a picker in the settings editor. */
export const HEADER_TOKENS = [
    'company_name',
    'store_name',
    'address',
    'phone',
    'email',
    'website',
    'vat_reg_no',
    'tin',
    'doc_title',
    'doc_number',
    'date',
] as const;

function tokenValues(ctx: HeaderContext): Record<string, string> {
    return {
        company_name: ctx.companyName ?? '',
        store_name: ctx.storeName ?? '',
        address: ctx.address ?? '',
        phone: ctx.phone ?? '',
        email: ctx.email ?? '',
        website: ctx.website ?? '',
        vat_reg_no: ctx.vatRegNo ?? '',
        tin: ctx.tin ?? '',
        doc_title: ctx.docTitle ?? '',
        doc_number: ctx.docNumber ?? '',
        date: ctx.docDate ?? '',
    };
}

/**
 * Substitutes {{tokens}} and reports whether the line still carries content.
 *
 * A line made only of tokens that all resolve empty is dropped, so a tenant
 * without a phone number does not print a bare "Tel:".
 */
export function applyTokens(
    template: string,
    ctx: HeaderContext,
): { text: string; empty: boolean } {
    const values = tokenValues(ctx);
    let tokenCount = 0;
    let filledCount = 0;

    const text = template.replace(TOKEN_RE, (_match, rawName: string) => {
        const value = values[rawName.toLowerCase()] ?? '';
        tokenCount += 1;
        if (value.trim()) filledCount += 1;
        return value;
    });

    const empty = tokenCount > 0 ? filledCount === 0 : !text.trim();
    return { text: text.trim(), empty };
}

/* ------------------------------------------------------------------ */
/*  Config resolution                                                  */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep<T>(base: T, patch: DeepPartial<T> | undefined): T {
    if (!patch) return base;
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
        if (value === undefined) continue;
        const current = out[key];
        out[key] = isPlainObject(value) && isPlainObject(current)
            ? mergeDeep(current, value as DeepPartial<typeof current>)
            : value;
    }
    return out as T;
}

/** Thermal rolls are too narrow for side-by-side layouts and large type. */
function coerceForThermal(config: PrintHeaderConfig, paperSize: PaperSize): PrintHeaderConfig {
    if (!isThermalPaper(paperSize)) return config;
    const narrow = paperSize === 'Thermal58';

    return {
        ...config,
        layout: config.layout === 'text-only' ? 'text-only' : 'logo-above',
        logo: {
            ...config.logo,
            heightMm: Math.min(config.logo.heightMm, narrow ? 10 : 14),
            url: config.logo.showOnThermal ? config.logo.url : undefined,
        },
        company: { ...config.company, fontSizePt: Math.min(config.company.fontSizePt, narrow ? 12 : 14) },
        title: {
            ...config.title,
            fontSizePt: Math.min(config.title.fontSizePt, narrow ? 10 : 12),
            letterSpacingPx: 0,
        },
        baseFontSizePt: Math.min(config.baseFontSizePt, narrow ? 8 : 9),
        spacingMm: Math.min(config.spacingMm, 2),
    };
}

/**
 * Produces the effective config: defaults → stored config → per-paper
 * overrides → thermal coercion.
 */
export function resolveHeaderConfig(
    config: DeepPartial<PrintHeaderConfig> | undefined,
    paperSize: PaperSize,
): PrintHeaderConfig {
    const merged = mergeDeep(DEFAULT_HEADER_CONFIG, config);
    const withPaper = mergeDeep(merged, merged.perPaper?.[paperSize]);
    return coerceForThermal(withPaper, paperSize);
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                          */
/* ------------------------------------------------------------------ */

function lineStyle(line: HeaderLine, config: PrintHeaderConfig): string {
    const parts = [
        `font-size:${num(line.fontSizePt, config.baseFontSizePt, 5, 48)}pt`,
        `color:${cssColor(line.color, '#555555')}`,
    ];
    if (line.bold) parts.push('font-weight:bold');
    if (line.italic) parts.push('font-style:italic');
    if (line.align) parts.push(`text-align:${line.align}`);
    return parts.join(';');
}

function renderLines(config: PrintHeaderConfig, ctx: HeaderContext): string {
    return config.lines
        .map((line) => {
            const { text, empty } = applyTokens(line.text ?? '', ctx);
            if (empty) return '';
            return `<div class="p71-hd-line" style="${lineStyle(line, config)}">${escapeHtml(text)}</div>`;
        })
        .filter(Boolean)
        .join('');
}

function renderLogo(config: PrintHeaderConfig): string {
    const url = safeImageUrl(config.logo.url);
    if (!url || config.layout === 'text-only') return '';
    const height = num(config.logo.heightMm, 16, 3, 60);
    return `<img class="p71-hd-logo" src="${escapeHtml(url)}" alt="" style="height:${height}mm">`;
}

function renderDocBlock(config: PrintHeaderConfig, ctx: HeaderContext): string {
    if (!config.title.show) return '';
    const title = ctx.docTitle?.trim();
    const meta: string[] = [];
    if (ctx.docNumber?.trim()) meta.push(`# ${ctx.docNumber.trim()}`);
    if (ctx.docDate?.trim()) meta.push(ctx.docDate.trim());
    if (!title && meta.length === 0) return '';

    return `<div class="p71-hd-doc">
        ${title ? `<div class="p71-hd-title">${escapeHtml(title)}</div>` : ''}
        ${meta.map((entry) => `<div class="p71-hd-meta">${escapeHtml(entry)}</div>`).join('')}
    </div>`;
}

/**
 * Builds the header markup. Returns an empty string when the resolved config
 * would render nothing, so callers can drop the wrapper entirely.
 */
export function renderHeaderHtml(
    config: DeepPartial<PrintHeaderConfig> | undefined,
    ctx: HeaderContext,
    paperSize: PaperSize,
): string {
    const resolved = resolveHeaderConfig(config, paperSize);

    const logoHtml = renderLogo(resolved);
    const nameText = (resolved.company.nameOverride?.trim() || ctx.companyName?.trim()) ?? '';
    const nameHtml = resolved.company.show && nameText
        ? `<div class="p71-hd-name">${escapeHtml(nameText)}</div>`
        : '';
    const linesHtml = renderLines(resolved, ctx);
    const docHtml = renderDocBlock(resolved, ctx);

    if (!logoHtml && !nameHtml && !linesHtml && !docHtml) return '';

    const brandHtml = `<div class="p71-hd-brand">
        ${logoHtml}
        ${nameHtml || linesHtml ? `<div class="p71-hd-text">${nameHtml}${linesHtml}</div>` : ''}
    </div>`;

    return `<div class="p71-hd p71-hd--${resolved.layout}">${brandHtml}${docHtml}</div>`;
}

/**
 * The stylesheet for `renderHeaderHtml`. Kept separate so a document can place
 * it in `<head>` alongside its own rules.
 */
export function headerCss(
    config: DeepPartial<PrintHeaderConfig> | undefined,
    paperSize: PaperSize,
): string {
    const resolved = resolveHeaderConfig(config, paperSize);
    const thermal = isThermalPaper(paperSize);
    const spacing = num(resolved.spacingMm, 4, 0, 30);
    const ruleColor = cssColor(resolved.rule.color, '#1d4ed8');
    const ruleWidth = num(resolved.rule.thicknessPx, 2, 0, 8);
    const centred = resolved.layout === 'logo-above' || resolved.layout === 'logo-center';

    return `
    .p71-hd {
        display: flex;
        gap: ${Math.max(spacing, 3)}mm;
        align-items: flex-start;
        justify-content: space-between;
        font-family: ${FONT_STACKS[resolved.fontFamily]};
        padding-bottom: ${spacing}mm;
        margin-bottom: ${spacing}mm;
        ${resolved.rule.show ? `border-bottom: ${ruleWidth}px solid ${ruleColor};` : ''}
    }
    .p71-hd--logo-right { flex-direction: row-reverse; }
    .p71-hd--logo-above,
    .p71-hd--logo-center,
    .p71-hd--text-only { flex-direction: column; align-items: ${centred || thermal ? 'center' : 'flex-start'}; }
    .p71-hd--logo-above .p71-hd-brand { flex-direction: column; align-items: center; }

    .p71-hd-brand { display: flex; gap: 3mm; align-items: center; }
    .p71-hd-logo { display: block; width: auto; max-width: 60mm; object-fit: contain; }
    .p71-hd-text { ${centred || thermal ? 'text-align: center;' : ''} }

    .p71-hd-name {
        font-size: ${num(resolved.company.fontSizePt, 16, 6, 48)}pt;
        font-weight: ${resolved.company.bold ? 'bold' : 'normal'};
        color: ${cssColor(resolved.company.color, '#1d4ed8')};
        line-height: 1.2;
    }
    .p71-hd-line { line-height: 1.35; }

    .p71-hd-doc { ${centred || thermal ? 'text-align: center;' : 'text-align: right;'} ${thermal ? 'margin-top: 1mm;' : ''} }
    .p71-hd-title {
        font-size: ${num(resolved.title.fontSizePt, 20, 6, 48)}pt;
        font-weight: bold;
        color: ${cssColor(resolved.title.color, '#1d4ed8')};
        letter-spacing: ${num(resolved.title.letterSpacingPx, 0, 0, 10)}px;
        ${resolved.title.uppercase ? 'text-transform: uppercase;' : ''}
        line-height: 1.2;
    }
    .p71-hd-meta {
        font-size: ${num(resolved.baseFontSizePt, 10, 5, 24)}pt;
        color: #555555;
        margin-top: 0.5mm;
    }`;
}

/**
 * Convenience for callers that only have the tenant's branding fields — the
 * shape used everywhere until a stored template is available.
 */
export function headerConfigFromBranding(branding: {
    logoUrl?: string | null;
    primaryColor?: string | null;
}): DeepPartial<PrintHeaderConfig> {
    const color = cssColor(branding.primaryColor ?? undefined, DEFAULT_HEADER_CONFIG.company.color);
    return {
        logo: { url: branding.logoUrl ?? undefined },
        company: { color },
        title: { color },
        rule: { color },
    };
}
