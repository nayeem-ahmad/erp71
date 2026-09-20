import { Schema, type Node } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import {
    MarkdownParser,
    MarkdownSerializer,
    defaultMarkdownParser,
    defaultMarkdownSerializer,
} from 'prosemirror-markdown';
import markdownit from 'markdown-it';

/**
 * Markdown in, markdown out, with a ProseMirror document in between.
 *
 * The editor above this is a rich surface, but what is stored stays plain
 * markdown: a description written here is still readable in an export, an
 * email or the API, and there is no blob of stored HTML to sanitise on the
 * way back out. This file is the whole of that boundary — nothing else in
 * the editor knows how a document becomes text.
 *
 * Kept free of React so the round-trip can be tested for what it is: a pure
 * function whose output must equal its input.
 */

/* ------------------------------------------------------------------ *
 * Image widths
 * ------------------------------------------------------------------ */

/**
 * The width an author dragged an image to, carried on the URL as `?w=`.
 *
 * On the URL rather than in a custom `![alt|420](url)` syntax, so what is
 * stored stays standard markdown: it renders correctly wherever the
 * description is pointed, and an asset host that takes a width parameter can
 * serve the smaller file rather than shipping a full screenshot to be scaled
 * down in the browser.
 */

/** A base for parsing relative URLs; never sent anywhere. */
const RELATIVE_BASE = 'https://relative.invalid';

const isRelative = (url: string) => !/^[a-z][a-z0-9+.-]*:/i.test(url);

function parse(url: string): URL | null {
    try {
        return new URL(url, isRelative(url) ? RELATIVE_BASE : undefined);
    } catch {
        return null;
    }
}

/** Back to how it was written: relative in, relative out. */
function format(parsed: URL, original: string): string {
    return isRelative(original)
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.toString();
}

export function widthFromUrl(url: string): number | null {
    const parsed = parse(url);
    const raw = parsed?.searchParams.get('w');
    if (!raw) return null;
    const width = Number(raw);
    return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
}

export function urlWithWidth(url: string, width: number | null): string {
    const parsed = parse(url);
    if (!parsed) return url;
    if (width === null) parsed.searchParams.delete('w');
    else parsed.searchParams.set('w', String(Math.round(width)));
    return format(parsed, url);
}

/* ------------------------------------------------------------------ *
 * The document shape
 * ------------------------------------------------------------------ */

/**
 * Deliberately narrow — paragraphs, the marks the toolbar offers, lists and
 * images. Headings, blockquotes, code blocks and rules are left out because
 * the toolbar has never offered them, and a schema that admits a construct is
 * a schema whose round-trip has to be proved for it.
 */
const listNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');

export const editorSchema = new Schema({
    nodes: listNodes
        .remove('heading')
        .remove('blockquote')
        .remove('horizontal_rule')
        .remove('code_block')
        .update('image', {
            /*
             * Inline, inside a paragraph — which is what an image in markdown
             * is. It reads like a block because a pasted screenshot sits on a
             * line of its own, and the serializer already writes it that way,
             * but the token markdown-it emits is an inline one: declaring the
             * node a block means the parser has nowhere to put it and drops
             * the image entirely, leaving an empty paragraph behind.
             */
            inline: true,
            group: 'inline',
            draggable: true,
            attrs: {
                src: {},
                alt: { default: null },
                /** CSS pixels the author dragged to; null means natural size. */
                width: { default: null },
                /** True while the bytes are still going up. */
                uploading: { default: false },
                /** Identifies one in-flight paste, so its node can be found again. */
                pasteId: { default: null },
            },
            parseDOM: [
                {
                    tag: 'img[src]',
                    getAttrs: (dom: HTMLElement | string) => {
                        if (typeof dom === 'string') return false;
                        const src = dom.getAttribute('src') ?? '';
                        return {
                            src,
                            alt: dom.getAttribute('alt') || null,
                            width: widthFromUrl(src),
                        };
                    },
                },
            ],
            toDOM: (node: Node) => [
                'img',
                {
                    src: node.attrs.src,
                    alt: node.attrs.alt ?? '',
                    ...(node.attrs.width ? { width: String(node.attrs.width) } : {}),
                },
            ],
        }),
    marks: basicSchema.spec.marks.addToEnd('strike', {
        parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
        toDOM: () => ['s', 0],
    }),
});

/* ------------------------------------------------------------------ *
 * Parsing and serializing
 * ------------------------------------------------------------------ */

/**
 * CommonMark plus strikethrough.
 *
 * prosemirror-markdown's own tokenizer leaves `~~struck~~` as plain text —
 * GFM's strikethrough postdates the token table it ships — so the toolbar's
 * strike button would round-trip into nothing. Enabling the one rule is
 * cheaper than owning a tokenizer.
 */
const tokenizer = markdownit('commonmark', { html: false }).enable('strikethrough');

/**
 * The default token table maps tokens onto nodes this schema does not have —
 * headings, blockquotes, code blocks, rules — and `MarkdownParser` resolves
 * every one of them up front, so inheriting them wholesale throws before a
 * single character is parsed. Dropped here rather than in the schema: the
 * schema says what a document may contain, this says what the parser may
 * produce, and they have to agree.
 *
 * A dropped construct is not an error. markdown-it still tokenizes `# Heading`
 * and the parser, finding no handler, keeps its text — which is what should
 * happen to something the toolbar cannot produce in the first place.
 */
const UNSUPPORTED_TOKENS = ['heading', 'blockquote', 'code_block', 'fence', 'hr'] as const;

const inheritedTokens = Object.fromEntries(
    Object.entries(defaultMarkdownParser.tokens).filter(
        ([token]) => !UNSUPPORTED_TOKENS.includes(token as (typeof UNSUPPORTED_TOKENS)[number]),
    ),
);

const parser = new MarkdownParser(editorSchema, tokenizer, {
    ...inheritedTokens,
    image: {
        node: 'image',
        getAttrs: (token) => {
            const src = token.attrGet('src') ?? '';
            // The alt text is the token's content, not its `alt` attribute —
            // markdown-it leaves that empty and puts what the author wrote
            // between the brackets in `content`.
            return { src, alt: token.content || null, width: widthFromUrl(src) };
        },
    },
    s: { mark: 'strike' },
});

const serializer = new MarkdownSerializer(
    {
        ...defaultMarkdownSerializer.nodes,
        image: (state, node) => {
            // A paste still in flight is not part of the document yet: its src
            // is a blob URL that means nothing outside this tab, and the
            // description saves on blur. Leaving it out here is what makes it
            // impossible for one to reach the database.
            if (node.attrs.uploading) return;
            const src = urlWithWidth(node.attrs.src, node.attrs.width ?? null);
            state.write(`![${state.esc(node.attrs.alt || '')}](${state.esc(src)})`);
            state.closeBlock(node);
        },
    },
    {
        ...defaultMarkdownSerializer.marks,
        strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    },
);

export function markdownToDoc(markdown: string): Node {
    return parser.parse(markdown) ?? editorSchema.topNodeType.createAndFill()!;
}

export function docToMarkdown(doc: Node): string {
    return serializer.serialize(doc).trim();
}
