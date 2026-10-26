/**
 * How a person likes their lists drawn: row spacing, text size, striping (and
 * its colour) and whether wide tables squeeze into the screen instead of
 * scrolling sideways.
 *
 * Lives here, not in the frontend, because a preference profile carries these
 * same settings and the API normalises them against the same option lists the
 * list renders. The Tailwind class tables that turn a setting into pixels stay
 * in the frontend (`components/table/view-settings.ts`).
 */

export type TableDensity = 'compact' | 'standard' | 'cozy';
export type TableFontSize = 'sm' | 'md' | 'lg' | 'xl';
/** The stripe swatches a list offers; the frontend maps each to its fill. */
export type TableStripePreset = 'gray' | 'blue' | 'green' | 'amber' | 'slate';
/** A preset swatch, or a custom colour as `#rrggbb`. */
export type TableStripeColor = TableStripePreset | `#${string}`;

export interface TableViewSettings {
  density: TableDensity;
  fontSize: TableFontSize;
  striped: boolean;
  stripeColor: TableStripeColor;
  fitWidth: boolean;
}

export const DEFAULT_TABLE_VIEW: TableViewSettings = {
  density: 'standard',
  fontSize: 'md',
  striped: true,
  stripeColor: 'gray',
  fitWidth: false,
};

export const TABLE_DENSITIES: readonly TableDensity[] = ['compact', 'standard', 'cozy'];
export const TABLE_FONT_SIZES: readonly TableFontSize[] = ['sm', 'md', 'lg', 'xl'];
export const TABLE_STRIPE_PRESETS: readonly TableStripePreset[] = ['gray', 'blue', 'green', 'amber', 'slate'];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isTableStripeColor(value: unknown): value is TableStripeColor {
  return (
    typeof value === 'string' &&
    (TABLE_STRIPE_PRESETS.includes(value as TableStripePreset) || HEX_COLOR.test(value))
  );
}

/** Drops anything a stored blob holds that is not a valid setting. */
export function sanitizeTableView(raw: unknown): Partial<TableViewSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const clean: Partial<TableViewSettings> = {};
  if (TABLE_DENSITIES.includes(value.density as TableDensity)) clean.density = value.density as TableDensity;
  if (TABLE_FONT_SIZES.includes(value.fontSize as TableFontSize)) clean.fontSize = value.fontSize as TableFontSize;
  if (typeof value.striped === 'boolean') clean.striped = value.striped;
  if (isTableStripeColor(value.stripeColor)) clean.stripeColor = value.stripeColor.toLowerCase() as TableStripeColor;
  if (typeof value.fitWidth === 'boolean') clean.fitWidth = value.fitWidth;
  return clean;
}
