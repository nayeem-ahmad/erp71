import {
    editorSchema,
    widthFromUrl,
    urlWithWidth,
    markdownToDoc,
    docToMarkdown,
    sizedImageUrl,
} from './markdown-bridge';

describe('image width on the URL', () => {
    it('reads a width', () => {
        expect(widthFromUrl('https://cdn/x.png?w=420')).toBe(420);
    });

    it('is null when there is none', () => {
        expect(widthFromUrl('https://cdn/x.png')).toBeNull();
    });

    it('ignores a width that is not a positive number', () => {
        expect(widthFromUrl('https://cdn/x.png?w=abc')).toBeNull();
        expect(widthFromUrl('https://cdn/x.png?w=-5')).toBeNull();
    });

    it('sets a width, keeping other parameters', () => {
        expect(urlWithWidth('https://cdn/x.png?v=2', 420)).toBe('https://cdn/x.png?v=2&w=420');
    });

    it('replaces a width rather than appending a second', () => {
        expect(urlWithWidth('https://cdn/x.png?w=100', 420)).toBe('https://cdn/x.png?w=420');
    });

    it('removes the width when given null', () => {
        expect(urlWithWidth('https://cdn/x.png?w=100', null)).toBe('https://cdn/x.png');
    });

    it('leaves a relative URL usable', () => {
        expect(urlWithWidth('/uploads/x.png', 200)).toBe('/uploads/x.png?w=200');
    });
});

/** What the author typed must be what comes back out. */
const roundTrip = (markdown: string) => docToMarkdown(markdownToDoc(markdown));

describe('markdown round-trip', () => {
    it.each([
        ['plain text', 'Just a sentence.'],
        ['bold', 'A **bold** word.'],
        ['italic', 'An *italic* word.'],
        ['strikethrough', 'A ~~struck~~ word.'],
        ['inline code', 'Run `npm test` first.'],
        ['a link', 'See [the docs](https://example.com/docs).'],
        // The serializer writes list items apart rather than tight. Cosmetic,
        // and stable — see 'settles after one pass' below — so the canonical
        // form is what is asserted rather than what was typed.
        ['a bullet list', '* one\n\n* two'],
        ['a numbered list', '1. one\n\n2. two'],
        ['two paragraphs', 'First.\n\nSecond.'],
        ['an image', '![shot.png](https://cdn/shot.png)'],
        ['an image with a width', '![shot.png](https://cdn/shot.png?w=420)'],
    ])('keeps %s', (_label, markdown) => {
        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('keeps an image that sits in a paragraph of text', () => {
        const markdown = 'Before\n\n![shot.png](https://cdn/shot.png)\n\nAfter';
        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('keeps two images pasted one after the other', () => {
        const markdown = '![one.png](https://cdn/one.png)\n\n![two.png](https://cdn/two.png)';
        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('reads a width off the URL into the node', () => {
        const doc = markdownToDoc('![shot.png](https://cdn/shot.png?w=420)');
        let width: unknown = null;
        doc.descendants((node) => {
            if (node.type.name === 'image') width = node.attrs.width;
        });
        expect(width).toBe(420);
    });

    it('is empty for an empty string', () => {
        expect(roundTrip('')).toBe('');
    });

    /*
     * Where the serializer has its own way of writing something — list items
     * spaced apart, say — the first pass may not give back exactly what was
     * typed. That is tolerable only if it settles: a description that gained
     * a blank line every time someone opened the task would grow without end.
     */
    it.each([
        ['a tight bullet list', '* one\n* two'],
        ['a tight numbered list', '1. one\n2. two'],
        ['an image', '![shot.png](https://cdn/shot.png)'],
        ['text around an image', 'Before\n\n![shot.png](https://cdn/shot.png)\n\nAfter'],
    ])('settles after one pass: %s', (_label, markdown) => {
        const once = roundTrip(markdown);
        expect(roundTrip(once)).toBe(once);
    });

    it('leaves out an image that is still uploading', () => {
        // The description saves on blur, and a blob URL means nothing
        // outside the tab that made it. The value must not be able to
        // carry one — this is the structural guarantee behind that.
        const doc = editorSchema.node('doc', null, [
            editorSchema.node('paragraph', null, [editorSchema.text('Before')]),
            // An image is inline, so it lives in a paragraph of its own.
            editorSchema.node('paragraph', null, [
                editorSchema.node('image', {
                    src: 'blob:https://app/9f2c',
                    alt: 'shot.png',
                    uploading: true,
                    pasteId: 'p1',
                }),
            ]),
        ]);
        const markdown = docToMarkdown(doc);
        expect(markdown).not.toContain('blob:');
        expect(markdown).toBe('Before');
    });
});

describe('asking the asset host for a narrower copy', () => {
    const cloudinary = 'https://res.cloudinary.com/demo/image/upload/v1/erp71/shot.png';

    it('puts a width transform in the delivery path', () => {
        expect(sizedImageUrl(cloudinary, 320)).toBe(
            'https://res.cloudinary.com/demo/image/upload/w_320,c_limit,q_auto,f_auto/v1/erp71/shot.png',
        );
    });

    it('does not stack a second transform on a URL that already has one', () => {
        const once = sizedImageUrl(cloudinary, 320);
        expect(sizedImageUrl(once, 320)).toBe(once);
    });

    it('leaves a URL from anywhere else alone', () => {
        // Nothing to ask: an unknown host has no transform vocabulary, and a
        // guess would produce a 404 where the full-size image worked.
        expect(sizedImageUrl('https://cdn/x.png', 320)).toBe('https://cdn/x.png');
    });

    it('leaves the URL alone when no width is wanted', () => {
        expect(sizedImageUrl(cloudinary, null)).toBe(cloudinary);
    });
});
