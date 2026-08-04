import { applyMarkdown, type MarkdownCommand, type TextSelection } from './markdown-format';

/** `[` and `]` mark the selection, so the cases read like what the user sees. */
const at = (marked: string): TextSelection => {
    const selectionStart = marked.indexOf('[');
    const selectionEnd = marked.indexOf(']') - 1;
    return {
        value: marked.replace('[', '').replace(']', ''),
        selectionStart,
        selectionEnd,
    };
};

const run = (marked: string, command: MarkdownCommand) => {
    const result = applyMarkdown(at(marked), command);
    return {
        value: result.value,
        selected: result.value.slice(result.selectionStart, result.selectionEnd),
    };
};

describe('applyMarkdown — inline markers', () => {
    it('wraps the selection and keeps it selected', () => {
        expect(run('fix the [meter] box', 'bold')).toEqual({
            value: 'fix the **meter** box',
            selected: 'meter',
        });
    });

    it('wraps an empty selection so typing lands between the markers', () => {
        const result = applyMarkdown({ value: 'note: ', selectionStart: 6, selectionEnd: 6 }, 'italic');
        expect(result.value).toBe('note: **');
        expect(result.selectionStart).toBe(7);
        expect(result.selectionEnd).toBe(7);
    });

    it('unwraps when the markers are inside the selection', () => {
        expect(run('fix the [**meter**] box', 'bold')).toEqual({
            value: 'fix the meter box',
            selected: 'meter',
        });
    });

    it('unwraps when the markers sit just outside the selection', () => {
        expect(run('fix the **[meter]** box', 'bold')).toEqual({
            value: 'fix the meter box',
            selected: 'meter',
        });
    });

    it('does not eat one star from a bold run when italicising inside it', () => {
        expect(run('fix the **[meter]** box', 'italic')).toEqual({
            value: 'fix the ***meter*** box',
            selected: 'meter',
        });
    });

    it('handles strikethrough and inline code', () => {
        expect(run('[done]', 'strike').value).toBe('~~done~~');
        expect(run('[npm run db:migrate]', 'code').value).toBe('`npm run db:migrate`');
    });
});

describe('applyMarkdown — lists', () => {
    it('prefixes every line the selection touches', () => {
        expect(run('[wire it\ntest it]\nbill it', 'bulletList').value).toBe(
            '- wire it\n- test it\nbill it',
        );
    });

    it('numbers the lines from one', () => {
        expect(run('[wire it\ntest it]', 'numberedList').value).toBe('1. wire it\n2. test it');
    });

    it('takes the whole line even when only part of it is selected', () => {
        expect(run('wire the [meter]', 'bulletList').value).toBe('- wire the meter');
    });

    it('removes the markers when every line already has them', () => {
        expect(run('[- wire it\n- test it]', 'bulletList').value).toBe('wire it\ntest it');
    });

    it('switches a bulleted block to a numbered one in one click', () => {
        expect(run('[- wire it\n- test it]', 'numberedList').value).toBe('1. wire it\n2. test it');
    });

    it('leaves the lines above and below alone', () => {
        expect(run('intro\n[wire it]\noutro', 'bulletList').value).toBe('intro\n- wire it\noutro');
    });
});

describe('applyMarkdown — links', () => {
    it('keeps the selection as the label and selects the url stand-in', () => {
        expect(run('see [the runbook] for more', 'link')).toEqual({
            value: 'see [the runbook](url) for more',
            selected: 'url',
        });
    });

    it('inserts an empty label when nothing is selected', () => {
        const result = applyMarkdown({ value: '', selectionStart: 0, selectionEnd: 0 }, 'link');
        expect(result.value).toBe('[](url)');
        expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('url');
    });
});
