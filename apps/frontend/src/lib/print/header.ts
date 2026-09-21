/**
 * Renders the tenant-designed letterhead — header band and footer band — to
 * plain HTML + CSS.
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
    defaultTitlePosition,
    isThermalPaper,
    PAGE_MARGIN_MM,
    TITLE_POSITIONS,
    type DeepPartial,
    type HeaderContext,
    type HeaderLine,
    type PaperSize,
    type PrintFontFamily,
    type PrintHeaderConfig,
    type TemplateImage,
    type TitlePosition,
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

/** Only known font keys reach the stylesheet — never a raw string. */
function fontStack(value: PrintFontFamily | undefined, fallback: PrintFontFamily): string {
    return FONT_STACKS[value as PrintFontFamily] ?? FONT_STACKS[fallback];
}

/** Data and https URLs only — blocks `javascript:` and friends in image slots. */
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
            // A roll is one narrow column: the title can only sit above or
            // below the brand, centred, and a nudge would push it off the roll.
            position: titlePosition(config).startsWith('above') ? 'above-center' : 'below-center',
            offsetXMm: 0,
            offsetYMm: 0,
        },
        baseFontSizePt: Math.min(config.baseFontSizePt, narrow ? 8 : 9),
        spacingMm: Math.min(config.spacingMm, 2),
        footer: {
            ...config.footer,
            spacingMm: Math.min(config.footer?.spacingMm ?? 4, 2),
            // A roll has no page bottom to pin a footer to; it prints once.
            repeatOnEveryPage: false,
            pinToPageBottom: false,
            // A roll is cut to length and already edge to edge — bleeding a
            // band past the 3-4mm margin only risks the thermal head's edge.
            bleed: false,
        },
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

const ALIGNMENTS = ['left', 'center', 'right'] as const;
type Alignment = (typeof ALIGNMENTS)[number];

/** Only the three known keywords reach `text-align` / `justify-content`. */
function alignment(value: string | undefined, fallback: Alignment): Alignment {
    return (ALIGNMENTS as readonly string[]).includes(value ?? '')
        ? (value as Alignment)
        : fallback;
}

/**
 * The title's slot: the stored one when it is a value we know, otherwise the
 * placement the layout implied before the control existed.
 */
export function titlePosition(config: PrintHeaderConfig): TitlePosition {
    const stored = config.title?.position;
    return (TITLE_POSITIONS as readonly string[]).includes(stored ?? '')
        ? (stored as TitlePosition)
        : defaultTitlePosition(config.layout);
}

/** Splits a slot into its row ('above' | 'beside' | 'below') and alignment. */
function titleSlot(position: TitlePosition): { row: string; align: Alignment } {
    const [row, align] = position.split('-');
    return { row, align: alignment(align, 'right') };
}

function lineStyle(line: HeaderLine, config: PrintHeaderConfig): string {
    const parts = [
        `font-size:${num(line.fontSizePt, config.baseFontSizePt, 5, 48)}pt`,
        `color:${cssColor(line.color, '#555555')}`,
    ];
    if (line.bold) parts.push('font-weight:bold');
    if (line.italic) parts.push('font-style:italic');
    if (line.underline) parts.push('text-decoration:underline');
    if (line.align) parts.push(`text-align:${alignment(line.align, 'left')}`);
    if (line.fontFamily) parts.push(`font-family:${fontStack(line.fontFamily, config.fontFamily)}`);
    if (line.letterSpacingPx) parts.push(`letter-spacing:${num(line.letterSpacingPx, 0, 0, 10)}px`);
    return parts.join(';');
}

function renderLines(
    lines: HeaderLine[],
    config: PrintHeaderConfig,
    ctx: HeaderContext,
    className: string,
): string {
    return (lines ?? [])
        .map((line) => {
            const { text, empty } = applyTokens(line.text ?? '', ctx);
            if (empty) return '';
            return `<div class="${className}" style="${lineStyle(line, config)}">${escapeHtml(text)}</div>`;
        })
        .filter(Boolean)
        .join('');
}

/**
 * Renders images into left/centre/right buckets so a footer can carry a
 * signature on one side and a company seal on the other.
 *
 * An entry with a caption but no usable image still renders — that is the
 * blank signature line a tenant leaves for someone to sign by hand.
 */
function usableImages(
    images: TemplateImage[] | undefined,
    paperSize: PaperSize,
): TemplateImage[] {
    const thermal = isThermalPaper(paperSize);
    return (images ?? []).filter((image) => {
        if (thermal && !image.showOnThermal) return false;
        return !!safeImageUrl(image.url) || !!image.caption?.trim();
    });
}

/** A single image cell — the picture (or a blank slot) plus its caption. */
function renderImageCell(image: TemplateImage): string {
    const url = safeImageUrl(image.url);
    const caption = image.caption?.trim();
    const captionHtml = caption ? `<div class="p71-img-cap">${escapeHtml(caption)}</div>` : '';

    // Full width: the width is the constraint and the height follows the
    // aspect ratio, so a letterhead strip spans the band instead of being
    // boxed into its height.
    if (image.fullWidth) {
        const slot = url
            ? `<img class="p71-img-el p71-img-el--full" src="${escapeHtml(url)}" alt="">`
            : `<div class="p71-img-el p71-img-el--full" style="height:${num(image.heightMm, 14, 3, 60)}mm"></div>`;
        return `<div class="p71-img p71-img--full">${slot}${captionHtml}</div>`;
    }

    const height = num(image.heightMm, 14, 3, 60);
    const slot = url
        ? `<img class="p71-img-el" src="${escapeHtml(url)}" alt="" style="height:${height}mm">`
        : `<div class="p71-img-el" style="height:${height}mm"></div>`;
    return `<div class="p71-img">${slot}${captionHtml}</div>`;
}

function renderImages(
    images: TemplateImage[] | undefined,
    paperSize: PaperSize,
    prefix: string,
): string {
    const usable = usableImages(images, paperSize);
    if (usable.length === 0) return '';

    // A full-width image cannot share a row — it gets one of its own, in the
    // order it was added relative to the rest.
    const full = usable.filter((image) => image.fullWidth);
    const inline = usable.filter((image) => !image.fullWidth);
    const fullHtml = full.map((image) => `<div class="${prefix}-images ${prefix}-images--full">${renderImageCell(image)}</div>`).join('');
    if (inline.length === 0) return fullHtml;

    const bucket = (align: Alignment): string => {
        const entries = inline.filter((image) => alignment(image.align, 'left') === align);
        if (entries.length === 0) return `<div class="p71-img-col p71-img-col--${align}"></div>`;

        const cells = entries.map(renderImageCell).join('');
        return `<div class="p71-img-col p71-img-col--${align}">${cells}</div>`;
    };

    return `${fullHtml}<div class="${prefix}-images">${ALIGNMENTS.map(bucket).join('')}</div>`;
}

function renderLogo(config: PrintHeaderConfig): string {
    const url = safeImageUrl(config.logo.url);
    if (!url || config.layout === 'text-only') return '';

    // A full-width logo is sized by width and lets its height follow the aspect
    // ratio — the only way a banner wordmark fills the band it was drawn for.
    if (config.logo.fullWidth) {
        return `<img class="p71-hd-logo p71-hd-logo--full" src="${escapeHtml(url)}" alt="">`;
    }

    const height = num(config.logo.heightMm, 16, 3, 60);
    // No cap set means uncapped: the logo takes the width its ratio asks for.
    const maxWidth = typeof config.logo.maxWidthMm === 'number'
        ? `;max-width:${num(config.logo.maxWidthMm, 60, 5, 250)}mm`
        : '';
    return `<img class="p71-hd-logo" src="${escapeHtml(url)}" alt="" style="height:${height}mm${maxWidth}">`;
}

function renderDocBlock(config: PrintHeaderConfig, ctx: HeaderContext): string {
    if (!config.title.show) return '';
    const title = ctx.docTitle?.trim();
    const meta: string[] = [];
    if (ctx.docNumber?.trim()) meta.push(`# ${ctx.docNumber.trim()}`);
    if (ctx.docDate?.trim()) meta.push(ctx.docDate.trim());
    if (!title && meta.length === 0) return '';

    const { row, align } = titleSlot(titlePosition(config));
    // Relative, so the block keeps its place in the flow and only its painted
    // position moves — a large nudge cannot make the title disappear.
    const offsetX = num(config.title.offsetXMm, 0, -100, 100);
    const offsetY = num(config.title.offsetYMm, 0, -100, 100);
    const offset = offsetX || offsetY
        ? ` style="left:${offsetX}mm;top:${offsetY}mm"`
        : '';

    return `<div class="p71-hd-doc p71-hd-doc--${row} p71-hd-doc--${align}"${offset}>
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
    const linesHtml = renderLines(resolved.lines, resolved, ctx, 'p71-hd-line');
    const docHtml = renderDocBlock(resolved, ctx);
    const imagesHtml = renderImages(resolved.images, paperSize, 'p71-hd');

    if (!logoHtml && !nameHtml && !linesHtml && !docHtml && !imagesHtml) return '';

    const brandHtml = `<div class="p71-hd-brand">
        ${logoHtml}
        ${nameHtml || linesHtml ? `<div class="p71-hd-text">${nameHtml}${linesHtml}</div>` : ''}
    </div>`;

    // `beside` keeps the title in the band, sharing the row with the brand.
    // `above`/`below` lift it out into a full-width row of its own, which is
    // what a centred banner title needs — inside the band it would only ever be
    // as wide as the space the brand left it.
    const { row } = titleSlot(titlePosition(resolved));
    const inBand = row === 'beside';

    const bandHtml = `<div class="p71-hd p71-hd--${resolved.layout}">${brandHtml}${inBand ? docHtml : ''}</div>`;

    let rowsHtml = bandHtml;
    if (row === 'above') rowsHtml = `${docHtml}${bandHtml}`;
    else if (row === 'below') rowsHtml = `${bandHtml}${docHtml}`;

    // The image strip sits under the band so it spans the full width rather
    // than competing with the document block for the space beside it.
    if (imagesHtml) return `<div class="p71-hd-wrap">${rowsHtml}${imagesHtml}</div>`;
    // A title on its own row needs a wrapper to carry the divider that the band
    // would otherwise draw above it.
    return inBand ? rowsHtml : `<div class="p71-hd-wrap">${rowsHtml}</div>`;
}

/**
 * Builds the footer markup, or an empty string when the tenant has not
 * designed one — callers then keep whatever footer they already print.
 */
export function renderFooterHtml(
    config: DeepPartial<PrintHeaderConfig> | undefined,
    ctx: HeaderContext,
    paperSize: PaperSize,
): string {
    const resolved = resolveHeaderConfig(config, paperSize);
    const footer = resolved.footer;
    if (!footer?.show) return '';

    const linesHtml = renderLines(footer.lines, resolved, ctx, 'p71-ft-line');
    const imagesHtml = renderImages(footer.images, paperSize, 'p71-ft');
    if (!linesHtml && !imagesHtml) return '';

    // A bleeding footer that is pinned to the page bottom runs off the bottom
    // edge too; one that flows after the content keeps the bottom margin, or
    // it would collide with whatever follows.
    const bleedBottom = footer.bleed && footer.pinToPageBottom
        ? ' p71-ft--bleed-bottom'
        : '';

    // Images above the text: a signature block belongs directly under the
    // content it signs off, with the address strip closing the page.
    return `<div class="p71-ft${bleedBottom}">${imagesHtml}${linesHtml}</div>`;
}

/** Whether a tenant footer would render anything for this config. */
export function hasFooter(
    config: DeepPartial<PrintHeaderConfig> | undefined,
    ctx: HeaderContext,
    paperSize: PaperSize,
): boolean {
    return renderFooterHtml(config, ctx, paperSize) !== '';
}

/** Whether the footer should repeat at the bottom of every page. */
export function footerRepeats(
    config: DeepPartial<PrintHeaderConfig> | undefined,
    paperSize: PaperSize,
): boolean {
    return !!resolveHeaderConfig(config, paperSize).footer?.repeatOnEveryPage;
}

/**
 * Whether the footer runs past the page margin to the paper edge.
 *
 * The print window drops its centred max-width when this is on — a band cannot
 * reach the paper edge from inside a column narrower than the page.
 */
export function footerBleeds(
    config: DeepPartial<PrintHeaderConfig> | undefined,
    paperSize: PaperSize,
): boolean {
    return !!resolveHeaderConfig(config, paperSize).footer?.bleed;
}

/**
 * Whether the footer should sit on the page's bottom edge rather than directly
 * under the content.
 *
 * Independent of `repeatOnEveryPage`. Both put the footer in a `<tfoot>`, but
 * they answer different questions — "on every page or only the last?" versus
 * "at the page bottom or right under the content?" — and a short invoice whose
 * footer floats in the middle of the sheet is the usual reason to want this.
 */
export function footerPinsToBottom(
    config: DeepPartial<PrintHeaderConfig> | undefined,
    paperSize: PaperSize,
): boolean {
    return !!resolveHeaderConfig(config, paperSize).footer?.pinToPageBottom;
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

    // The divider belongs to whichever element is outermost: the wrapper when
    // there is one, the band itself otherwise. Emitted once either way, so
    // switching the divider off leaves no border declaration behind.
    const hasImages = usableImages(resolved.images, paperSize).length > 0;
    const titleOutsideBand = titleSlot(titlePosition(resolved)).row !== 'beside';
    const wrapped = hasImages || titleOutsideBand;
    const divider = resolved.rule.show ? `border-bottom: ${ruleWidth}px solid ${ruleColor};` : '';

    return `
    .p71-hd {
        display: flex;
        gap: ${Math.max(spacing, 3)}mm;
        align-items: flex-start;
        justify-content: space-between;
        font-family: ${FONT_STACKS[resolved.fontFamily]};
        padding-bottom: ${wrapped ? 0 : spacing}mm;
        margin-bottom: ${wrapped ? Math.max(spacing - 1, 1) : spacing}mm;
        ${wrapped ? '' : divider}
    }
    .p71-hd--logo-right { flex-direction: row-reverse; }
    .p71-hd--logo-above,
    .p71-hd--logo-center,
    .p71-hd--text-only { flex-direction: column; align-items: ${centred || thermal ? 'center' : 'flex-start'}; }
    .p71-hd--logo-above .p71-hd-brand { flex-direction: column; align-items: center; }

    .p71-hd-brand { display: flex; gap: 3mm; align-items: center; min-width: 0; }
    /* No max-width here: a cap is written inline only when the tenant sets one,
       so a wide wordmark prints at whatever width its height asks for. */
    .p71-hd-logo { display: block; width: auto; max-width: 100%; object-fit: contain; }
    /* Sized by width instead: the height follows the aspect ratio. */
    .p71-hd-logo--full { width: 100%; height: auto; max-width: 100%; }
    .p71-hd--logo-above .p71-hd-brand,
    .p71-hd--logo-center .p71-hd-brand,
    .p71-hd--text-only .p71-hd-brand { width: 100%; }
    .p71-hd-text { ${centred || thermal ? 'text-align: center;' : ''} min-width: 0; }

    .p71-hd-name {
        font-size: ${num(resolved.company.fontSizePt, 16, 6, 48)}pt;
        font-weight: ${resolved.company.bold ? 'bold' : 'normal'};
        color: ${cssColor(resolved.company.color, '#1d4ed8')};
        line-height: 1.2;
    }
    .p71-hd-line { line-height: 1.35; }

    /* Alignment comes from the title's own slot, not from the logo layout. */
    .p71-hd-doc { position: relative; ${thermal ? 'margin-top: 1mm;' : ''} }
    .p71-hd-doc--left { text-align: left; }
    .p71-hd-doc--center { text-align: center; }
    .p71-hd-doc--right { text-align: right; }
    /* Out of the band it owns a full-width row, so its alignment has room to
       mean something. In the band it only takes the space the brand leaves. */
    .p71-hd-doc--above, .p71-hd-doc--below { width: 100%; }
    .p71-hd-doc--above { margin-bottom: ${Math.max(spacing - 1, 1)}mm; }
    .p71-hd-doc--below { margin-top: ${Math.max(spacing - 1, 1)}mm; }
    .p71-hd-doc--beside { flex: 0 1 auto; }
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
    }

    ${wrapped ? `
    /* The header band plus whatever rows sit outside it — an image strip, a
       title on its own row, or both. */
    .p71-hd-wrap {
        padding-bottom: ${spacing}mm;
        margin-bottom: ${spacing}mm;
        ${divider}
    }` : ''}

    ${imageCss(thermal)}
    ${footerCssBlock(resolved, paperSize)}`;
}

/**
 * Image strips, shared by the header and the footer.
 *
 * Three buckets rather than one row so a signature on the left and a seal on
 * the right land where a tenant expects, whatever order they were added in.
 */
function imageCss(thermal: boolean): string {
    return `
    .p71-hd-images, .p71-ft-images {
        display: flex;
        align-items: flex-end;
        gap: 4mm;
        ${thermal ? 'flex-direction: column;' : ''}
    }
    .p71-img-col {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 4mm;
    }
    .p71-img-col--left { justify-content: flex-start; }
    .p71-img-col--center { justify-content: center; }
    .p71-img-col--right { justify-content: flex-end; }
    .p71-img-col:empty { ${thermal ? 'display: none;' : ''} }
    .p71-img { text-align: center; }
    img.p71-img-el { display: block; width: auto; max-width: 100%; object-fit: contain; }

    /* A full-width image owns its row and is sized by width, not height. */
    .p71-hd-images--full, .p71-ft-images--full { display: block; }
    .p71-img--full { width: 100%; }
    .p71-img--full img.p71-img-el--full,
    .p71-img--full .p71-img-el--full { width: 100%; max-width: 100%; height: auto; }
    .p71-img-cap {
        border-top: 1px solid #999999;
        margin-top: 1mm;
        padding-top: 1mm;
        font-size: 8pt;
        color: #555555;
        white-space: nowrap;
    }`;
}

/**
 * The declarations that make a footer band run past the page margin, written
 * against whichever selector the surrounding media query needs.
 *
 * Shared so the printed page and the on-screen preview sheet bleed by exactly
 * the same rules rather than two hand-kept copies that can drift apart.
 */
function bleedRules(scope: string, margin: number): string {
    return `${scope} {
            margin-left: -${margin}mm;
            margin-right: -${margin}mm;
            max-width: none;
        }
        /* The band reaches the paper edge, but its text should not sit in the
           margin — only a full-width image is meant to run right to the edge. */
        ${scope} .p71-ft-line { padding-left: ${margin}mm; padding-right: ${margin}mm; }
        ${scope} .p71-ft-images { padding-left: ${margin}mm; padding-right: ${margin}mm; }
        ${scope} .p71-ft-images--full { padding-left: 0; padding-right: 0; }
        ${scope}--bleed-bottom { margin-bottom: -${margin}mm; }`;
}

/** Footer band rules — only emitted when the tenant designed a footer. */
function footerCssBlock(resolved: PrintHeaderConfig, paperSize: PaperSize): string {
    const footer = resolved.footer;
    if (!footer?.show) return '';

    const thermal = isThermalPaper(paperSize);
    const spacing = num(footer.spacingMm, 4, 0, 30);
    const ruleWidth = num(footer.rule?.thicknessPx, 1, 0, 8);
    const ruleColor = cssColor(footer.rule?.color, '#d1d5db');

    // Bleeding cancels the `@page` margin with an equal negative one, so the
    // band runs to the true paper edge. The bottom margin is cancelled too —
    // a footer pinned to the page bottom should touch it, not stop short.
    const margin = PAGE_MARGIN_MM[paperSize];
    const bleed = !!footer.bleed;

    return `
    .p71-ft {
        font-family: ${fontStack(resolved.fontFamily, 'sans')};
        padding-top: ${spacing}mm;
        margin-top: ${spacing}mm;
        ${footer.rule?.show ? `border-top: ${ruleWidth}px solid ${ruleColor};` : ''}
        ${thermal ? 'text-align: center;' : ''}
    }
    ${bleed ? `
    /* Bleeding cancels a page margin with an equal negative one. That needs a
       real margin to cancel, which exists on paper (@page) and inside the
       preview's paper-shaped sheet (its padding) — but nowhere else on screen,
       where these rules would just push the band off the viewport and let the
       browser crop both its edges.

       Both media therefore get the same declarations, so the preview and the
       printed page agree. The .p71-pv-sheet selector is the preview sheet in
       print-window.ts; keep the two in step. */
    @media print {
        ${bleedRules('.p71-ft', margin)}
    }
    @media screen {
        ${bleedRules('.p71-pv-sheet .p71-ft', margin)}
    }` : ''}
    .p71-ft-line { line-height: 1.35; }
    .p71-ft-images + .p71-ft-line { margin-top: ${Math.max(spacing - 1, 1)}mm; }`;
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
