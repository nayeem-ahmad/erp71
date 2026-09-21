import { getSchema } from '@tiptap/core';
import type { Node } from 'prosemirror-model';
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import markdownit from 'markdown-it';
import { contentExtensions } from './editor-extensions';

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
    // A `data:` or `blob:` URL has no query string to speak of: everything
    // after the comma is payload, and a `?w=` glued to the end of base64 is an
    // image the browser cannot decode. Neither is ever stored — the editor
    // swaps a blob for the uploaded URL before serializing — so there is
    // nothing to record a width against.
    if (/^(data|blob):/i.test(url)) return url;

    const parsed = parse(url);
    if (!parsed) return url;
    if (width === null) parsed.searchParams.delete('w');
    else parsed.searchParams.set('w', String(Math.round(width)));
    return format(parsed, url);
}


/**
 * The same image, delivered no wider than `width`.
 *
 * `?w=` on its own is only a note to this app about how big to draw the
 * picture — Cloudinary takes its transforms as a path segment, so a query
 * parameter changes nothing about what crosses the wire. This turns that
 * note into a real request, which is what keeps a 4 MB screenshot from being
 * downloaded in full to fill a 160px tile.
 *
 * `c_limit` so an image already narrower than the cap is left alone rather
 * than stretched; `q_auto,f_auto` to match what the upload itself asks for.
 *
 * Only Cloudinary, because only Cloudinary's vocabulary is known here. Any
 * other host gets its URL back untouched: a guessed transform would turn a
 * working image into a 404.
 */
const CLOUDINARY_DELIVERY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video|raw)\/upload\/)(.*)$/;
/** A path segment that is already a transform, e.g. `w_320,c_limit`. */
const TRANSFORM_SEGMENT = /^[a-z]{1,3}_[^/]*\//;

export function sizedImageUrl(url: string, width: number | null): string {
    if (width === null) return url;
    const match = CLOUDINARY_DELIVERY.exec(url);
    if (!match) return url;

    const [, delivery, rest] = match;
    // Already asked for: re-wrapping would stack transforms on every render.
    if (TRANSFORM_SEGMENT.test(rest)) return url;
    return `${delivery}w_${Math.round(width)},c_limit,q_auto,f_auto/${rest}`;
}

/* ------------------------------------------------------------------ *
 * The document shape
 * ------------------------------------------------------------------ */

/**
 * Derived from the editor's own extensions rather than declared again here.
 *
 * TipTap and ProseMirror disagree about names — `bold` against `strong`,
 * `bulletList` against `bullet_list` — and a parallel schema that got one of
 * them wrong would not throw. It would quietly drop every bold word as the
 * document crossed the boundary, which is the kind of bug that reaches
 * production because nothing about it looks broken until someone's text is
 * gone.
 */
export const editorSchema = getSchema(contentExtensions);

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
 * Markdown tokens onto this schema's nodes and marks.
 *
 * Written out rather than spread from `defaultMarkdownParser.tokens`, which
 * names nodes the way ProseMirror's own schema does and would map onto
 * nothing here. A construct with no entry is not an error: markdown-it still
 * tokenizes `# Heading` and the parser, finding no handler, keeps its text —
 * which is what should happen to something the toolbar cannot produce.
 */
const parser = new MarkdownParser(editorSchema, tokenizer, {
    paragraph: { block: 'paragraph' },
    bullet_list: { block: 'bulletList' },
    ordered_list: { block: 'orderedList' },
    list_item: { block: 'listItem' },
    hardbreak: { node: 'hardBreak' },

    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    code_inline: { mark: 'code', noCloseToken: true },
    link: {
        mark: 'link',
        getAttrs: (token) => ({
            href: token.attrGet('href'),
            title: token.attrGet('title') || null,
        }),
    },

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
});

const serializer = new MarkdownSerializer(
    {
        paragraph: (state, node) => {
            state.renderInline(node);
            state.closeBlock(node);
        },
        bulletList: (state, node) => {
            state.renderList(node, '  ', () => '* ');
        },
        orderedList: (state, node) => {
            const start = (node.attrs.start as number | undefined) ?? 1;
            const maxWidth = String(start + node.childCount - 1).length;
            const space = ' '.repeat(maxWidth + 2);
            state.renderList(node, space, (i) => {
                const label = String(start + i);
                return `${label.padStart(maxWidth)}. `;
            });
        },
        listItem: (state, node) => {
            state.renderContent(node);
        },
        hardBreak: (state, node, parent, index) => {
            for (let i = index + 1; i < parent.childCount; i += 1) {
                if (parent.child(i).type !== node.type) {
                    state.write('\\\n');
                    return;
                }
            }
        },
        text: (state, node) => {
            state.text(node.text ?? '');
        },
        image: (state, node) => {
            // A paste still in flight is not part of the document yet: its src
            // is a blob URL that means nothing outside this tab, and the
            // description saves on blur. Leaving it out here is what makes it
            // impossible for one to reach the database.
            if (node.attrs.uploading) return;
            const src = urlWithWidth(node.attrs.src, node.attrs.width ?? null);
            state.write(`![${state.esc(node.attrs.alt || '')}](${state.esc(src)})`);
        },
    },
    {
        bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
        italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
        strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
        code: {
            open: '`',
            close: '`',
            escape: false,
        },
        link: {
            open: '[',
            close: (state, mark) => {
                // `quote` is on the state at runtime but missing from the
                // published types.
                const quote = (state as unknown as { quote: (s: string) => string }).quote;
                const title = mark.attrs.title ? ` ${quote.call(state, mark.attrs.title)}` : '';
                return `](${state.esc(mark.attrs.href)}${title})`;
            },
            mixable: true,
        },
    },
);

export function markdownToDoc(markdown: string): Node {
    return parser.parse(markdown) ?? editorSchema.topNodeType.createAndFill()!;
}

export function docToMarkdown(doc: Node): string {
    return serializer.serialize(doc).trim();
}
