import {
    backgroundSwatchClass,
    boardBackgroundKind,
    boardCanvasClass,
    boardCanvasStyle,
    boardColumnLiftClass,
    BOARD_BACKGROUND_CLASS,
    BOARD_BACKGROUND_COLORS,
    isBoardBackgroundColor,
} from './board-background';

describe('boardBackgroundKind', () => {
    it('reads a board with neither column set as the plain board', () => {
        expect(boardBackgroundKind(null)).toBe('default');
        expect(boardBackgroundKind(undefined)).toBe('default');
        expect(boardBackgroundKind({})).toBe('default');
        expect(boardBackgroundKind({ background_color: null, background_image_url: null })).toBe(
            'default',
        );
    });

    it('reads a palette key as a colour', () => {
        expect(boardBackgroundKind({ background_color: 'BLUE' })).toBe('color');
    });

    it('reads an uploaded picture as an image', () => {
        expect(boardBackgroundKind({ background_image_url: 'https://cdn/x.jpg' })).toBe('image');
    });

    it('lets the picture win when a row somehow holds both', () => {
        // The API keeps them mutually exclusive, so this is about a row written
        // before that rule — the board still has to open, and it has to pick one.
        expect(
            boardBackgroundKind({
                background_color: 'RED',
                background_image_url: 'https://cdn/x.jpg',
            }),
        ).toBe('image');
    });

    it('falls back to the plain board for a colour that is no longer in the palette', () => {
        // A board must still open after a colour is retired from the list —
        // and an unknown key must never reach a class lookup.
        expect(boardBackgroundKind({ background_color: 'CHARTREUSE' })).toBe('default');
    });
});

describe('isBoardBackgroundColor', () => {
    it('accepts every key in the palette and nothing else', () => {
        for (const color of BOARD_BACKGROUND_COLORS) expect(isBoardBackgroundColor(color)).toBe(true);
        expect(isBoardBackgroundColor('blue')).toBe(false);
        expect(isBoardBackgroundColor('#ff0000')).toBe(false);
        expect(isBoardBackgroundColor(null)).toBe(false);
    });
});

describe('boardCanvasClass', () => {
    it('paints nothing on the plain board, so the page keeps its own surface', () => {
        expect(boardCanvasClass(null)).toBe('');
        expect(boardCanvasClass({ background_color: null })).toBe('');
    });

    it('paints the picked colour, with the inset the columns need to read as inside it', () => {
        const className = boardCanvasClass({ background_color: 'EMERALD' });
        expect(className).toContain(BOARD_BACKGROUND_CLASS.EMERALD);
        expect(className).toContain('p-2');
    });

    it('leaves the colour off an image board, so the picture is what shows', () => {
        const className = boardCanvasClass({ background_image_url: 'https://cdn/x.jpg' });
        expect(className).toContain('bg-cover');
        for (const color of BOARD_BACKGROUND_COLORS) {
            expect(className).not.toContain(BOARD_BACKGROUND_CLASS[color]);
        }
    });

    it('never emits an arbitrary-value class', () => {
        // `bg-[#f3f4f6]` is against the UI rules, and Tailwind would not build
        // a class assembled at runtime anyway.
        for (const color of BOARD_BACKGROUND_COLORS) {
            expect(boardCanvasClass({ background_color: color })).not.toContain('[');
        }
    });
});

describe('boardCanvasStyle', () => {
    it('is absent unless the board wears a picture', () => {
        expect(boardCanvasStyle(null)).toBeUndefined();
        expect(boardCanvasStyle({ background_color: 'BLUE' })).toBeUndefined();
    });

    it('quotes the URL so it cannot break out of url()', () => {
        expect(boardCanvasStyle({ background_image_url: 'https://cdn/x.jpg' })).toEqual({
            backgroundImage: 'url("https://cdn/x.jpg")',
        });
    });

    it('escapes a quote in the URL rather than closing the value early', () => {
        const style = boardCanvasStyle({ background_image_url: 'https://cdn/a".jpg' });
        expect(style?.backgroundImage).toBe('url("https://cdn/a%22.jpg")');
    });
});

describe('boardColumnLiftClass', () => {
    it('leaves a plain board’s columns flat', () => {
        expect(boardColumnLiftClass(null)).toBe('');
    });

    it('lifts the columns off anything painted, or they lose their edges', () => {
        expect(boardColumnLiftClass({ background_color: 'AMBER' })).toBe('shadow-md');
        expect(boardColumnLiftClass({ background_image_url: 'https://cdn/x.jpg' })).toBe('shadow-md');
    });
});

describe('backgroundSwatchClass', () => {
    it('previews a colour with the colour itself', () => {
        expect(backgroundSwatchClass('PURPLE')).toBe(BOARD_BACKGROUND_CLASS.PURPLE);
    });

    it('has a class for every key in the palette', () => {
        for (const color of BOARD_BACKGROUND_COLORS) {
            expect(backgroundSwatchClass(color)).toBeTruthy();
        }
    });
});
