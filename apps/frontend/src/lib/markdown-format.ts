/**
 * Toolbar commands for the small markdown editor (`RichTextEditor`).
 *
 * Kept as pure functions over `{ value, selectionStart, selectionEnd }` rather
 * than reaching into a textarea: the interesting parts — toggling a marker off
 * again, prefixing a multi-line selection — are all string work, and string
 * work is worth testing without a DOM.
 */

export type MarkdownCommand =
    | 'bold'
    | 'italic'
    | 'strike'
    | 'code'
    | 'bulletList'
    | 'numberedList'
    | 'link';

export interface TextSelection {
    value: string;
    selectionStart: number;
    selectionEnd: number;
}

const WRAP_MARKER: Record<'bold' | 'italic' | 'strike' | 'code', string> = {
    bold: '**',
    italic: '*',
    strike: '~~',
    code: '`',
};

const BULLET = /^(\s*)[-*] /;
const NUMBERED = /^(\s*)\d+\. /;

/** The URL stand-in a link insert leaves selected, so typing replaces it. */
export const LINK_PLACEHOLDER = 'url';

/**
 * `*` is also the first half of `**`, so an italic toggle sitting just inside a
 * bold run would otherwise "unwrap" one star from each side and silently turn
 * bold into italic. Only treat the neighbours as an italic pair when they are
 * not part of a double marker.
 */
function neighboursAre(value: string, start: number, end: number, marker: string): boolean {
    if (value.slice(start - marker.length, start) !== marker) return false;
    if (value.slice(end, end + marker.length) !== marker) return false;
    if (marker !== '*') return true;
    return value.slice(start - 2, start) !== '**' && value.slice(end, end + 2) !== '**';
}

function toggleWrap(input: TextSelection, marker: string): TextSelection {
    const { value, selectionStart: start, selectionEnd: end } = input;
    const selected = value.slice(start, end);
    const width = marker.length;

    // Markers inside the selection — the user selected "**bold**" and clicked B.
    if (
        selected.length >= width * 2 &&
        selected.startsWith(marker) &&
        selected.endsWith(marker)
    ) {
        const inner = selected.slice(width, selected.length - width);
        return {
            value: value.slice(0, start) + inner + value.slice(end),
            selectionStart: start,
            selectionEnd: start + inner.length,
        };
    }

    // Markers just outside it — the user selected "bold" within "**bold**".
    if (neighboursAre(value, start, end, marker)) {
        return {
            value: value.slice(0, start - width) + selected + value.slice(end + width),
            selectionStart: start - width,
            selectionEnd: end - width,
        };
    }

    return {
        value: value.slice(0, start) + marker + selected + marker + value.slice(end),
        selectionStart: start + width,
        selectionEnd: end + width,
    };
}

function toggleList(input: TextSelection, command: 'bulletList' | 'numberedList'): TextSelection {
    const { value, selectionStart: start, selectionEnd: end } = input;

    // Whole lines, always: a list marker belongs to the line, not the selection.
    const blockStart = value.lastIndexOf('\n', Math.max(start - 1, 0)) + 1;
    const newline = value.indexOf('\n', end);
    const blockEnd = newline === -1 ? value.length : newline;

    const lines = value.slice(blockStart, blockEnd).split('\n');
    const pattern = command === 'bulletList' ? BULLET : NUMBERED;
    const alreadyList = lines.every((line) => pattern.test(line));

    // Strip whichever marker is there first, so bullets ↔ numbers is one click
    // rather than "unbullet, then number".
    const bare = lines.map((line) => line.replace(BULLET, '$1').replace(NUMBERED, '$1'));
    const next = alreadyList
        ? bare
        : bare.map((line, index) =>
              command === 'bulletList' ? `- ${line}` : `${index + 1}. ${line}`,
          );

    const block = next.join('\n');
    return {
        value: value.slice(0, blockStart) + block + value.slice(blockEnd),
        selectionStart: blockStart,
        selectionEnd: blockStart + block.length,
    };
}

function insertLink(input: TextSelection): TextSelection {
    const { value, selectionStart: start, selectionEnd: end } = input;
    const label = value.slice(start, end);
    const snippet = `[${label}](${LINK_PLACEHOLDER})`;
    // Leaves the URL selected — the label is either already written or the one
    // thing the user cannot type for you.
    const urlStart = start + label.length + 3;
    return {
        value: value.slice(0, start) + snippet + value.slice(end),
        selectionStart: urlStart,
        selectionEnd: urlStart + LINK_PLACEHOLDER.length,
    };
}

/** Applies a toolbar command and reports where the caret should end up. */
export function applyMarkdown(input: TextSelection, command: MarkdownCommand): TextSelection {
    if (command === 'link') return insertLink(input);
    if (command === 'bulletList' || command === 'numberedList') return toggleList(input, command);
    return toggleWrap(input, WRAP_MARKER[command]);
}
