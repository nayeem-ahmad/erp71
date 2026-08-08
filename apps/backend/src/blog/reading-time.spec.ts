import { countWords, readingMinutes } from './reading-time';

describe('countWords', () => {
    it('counts plain prose', () => {
        expect(countWords('one two three four five')).toBe(5);
    });

    it('does not count fenced code as prose', () => {
        const body = ['Intro paragraph here.', '', '```ts', 'const x = 1;', 'doThing(x, x, x);', '```', '', 'Outro.'].join('\n');
        // "Intro paragraph here." (3) + "Outro." (1)
        expect(countWords(body)).toBe(4);
    });

    it('counts an image by its alt text and not its URL', () => {
        expect(countWords('![a wide shelf](https://cdn.example.com/very/long/path/shelf.png)')).toBe(3);
    });

    it('counts a link by its label and not its target', () => {
        // "See our pricing page for more" — the URL contributes nothing.
        expect(countWords('See [our pricing page](https://erp71.com/pricing) for more')).toBe(6);
    });

    it('ignores heading and quote markers', () => {
        expect(countWords('## A Heading\n\n> quoted line')).toBe(4);
    });

    it('returns zero for an empty or missing body', () => {
        expect(countWords('')).toBe(0);
        expect(countWords(undefined as unknown as string)).toBe(0);
    });
});

describe('readingMinutes', () => {
    it('rounds up to the next whole minute', () => {
        expect(readingMinutes(new Array(201).fill('word').join(' '))).toBe(2);
        expect(readingMinutes(new Array(400).fill('word').join(' '))).toBe(2);
        expect(readingMinutes(new Array(401).fill('word').join(' '))).toBe(3);
    });

    it('never returns zero, including for an empty body', () => {
        // "0 min read" reads as a bug rather than as a very short post.
        expect(readingMinutes('')).toBe(1);
        expect(readingMinutes('hi')).toBe(1);
    });

    it('is not inflated by a long code block', () => {
        const code = ['```', new Array(2000).fill('const x = 1;').join('\n'), '```'].join('\n');
        expect(readingMinutes(`A short intro.\n\n${code}`)).toBe(1);
    });
});
