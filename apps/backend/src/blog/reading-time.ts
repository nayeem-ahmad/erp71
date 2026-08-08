/**
 * Reading time, computed once on save rather than on every read.
 *
 * 200 words per minute is the usual figure for prose on a screen. It is an
 * estimate presented as one ("6 min read"), so the interesting part is not the
 * constant but what gets counted: markdown syntax, code fences and image
 * references are not read at reading speed and inflate the number badly on a
 * technical post.
 */
const WORDS_PER_MINUTE = 200;

/** Words in a markdown body, with the syntax that is not prose removed. */
export function countWords(markdown: string): number {
    const prose = (markdown ?? '')
        // Fenced code blocks: skimmed, not read. Removed whole.
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/~~~[\s\S]*?~~~/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        // Images contribute their alt text at most; the URL is not prose.
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        // Links keep their label and drop the target.
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/[*_~]/g, '')
        .replace(/<[^>]+>/g, ' ');

    const words = prose.split(/\s+/).filter(Boolean);
    return words.length;
}

/**
 * Minutes, rounded up, floored at 1 — "0 min read" reads as an error, and a
 * post short enough to round to zero still takes a moment to read.
 */
export function readingMinutes(markdown: string): number {
    const words = countWords(markdown);
    if (words === 0) return 1;
    return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
