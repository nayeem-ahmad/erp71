/**
 * What a project board's canvas can be painted with.
 *
 * A board background is two things in one setting: a colour picked from a fixed
 * palette, or an image the workspace uploaded. It is a property of the *board*,
 * not of the browser reading it — unlike the card size and column width in
 * `board-view.ts`, which are one person's eyesight preference. Everyone who
 * opens the board sees the same background, because the point of it is that a
 * team recognises "the release board" by its colour at a glance.
 *
 * The key list lives here, shared, for the same reason the password policy
 * does: the API rejects a colour that is not on it and the board page maps the
 * same keys to Tailwind classes, and two copies of a list like this drift the
 * first time one side gains a colour.
 *
 * The keys deliberately repeat `ProjectLabel`'s palette rather than opening a
 * new set of hues. These are surfaces carrying tenant data, not UI accents, so
 * the one-accent rule does not apply — the same exemption `LABEL_CLASS` already
 * takes — but there is still no reason for a board to introduce a colour the
 * app does not otherwise use.
 */

export const BOARD_BACKGROUND_COLORS = [
  'GRAY',
  'BLUE',
  'EMERALD',
  'AMBER',
  'RED',
  'PURPLE',
] as const;

export type BoardBackgroundColor = (typeof BOARD_BACKGROUND_COLORS)[number];

export function isBoardBackgroundColor(value: unknown): value is BoardBackgroundColor {
  return typeof value === 'string' && (BOARD_BACKGROUND_COLORS as readonly string[]).includes(value);
}

/** The background columns of `Board`, as the API hands them back. */
export interface BoardBackground {
  background_color?: string | null;
  background_image_url?: string | null;
}

export type BoardBackgroundKind = 'default' | 'color' | 'image';

/**
 * Which of the two a board is actually wearing.
 *
 * An image wins over a colour when both columns are somehow set — a board has
 * one background, and the upload is the more deliberate of the two acts. The
 * API keeps the columns mutually exclusive, so this only decides what a row
 * written before that rule (or by hand) renders as, rather than papering over a
 * state the product supports.
 *
 * A colour that is no longer in the palette reads as `default` rather than
 * throwing: a board must still open after a colour is retired from the list.
 */
export function boardBackgroundKind(board: BoardBackground | null | undefined): BoardBackgroundKind {
  if (!board) return 'default';
  if (board.background_image_url) return 'image';
  return isBoardBackgroundColor(board.background_color) ? 'color' : 'default';
}
