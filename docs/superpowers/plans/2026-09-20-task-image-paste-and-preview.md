# Task Images: Paste, Resize and Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A screenshot pasted into a task description appears as an image immediately, can be dragged to a width that persists, and attachments show as thumbnails that open a zoomable preview modal instead of a new browser tab.

**Architecture:** `RichTextEditor` is rebuilt on TipTap (ProseMirror) behind its existing props contract, so its five call sites are untouched and the database still stores markdown, not HTML. A pure markdown bridge sits at the editor boundary. A task-agnostic `ImagePreviewModal` serves both the attachments grid and images inside rendered descriptions.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind, Jest + Testing Library, TipTap 3.31.3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`), `prosemirror-markdown` (ships inside `@tiptap/pm`).

**Spec:** `docs/superpowers/specs/2026-09-20-task-image-paste-and-preview-design.md`

## Global Constraints

- **Markdown is the stored format.** `value`/`onChange` are markdown strings at every boundary. No HTML reaches the database.
- **`RichTextEditor`'s props contract is unchanged:** `value`, `onChange`, `rows`, `maxLength`, `placeholder`, `ariaLabel`, `disabled`, `autoFocus`, `onSubmit`, `onCancel`, `hideHint`, `uploadImage`, `onUploadingChange`. The five call sites get no edits.
- **Serializer:** use `prosemirror-markdown` from `@tiptap/pm/markdown`. Do **not** add the third-party `tiptap-markdown` package (0.9.0, last touched 2025-09).
- **A blob URL must never be committed.** `onUploadingChange` fires from an effect after the swap has rendered.
- **UI rules** (`docs/ui-design-guidelines.md`): `ModalShell` for every modal, `blue-600` the only accent, ≥44px touch targets (`min-h-touch`), no arbitrary hex classes, no `rounded-2xl`/`rounded-3xl`, no horizontal body scroll at 360px.
- **i18n:** every user-visible string goes in all ten locale files (`en`, `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur`). Non-English locales take the English string unless an obvious translation exists — that is the established pattern in this repo.
- **Branch:** work on `dev`. Never commit to `main`.
- Run tests from `apps/frontend` with `npm test -- <path>`.

---

### Task 1: The markdown bridge

The riskiest unit, built first and in isolation: pure functions, no React, no TipTap editor instance.

**Files:**
- Create: `apps/frontend/src/components/ui/markdown-bridge.ts`
- Test: `apps/frontend/src/components/ui/markdown-bridge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `editorSchema: Schema` — the ProseMirror schema shared by the bridge and the editor. StarterKit's nodes minus headings/blockquote/table, plus an `image` node whose attrs are `{ src, alt, width, uploading, pasteId }`.
  - `markdownToDoc(markdown: string): Node` — parses markdown into a ProseMirror doc.
  - `docToMarkdown(doc: Node): string` — serializes a doc back to markdown.
  - `widthFromUrl(url: string): number | null` — reads the `?w=` parameter.
  - `urlWithWidth(url: string, width: number | null): string` — sets or removes it.

- [ ] **Step 1: Add the dependencies**

```bash
cd apps/frontend
npm install @tiptap/react@3.31.3 @tiptap/core@3.31.3 @tiptap/pm@3.31.3 @tiptap/starter-kit@3.31.3
```

- [ ] **Step 2: Write the failing width-parameter tests**

Create `apps/frontend/src/components/ui/markdown-bridge.test.ts`:

```typescript
import { widthFromUrl, urlWithWidth, markdownToDoc, docToMarkdown } from './markdown-bridge';

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
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd apps/frontend && npm test -- markdown-bridge`
Expected: FAIL — `markdown-bridge` has no such exports.

- [ ] **Step 4: Implement the width helpers**

Create `apps/frontend/src/components/ui/markdown-bridge.ts`:

```typescript
/**
 * The width an author dragged an image to, carried on the URL as `?w=`.
 *
 * On the URL rather than in a custom `![alt|420](url)` syntax, so what is
 * stored stays standard markdown: it renders correctly in an export, an
 * email or anything else pointed at the description, and the asset host can
 * serve the smaller file rather than shipping a full screenshot to be
 * scaled down in the browser.
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
    return isRelative(original) ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
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
```

- [ ] **Step 5: Run the width tests to confirm they pass**

Run: `cd apps/frontend && npm test -- markdown-bridge`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the failing round-trip tests**

Append to `markdown-bridge.test.ts`:

```typescript
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
        ['a bullet list', '* one\n* two'],
        ['a numbered list', '1. one\n2. two'],
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
        const image = doc.firstChild?.firstChild ?? doc.firstChild;
        expect(image?.attrs.width).toBe(420);
    });

    it('is empty for an empty string', () => {
        expect(roundTrip('')).toBe('');
    });

    it('leaves out an image that is still uploading', () => {
        // The description saves on blur, and a blob URL means nothing
        // outside the tab that made it. The value must not be able to
        // carry one — this is the structural guarantee behind that.
        const doc = editorSchema.node('doc', null, [
            editorSchema.node('paragraph', null, [editorSchema.text('Before')]),
            editorSchema.node('image', {
                src: 'blob:https://app/9f2c',
                alt: 'shot.png',
                uploading: true,
                pasteId: 'p1',
            }),
        ]);
        const markdown = docToMarkdown(doc);
        expect(markdown).not.toContain('blob:');
        expect(markdown).toBe('Before');
    });
});
```

Import `editorSchema` alongside the others at the top of the test file.

- [ ] **Step 7: Run to confirm they fail**

Run: `cd apps/frontend && npm test -- markdown-bridge`
Expected: FAIL — `markdownToDoc` is not defined.

- [ ] **Step 8: Implement the schema and the bridge**

Append to `markdown-bridge.ts`:

```typescript
import { Schema, type Node } from '@tiptap/pm/model';
import { schema as basicSchema } from '@tiptap/pm/schema-basic';
import { addListNodes } from '@tiptap/pm/schema-list';
import {
    MarkdownParser,
    MarkdownSerializer,
    defaultMarkdownParser,
    defaultMarkdownSerializer,
} from '@tiptap/pm/markdown';

/**
 * The editor's document shape, shared by the bridge and the editor itself so
 * neither can drift from the other.
 *
 * Deliberately narrow — paragraphs, the marks the toolbar offers, lists and
 * images. Headings, blockquotes and tables are left out because the toolbar
 * has never offered them, and a schema that admits them is a schema whose
 * round-trip has to be proved for them too.
 */
const withLists = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');

export const editorSchema = new Schema({
    nodes: withLists
        .remove('heading')
        .remove('blockquote')
        .remove('horizontal_rule')
        .remove('code_block')
        .update('image', {
            inline: false,
            group: 'block',
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
                    getAttrs: (dom: HTMLElement) => ({
                        src: dom.getAttribute('src'),
                        alt: dom.getAttribute('alt'),
                        width: dom.hasAttribute('width') ? Number(dom.getAttribute('width')) : null,
                    }),
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
    marks: basicSchema.spec.marks.remove('code').addToEnd('code', {
        parseDOM: [{ tag: 'code' }],
        toDOM: () => ['code', 0],
    }).addToEnd('strike', {
        parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
        toDOM: () => ['s', 0],
    }),
});

/**
 * Parsing and serializing reuse prosemirror-markdown's defaults, with the
 * image rule taught about `?w=` and strikethrough added — the default table
 * of tokens predates GFM's `~~`.
 */
const parser = new MarkdownParser(editorSchema, defaultMarkdownParser.tokenizer, {
    ...defaultMarkdownParser.tokens,
    image: {
        node: 'image',
        getAttrs: (token: { attrGet: (name: string) => string | null }) => {
            const src = token.attrGet('src') ?? '';
            return { src, alt: token.attrGet('alt') || null, width: widthFromUrl(src) };
        },
    },
    s: { mark: 'strike' },
});

const serializer = new MarkdownSerializer(
    {
        ...defaultMarkdownSerializer.nodes,
        image: (state, node) => {
            // A paste still in flight is not part of the document yet: its
            // src is a blob URL that means nothing outside this tab, and the
            // description saves on blur. Leaving it out here is what makes it
            // impossible for one to reach the database.
            if (node.attrs.uploading) return;
            // The width lives on the URL, so a reader outside the app still
            // gets a valid image link.
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
```

Note the markdown-it tokenizer must have strikethrough enabled; if `defaultMarkdownParser.tokenizer` does not emit `s` tokens, construct one with `markdownit('commonmark', { html: false }).enable('strikethrough')` and pass that instead.

- [ ] **Step 9: Run the full bridge suite**

Run: `cd apps/frontend && npm test -- markdown-bridge`
Expected: PASS. If a round-trip case fails on whitespace (a trailing newline, `*` vs `-` bullets), fix the **test's expectation** to the serializer's canonical form only where the difference is cosmetic and round-trips stably — a second pass through `roundTrip` must be a fixed point. Do not loosen an assertion to hide a lost construct.

- [ ] **Step 10: Commit**

```bash
cd /Users/bs01621/Projects/nayeem/erp71
git add apps/frontend/src/components/ui/markdown-bridge.ts apps/frontend/src/components/ui/markdown-bridge.test.ts apps/frontend/package.json package-lock.json
git commit -m "feat(ui): a markdown bridge for the editor, with image widths on the URL

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `RichTextEditor` on TipTap, behind its current contract

**Files:**
- Modify: `apps/frontend/src/components/ui/RichTextEditor.tsx` (whole file)
- Modify: `apps/frontend/src/components/ui/RichTextEditor.test.tsx` (rewrite the assertions, keep every behaviour)
- Modify: `apps/frontend/jest.config.ts` (TipTap ships ESM)

**Interfaces:**
- Consumes: `editorSchema`, `markdownToDoc`, `docToMarkdown`, `urlWithWidth` from Task 1.
- Produces: `RichTextEditor` with its props unchanged, and the exported type `PastedImage = { url: string; name?: string }`.

**The existing tests must be rewritten, not deleted.** They assert against
`textarea.value`, which no longer exists — but each one pins a real behaviour.
Port every case to the new surface: the assertions change, the behaviours do
not. A deleted case is a lost guarantee.

- [ ] **Step 1: Let Jest transform TipTap's ESM**

In `apps/frontend/jest.config.ts`, add to the `esmPackages` array:

```typescript
  '@tiptap.*',
  'prosemirror-.*',
```

- [ ] **Step 2: Write the failing paste test against the new surface**

Rewrite the `Host` and `paste` helpers in `RichTextEditor.test.tsx`. The
editor is now a contenteditable, so the value is read from what the host
holds rather than from a form control:

```typescript
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RichTextEditor } from './RichTextEditor';

/** The last markdown the editor reported, as a description or comment box sees it. */
let latest = '';

function Host({
    uploadImage,
    onUploadingChange,
    initial = '',
}: {
    uploadImage?: (file: File) => Promise<{ url: string; name?: string } | null>;
    onUploadingChange?: (uploading: boolean) => void;
    initial?: string;
}) {
    const [value, setValue] = useState(initial);
    latest = value;
    return (
        <RichTextEditor
            value={value}
            onChange={(next) => { latest = next; setValue(next); }}
            ariaLabel="Description"
            uploadImage={uploadImage}
            onUploadingChange={onUploadingChange}
        />
    );
}

const image = (name = 'shot.png') => new File(['binary'], name, { type: 'image/png' });

const surface = () => screen.getByLabelText('Description');

const paste = (files: File[]) => {
    fireEvent.paste(surface(), { clipboardData: { files, getData: () => '' } });
};
```

Then port each existing case. The full set, with its new assertions:

```typescript
describe('RichTextEditor image paste', () => {
    it('shows the image straight away and swaps it for the uploaded one', async () => {
        const uploadImage = jest.fn().mockResolvedValue({ url: 'https://cdn/x.png', name: 'x.png' });
        render(<Host uploadImage={uploadImage} initial="Steps to reproduce" />);

        paste([image()]);

        // The image is on screen before the upload has landed — that is the
        // whole point of the local preview.
        const shown = await screen.findByRole('img');
        expect(shown).toHaveAttribute('src', expect.stringContaining('blob:'));
        expect(shown.closest('[data-uploading]')).toHaveAttribute('data-uploading', 'true');

        await waitFor(() => expect(latest).toBe('Steps to reproduce\n\n![x.png](https://cdn/x.png)'));
        expect(uploadImage).toHaveBeenCalledTimes(1);
        expect((uploadImage.mock.calls[0][0] as File).type).toBe('image/png');
    });

    it('never reports a blob URL as the value', async () => {
        // The description saves on blur. A blob URL in the database is a
        // dead link the moment the tab closes.
        const reported: string[] = [];
        let resolve!: (v: { url: string }) => void;
        const uploadImage = jest.fn().mockReturnValue(new Promise((r) => { resolve = r; }));

        function Watching() {
            const [value, setValue] = useState('');
            reported.push(value);
            return <RichTextEditor value={value} onChange={setValue} ariaLabel="Description" uploadImage={uploadImage} />;
        }
        render(<Watching />);

        paste([image()]);
        await screen.findByRole('img');
        await act(async () => { resolve({ url: 'https://cdn/x.png' }); });

        await waitFor(() => expect(reported.at(-1)).toContain('https://cdn/x.png'));
        expect(reported.some((v) => v.includes('blob:'))).toBe(false);
    });

    it('takes the image back out when the upload is refused', async () => {
        render(<Host uploadImage={jest.fn().mockResolvedValue(null)} initial="Before" />);
        paste([image()]);
        await waitFor(() => expect(latest).toBe('Before'));
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('takes it back out when the upload throws', async () => {
        render(<Host uploadImage={jest.fn().mockRejectedValue(new Error('offline'))} />);
        paste([image()]);
        await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
        expect(latest).toBe('');
    });

    it('keeps every image of a multi-image paste', async () => {
        const uploadImage = jest
            .fn()
            .mockImplementation(async (file: File) => ({ url: `https://cdn/${file.name}` }));
        render(<Host uploadImage={uploadImage} />);

        paste([image('one.png'), image('two.png')]);

        await waitFor(() =>
            expect(latest).toBe('![one.png](https://cdn/one.png)\n\n![two.png](https://cdn/two.png)'),
        );
    });

    it('says when an upload is in flight and when it has landed', async () => {
        const onUploadingChange = jest.fn();
        render(
            <Host
                uploadImage={jest.fn().mockResolvedValue({ url: 'https://cdn/x.png' })}
                onUploadingChange={onUploadingChange}
            />,
        );

        paste([image()]);

        await waitFor(() => expect(onUploadingChange).toHaveBeenCalledWith(true));
        await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(false));
        // Told only once the real URL is in the value, never before.
        expect(latest).toBe('![shot.png](https://cdn/x.png)');
    });

    it('leaves a paste carrying no image to the browser', () => {
        const uploadImage = jest.fn();
        render(<Host uploadImage={uploadImage} />);
        fireEvent.paste(surface(), { clipboardData: { files: [], getData: () => 'hello' } });
        expect(uploadImage).not.toHaveBeenCalled();
    });

    it('offers no paste hint where it cannot keep the image', () => {
        render(<Host />);
        expect(screen.queryByText(/Paste an image/)).not.toBeInTheDocument();
    });

    it('says an image can be pasted where one can', () => {
        render(<Host uploadImage={jest.fn()} />);
        expect(screen.getByText(/Paste an image to attach it\./)).toBeInTheDocument();
    });
});

describe('RichTextEditor markdown contract', () => {
    it('renders the markdown it is given', async () => {
        render(<Host initial="A **bold** word." />);
        await waitFor(() => expect(screen.getByText('bold').tagName).toBe('STRONG'));
    });

    it('reports markdown, not HTML, as the user types', async () => {
        render(<Host initial="Hello" />);
        const box = surface();
        await act(async () => {
            fireEvent.input(box, { target: { textContent: 'Hello there' } });
        });
        await waitFor(() => expect(latest).not.toContain('<'));
    });
});
```

- [ ] **Step 3: Run to confirm they fail**

Run: `cd apps/frontend && npm test -- RichTextEditor`
Expected: FAIL — the component is still a textarea, so `getByRole('img')` finds nothing.

- [ ] **Step 4: Rebuild the component**

Rewrite `apps/frontend/src/components/ui/RichTextEditor.tsx`. Keep the file's
existing header comment, updated: the editor is now ProseMirror-backed, and
the reason markdown is still the stored format is unchanged and still worth
stating.

Structure:

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
// ... toolbar icons as now

export type PastedImage = { url: string; name?: string };
export type RichTextEditorProps = { /* unchanged — copy from the current file */ };

let pasteSequence = 0;

export function RichTextEditor({ value, onChange, /* … */ uploadImage, onUploadingChange }: RichTextEditorProps) {
    const [uploading, setUploading] = useState(0);

    const editor = useEditor({
        // The shared schema from Task 1, wrapped as TipTap extensions, with
        // the image node rendered by a React node view so it can show a
        // spinner and carry a drag handle (Task 3).
        extensions: [/* … */],
        content: markdownToDoc(value).toJSON(),
        // Next.js renders this on the server first; TipTap must not.
        immediatelyRender: false,
        editorProps: {
            attributes: { 'aria-label': ariaLabel ?? '', role: 'textbox', 'aria-multiline': 'true' },
            handlePaste: (view, event) => { /* see below */ },
        },
        onUpdate: ({ editor }) => onChange(docToMarkdown(editor.state.doc)),
    });

    /* Announced from an effect rather than from the upload itself, so a parent
       that commits on "no longer uploading" is told after the replacement has
       been rendered — told any earlier it would read the doc from the render
       it is still in and save a blob URL. */
    useEffect(() => {
        onUploadingChange?.(uploading > 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploading]);

    // …
}
```

The paste handler, and the swap that replaces the textarea's `textRef` dance:

```typescript
/**
 * Puts each pasted image in at the caret straight away, from a local blob, and
 * swaps its `src` for the stored URL once the upload lands.
 *
 * Located by `pasteId` rather than by matching text: two images pasted
 * together used to race — both read the textarea before React had painted the
 * first one's edit, and the second quietly reinstated the first one's
 * placeholder. A node keeps its identity across edits, so there is nothing
 * left to race.
 */
const runUpload = async (upload: NonNullable<RichTextEditorProps['uploadImage']>, file: File, pasteId: string, blobUrl: string) => {
    setUploading((n) => n + 1);
    let landed: PastedImage | null = null;
    try {
        landed = await upload(file);
    } catch {
        landed = null;
    }

    const found = findByPasteId(editor, pasteId);
    if (found) {
        if (landed) {
            editor.chain().setNodeAttrsAt(found.pos, {
                src: landed.url,
                alt: landed.name || file.name || 'image',
                uploading: false,
                pasteId: null,
            }).run();
        } else {
            editor.chain().deleteRange({ from: found.pos, to: found.pos + found.node.nodeSize }).run();
        }
    }
    URL.revokeObjectURL(blobUrl);
    setUploading((n) => n - 1);
};
```

`findByPasteId` walks `editor.state.doc.descendants` for an image node whose
`attrs.pasteId` matches, returning `{ node, pos }` or null — the node may be
gone because the user deleted it or the editor closed while the upload ran.

The image node view renders `<img src={node.attrs.src}>` wrapped in a
container carrying `data-uploading={String(node.attrs.uploading)}`; when
uploading it dims the image (`opacity-50`) and overlays a centred spinner.

The "never reports a blob URL" test passes structurally rather than by
care: Task 1's serializer already leaves out any node still `uploading`, so
the value this component reports simply cannot contain a blob URL. Do not
add a second guard here — one place, already tested.

Keep the toolbar, the `maxLength` counter, the hint line, `onSubmit`
(Ctrl/⌘+Enter), `onCancel` (Escape) and `autoFocus` (caret at the end)
working exactly as they do now, driven through TipTap commands instead of
`applyMarkdown`.

- [ ] **Step 5: Run the editor suite**

Run: `cd apps/frontend && npm test -- RichTextEditor`
Expected: PASS, including the blob-URL guard.

- [ ] **Step 6: Run the suites of all five call sites**

Run: `cd apps/frontend && npm test -- TaskDetailPanel TaskQuickAdd`
Expected: PASS with no edits to those files. If a call site needs changing,
stop — the contract has been broken, and that is a plan revision, not a
patch to the call site.

- [ ] **Step 7: Commit**

```bash
cd /Users/bs01621/Projects/nayeem/erp71
git add apps/frontend/src/components/ui/RichTextEditor.tsx apps/frontend/src/components/ui/RichTextEditor.test.tsx apps/frontend/src/components/ui/markdown-bridge.ts apps/frontend/jest.config.ts
git commit -m "feat(ui): show a pasted image as it uploads, not as placeholder text

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Drag to resize

**Files:**
- Modify: `apps/frontend/src/components/ui/RichTextEditor.tsx` (the image node view)
- Create: `apps/frontend/src/components/ui/ResizableImage.tsx`
- Test: `apps/frontend/src/components/ui/ResizableImage.test.tsx`

**Interfaces:**
- Consumes: `editorSchema` (the `width` attr), `urlWithWidth`.
- Produces: `ResizableImage`, the TipTap node-view component — props are TipTap's `NodeViewProps` (`node`, `updateAttributes`, `selected`).

- [ ] **Step 1: Write the failing resize tests**

Create `apps/frontend/src/components/ui/ResizableImage.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ResizableImage } from './ResizableImage';

const props = (overrides = {}) => ({
    node: { attrs: { src: 'https://cdn/x.png', alt: 'shot', width: null, uploading: false } },
    updateAttributes: jest.fn(),
    selected: true,
    ...overrides,
} as never);

/** The editor's content box, which the drag is clamped to. */
const stubContentWidth = (px: number) => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: px });
};

describe('ResizableImage', () => {
    beforeEach(() => stubContentWidth(800));

    it('shows no handle when the image is not selected', () => {
        render(<ResizableImage {...props({ selected: false })} />);
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('shows a handle when it is selected', () => {
        render(<ResizableImage {...props()} />);
        expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('writes the dragged width back to the node', () => {
        const updateAttributes = jest.fn();
        render(<ResizableImage {...props({ updateAttributes })} />);

        const handle = screen.getByRole('slider');
        fireEvent.pointerDown(handle, { clientX: 400 });
        fireEvent.pointerMove(window, { clientX: 300 });
        fireEvent.pointerUp(window, { clientX: 300 });

        expect(updateAttributes).toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number) }));
        expect(updateAttributes.mock.calls.at(-1)[0].width).toBeLessThan(400);
    });

    it('never goes below the minimum width', () => {
        const updateAttributes = jest.fn();
        render(<ResizableImage {...props({ node: { attrs: { src: 'https://cdn/x.png', alt: '', width: 100, uploading: false } }, updateAttributes })} />);

        const handle = screen.getByRole('slider');
        fireEvent.pointerDown(handle, { clientX: 100 });
        fireEvent.pointerMove(window, { clientX: -500 });
        fireEvent.pointerUp(window, { clientX: -500 });

        expect(updateAttributes.mock.calls.at(-1)[0].width).toBeGreaterThanOrEqual(80);
    });

    it('never grows past the editor width', () => {
        const updateAttributes = jest.fn();
        render(<ResizableImage {...props({ node: { attrs: { src: 'https://cdn/x.png', alt: '', width: 700, uploading: false } }, updateAttributes })} />);

        const handle = screen.getByRole('slider');
        fireEvent.pointerDown(handle, { clientX: 700 });
        fireEvent.pointerMove(window, { clientX: 5000 });
        fireEvent.pointerUp(window, { clientX: 5000 });

        expect(updateAttributes.mock.calls.at(-1)[0].width).toBeLessThanOrEqual(800);
    });

    it('offers no handle while the image is still uploading', () => {
        render(<ResizableImage {...props({ node: { attrs: { src: 'blob:x', alt: '', width: null, uploading: true } } })} />);
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('takes the keyboard as well as the pointer', () => {
        const updateAttributes = jest.fn();
        render(<ResizableImage {...props({ node: { attrs: { src: 'https://cdn/x.png', alt: '', width: 400, uploading: false } }, updateAttributes })} />);

        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });

        expect(updateAttributes).toHaveBeenCalledWith(expect.objectContaining({ width: 380 }));
    });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `cd apps/frontend && npm test -- ResizableImage`
Expected: FAIL — no such module.

- [ ] **Step 3: Implement `ResizableImage`**

```typescript
'use client';

import { useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/** Small enough to be a thumbnail, large enough to still be an image. */
const MIN_WIDTH = 80;
/** One arrow key press. */
const STEP = 20;

export function ResizableImage({ node, updateAttributes, selected }: NodeViewProps) {
    const { t } = useI18n();
    const m = t.components.richText;
    const wrapper = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const { src, alt, width, uploading } = node.attrs;

    /** The column the image sits in — it may not grow past it. */
    const maxWidth = () => wrapper.current?.parentElement?.offsetWidth ?? Infinity;

    const clamp = (next: number) => Math.round(Math.min(Math.max(next, MIN_WIDTH), maxWidth()));

    const startDrag = (event: React.PointerEvent) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width ?? wrapper.current?.querySelector('img')?.offsetWidth ?? MIN_WIDTH;
        setDragging(true);

        const move = (e: PointerEvent) => {
            // Trailing edge: dragging away from the start grows it. In RTL the
            // inline end is on the left, so the sign follows the direction.
            const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
            const delta = (e.clientX - startX) * (rtl ? -1 : 1);
            updateAttributes({ width: clamp(startWidth + delta) });
        };
        const stop = () => {
            setDragging(false);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        const current = width ?? wrapper.current?.querySelector('img')?.offsetWidth ?? MIN_WIDTH;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            updateAttributes({ width: clamp(current - STEP) });
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            updateAttributes({ width: clamp(current + STEP) });
        }
    };

    return (
        <NodeViewWrapper ref={wrapper} className="relative my-2 inline-block max-w-full" data-uploading={String(!!uploading)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt={alt ?? ''}
                referrerPolicy="no-referrer"
                style={width ? { width: `${width}px` } : undefined}
                className={`max-w-full rounded-md border border-gray-200 ${uploading ? 'opacity-50' : ''}`}
            />
            {uploading && (
                <span className="absolute inset-0 flex items-center justify-center" aria-label={m.uploading}>
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                </span>
            )}
            {selected && !uploading && (
                <span
                    role="slider"
                    tabIndex={0}
                    aria-label={m.resizeImage}
                    aria-valuenow={width ?? 0}
                    aria-valuemin={MIN_WIDTH}
                    aria-valuemax={Math.round(maxWidth())}
                    onPointerDown={startDrag}
                    onKeyDown={onKeyDown}
                    className={`absolute inset-y-0 end-0 flex w-3 cursor-ew-resize items-center justify-center rounded-e-md bg-blue-600/80 ${dragging ? 'bg-blue-600' : ''}`}
                >
                    <span className="h-6 w-0.5 rounded bg-white" />
                </span>
            )}
        </NodeViewWrapper>
    );
}
```

- [ ] **Step 4: Wire it into the editor as the image node view**

In `RichTextEditor.tsx`, give the image extension
`addNodeView: () => ReactNodeViewRenderer(ResizableImage)`.

- [ ] **Step 5: Add the two new strings to all ten locales**

In each of `apps/frontend/src/lib/localization/messages/<locale>/components.ts`,
under `richText`, add `resizeImage`. `uploading` already exists — reuse it.

English: `resizeImage: 'Resize image'`. Other locales take the English string
unless an obvious translation exists.

- [ ] **Step 6: Run the suite**

Run: `cd apps/frontend && npm test -- ResizableImage RichTextEditor`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/bs01621/Projects/nayeem/erp71
git add apps/frontend/src/components/ui/ResizableImage.tsx apps/frontend/src/components/ui/ResizableImage.test.tsx apps/frontend/src/components/ui/RichTextEditor.tsx apps/frontend/src/lib/localization/messages
git commit -m "feat(ui): drag an image in the editor to a width that sticks

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ImagePreviewModal`

Task-agnostic, so it is built and tested before anything uses it.

**Files:**
- Create: `apps/frontend/src/components/ui/ImagePreviewModal.tsx`
- Test: `apps/frontend/src/components/ui/ImagePreviewModal.test.tsx`
- Modify: `apps/frontend/src/components/ui/index.ts` (export it)
- Modify: the ten `components.ts` locale files

**Interfaces:**
- Consumes: `ModalShell`.
- Produces:
  ```typescript
  export type PreviewItem = { url: string; name: string; mimeType?: string | null };
  export function ImagePreviewModal(props: {
      items: PreviewItem[];
      index: number;
      onIndexChange: (index: number) => void;
      onClose: () => void;
  }): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing tests**

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ImagePreviewModal, type PreviewItem } from './ImagePreviewModal';

const items: PreviewItem[] = [
    { url: 'https://cdn/one.png', name: 'one.png', mimeType: 'image/png' },
    { url: 'https://cdn/two.pdf', name: 'two.pdf', mimeType: 'application/pdf' },
    { url: 'https://cdn/three.png', name: 'three.png', mimeType: 'image/png' },
];

const open = (index = 0, onIndexChange = jest.fn(), onClose = jest.fn()) => {
    render(<ImagePreviewModal items={items} index={index} onIndexChange={onIndexChange} onClose={onClose} />);
    return { onIndexChange, onClose };
};

describe('ImagePreviewModal', () => {
    it('shows the image at the given index', () => {
        open(0);
        expect(screen.getByRole('img', { name: 'one.png' })).toHaveAttribute('src', 'https://cdn/one.png');
    });

    it('renders a PDF inline rather than as an image', () => {
        open(1);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByTitle('two.pdf')).toHaveAttribute('src', 'https://cdn/two.pdf');
    });

    it('steps to the next item', () => {
        const { onIndexChange } = open(0);
        fireEvent.click(screen.getByLabelText('Next'));
        expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('steps to the previous item', () => {
        const { onIndexChange } = open(1);
        fireEvent.click(screen.getByLabelText('Previous'));
        expect(onIndexChange).toHaveBeenCalledWith(0);
    });

    it('wraps around at the end', () => {
        const { onIndexChange } = open(2);
        fireEvent.click(screen.getByLabelText('Next'));
        expect(onIndexChange).toHaveBeenCalledWith(0);
    });

    it('steps with the arrow keys', () => {
        const { onIndexChange } = open(0);
        fireEvent.keyDown(document, { key: 'ArrowRight' });
        expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('offers no paging for a single item', () => {
        render(<ImagePreviewModal items={[items[0]]} index={0} onIndexChange={jest.fn()} onClose={jest.fn()} />);
        expect(screen.queryByLabelText('Next')).not.toBeInTheDocument();
    });

    it('zooms in and back to fit', () => {
        open(0);
        const image = screen.getByRole('img', { name: 'one.png' });
        expect(image).toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' });

        fireEvent.click(screen.getByLabelText('Zoom in'));
        expect(image).not.toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' });

        fireEvent.click(screen.getByLabelText('Reset zoom'));
        expect(image).toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' });
    });

    it('zooms with the wheel', () => {
        open(0);
        fireEvent.wheel(screen.getByTestId('preview-stage'), { deltaY: -100 });
        expect(screen.getByRole('img', { name: 'one.png' })).not.toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' });
    });

    it('pans only once zoomed in', () => {
        open(0);
        const stage = screen.getByTestId('preview-stage');
        const image = screen.getByRole('img', { name: 'one.png' });

        fireEvent.pointerDown(stage, { clientX: 0 });
        fireEvent.pointerMove(stage, { clientX: 50 });
        expect(image).toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' });

        fireEvent.click(screen.getByLabelText('Zoom in'));
        fireEvent.pointerDown(stage, { clientX: 0, clientY: 0 });
        fireEvent.pointerMove(stage, { clientX: 50, clientY: 10 });
        expect(image.style.transform).toContain('translate(50px, 10px)');
    });

    it('resets the zoom when the item changes', () => {
        const { rerender } = render(<ImagePreviewModal items={items} index={0} onIndexChange={jest.fn()} onClose={jest.fn()} />);
        fireEvent.click(screen.getByLabelText('Zoom in'));
        rerender(<ImagePreviewModal items={items} index={2} onIndexChange={jest.fn()} onClose={jest.fn()} />);
        expect(screen.getByRole('img', { name: 'three.png' })).toHaveStyle({ transform: 'scale(1) translate(0px, 0px)' });
    });

    it('offers a download and a way out to the raw file', () => {
        open(0);
        expect(screen.getByLabelText('Download')).toHaveAttribute('href', 'https://cdn/one.png');
        expect(screen.getByLabelText('Download')).toHaveAttribute('download', 'one.png');
        expect(screen.getByLabelText('Open in a new tab')).toHaveAttribute('target', '_blank');
    });

    it('shows nothing when the index is out of range', () => {
        const { container } = render(<ImagePreviewModal items={[]} index={0} onIndexChange={jest.fn()} onClose={jest.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `cd apps/frontend && npm test -- ImagePreviewModal`
Expected: FAIL — no such module.

- [ ] **Step 3: Implement the modal**

Build on `ModalShell` at size `2xl`. Key points:

- Zoom state `{ scale, x, y }`, reset whenever `index` changes.
- `scale` clamped to `[1, 5]`; wheel `deltaY < 0` zooms in, a step of 0.25.
- Pan only when `scale > 1`; pointer drag adds to `x`/`y`.
- `transform: scale(${scale}) translate(${x}px, ${y}px)` on the image, always
  set so the "fit" state is assertable.
- Paging wraps both ways; arrow keys bound on `document`, cleaned up on
  unmount. Hidden entirely when `items.length < 2`.
- PDFs (`mimeType === 'application/pdf'`) render as
  `<iframe src={url} title={name} className="h-full w-full" />`; zoom and pan
  controls are hidden for them, since the PDF viewer has its own.
- Anything neither image nor PDF: a file glyph, the name, and the download and
  open-in-tab actions.
- Buttons are `min-h-touch` on mobile, `blue-600` for the primary action.
- The stage carries `data-testid="preview-stage"`.

- [ ] **Step 4: Add the strings to all ten locales**

A new `preview` block in `components.ts`: `zoomIn`, `zoomOut`, `resetZoom`,
`next`, `previous`, `download`, `openInNewTab`, `closePreview`, `noPreview`.

English values: `'Zoom in'`, `'Zoom out'`, `'Reset zoom'`, `'Next'`,
`'Previous'`, `'Download'`, `'Open in a new tab'`, `'Close preview'`,
`'This file cannot be previewed.'`

- [ ] **Step 5: Export it**

Add `export { ImagePreviewModal } from './ImagePreviewModal';` and the
`PreviewItem` type to `apps/frontend/src/components/ui/index.ts`.

- [ ] **Step 6: Run the suite**

Run: `cd apps/frontend && npm test -- ImagePreviewModal`
Expected: PASS (14 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/bs01621/Projects/nayeem/erp71
git add apps/frontend/src/components/ui/ImagePreviewModal.tsx apps/frontend/src/components/ui/ImagePreviewModal.test.tsx apps/frontend/src/components/ui/index.ts apps/frontend/src/lib/localization/messages
git commit -m "feat(ui): a preview modal with zoom, pan and paging

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Attachment thumbnails, and images in rendered descriptions

**Files:**
- Modify: `apps/frontend/src/components/projects/TaskDetailPanel.tsx` (`AttachmentsSection`, around line 1881)
- Modify: `apps/frontend/src/components/ui/Markdown.tsx` (the `img` component)
- Test: `apps/frontend/src/components/projects/TaskDetailPanel.test.tsx` (add cases)
- Test: `apps/frontend/src/components/ui/Markdown.test.tsx` (add cases)

**Interfaces:**
- Consumes: `ImagePreviewModal`, `PreviewItem` (Task 4); `widthFromUrl` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing attachment tests**

`TaskDetailPanel.test.tsx` already has a `describe('TaskDetailPanel
attachments')` block (around line 1750) with the `panel()` and
`openTab(/^Attachments/)` idiom this file uses. Add the new cases **inside
that block**, so they share its helpers.

**One existing test must change.** `'lists what is attached'` asserts
`findByRole('link', { name: 'plan.png' })` with an `href` — a tile is a
button that opens the modal, not a link to a new tab. That is exactly the
behaviour being replaced, so rewrite that assertion; do not delete the test.

```typescript
    /** The two kinds of attachment a tile renders differently. */
    const twoFiles = () =>
        getTaskAttachments.mockResolvedValue([
            {
                id: 'a1',
                file_url: 'https://cdn/one.png',
                file_name: 'one.png',
                mime_type: 'image/png',
                file_size: 2048,
                created_at: '2026-09-20T10:00:00Z',
            },
            {
                id: 'a2',
                file_url: 'https://cdn/two.pdf',
                file_name: 'two.pdf',
                mime_type: 'application/pdf',
                file_size: 4096,
                created_at: '2026-09-20T10:00:00Z',
            },
        ]);

    it('shows an image attachment as its own thumbnail', async () => {
        twoFiles();
        panel();
        await openTab(/^Attachments/);

        expect(await screen.findByRole('img', { name: 'one.png' })).toHaveAttribute(
            'src',
            expect.stringContaining('https://cdn/one.png'),
        );
    });

    it('shows a glyph rather than a thumbnail for a PDF', async () => {
        twoFiles();
        panel();
        await openTab(/^Attachments/);

        expect(await screen.findByText('two.pdf')).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: 'two.pdf' })).not.toBeInTheDocument();
    });

    it('opens the preview modal instead of a new tab', async () => {
        twoFiles();
        panel();
        await openTab(/^Attachments/);

        fireEvent.click(await screen.findByLabelText('Preview one.png'));

        expect(await screen.findByLabelText('Zoom in')).toBeInTheDocument();
    });

    it('opens the preview at the tile that was clicked', async () => {
        twoFiles();
        panel();
        await openTab(/^Attachments/);

        fireEvent.click(await screen.findByLabelText('Preview two.pdf'));

        // The PDF, not the first attachment in the list.
        expect(await screen.findByTitle('two.pdf')).toBeInTheDocument();
    });

    it('still removes an attachment from a tile', async () => {
        twoFiles();
        deleteTaskAttachment.mockResolvedValue({});
        panel();
        await openTab(/^Attachments/);

        fireEvent.click(await screen.findByLabelText('Remove attachment one.png'));

        await waitFor(() => expect(deleteTaskAttachment).toHaveBeenCalledWith('a1'));
    });
```

And the rewritten existing case:

```typescript
    it('lists what is attached', async () => {
        getTaskAttachments.mockResolvedValue([
            {
                id: 'a1',
                file_url: 'https://cdn/plan.png',
                file_name: 'plan.png',
                mime_type: 'image/png',
                file_size: 2048,
                created_at: '2026-08-03T10:00:00Z',
            },
        ]);
        panel();
        await openTab(/^Attachments/);

        // A tile that opens the preview, rather than a link out to a tab.
        expect(await screen.findByLabelText('Preview plan.png')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'plan.png' })).not.toBeInTheDocument();
    });
```

- [ ] **Step 2: Run to confirm they fail**

Run: `cd apps/frontend && npm test -- TaskDetailPanel`
Expected: FAIL — the list renders links, not thumbnails.

- [ ] **Step 3: Rebuild the attachment list as a grid**

Replace the `<ul className="mt-2 divide-y …">` block. Each tile:

- A `button` with `aria-label={`${m.preview} ${item.file_name}`}` that sets
  the preview index.
- Images: `<img src={urlWithWidth(item.file_url, 160)} alt={item.file_name} className="h-24 w-full rounded-md border border-gray-200 object-cover" loading="lazy" referrerPolicy="no-referrer" />`
- PDFs: a `FileText` glyph on a `bg-gray-50` tile; anything else, `File`.
- Below the tile: the name (truncated) and the existing KB figure.
- The delete button stays, `min-h-touch`, `aria-label` unchanged so the
  existing test keeps passing.

Grid: `grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4`.

State: `const [previewAt, setPreviewAt] = useState<number | null>(null);`
Render `<ImagePreviewModal items={items.map(toPreviewItem)} index={previewAt} onIndexChange={setPreviewAt} onClose={() => setPreviewAt(null)} />`
when `previewAt !== null`.

Add `preview: 'Preview'` to the `attachments` block in all ten `projects.ts`
locale files.

- [ ] **Step 4: Run the attachment tests**

Run: `cd apps/frontend && npm test -- TaskDetailPanel`
Expected: PASS.

- [ ] **Step 5: Write the failing Markdown tests**

Add to `Markdown.test.tsx`:

```typescript
it('sizes an image to the width on its URL', () => {
    render(<Markdown content="![shot](https://cdn/x.png?w=420)" allowImages />);
    expect(screen.getByRole('img', { name: 'shot' })).toHaveStyle({ width: '420px' });
});

it('leaves an image with no width to the column', () => {
    render(<Markdown content="![shot](https://cdn/x.png)" allowImages />);
    expect(screen.getByRole('img', { name: 'shot' })).not.toHaveStyle({ width: '420px' });
});

it('opens a preview when an image is clicked', () => {
    render(<Markdown content="![shot](https://cdn/x.png)" allowImages />);
    fireEvent.click(screen.getByRole('img', { name: 'shot' }));
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
});

it('still drops images where they are not allowed', () => {
    render(<Markdown content="![shot](https://cdn/x.png)" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
```

- [ ] **Step 6: Run to confirm they fail**

Run: `cd apps/frontend && npm test -- Markdown`
Expected: FAIL — no width, no preview.

- [ ] **Step 7: Make images in `Markdown` sized and clickable**

In the `img` component: read `widthFromUrl(src)` and apply it as an inline
`width`, keeping the existing `max-h-80 max-w-full` cap as the ceiling. Wrap
the `img` in a `button` that opens an `ImagePreviewModal` holding just that
image. Keep `loading="lazy"` and `referrerPolicy="no-referrer"`.

The safety note at the top of the file still holds and needs a line: images
are still opt-in per call site, and the preview shows only a `src`
react-markdown already considered safe.

- [ ] **Step 8: Run the Markdown suite**

Run: `cd apps/frontend && npm test -- Markdown`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/bs01621/Projects/nayeem/erp71
git add apps/frontend/src/components/projects/TaskDetailPanel.tsx apps/frontend/src/components/projects/TaskDetailPanel.test.tsx apps/frontend/src/components/ui/Markdown.tsx apps/frontend/src/components/ui/Markdown.test.tsx apps/frontend/src/lib/localization/messages
git commit -m "feat(projects): attachment thumbnails that open a preview, not a tab

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Confirm the width transform, and verify the whole thing

**Files:**
- Possibly modify: `apps/backend/src/common/file-upload.util.ts` or `apps/frontend/src/components/ui/markdown-bridge.ts`
- Modify: `TODO.md`

- [ ] **Step 1: Find out whether the asset host honours `?w=`**

Read `apps/backend/src/common/file-upload.util.ts` and the asset service it
uses to see what a stored `file_url` looks like. Cloudinary's delivery URLs
take transforms as a **path segment** (`/upload/w_420/…`), not a query
parameter — so `?w=420` is very likely inert as a transform.

That is acceptable and was anticipated in the spec: the parameter still
governs the rendered width, which is the feature. If it is inert, add a
comment in `markdown-bridge.ts` saying so, so nobody later assumes the bytes
are smaller than they are.

If a path-segment transform is easy to derive from the stored URL, a helper
that rewrites `/upload/` to `/upload/w_420/` for rendering only — never for
storage — is a worthwhile follow-up. Add it to `TODO.md` rather than
building it here; it is not what was asked for.

- [ ] **Step 2: Run the whole frontend suite**

Run: `cd apps/frontend && npm test`
Expected: PASS. Any failure outside the files this plan touched is a
regression from the editor rewrite — fix it before continuing.

- [ ] **Step 3: Lint and type-check**

Run: `cd apps/frontend && npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Build**

Run: `cd apps/frontend && npm run build`
Expected: success. TipTap is client-only — a failure here most likely means a
missing `'use client'` or `immediatelyRender: false`.

- [ ] **Step 5: Try it in the browser**

Run the app, open a task, and check by hand:
- Paste a screenshot into the description: it appears at once, dimmed, then
  settles. The description saves the real URL, not a blob.
- Drag its edge: it resizes; reopen the task and the size is still there.
- The attachments tab shows thumbnails; clicking one opens the modal; zoom,
  pan, paging, download all work; a PDF renders inline.
- At 360px wide: no horizontal scroll, tiles and buttons are tappable.

- [ ] **Step 6: Update `TODO.md`**

Per `CLAUDE.md`: check off the items this work completes, move them to
`## COMPLETED` with today's date and a short note, and add any follow-ups
found along the way (the Cloudinary path-segment transform, if it turned out
to be inert).

- [ ] **Step 7: Commit and open the PR**

```bash
cd /Users/bs01621/Projects/nayeem/erp71
git add TODO.md apps/frontend/src/components/ui/markdown-bridge.ts
git commit -m "docs: record the task image paste and preview work in TODO.md

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin dev
```

Then open a PR `dev` → `main`, ending the description with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
