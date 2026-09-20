'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Bold, Code, Italic, Link2, List, ListOrdered, Strikethrough } from 'lucide-react';
import { Textarea } from './Textarea';
import { applyMarkdown, type MarkdownCommand } from '@/lib/markdown-format';
import { useI18n } from '@/lib/i18n';

/**
 * A small markdown editor: a plain textarea plus the handful of formatting
 * buttons people actually reach for. Deliberately not a WYSIWYG surface — what
 * is stored stays plain text, so a description written here is still readable
 * in an export, an email or the API, and there is no blob of stored HTML to
 * sanitise on the way back out.
 *
 * Given `uploadImage`, it also takes an image off the clipboard: a screenshot
 * pasted into a description or a comment is kept wherever the caller puts it
 * and left behind as a markdown image, which is still plain text.
 */

const COMMANDS: { key: MarkdownCommand; Icon: typeof Bold }[] = [
    { key: 'bold', Icon: Bold },
    { key: 'italic', Icon: Italic },
    { key: 'strike', Icon: Strikethrough },
    { key: 'code', Icon: Code },
    { key: 'bulletList', Icon: List },
    { key: 'numberedList', Icon: ListOrdered },
    { key: 'link', Icon: Link2 },
];

export type RichTextEditorProps = {
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    maxLength?: number;
    placeholder?: string;
    /** Names the textarea — the toolbar buttons carry their own labels. */
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
     * the placeholder back out of the text.
     *
     * Omitted, a pasted image falls through to whatever the browser does with
     * it, which is nothing.
     */
    uploadImage?: (file: File) => Promise<PastedImage | null>;
    /**
     * Fires when an upload starts and again when the last one lands.
     *
     * Editors that save on blur need it: the text holds a placeholder until the
     * upload returns, and committing in between would store that placeholder
     * instead of the image.
     */
    onUploadingChange?: (uploading: boolean) => void;
};

/** Where a pasted image was kept, and what to call it in the markdown. */
export type PastedImage = { url: string; name?: string };

/** Distinguishes one in-flight paste from the next within a single editor. */
let pasteSequence = 0;

/**
 * The image files on the clipboard. `clipboardData.files` holds them for a
 * screenshot pasted out of the OS clipboard as well as for an image copied from
 * another page; anything without a file (plain text, HTML) leaves it empty and
 * the paste goes through untouched.
 */
function imagesOnClipboard(data: DataTransfer | null): File[] {
    return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

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
    const ref = useRef<HTMLTextAreaElement>(null);
    const [uploading, setUploading] = useState(0);

    /**
     * The text as it stands, for the uploads to edit.
     *
     * Neither `value` nor the textarea's own value will do: an upload reads it
     * long after the render that started it, and two uploads landing back to
     * back both read the DOM before React has painted the first one's edit —
     * which is how the second quietly reinstated the first one's placeholder.
     * Written by every render (so typing is picked up) and by every edit made
     * here (so the next one builds on it, painted or not).
     */
    const textRef = useRef(value);
    useEffect(() => {
        textRef.current = value;
    });

    useEffect(() => {
        if (!autoFocus) return;
        const el = ref.current;
        if (!el) return;
        el.focus();
        // Caret at the end rather than the start: you nearly always arrive here
        // to add to what is already written.
        el.setSelectionRange(el.value.length, el.value.length);
        // Mount only — re-running would yank the caret back on every keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Announced from an effect rather than from the upload itself, so a parent
       that commits on "no longer uploading" is told after the replacement text
       has been rendered — told any earlier, it would read the value from the
       render it is still in and save the placeholder.

       `onUploadingChange` is left out of the deps on purpose: callers pass an
       inline closure, and re-running on every render would re-announce a state
       that has not changed. */
    useEffect(() => {
        onUploadingChange?.(uploading > 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploading]);

    const run = (command: MarkdownCommand) => {
        const el = ref.current;
        if (!el || disabled) return;
        const next = applyMarkdown(
            { value: el.value, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd },
            command,
        );
        onChange(next.value);
        // Restored after React has written the new value — setting the range
        // before the re-render would simply be undone by it.
        requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(next.selectionStart, next.selectionEnd);
        });
    };

    /** Sends `next` up and keeps `textRef` in step with it. */
    const write = (next: string) => {
        textRef.current = next;
        onChange(next);
    };

    /** Drops `text` over the selection and leaves the caret after it. */
    const insertAtCaret = (text: string) => {
        const el = ref.current;
        if (!el) return;
        // Sliced from the textarea rather than from `textRef`, because that is
        // what the caret offsets are offsets into.
        const before = el.value.slice(0, el.selectionStart);
        const after = el.value.slice(el.selectionEnd);
        // A markdown image only renders as one on a line of its own.
        const lead = before === '' || before.endsWith('\n') ? '' : '\n';
        const trail = after === '' || after.startsWith('\n') ? '' : '\n';
        const caret = before.length + lead.length + text.length;
        write(`${before}${lead}${text}${trail}${after}`);
        requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(caret, caret);
        });
    };

    /**
     * Uploads each pasted image in turn and swaps its placeholder for the real
     * link — or takes the placeholder back out if it could not be kept.
     *
     * One at a time, and the text is re-read from `textRef` before every swap
     * rather than closed over: the user goes on typing while this runs, and
     * `value` from the render that started it is stale by the time the first
     * upload lands.
     */
    const runUploads = async (
        upload: NonNullable<RichTextEditorProps['uploadImage']>,
        jobs: { file: File; placeholder: string }[],
    ) => {
        setUploading((n) => n + jobs.length);
        for (const job of jobs) {
            let landed: PastedImage | null = null;
            try {
                landed = await upload(job.file);
            } catch {
                landed = null;
            }
            const current = textRef.current;
            // Gone from the text (the editor closed, or the user deleted the
            // placeholder while it uploaded): nothing left to replace.
            if (ref.current && current.includes(job.placeholder)) {
                const alt = landed?.name || job.file.name || 'image';
                write(current.replace(job.placeholder, landed ? `![${alt}](${landed.url})` : ''));
            }
            setUploading((n) => n - 1);
        }
    };

    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        if (!uploadImage || disabled) return;
        const files = imagesOnClipboard(event.clipboardData);
        if (files.length === 0) return;
        // Only now: a paste carrying no image must still paste normally.
        event.preventDefault();

        const jobs = files.map((file) => ({
            file,
            // Kept visible in the text rather than shown beside it, so a paste
            // into the middle of a paragraph says where the image is going.
            placeholder: `![${m.uploading}](#paste-${(pasteSequence += 1)})`,
        }));
        insertAtCaret(jobs.map((job) => job.placeholder).join('\n'));
        void runUploads(uploadImage, jobs);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        const meta = event.metaKey || event.ctrlKey;
        if (meta && event.key.toLowerCase() === 'b') {
            event.preventDefault();
            return run('bold');
        }
        if (meta && event.key.toLowerCase() === 'i') {
            event.preventDefault();
            return run('italic');
        }
        if (meta && event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            return onSubmit();
        }
        if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            // Kept off the document: inside a modal, Escape is also "close",
            // and abandoning the edit should not abandon the card as well.
            event.stopPropagation();
            return onCancel();
        }
    };

    return (
        <div className="space-y-1.5">
            <div
                className="flex flex-wrap items-center gap-0.5"
                role="toolbar"
                aria-label={m.toolbar}
            >
                {COMMANDS.map(({ key, Icon }) => (
                    <button
                        key={key}
                        type="button"
                        disabled={disabled}
                        title={m[key]}
                        aria-label={m[key]}
                        // Keeps the selection alive: a plain click blurs the
                        // textarea first, and there would be nothing to wrap.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => run(key)}
                        className="flex items-center justify-center rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 max-md:min-h-touch max-md:min-w-touch"
                    >
                        <Icon className="h-4 w-4" aria-hidden />
                    </button>
                ))}
            </div>

            <Textarea
                ref={ref}
                rows={rows}
                value={value}
                maxLength={maxLength}
                disabled={disabled}
                placeholder={placeholder}
                aria-label={ariaLabel}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onChange={(event) => onChange(event.target.value)}
            />

            {/* The paste line shows even where the caller hides the formatting
                one: pasting a screenshot is not a thing anyone tries on the
                chance that it works. */}
            {(!hideHint || uploadImage) && (
                <p className="text-xs text-gray-500">
                    {[hideHint ? null : m.hint, uploadImage ? m.pasteImage : null]
                        .filter(Boolean)
                        .join(' ')}
                </p>
            )}
        </div>
    );
}
