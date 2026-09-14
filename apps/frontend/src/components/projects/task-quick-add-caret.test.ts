import { tokenAtCaret } from './TaskQuickAdd';

/**
 * The caret half of the quick-add grammar.
 *
 * `parseQuickAdd` decides what a finished line *means*; this decides what the
 * caret is in the middle of typing, which is what the suggestion popover hangs
 * off. Kept as its own suite because the awkward cases here are all "where does
 * this token start and end", and those are worth deciding against a test rather
 * than against a rendered page.
 */
describe('tokenAtCaret', () => {
    it('finds a token at the end of the line', () => {
        expect(tokenAtCaret('Chase the refund @raf', 21)).toEqual({
            sigil: '@',
            query: 'raf',
            from: 17,
            to: 21,
        });
    });

    it('finds a bare sigil, so the full list shows the moment one is typed', () => {
        expect(tokenAtCaret('Chase the refund @', 18)).toEqual({
            sigil: '@',
            query: '',
            from: 17,
            to: 18,
        });
    });

    /**
     * The reason this reads the caret rather than the end of the line: going
     * back to fix a name mid-sentence has to keep offering the roster.
     */
    it('follows the caret into the middle of a line', () => {
        const value = 'Chase @raf about the refund';
        expect(tokenAtCaret(value, 10)).toEqual({
            sigil: '@',
            query: 'raf',
            from: 6,
            to: 10,
        });
    });

    it('spans the whole token when the caret sits inside it', () => {
        // Caret after `@ra`, but the token runs to `@rafi`.
        const value = 'Ping @rafi now';
        expect(tokenAtCaret(value, 8)).toEqual({
            sigil: '@',
            query: 'ra',
            from: 5,
            to: 10,
        });
    });

    it('stops at a space — a finished token suggests nothing', () => {
        expect(tokenAtCaret('Ping @rafi now', 14)).toBeNull();
    });

    it('ignores a word that does not start with a sigil', () => {
        expect(tokenAtCaret('Chase the refund', 16)).toBeNull();
    });

    it('ignores an empty line', () => {
        expect(tokenAtCaret('', 0)).toBeNull();
    });

    it('recognises every sigil the grammar parses', () => {
        expect(tokenAtCaret('x #bug', 6)?.sigil).toBe('#');
        expect(tokenAtCaret('x !high', 7)?.sigil).toBe('!');
        expect(tokenAtCaret('x ~3h', 5)?.sigil).toBe('~');
        expect(tokenAtCaret('x >friday', 9)?.sigil).toBe('>');
    });

    /**
     * A sigil mid-word is not a token: `a@b.com` is an email and `#f3f4f6` a
     * colour. Both must survive to `parseQuickAdd`, whose no-silent-swallow
     * rule keeps them in the title.
     */
    it('does not treat a sigil inside a word as a token', () => {
        expect(tokenAtCaret('mail rafi@erp71.com', 19)).toBeNull();
    });

    it('does treat a leading # as a token even when it looks like a colour', () => {
        // It resolves to nothing in the popover, and `parseQuickAdd` leaves it
        // in the title — the point is that this function does not decide that.
        expect(tokenAtCaret('use #f3f4f6', 11)).toEqual({
            sigil: '#',
            query: 'f3f4f6',
            from: 4,
            to: 11,
        });
    });
});
