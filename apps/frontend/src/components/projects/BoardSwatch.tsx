'use client';

import {
    backgroundSwatchClass,
    boardBackgroundKind,
    boardCanvasStyle,
    type BoardBackground,
    type BoardBackgroundColor,
} from './board-background';

/**
 * A board's background, at the size of a bullet.
 *
 * Decorative, so it is hidden from assistive technology: the board's name sits
 * next to it and carries the meaning. Colour alone never distinguishes two rows
 * here — it only makes a row easier to find again for someone who can see it.
 *
 * A plain board still gets a swatch rather than a gap, so the names stay
 * aligned down the column.
 */
export default function BoardSwatch({ board }: Readonly<{ board: BoardBackground }>) {
    const kind = boardBackgroundKind(board);
    const painted =
        kind === 'color'
            ? backgroundSwatchClass(board.background_color as BoardBackgroundColor)
            : kind === 'image'
              ? 'bg-cover bg-center'
              : 'bg-gray-200';

    return (
        <span
            aria-hidden
            data-testid="board-swatch"
            className={`h-4 w-4 shrink-0 rounded ${painted}`}
            style={boardCanvasStyle(board)}
        />
    );
}
