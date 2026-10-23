/**
 * How a person likes their lists drawn: row spacing, text size, striping and
 * whether wide tables squeeze into the screen instead of scrolling sideways.
 *
 * One set applies to every list; a list can carry its own override (see
 * `useTableViewSettings`). The settings and their option lists live in
 * `@erp71/shared-types`, because a preference profile carries them too; this
 * file keeps the Tailwind classes that draw them. Kept apart from the
 * per-table column preferences in `data-table/useTablePreferences`, which
 * describe *what* a list shows rather than *how* it is drawn.
 */

import type { TableDensity, TableFontSize } from '@erp71/shared-types';

export {
    DEFAULT_TABLE_VIEW,
    TABLE_DENSITIES,
    TABLE_FONT_SIZES,
    sanitizeTableView,
} from '@erp71/shared-types';
export type { TableDensity, TableFontSize, TableViewSettings } from '@erp71/shared-types';

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

/**
 * Row fills. The stripe is a visible step (gray-100 at 70%, not the gray-50
 * that disappears on a laptop panel), the hover wash is blue with striping on
 * or off, and a ticked row sits a shade deeper than hover so the two can be
 * told apart. `hover:` follows `even:` in Tailwind's variant order, so the
 * wash replaces the stripe under the pointer; `selected` carries `!` because
 * it must win over both.
 */
export const TABLE_ROW_CLASSES = {
    striped: 'odd:bg-white even:bg-gray-100/70 hover:bg-blue-50 transition-colors',
    plain: 'bg-white hover:bg-blue-50 transition-colors',
    selected: '!bg-blue-100/80',
} as const;
