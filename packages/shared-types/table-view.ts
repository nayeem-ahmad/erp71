/**
 * How a person likes their lists drawn: row spacing, text size, striping and
 * whether wide tables squeeze into the screen instead of scrolling sideways.
 *
 * Lives here, not in the frontend, because a preference profile carries these
 * same settings and the API normalises them against the same option lists the
 * list renders. The Tailwind class tables that turn a setting into pixels stay
 * in the frontend (`components/table/view-settings.ts`).
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
