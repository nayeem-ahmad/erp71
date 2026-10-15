/**
 * Sizes a template prints at on one paper size, over its main design.
 *
 * A tenant designs one letterhead and prints it on several papers. A5 wants
 * the same logo, lines and colours as A4, only smaller — so the editor lets a
 * paper override sizes and nothing else. The content stays in the base config,
 * written once, and each override lives in `perPaper[paper]` where
 * `resolveHeaderConfig` merges it at print time.
 */

import type { DeepPartial, PaperSize, PrintHeaderConfig } from './types';

/**
 * The papers that can carry their own sizes. A4 is the main design; the rolls
 * already size themselves (see `coerceForThermal`).
 */
export const OVERRIDE_PAPERS: PaperSize[] = ['A5', 'Letter'];

export const PAPER_SIZE_FIELDS = [
    'logoHeightMm',
    'companyFontSizePt',
    'titleFontSizePt',
    'lineScalePct',
    'spacingMm',
    'qrSizeMm',
] as const;

export type PaperSizeField = (typeof PAPER_SIZE_FIELDS)[number];

/** Where each field lives in the config — the same place on the base and in `perPaper`. */
const PATHS: Record<PaperSizeField, readonly [string] | readonly [string, string]> = {
    logoHeightMm: ['logo', 'heightMm'],
    companyFontSizePt: ['company', 'fontSizePt'],
    titleFontSizePt: ['title', 'fontSizePt'],
    lineScalePct: ['lineScalePct'],
    spacingMm: ['spacingMm'],
    qrSizeMm: ['qr', 'sizeMm'],
};

/** The range each field accepts — the same as the main design's controls. */
export const PAPER_SIZE_LIMITS: Record<PaperSizeField, { min: number; max: number }> = {
    logoHeightMm: { min: 3, max: 60 },
    companyFontSizePt: { min: 6, max: 48 },
    titleFontSizePt: { min: 6, max: 48 },
    lineScalePct: { min: 50, max: 150 },
    spacingMm: { min: 0, max: 30 },
    qrSizeMm: { min: 10, max: 60 },
};

type Tree = Record<string, unknown>;

function read(tree: unknown, path: readonly string[]): unknown {
    return path.reduce<unknown>(
        (node, key) => (node && typeof node === 'object' ? (node as Tree)[key] : undefined),
        tree,
    );
}

/**
 * A copy of `tree` with `path` set to `value`, or removed when `value` is
 * undefined. A section left empty by a removal is removed too, so clearing the
 * last override leaves no `{ logo: {} }` behind in the stored config.
 */
function write(tree: Tree | undefined, path: readonly string[], value: unknown): Tree | undefined {
    const [key, ...rest] = path;
    const out: Tree = { ...(tree ?? {}) };
    const next = rest.length ? write(out[key] as Tree | undefined, rest, value) : value;
    if (next === undefined) delete out[key];
    else out[key] = next;
    return Object.keys(out).length ? out : undefined;
}

/** The main design's value, which a paper without an override prints. */
export function paperSizeValue(config: PrintHeaderConfig, field: PaperSizeField): number {
    const value = read(config, PATHS[field]);
    if (typeof value === 'number') return value;
    // The two fields a stored config may lack print at these.
    return field === 'lineScalePct' ? 100 : 20;
}

/** The paper's own value, or undefined when it follows the main design. */
export function paperOverride(
    config: DeepPartial<PrintHeaderConfig>,
    paper: PaperSize,
    field: PaperSizeField,
): number | undefined {
    const value = read(config.perPaper?.[paper], PATHS[field]);
    return typeof value === 'number' ? value : undefined;
}

/** Sets the paper's own value; undefined returns it to the main design. */
export function setPaperOverride(
    config: PrintHeaderConfig,
    paper: PaperSize,
    field: PaperSizeField,
    value: number | undefined,
): PrintHeaderConfig {
    const perPaper = write(config.perPaper as Tree | undefined, [paper, ...PATHS[field]], value);
    const next: PrintHeaderConfig = { ...config, perPaper: perPaper as PrintHeaderConfig['perPaper'] };
    if (!perPaper) delete next.perPaper;
    return next;
}

/**
 * Returns the paper to the main design. Only the sizes the editor manages are
 * cleared — anything else stored for the paper was put there some other way,
 * and is not the editor's to delete.
 */
export function clearPaperOverrides(config: PrintHeaderConfig, paper: PaperSize): PrintHeaderConfig {
    return PAPER_SIZE_FIELDS.reduce((next, field) => setPaperOverride(next, paper, field, undefined), config);
}

/** The papers that print at least one size of their own. */
export function papersWithOverrides(config: DeepPartial<PrintHeaderConfig>): PaperSize[] {
    return OVERRIDE_PAPERS.filter((paper) =>
        PAPER_SIZE_FIELDS.some((field) => paperOverride(config, paper, field) !== undefined),
    );
}
