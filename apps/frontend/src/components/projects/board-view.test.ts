import {
    BOARD_VIEW_STORAGE_KEY,
    CARD_FIELDS,
    columnWidthClass,
    DEFAULT_BOARD_VIEW,
    density,
    isDefaultBoardView,
    mergeBoardView,
    motionClass,
    readStoredBoardView,
    staggerDelay,
    STAGGER_MAX_MS,
    tintOf,
    writeStoredBoardView,
    type BoardView,
} from './board-view';

type ViewOverrides = Partial<Omit<BoardView, 'fields'>> & {
    fields?: Partial<BoardView['fields']>;
};

const withView = (overrides: ViewOverrides): BoardView => ({
    ...DEFAULT_BOARD_VIEW,
    ...overrides,
    fields: { ...DEFAULT_BOARD_VIEW.fields, ...(overrides.fields ?? {}) },
});

describe('mergeBoardView', () => {
    it('falls back to the defaults for anything that is not an object', () => {
        expect(mergeBoardView(null)).toEqual(DEFAULT_BOARD_VIEW);
        expect(mergeBoardView('compact')).toEqual(DEFAULT_BOARD_VIEW);
        expect(mergeBoardView(['compact'])).toEqual(DEFAULT_BOARD_VIEW);
    });

    it('keeps a stored setting the release it was stored in did not have', () => {
        // What an entry written before `columnTint` existed looks like. The
        // stored choices survive; the new option starts at its default.
        const merged = mergeBoardView({ density: 'compact', columnWidth: 'wide' });
        expect(merged.density).toBe('compact');
        expect(merged.columnWidth).toBe('wide');
        expect(merged.columnTint).toBe(DEFAULT_BOARD_VIEW.columnTint);
    });

    it('drops a value outside the option list rather than passing it to a class lookup', () => {
        const merged = mergeBoardView({ density: 'tiny', columnWidth: 7, animate: 'yes' });
        expect(merged.density).toBe(DEFAULT_BOARD_VIEW.density);
        expect(merged.columnWidth).toBe(DEFAULT_BOARD_VIEW.columnWidth);
        expect(merged.animate).toBe(DEFAULT_BOARD_VIEW.animate);
    });

    it('takes only the card fields it knows, and only booleans', () => {
        const merged = mergeBoardView({ fields: { labels: false, cover: 'no', invented: false } });
        expect(merged.fields.labels).toBe(false);
        expect(merged.fields.cover).toBe(true);
        expect(Object.keys(merged.fields).sort()).toEqual([...CARD_FIELDS].sort());
    });
});

describe('storage', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips a view', () => {
        const view = withView({ density: 'compact', fields: { assignee: false } });
        writeStoredBoardView(view);
        expect(readStoredBoardView()).toEqual(view);
    });

    it('returns the defaults when the entry is not JSON', () => {
        localStorage.setItem(BOARD_VIEW_STORAGE_KEY, '{not json');
        expect(readStoredBoardView()).toEqual(DEFAULT_BOARD_VIEW);
    });

    it('survives storage being unavailable', () => {
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });

        expect(readStoredBoardView()).toEqual(DEFAULT_BOARD_VIEW);
        expect(() => writeStoredBoardView(DEFAULT_BOARD_VIEW)).not.toThrow();

        getItem.mockRestore();
        setItem.mockRestore();
    });
});

describe('isDefaultBoardView', () => {
    it('is true for the defaults and false once any one setting moves', () => {
        expect(isDefaultBoardView(DEFAULT_BOARD_VIEW)).toBe(true);
        expect(isDefaultBoardView(withView({ columnWidth: 'wide' }))).toBe(false);
        expect(isDefaultBoardView(withView({ animate: false }))).toBe(false);
        expect(isDefaultBoardView(withView({ fields: { cover: false } }))).toBe(false);
    });
});

describe('class maps', () => {
    it('gives each column width its own class', () => {
        const widths = ['narrow', 'standard', 'wide'] as const;
        const classes = widths.map(columnWidthClass);
        expect(new Set(classes).size).toBe(widths.length);
    });

    it('packs the card tighter in compact than in comfortable', () => {
        expect(density(withView({ density: 'compact' }))).not.toEqual(
            density(withView({ density: 'comfortable' })),
        );
    });

    it('tints a column by its category only when the setting asks for it', () => {
        const tinted = withView({ columnTint: 'category' });
        expect(tintOf(tinted, 'IN_PROGRESS')).not.toEqual(tintOf(tinted, 'DONE'));
        expect(tintOf(withView({ columnTint: 'none' }), 'IN_PROGRESS')).toEqual(
            tintOf(withView({ columnTint: 'none' }), 'DONE'),
        );
    });

    it('falls back to the plain tint for a category it does not know', () => {
        const tinted = withView({ columnTint: 'category' });
        expect(tintOf(tinted, 'BLOCKED')).toEqual(tintOf(tinted, undefined));
    });
});

describe('motion', () => {
    it('emits nothing at all once motion is switched off', () => {
        expect(motionClass(withView({ animate: false }), 'card')).toBe('');
        expect(staggerDelay(withView({ animate: false }), 4)).toBeUndefined();
    });

    it('only ever animates under motion-safe, so the OS setting still wins', () => {
        for (const kind of ['card', 'column', 'drop'] as const) {
            expect(motionClass(DEFAULT_BOARD_VIEW, kind)).toMatch(/^motion-safe:/);
        }
    });

    it('staggers the first cards and then caps, so a long column is not a queue', () => {
        expect(staggerDelay(DEFAULT_BOARD_VIEW, 0)).toBeUndefined();
        expect(staggerDelay(DEFAULT_BOARD_VIEW, 1)).toBe('35ms');
        expect(staggerDelay(DEFAULT_BOARD_VIEW, 40)).toBe(`${STAGGER_MAX_MS}ms`);
    });
});
