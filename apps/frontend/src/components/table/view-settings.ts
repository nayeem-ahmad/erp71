/**
 * How a person likes their lists drawn: row spacing, text size, striping and
 * whether wide tables squeeze into the screen instead of scrolling sideways.
 *
 * One set applies to every list; a list can carry its own override (see
 * `useTableViewSettings`). Kept apart from the per-table column preferences in
 * `data-table/useTablePreferences`, which describe *what* a list shows rather
 * than *how* it is drawn.
 */

export type TableDensity = 'compact' | 'standard' | 'cozy';
export type TableFontSize = 'sm' | 'md' | 'lg' | 'xl';

export interface TableViewSettings {
    density: TableDensity;
    fontSize: TableFontSize;
    striped: boolean;
    fitWidth: boolean;
}

export const DEFAULT_TABLE_VIEW: TableViewSettings = {
    density: 'standard',
    fontSize: 'md',
    striped: true,
    fitWidth: false,
};

export const TABLE_DENSITIES: readonly TableDensity[] = ['compact', 'standard', 'cozy'];
export const TABLE_FONT_SIZES: readonly TableFontSize[] = ['sm', 'md', 'lg', 'xl'];

/** Body text in px. The header row sits one pixel under it. */
export const TABLE_FONT_PX: Record<TableFontSize, number> = {
    sm: 12,
    md: 13,
    lg: 14,
    xl: 15,
};

/**
 * Cell padding per density. Compact also holds every row to one line — see the
 * `.dt-single-line` rules in `globals.css`, which flatten stacked cell content
 * (a date over its time) onto that line and cut it off with an ellipsis.
 */
export const TABLE_DENSITY_CLASSES: Record<TableDensity, { headerCell: string; bodyCell: string }> = {
    compact: { headerCell: 'px-2 py-1', bodyCell: 'px-2 py-0.5' },
    standard: { headerCell: 'px-2 py-1.5', bodyCell: 'px-2 py-1.5' },
    cozy: { headerCell: 'px-3 py-2.5', bodyCell: 'px-3 py-2.5' },
};

/** Drops anything a stored blob holds that is not a valid setting. */
export function sanitizeTableView(raw: unknown): Partial<TableViewSettings> {
    if (!raw || typeof raw !== 'object') return {};
    const value = raw as Record<string, unknown>;
    const clean: Partial<TableViewSettings> = {};
    if (TABLE_DENSITIES.includes(value.density as TableDensity)) clean.density = value.density as TableDensity;
    if (TABLE_FONT_SIZES.includes(value.fontSize as TableFontSize)) clean.fontSize = value.fontSize as TableFontSize;
    if (typeof value.striped === 'boolean') clean.striped = value.striped;
    if (typeof value.fitWidth === 'boolean') clean.fitWidth = value.fitWidth;
    return clean;
}
