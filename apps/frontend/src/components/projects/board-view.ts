/**
 * How a board looks, as a per-viewer preference.
 *
 * A board is read very differently by different people: a lead scanning forty
 * cards for what is late wants them small and stripped down; someone working a
 * single lane wants the description marker, the checklist count and the
 * assignee in front of them. One fixed card layout serves one of those two and
 * annoys the other, so the layout is a setting rather than a decision.
 *
 * Kept in `localStorage`, not `sessionStorage` — the opposite of
 * `useRememberedFilters`. A filter is a view of what you are doing right now; a
 * card size is a preference about eyesight and screen, and re-picking it every
 * morning would be the tax that hook exists to avoid. Same reasoning as
 * `useTablePreferences`, which stores column widths the same way.
 *
 * One entry for every board rather than one per board id: "how I like boards to
 * look" does not change between two boards of the same workspace, and a
 * per-board entry would mean re-choosing on every new board.
 *
 * Pure on purpose — no React here — so the merge rules and the class maps can
 * be tested directly. The hook that owns the state is `use-board-view.ts`.
 */

export type BoardDensity = 'comfortable' | 'compact';
export type BoardColumnWidth = 'narrow' | 'standard' | 'wide';
/** Whether a column is tinted by the category its statuses belong to. */
export type BoardColumnTint = 'none' | 'category';
/** Whether the board's overflowing height is the page's to scroll, or each column's. */
export type BoardScroll = 'page' | 'column';
/** What the board's rows are, when it has any — see `board-lanes.ts`. */
export type BoardSwimlanes = 'none' | 'assignee' | 'story';

/** The optional parts of a card, each one hideable. The title is not on the list. */
export type BoardCardField = 'cover' | 'labels' | 'project' | 'badges' | 'details' | 'assignee';

export const CARD_FIELDS: BoardCardField[] = [
    'cover',
    'labels',
    'project',
    'badges',
    'details',
    'assignee',
];

export interface BoardView {
    density: BoardDensity;
    columnWidth: BoardColumnWidth;
    columnTint: BoardColumnTint;
    /** Where the board scrolls when it is taller than the window — see `SCROLL`. */
    scroll: BoardScroll;
    /**
     * Rows across the columns, one per person or per story. A way of reading
     * the board rather than a property of it, so it is kept here with the other
     * per-viewer settings: a lead grouping by assignee for a standup should not
     * regroup the board under the developer reading it by story.
     */
    swimlanes: BoardSwimlanes;
    /** Entrance and drag motion. Independent of `prefers-reduced-motion`, which wins regardless. */
    animate: boolean;
    fields: Record<BoardCardField, boolean>;
}

export const DEFAULT_BOARD_VIEW: BoardView = {
    density: 'comfortable',
    columnWidth: 'standard',
    columnTint: 'category',
    scroll: 'page',
    swimlanes: 'none',
    animate: true,
    fields: {
        cover: true,
        labels: true,
        project: true,
        badges: true,
        details: true,
        assignee: true,
    },
};

export const BOARD_VIEW_STORAGE_KEY = 'board-view';

const DENSITIES: BoardDensity[] = ['comfortable', 'compact'];
const WIDTHS: BoardColumnWidth[] = ['narrow', 'standard', 'wide'];
const TINTS: BoardColumnTint[] = ['none', 'category'];
const SCROLLS: BoardScroll[] = ['page', 'column'];
const SWIMLANES: BoardSwimlanes[] = ['none', 'assignee', 'story'];

function pick<T extends string>(allowed: T[], value: unknown, fallback: T): T {
    return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Merged key by key over the defaults, so an option added in a later release
 * starts at its default instead of invalidating what is already stored, and a
 * hand-edited or stale entry cannot put an unknown value into a class lookup.
 */
export function mergeBoardView(stored: unknown): BoardView {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return DEFAULT_BOARD_VIEW;
    const raw = stored as Partial<Record<keyof BoardView, unknown>>;
    const fields = { ...DEFAULT_BOARD_VIEW.fields };

    if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
        const storedFields = raw.fields as Record<string, unknown>;
        for (const field of CARD_FIELDS) {
            if (typeof storedFields[field] === 'boolean') fields[field] = storedFields[field] as boolean;
        }
    }

    return {
        density: pick(DENSITIES, raw.density, DEFAULT_BOARD_VIEW.density),
        columnWidth: pick(WIDTHS, raw.columnWidth, DEFAULT_BOARD_VIEW.columnWidth),
        columnTint: pick(TINTS, raw.columnTint, DEFAULT_BOARD_VIEW.columnTint),
        scroll: pick(SCROLLS, raw.scroll, DEFAULT_BOARD_VIEW.scroll),
        swimlanes: pick(SWIMLANES, raw.swimlanes, DEFAULT_BOARD_VIEW.swimlanes),
        animate: typeof raw.animate === 'boolean' ? raw.animate : DEFAULT_BOARD_VIEW.animate,
        fields,
    };
}

export function isDefaultBoardView(view: BoardView): boolean {
    return (
        view.density === DEFAULT_BOARD_VIEW.density &&
        view.columnWidth === DEFAULT_BOARD_VIEW.columnWidth &&
        view.columnTint === DEFAULT_BOARD_VIEW.columnTint &&
        view.scroll === DEFAULT_BOARD_VIEW.scroll &&
        view.swimlanes === DEFAULT_BOARD_VIEW.swimlanes &&
        view.animate === DEFAULT_BOARD_VIEW.animate &&
        CARD_FIELDS.every((field) => view.fields[field] === DEFAULT_BOARD_VIEW.fields[field])
    );
}

export function readStoredBoardView(): BoardView {
    try {
        const raw = localStorage.getItem(BOARD_VIEW_STORAGE_KEY);
        return raw ? mergeBoardView(JSON.parse(raw)) : DEFAULT_BOARD_VIEW;
    } catch {
        // Storage blocked or the entry is not JSON. The defaults are a board.
        return DEFAULT_BOARD_VIEW;
    }
}

export function writeStoredBoardView(view: BoardView): void {
    try {
        localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify(view));
    } catch {
        // Not remembering the choice is better than failing to make it.
    }
}

// ── Class maps ──────────────────────────────────────────────────────────────
// Written out as whole strings for the same reason `LABEL_CLASS` is: Tailwind
// scans source text, so a class assembled at runtime produces no CSS.

/**
 * Three visibly different steps that all still fit a 360px viewport, so a
 * narrow phone never ends up scrolling a column that is wider than the screen.
 */
export const COLUMN_WIDTH_CLASS: Record<BoardColumnWidth, string> = {
    narrow: 'w-60',
    standard: 'w-72',
    wide: 'w-80',
};

export function columnWidthClass(width: BoardColumnWidth): string {
    return COLUMN_WIDTH_CLASS[width] ?? COLUMN_WIDTH_CLASS.standard;
}

interface ScrollTokens {
    /** What `PageShell` gives the box its children sit in. */
    shell: string;
    /** The board canvas — the header, the selection bar and the columns. */
    canvas: string;
    /** The strip the columns are laid out across. */
    strip: string;
    /** The row inside that strip, bounded so the columns it holds can be. */
    row: string;
    /** A column's cards — the box that actually scrolls. */
    list: string;
}

/**
 * Where a board taller than the window scrolls, as the classes that decide it.
 *
 * There are two honest answers and no right one. The page can take the height:
 * the board is as tall as its longest column and the window scrolls, which is
 * what this board has always done and what a short board wants — nothing is
 * cropped and the browser's own scrollbar gets you there. Or each column can
 * take its own: the board is exactly as tall as the window, the header and
 * every column heading stay put, and a column scrolls inside its own frame,
 * which is what a long board wants — at forty cards in Doing, page scrolling
 * puts the headings off screen and you lose track of which lane you are in.
 *
 * `page` stays the default. It is what is already there, and a board that fits
 * is better served by it than by a frame it never fills.
 *
 * The height is handed down a step at a time rather than declared once, which
 * is why this is five classes and not one: `PageShell` is the app's vertical
 * scroller, and a column can only be given a definite height if every box
 * between it and the shell has one too.
 *
 * All of it is `md:` and up. A phone's board area is a few hundred pixels tall
 * once the filters have wrapped above it, and a scroller nested in that shows
 * three cards and two scrollbars — so below `md` the page scrolls either way,
 * whatever is stored.
 */
export const SCROLL: Record<BoardScroll, ScrollTokens> = {
    page: { shell: '', canvas: '', strip: '', row: '', list: '' },
    column: {
        shell: 'md:flex md:h-full md:flex-col',
        canvas: 'md:flex md:min-h-0 md:flex-1 md:flex-col',
        strip: 'md:min-h-0 md:flex-1',
        row: 'md:h-full',
        list: 'md:min-h-0 md:flex-1 md:overflow-y-auto',
    },
};

export function scrollClasses(view: BoardView): ScrollTokens {
    return SCROLL[view.scroll] ?? SCROLL.page;
}

interface DensityTokens {
    /** Padding inside a card body. */
    cardPad: string;
    /** Gap between cards in a column, and the column's own inner padding. */
    columnGap: string;
    columnPad: string;
    /** Leading of the card title, and how much room the rows under it get. */
    title: string;
    row: string;
    /** The assignee bubble — the one element small enough to need a size of its own. */
    avatar: string;
}

export const DENSITY: Record<BoardDensity, DensityTokens> = {
    comfortable: {
        cardPad: 'p-2.5',
        columnGap: 'gap-2',
        columnPad: 'p-2',
        title: 'text-sm font-medium leading-snug',
        row: 'mt-1.5',
        avatar: 'h-6 w-6 text-[10px]',
    },
    compact: {
        cardPad: 'px-2 py-1.5',
        columnGap: 'gap-1.5',
        columnPad: 'p-1.5',
        title: 'text-xs font-medium leading-snug',
        row: 'mt-1',
        avatar: 'h-5 w-5 text-[9px]',
    },
};

export function density(view: BoardView): DensityTokens {
    return DENSITY[view.density] ?? DENSITY.comfortable;
}

interface CategoryTint {
    /** The rule across the top of the column. */
    bar: string;
    /** The dot beside the column name. */
    dot: string;
    /** The count chip in the column header. */
    chip: string;
    /** The WIP meter's fill. */
    meter: string;
}

/**
 * Neutral → primary → success, which is the app's semantic palette rather than
 * three decorative hues: a column is "not started", "being worked" or "done",
 * and those are exactly the states `StatusBadge` already colours this way. No
 * new accent is introduced, which is what the one-accent rule is protecting.
 */
export const CATEGORY_TINT: Record<string, CategoryTint> = {
    TODO: {
        bar: 'bg-gray-300',
        dot: 'bg-gray-400',
        chip: 'bg-gray-100 text-gray-600',
        meter: 'bg-gray-400',
    },
    IN_PROGRESS: {
        bar: 'bg-blue-500',
        dot: 'bg-blue-500',
        chip: 'bg-blue-50 text-blue-700',
        meter: 'bg-blue-500',
    },
    DONE: {
        bar: 'bg-emerald-500',
        dot: 'bg-emerald-500',
        chip: 'bg-emerald-50 text-emerald-700',
        meter: 'bg-emerald-500',
    },
};

const PLAIN_TINT: CategoryTint = {
    bar: 'bg-gray-200',
    dot: 'bg-gray-300',
    chip: 'bg-gray-100 text-gray-600',
    meter: 'bg-gray-400',
};

export function tintOf(view: BoardView, category: string | undefined): CategoryTint {
    if (view.columnTint !== 'category') return PLAIN_TINT;
    return CATEGORY_TINT[category ?? ''] ?? PLAIN_TINT;
}

// ── Motion ──────────────────────────────────────────────────────────────────

/**
 * Every animation class goes out under `motion-safe:`, so a reader who has
 * asked their OS for reduced motion gets a still board whatever this preference
 * says. The toggle can only take motion away, never add it back.
 */
const MOTION: Record<'card' | 'column' | 'drop', string> = {
    card: 'motion-safe:animate-board-card-in',
    column: 'motion-safe:animate-board-column-in',
    drop: 'motion-safe:animate-board-drop-in',
};

export function motionClass(view: BoardView, kind: 'card' | 'column' | 'drop'): string {
    return view.animate ? MOTION[kind] : '';
}

/**
 * Cards deal in fractions of a second — past about a fifth of one the board
 * stops feeling quick and starts feeling like it is loading — so the stagger is
 * capped rather than multiplied out over a column of thirty.
 */
export const STAGGER_STEP_MS = 35;
export const STAGGER_MAX_MS = 210;

export function staggerDelay(view: BoardView, index: number): string | undefined {
    if (!view.animate || index <= 0) return undefined;
    return `${Math.min(index * STAGGER_STEP_MS, STAGGER_MAX_MS)}ms`;
}
