# Task images: paste, resize, and preview

Date: 2026-09-20

## The problem

Pasting a screenshot into a task description works, but it reads as
machinery rather than as an image. A placeholder — `![Uploading…](#paste-1)`
— sits in the text as an anchor-like string while the upload runs, then
becomes a markdown image that renders at whatever size the screenshot
happened to be. Attachments are a list of blue file names; opening one
throws the reader into a separate browser tab, away from the task.

Three complaints, one cause: the description editor is a plain `<textarea>`
holding plain-text markdown, so an image in it can only ever be text until
it is rendered somewhere else.

## What changes

1. A pasted image appears **as an image, immediately**, from a local blob
   URL, dimmed with a spinner until the upload lands.
2. An image in the editor can be **resized by dragging**, and the chosen
   width persists.
3. Attachments show as **thumbnails**, and clicking one opens a **preview
   modal** with zoom, pan, and paging — not a new tab.

## What does not change

The database still stores **markdown, not HTML**. This is load-bearing: a
description written here stays readable in an export, an email or the API,
and there is no blob of stored HTML to sanitise on the way back out. The
editor becomes a ProseMirror document internally, but markdown is the
format at every boundary.

`RichTextEditor`'s props contract is unchanged, so its five call sites —
the task description, both New task dialogs, and both comment boxes — are
untouched.

## Architecture

Four units, each usable and testable on its own.

### 1. `ui/RichTextEditor.tsx` — rebuilt on TipTap

Keeps its exact current props (`value`/`onChange` as markdown strings,
`uploadImage`, `onUploadingChange`, `onSubmit`, `onCancel`, `maxLength`,
`ariaLabel`, `disabled`, `autoFocus`, `hideHint`, `rows`, `placeholder`).
Internally a ProseMirror document; the markdown bridge sits at the
boundary.

The existing `RichTextEditor.test.tsx` suite encodes this contract and must
keep passing. That is the guard that the call sites need no edits.

### 2. `ui/markdown-bridge.ts` — `markdownToDoc` / `docToMarkdown`

Pure functions, no React. Most of the risk in this work lives here, so most
of the tests do too.

Scope is deliberately small: the editor has only ever produced bold,
italic, strikethrough, inline code, bullet and numbered lists, links,
paragraphs and images. The bridge covers that set and round-trips it
exactly. Anything outside it is passed through as text rather than
silently restructured.

### 3. `ui/ImagePreviewModal.tsx` — new

A `ModalShell` lightbox that knows nothing about tasks. Takes a list of
`{ url, name, mimeType }` and an index.

- Zoom: buttons, scroll-to-zoom, reset-to-fit
- Pan: drag when zoomed in
- Paging: on-screen arrows and arrow keys, across the supplied list
- Download button and open-in-new-tab, as explicit actions
- PDFs render inline in an `<iframe>`

### 4. `AttachmentsSection` — thumbnails

In `components/projects/TaskDetailPanel.tsx`. The text-link list becomes a
thumbnail grid: images render themselves small, PDFs show a PDF glyph,
anything else a generic file glyph. Name, size and the delete button stay.
A tile opens `ImagePreviewModal` at that tile's index.

`ui/Markdown.tsx` gains click-to-preview on `img`, opening the same modal,
so an image in a rendered description behaves like an attachment tile.

## The paste flow

On paste, an image node is inserted at the caret immediately, its `src` a
local `URL.createObjectURL(file)` blob and its attrs carrying
`uploading: true` and a unique `pasteId`. It renders dimmed under a
spinner. The upload runs. On success the node's `src` is rewritten to the
stored URL, `uploading` flips false, and the blob URL is revoked. On
refusal the node is removed and a toast explains why — the editor reports
nothing itself, because the caller is what knows the limits.

Three behaviours carry over from the textarea implementation. Each was a
real bug; the rewrite must not reintroduce them.

**Two images pasted together.** Previously both uploads read the textarea
before React had painted the first one's edit, so the second reinstated the
first one's placeholder — worked around with a `textRef`. In ProseMirror
each node has a stable identity: the swap locates its node by `pasteId`,
not by matching a string. This is strictly more robust than the workaround
it replaces.

**Blur-commit ordering.** The task description saves on blur. Committing
while an upload is in flight would persist the placeholder — now, worse, a
blob URL, which is meaningless outside the browser tab that made it.
`onUploadingChange` still fires from an effect *after* the swap has
rendered, and the description still waits for it. A blob URL reaching the
database is the sharpest failure mode in this work and gets an explicit
test.

**A paste carrying no image** still pastes normally.

## Resize

The image node carries a `width` attr. Selecting an image shows a drag
handle on its trailing edge; dragging sets width in CSS pixels, clamped to
a minimum of 80px and to the editor's content width at the top.

On serialize the width goes onto the URL as a query parameter, leaving the
markdown standard: `![alt](https://…/img.png?w=420)`. On parse it is read
back into the attr. `Markdown.tsx` reads the same parameter when rendering
read-only, so a reader sees the size the author chose.

An image with no width parameter renders at natural size capped to the
column — today's behaviour — so existing descriptions are unaffected.

Whether the asset host applies the parameter as a real transform (serving a
smaller file) is to be confirmed against Cloudinary during implementation.
If it does not, the parameter still governs rendered width; only the
bandwidth saving is lost.

## Testing

- **Bridge:** round-trip every construct the toolbar produces, plus an
  image mid-paragraph, two consecutive pastes, and typing during an
  in-flight upload.
- **Editor:** the existing suite, unchanged, plus a test asserting no blob
  URL can be committed.
- **Modal:** zoom, pan, paging and PDF rendering, independent of tasks.
- **Attachments:** tiles render per type and open the modal at the right
  index.

## Risks

TipTap is a real dependency (~100KB), and a markdown round-trip through
ProseMirror can lose exotic constructs. The mitigation is the narrow known
set of markdown this editor produces, pinned by the bridge tests. If a call
site's content round-trips badly, that is a revision to this spec, not a
workaround in the bridge.

## UI rules

The modal uses `ModalShell` (bottom sheet on mobile), `blue-600` for
primary actions, ≥44px touch targets, no arbitrary hex classes, and no
horizontal body scroll at 360px — per `docs/ui-design-guidelines.md`.
