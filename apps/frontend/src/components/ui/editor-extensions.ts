import { Node as TiptapNode } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import { Bold } from '@tiptap/extension-bold';
import { Italic } from '@tiptap/extension-italic';
import { Strike } from '@tiptap/extension-strike';
import { Code } from '@tiptap/extension-code';
import { Link } from '@tiptap/extension-link';
import { BulletList, OrderedList, ListItem } from '@tiptap/extension-list';

/**
 * What a description or a comment may contain, in one place.
 *
 * Deliberately narrow — paragraphs, the marks the toolbar offers, lists and
 * images. Headings, blockquotes, code blocks and rules are left out because
 * the toolbar has never offered them, and a schema that admits a construct is
 * a schema whose markdown round-trip has to be proved for it.
 *
 * Shared by the editor and by `markdown-bridge`, which derives its schema from
 * this same list rather than declaring a parallel one. That is not tidiness:
 * TipTap names its bold mark `bold` where ProseMirror's own schema calls it
 * `strong`, and a hand-written copy that got one of those wrong would not
 * fail — it would quietly drop every bold word on the way in.
 */

/**
 * The image node. Its attrs are read by `markdown-bridge` on the way out and
 * by `ResizableImage` on the way to the screen.
 *
 * Inline, inside a paragraph, which is what an image in markdown is: it reads
 * like a block because a pasted screenshot sits on a line of its own, but the
 * token markdown-it emits is an inline one, and a block node would leave the
 * parser nowhere to put it.
 */
export const Image = TiptapNode.create({
    name: 'image',
    inline: true,
    group: 'inline',
    draggable: true,
    addAttributes: () => ({
        src: { default: null },
        alt: { default: null },
        /** CSS pixels the author dragged to; null means natural size. */
        width: { default: null },
        /** True while the bytes are still going up. */
        uploading: { default: false },
        /** Identifies one in-flight paste, so its node can be found again. */
        pasteId: { default: null },
    }),
    parseHTML: () => [{ tag: 'img[src]' }],
    renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
});

/**
 * Everything but the node view and the caller's keyboard shortcuts, which
 * need React and a live editor respectively — so this list stays usable from
 * a plain function, which is what the bridge is.
 */
export const contentExtensions = [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Bold,
    Italic,
    Strike,
    Code,
    Link.configure({ openOnClick: false }),
    BulletList,
    OrderedList,
    ListItem,
    Image,
];
