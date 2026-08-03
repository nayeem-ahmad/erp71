'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
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
};

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
}: RichTextEditorProps) {
    const { t } = useI18n();
    const m = t.components.richText;
    const ref = useRef<HTMLTextAreaElement>(null);

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
                onChange={(event) => onChange(event.target.value)}
            />

            {!hideHint && <p className="text-xs text-gray-500">{m.hint}</p>}
        </div>
    );
}
