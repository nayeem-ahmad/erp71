/**
 * A paper designed separately from the main letterhead.
 *
 * A template has one main design, which A4 prints. A5, Letter or either
 * thermal roll can be given a design of its own — a full copy kept in
 * `paperDesigns[paper]` and printed in place of the main one (see
 * `resolveHeaderConfig`). Until then the paper prints the main design, and
 * editing it while looking at that paper edits the main design.
 *
 * These are the editor's operations on that shape. They never mutate the
 * config they are given.
 */

import { coerceForThermal, fillHeaderConfig, resolveHeaderConfig } from './header';
import type { DeepPartial, PaperSize, PrintHeaderConfig, TemplateImage } from './types';

/** The papers that can be designed separately. A4 is the main design. */
export const OWN_DESIGN_PAPERS: PaperSize[] = ['A5', 'Letter', 'Thermal80', 'Thermal58'];

export function hasOwnDesign(config: DeepPartial<PrintHeaderConfig> | undefined, paper: PaperSize): boolean {
    return !!config?.paperDesigns?.[paper];
}

/** The papers that print a design of their own. */
export function papersWithOwnDesign(config: DeepPartial<PrintHeaderConfig> | undefined): PaperSize[] {
    return OWN_DESIGN_PAPERS.filter((paper) => hasOwnDesign(config, paper));
}

/**
 * The design the editor shows for a paper: its own, filled from the defaults,
 * or the main one. As stored rather than as printed — a roll's print limits
 * would otherwise be written back into its design on the next edit.
 */
export function designFor(config: PrintHeaderConfig, paper: PaperSize): PrintHeaderConfig {
    return hasOwnDesign(config, paper) ? fillHeaderConfig(config.paperDesigns?.[paper]) : config;
}

/** Writes an edited design back to where `designFor` read it from. */
export function withDesignFor(
    config: PrintHeaderConfig,
    paper: PaperSize,
    design: PrintHeaderConfig,
): PrintHeaderConfig {
    if (!hasOwnDesign(config, paper)) return design;
    return { ...config, paperDesigns: { ...config.paperDesigns, [paper]: design } };
}

/**
 * Gives the paper a design of its own, starting as a copy of what it prints
 * now, so nothing changes on paper until the copy is edited. A deep copy: the
 * two designs share no objects, so an edit to one can never reach the other.
 * Through JSON because the config is stored as JSON — the round trip is exact.
 */
export function startOwnDesign(config: PrintHeaderConfig, paper: PaperSize): PrintHeaderConfig {
    const { paperDesigns: _designs, perPaper: _perPaper, ...current } = resolveHeaderConfig(config, paper);
    const copy: PrintHeaderConfig = JSON.parse(JSON.stringify(current));
    return { ...config, paperDesigns: { ...config.paperDesigns, [paper]: copy } };
}

/**
 * Gives the paper a copy of another paper's design — 58mm a copy of the 80mm
 * one, say. The copy starts at what the paper can carry, shrunk the way a
 * sheet design is shrunk onto a roll, and is edited freely from there.
 */
export function copyDesignFrom(config: PrintHeaderConfig, paper: PaperSize, source: PaperSize): PrintHeaderConfig {
    const printed = optInToRolls(resolveHeaderConfig(config, source));
    const { paperDesigns: _designs, perPaper: _perPaper, ...fitted } = coerceForThermal(printed, paper);
    const copy: PrintHeaderConfig = JSON.parse(JSON.stringify(fitted));
    return { ...config, paperDesigns: { ...config.paperDesigns, [paper]: copy } };
}

/**
 * Marks every image a design prints as one a roll prints too. What the source
 * paper printed comes across whole: a roll's own design prints its imagery
 * whatever the opt-in says, so shrinking the copy must not drop any of it.
 */
function optInToRolls(design: PrintHeaderConfig): PrintHeaderConfig {
    const optIn = (images: TemplateImage[] | undefined) => (images ?? []).map((image) => ({ ...image, showOnThermal: true }));
    return {
        ...design,
        logo: { ...design.logo, showOnThermal: true },
        images: optIn(design.images),
        footer: { ...design.footer, images: optIn(design.footer?.images) },
    };
}

/** Puts the paper back on the main design. Its own design is discarded. */
export function dropOwnDesign(config: PrintHeaderConfig, paper: PaperSize): PrintHeaderConfig {
    const { [paper]: _dropped, ...rest } = config.paperDesigns ?? {};
    const next: PrintHeaderConfig = { ...config, paperDesigns: rest };
    if (!Object.keys(rest).length) delete next.paperDesigns;
    return next;
}
