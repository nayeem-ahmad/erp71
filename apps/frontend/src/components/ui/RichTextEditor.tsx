'use client';

import { useEffect, useState } from 'react';
import { Bold, Code, Italic, Link2, List, ListOrdered, Strikethrough } from 'lucide-react';
import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { docToMarkdown, markdownToDoc } from './markdown-bridge';
import { contentExtensions, Image } from './editor-extensions';
import { ResizableImage } from './ResizableImage';
import { useI18n } from '@/lib/i18n';

/**
 * A small markdown editor: a rich surface over a document that is still
 * stored as plain text. What goes in and comes out of `value` is markdown, so
 * a description written here is still readable in an export, an email or the
 * API, and there is no blob of stored HTML to sanitise on the way back out.
 *
 * It was a textarea until images arrived. A pasted screenshot could only ever
 * be a string of characters in one — it showed as `![Uploading…](#paste-1)`
 * while the bytes went up, and there is nothing to take hold of to resize
 * something that is text. The document is ProseMirror now; the storage format
 * did not change, and `markdown-bridge.ts` is the whole of the boundary.
 *
 * Given `uploadImage`, it takes an image off the clipboard: the image appears
 * at the caret straight away, from a local blob, and is left behind as a
 * markdown image once the upload lands.
 */

const COMMANDS = [
    { key: 'bold', Icon: Bold },
    { key: 'italic', Icon: Italic },
    { key: 'strike', Icon: Strikethrough },
    { key: 'code', Icon: Code },
    { key: 'bulletList', Icon: List },
    { key: 'numberedList', Icon: ListOrdered },
    { key: 'link', Icon: Link2 },
] as const;

type CommandKey = (typeof COMMANDS)[number]['key'];

export type RichTextEditorProps = {
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    maxLength?: number;
    placeholder?: string;
    /** Names the editing surface — the toolbar buttons carry their own labels. */
    ariaLabel?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    /** Ctrl/⌘+Enter. */
    onSubmit?: () => void;
    /** Escape. */
    onCancel?: () => void;
    /** Hides the "**bold**, *italic*…" line when the caller says it elsewhere. */
    hideHint?: boolean;
    /**
     * Keeps an image the user pasted and says where it landed, or returns null
     * if it could not be kept. Reporting *why* is the caller's job — it is the
     * one that knows which types and sizes it takes — and a null simply takes
     * the image back out again.
     *
     * Omitted, a pasted image falls through to whatever the browser does with
     * it, which is nothing.
     */
    uploadImage?: (file: File) => Promise<PastedImage | null>;
    /**
     * Fires when an upload starts and again when the last one lands.
     *
     * Editors that save on blur need it: committing mid-upload would store a
     * blob URL, which means nothing outside the tab that made it.
     */
    onUploadingChange?: (uploading: boolean) => void;
};

/** Where a pasted image was kept, and what to call it in the markdown. */
export type PastedImage = { url: string; name?: string };

/** Distinguishes one in-flight paste from the next. */
let pasteSequence = 0;

/**
 * The image files on the clipboard. `clipboardData.files` holds them for a
 * screenshot pasted out of the OS clipboard as well as for an image copied
 * from another page; anything without a file (plain text, HTML) leaves it
 * empty and the paste goes through untouched.
 */
function imagesOnClipboard(data: DataTransfer | null): File[] {
    return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

/** Ctrl/⌘+Enter and Escape, which belong to the caller rather than the editor. */
const Shortcuts = Extension.create<{ onSubmit?: () => void; onCancel?: () => void }>({
    name: 'richTextShortcuts',
    addOptions: () => ({ onSubmit: undefined, onCancel: undefined }),
    addKeyboardShortcuts() {
        return {
            'Mod-Enter': () => {
                const submit = this.options.onSubmit;
                if (!submit) return false;
                submit();
                return true;
            },
            Escape: () => {
                const cancel = this.options.onCancel;
                if (!cancel) return false;
                cancel();
                return true;
            },
        };
    },
});

export function RichTextEditor({
    value,
    onChange,
    rows = 6,
    maxLength,
    placeholder,
    ariaLabel,
    disabled,
    autoFocus,
    onSubmit,
    onCancel,
    hideHint,
    uploadImage,
    onUploadingChange,
}: RichTextEditorProps) {
    const { t } = useI18n();
    const m = t.components.richText;
    const [uploading, setUploading] = useState(0);

    const editor = useEditor({
        extensions: [
            // The same list the markdown bridge derives its schema from, with
            // the image node given its React view: the drag handle and the
            // upload spinner need one, and a plain function cannot hold them.
            ...contentExtensions.filter((extension) => extension.name !== 'image'),
            Image.extend({ addNodeView: () => ReactNodeViewRenderer(ResizableImage) }),
            Placeholder.configure({ placeholder: placeholder ?? '' }),
            Shortcuts.configure({ onSubmit, onCancel }),
        ],
        content: markdownToDoc(value).toJSON(),
        editable: !disabled,
        autofocus: autoFocus ? 'end' : false,
        // Next.js renders this on the server first; ProseMirror must not.
        immediatelyRender: false,
        editorProps: {
            attributes: {
                'aria-label': ariaLabel ?? '',
                role: 'textbox',
                'aria-multiline': 'true',
                // The old textarea's `rows`, which has no meaning here.
                style: `min-height: ${Math.max(rows, 2) * 1.5}rem`,
                class: 'prose-editor px-3 py-2 text-sm focus:outline-none',
            },
            handlePaste: (_view, event) => handlePaste(event as ClipboardEvent),
        },
        onUpdate: ({ editor }) => onChange(docToMarkdown(editor.state.doc)),
    });

    /*
     * Announced from an effect rather than from the upload itself, so a parent
     * that commits on "no longer uploading" is told after the replacement has
     * been rendered — told any earlier, it would read the document from the
     * render it is still in.
     *
     * `onUploadingChange` is left out of the deps on purpose: callers pass an
     * inline closure, and re-running on every render would re-announce a state
     * that has not changed.
     */
    useEffect(() => {
        onUploadingChange?.(uploading > 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploading]);

    /* The value can change from outside — a task loaded, a comment box reset
       after posting. Rewriting the document on every keystroke would fight the
       user for the caret, so this only acts when what is on screen no longer
       serializes to what was handed in. */
    useEffect(() => {
        if (!editor) return;
        if (docToMarkdown(editor.state.doc) === value) return;
        editor.commands.setContent(markdownToDoc(value).toJSON(), { emitUpdate: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, editor]);

    useEffect(() => {
        editor?.setEditable(!disabled);
    }, [disabled, editor]);

    /**
     * Finds a pasted image's node by the id it was inserted with.
     *
     * By id rather than by position, because the user goes on typing while the
     * upload runs and every keystroke moves it. This is what the textarea
     * could not do: two images pasted together both read the text before React
     * had painted the first one's edit, and the second quietly reinstated the
     * first one's placeholder.
     */
    const findPaste = (ed: Editor, pasteId: string) => {
        let found: { pos: number; size: number } | null = null;
        ed.state.doc.descendants((node, pos) => {
            if (node.type.name === 'image' && node.attrs.pasteId === pasteId) {
                found = { pos, size: node.nodeSize };
                return false;
            }
            return true;
        });
        return found as { pos: number; size: number } | null;
    };

    const runUpload = async (
        upload: NonNullable<RichTextEditorProps['uploadImage']>,
        ed: Editor,
        file: File,
        pasteId: string,
        blobUrl: string,
    ) => {
        setUploading((n) => n + 1);
        let landed: PastedImage | null = null;
        try {
            landed = await upload(file);
        } catch {
            landed = null;
        }

        // Gone from the document (the user deleted it, or the editor closed
        // while it uploaded): nothing left to replace.
        const at = findPaste(ed, pasteId);
        if (at) {
            if (landed) {
                ed.chain()
                    .command(({ tr }) => {
                        tr.setNodeMarkup(at.pos, undefined, {
                            src: landed!.url,
                            alt: landed!.name || file.name || 'image',
                            width: null,
                            uploading: false,
                            pasteId: null,
                        });
                        return true;
                    })
                    .run();
            } else {
                ed.chain().deleteRange({ from: at.pos, to: at.pos + at.size }).run();
            }
        }
        URL.revokeObjectURL(blobUrl);
        setUploading((n) => n - 1);
    };

    function handlePaste(event: ClipboardEvent): boolean {
        if (!uploadImage || disabled || !editor) return false;
        const files = imagesOnClipboard(event.clipboardData);
        // A paste carrying no image must still paste normally.
        if (files.length === 0) return false;

        /* Where the caret is — or the end of the document, if it has never
           been put anywhere. An editor that has not been focused reports a
           selection at position 0, and an image pasted into a description you
           have not clicked into belongs after what is already written, not
           jammed in front of the first word. */
        const caret = editor.isFocused ? undefined : editor.state.doc.content.size;

        for (const file of files) {
            const pasteId = `paste-${(pasteSequence += 1)}`;
            const blobUrl = URL.createObjectURL(file);
            editor
                .chain()
                .focus(caret)
                // Its own paragraph: a screenshot is not a word in a sentence,
                // and one pasted at the end of a line would otherwise sit
                // against the last word with no space between them.
                .insertContent([
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'image',
                                attrs: {
                                    src: blobUrl,
                                    alt: file.name || 'image',
                                    uploading: true,
                                    pasteId,
                                },
                            },
                        ],
                    },
                ])
                .run();
            void runUpload(uploadImage, editor, file, pasteId, blobUrl);
        }
        return true;
    }

    const run = (command: CommandKey) => {
        if (!editor || disabled) return;
        const chain = editor.chain().focus();
        if (command === 'bold') return chain.toggleBold().run();
        if (command === 'italic') return chain.toggleItalic().run();
        if (command === 'strike') return chain.toggleStrike().run();
        if (command === 'code') return chain.toggleCode().run();
        if (command === 'bulletList') return chain.toggleBulletList().run();
        if (command === 'numberedList') return chain.toggleOrderedList().run();
        if (command === 'link') {
            // Toggling off needs no target; toggling on asks for one.
            if (editor.isActive('link')) return chain.unsetLink().run();
            const href = window.prompt(m.link);
            if (!href) return;
            return chain.setLink({ href }).run();
        }
    };

    /* The old textarea enforced `maxLength` itself. Counted over the markdown,
       because that is what the caller will store and what its column is sized
       for — not over the characters on screen, which exclude the syntax. */
    const length = value.length;
    const overLimit = maxLength !== undefined && length > maxLength;

    return (
        /* Marked so a caller that commits on blur can find the whole editor —
           toolbar, input and hint — rather than the input alone. Reaching for
           bold moves focus out of the input, and a caller listening there
           would save, and close the card, every time somebody did. */
        <div
            className="space-y-1.5"
            data-rich-text-editor=""
            onKeyDown={(event) => {
                /* Kept off the document: inside a modal, Escape is also
                   "close", and abandoning the edit should not abandon the
                   card as well. TipTap's own shortcut handles the cancel —
                   this only stops the key carrying any further. */
                if (event.key === 'Escape' && onCancel) event.stopPropagation();
            }}
        >
            <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label={m.toolbar}>
                {COMMANDS.map(({ key, Icon }) => (
                    <button
                        key={key}
                        type="button"
                        disabled={disabled}
                        title={m[key]}
                        aria-label={m[key]}
                        aria-pressed={editor?.isActive(key === 'numberedList' ? 'orderedList' : key) ?? false}
                        // Keeps the selection alive: a plain click blurs the
                        // editor first, and there would be nothing to wrap.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => run(key)}
                        className="flex items-center justify-center rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 max-md:min-h-touch max-md:min-w-touch"
                    >
                        <Icon className="h-4 w-4" aria-hidden />
                    </button>
                ))}
            </div>

            <div
                className={`rounded-md border bg-white ${
                    overLimit ? 'border-danger' : 'border-gray-300'
                } focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600`}
            >
                <EditorContent editor={editor} />
            </div>

            <div className="flex items-start justify-between gap-2">
                {/* The paste line shows even where the caller hides the
                    formatting one: pasting a screenshot is not a thing anyone
                    tries on the chance that it works. */}
                {!hideHint || uploadImage ? (
                    <p className="text-xs text-gray-500">
                        {[hideHint ? null : m.hint, uploadImage ? m.pasteImage : null]
                            .filter(Boolean)
                            .join(' ')}
                    </p>
                ) : (
                    <span />
                )}
                {maxLength !== undefined && (
                    <p className={`shrink-0 text-xs ${overLimit ? 'text-danger' : 'text-gray-400'}`}>
                        {length}/{maxLength}
                    </p>
                )}
            </div>
        </div>
    );
}
