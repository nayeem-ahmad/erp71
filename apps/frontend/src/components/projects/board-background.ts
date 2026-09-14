/**
 * How a board's background is painted.
 *
 * The counterpart to `board-view.ts`, and deliberately the opposite kind of
 * setting: a card size is one reader's preference and lives in `localStorage`,
 * while a background belongs to the board and is stored on it, so everybody
 * who opens the board sees the same thing. That is the whole point of it — a
 * team learns to recognise "the release board" by its colour.
 *
 * Pure on purpose, like `board-view.ts`: the class maps and the "which
 * background is this board wearing" rule are the parts worth testing directly,
 * and none of it needs React.
 */

import {
    BOARD_BACKGROUND_COLORS,
    boardBackgroundKind,
    isBoardBackgroundColor,
    type BoardBackground,
    type BoardBackgroundColor,
    type BoardBackgroundKind,
} from '@erp71/shared-types';
import type { CSSProperties } from 'react';

export {
    BOARD_BACKGROUND_COLORS,
    boardBackgroundKind,
    isBoardBackgroundColor,
    type BoardBackground,
    type BoardBackgroundColor,
    type BoardBackgroundKind,
};

/**
 * Written out as whole class strings, for the same reason `LABEL_CLASS` and
 * `COLUMN_WIDTH_CLASS` are: Tailwind scans source text, so `from-${colour}-500`
 * produces no CSS at all.
 *
 * A gradient rather than a flat fill because this is a large surface — a single
 * saturated block behind a board reads as a rendering error, while the same
 * hue with a little depth reads as a choice. The mid-to-dark range is chosen so
 * the white and gray-50 columns sitting on top keep their edges.
 */
export const BOARD_BACKGROUND_CLASS: Record<BoardBackgroundColor, string> = {
    GRAY: 'bg-gradient-to-br from-gray-500 to-gray-700',
    BLUE: 'bg-gradient-to-br from-blue-500 to-blue-700',
    EMERALD: 'bg-gradient-to-br from-emerald-500 to-emerald-700',
    AMBER: 'bg-gradient-to-br from-amber-500 to-amber-700',
    RED: 'bg-gradient-to-br from-red-500 to-red-700',
    PURPLE: 'bg-gradient-to-br from-purple-500 to-purple-700',
};

/**
 * The swatch in the picker is the background itself, at thumbnail size — the
 * one honest preview of what the button does.
 */
export function backgroundSwatchClass(color: BoardBackgroundColor): string {
    return BOARD_BACKGROUND_CLASS[color] ?? BOARD_BACKGROUND_CLASS.GRAY;
}

/**
 * The classes the board canvas wears.
 *
 * `''` for the default board, so the canvas keeps the page's own surface rather
 * than being painted a colour that only happens to match it — one less thing to
 * keep in step when the page background changes.
 *
 * The padding and rounding come with the colour deliberately: a background is
 * only legible as one if the columns sit *inside* it with a margin, and a
 * plain board has no edge to round.
 */
export function boardCanvasClass(board: BoardBackground | null | undefined): string {
    const kind = boardBackgroundKind(board);
    if (kind === 'default') return '';

    const painted = 'rounded-lg bg-cover bg-center p-2 md:p-3';
    if (kind === 'image') return painted;
    return `${painted} ${BOARD_BACKGROUND_CLASS[board!.background_color as BoardBackgroundColor]}`;
}

/**
 * The uploaded picture, as an inline style.
 *
 * Inline rather than a class because the URL is tenant data — there is no
 * build-time class for it, and an arbitrary-value class would be exactly the
 * `bg-[...]` the UI rules forbid. `undefined` for every other kind, so the
 * attribute is simply absent on a board that has no picture.
 */
export function boardCanvasStyle(board: BoardBackground | null | undefined): CSSProperties | undefined {
    if (boardBackgroundKind(board) !== 'image') return undefined;
    // Quotes and parentheses in a Cloudinary URL would break out of `url()`.
    // They cannot appear in one — Cloudinary encodes them — but the board
    // renders whatever the column holds, and a CSS property is not a place to
    // find out that assumption was wrong.
    return { backgroundImage: `url("${encodeURI(board!.background_image_url!).replace(/"/g, '%22')}")` };
}

/**
 * Whether the columns need to be lifted off the background they sit on.
 *
 * A plain board's columns are gray-50 on white and read fine. The same columns
 * on a photograph lose their edges entirely, so on a painted board they get a
 * shadow — the one thing that separates a light surface from a light background
 * without repainting the column itself.
 */
export function boardColumnLiftClass(board: BoardBackground | null | undefined): string {
    return boardBackgroundKind(board) === 'default' ? '' : 'shadow-md';
}

/**
 * The plate the header sits on once the background runs behind it.
 *
 * The background used to stop below the header, so the title, subtitle and
 * breadcrumb could rely on the page's own white surface. Now that it runs to
 * the top of the page they sit on tenant data, and `PageHeader` paints them
 * `gray-950`/`gray-500` — unreadable on a photograph, and no better on the
 * palette, whose gradients run 500→700 and are dark by design.
 *
 * A translucent white plate rather than light-on-dark text, which is the
 * cheaper of the two by a distance: every existing gray token keeps its
 * meaning, and `PageHeader`, `PageBreadcrumb` and the filter `Select`s stay
 * untouched — none of them has to learn what background it is standing on.
 * `backdrop-blur-sm` keeps a busy photograph from reading through the plate as
 * texture behind the title.
 */
export function boardHeaderPlateClass(board: BoardBackground | null | undefined): string {
    if (boardBackgroundKind(board) === 'default') return '';
    return 'rounded-lg bg-white/85 p-3 shadow-sm backdrop-blur-sm';
}
