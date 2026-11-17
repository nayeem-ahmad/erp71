'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Input, SkeletonBar } from '@/components/ui';
import { RichTextEditor } from '@/components/ui/LazyRichTextEditor';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatMessage, useI18n } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import type { Note } from './types';
import { useNoteImageUpload } from './useNoteImageUpload';

/** How long typing has to pause before the note is saved. */
const AUTOSAVE_DELAY_MS = 800;

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface NoteEditorProps {
    noteId: string;
    /** A save (or pin) landed: the list moves the note into its new place. */
    onSaved: (note: Note) => void;
    onDeleted: (id: string) => void;
    /** Phone layout: back to the list. */
    onBack: () => void;
}

/**
 * One note, open for editing. Saves itself a moment after typing stops, and
 * once more on the way out — keyed by note id, so switching notes unmounts
 * this and flushes whatever was still pending.
 *
 * Never saves mid-upload: until a picture lands, the document holds a `blob:`
 * URL that means nothing outside this tab.
 */
export function NoteEditor({ noteId, onSaved, onDeleted, onBack }: NoteEditorProps) {
    const { t, locale } = useI18n();
    const m = t.notes;
    const uploadImage = useNoteImageUpload();

    const [note, setNote] = useState<Note | null>(null);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [saveState, setSaveState] = useState<SaveState>('saved');
    const [uploading, setUploading] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    /** What the server last confirmed, to tell an edit from a no-op. */
    const persisted = useRef({ title: '', content: '' });
    /** This render's text, for a save that runs after the render it was scheduled in. */
    const draft = useRef({ title, content });
    draft.current = { title, content };
    const uploadingRef = useRef(false);
    uploadingRef.current = uploading;
    /** Saves run one after another, so an older body can never land last. */
    const queue = useRef<Promise<void>>(Promise.resolve());
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const deletedRef = useRef(false);

    useEffect(() => {
        let live = true;
        api.getNote(noteId)
            .then((loaded) => {
                if (!live) return;
                persisted.current = { title: loaded.title, content: loaded.content };
                setNote(loaded);
                setTitle(loaded.title);
                setContent(loaded.content);
            })
            .catch((error: unknown) => {
                if (live) toast.error(error instanceof Error && error.message ? error.message : m.openFailed);
            });
        return () => {
            live = false;
        };
    }, [noteId, m.openFailed]);

    const save = useCallback(() => {
        queue.current = queue.current.then(async () => {
            if (deletedRef.current) return;
            const next = { ...draft.current };
            const last = persisted.current;
            if (next.title === last.title && next.content === last.content) return;
            setSaveState('saving');
            try {
                const saved = await api.updateNote(noteId, { title: next.title, content: next.content });
                persisted.current = next;
                setNote(saved);
                onSavedRef.current(saved);
                const now = draft.current;
                setSaveState(now.title === next.title && now.content === next.content ? 'saved' : 'dirty');
            } catch (error: unknown) {
                setSaveState('error');
                toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
            }
        });
        return queue.current;
    }, [noteId, m.saveFailed]);

    // Autosave after a pause in typing — held while a picture is uploading.
    useEffect(() => {
        if (!note) return;
        const dirty = title !== persisted.current.title || content !== persisted.current.content;
        if (!dirty) return;
        setSaveState((current) => (current === 'saving' ? current : 'dirty'));
        if (uploading) return;
        const timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [title, content, uploading, note, save]);

    // Leaving for another note (or page) saves what the timer had not got to yet.
    useEffect(
        () => () => {
            const now = draft.current;
            const last = persisted.current;
            if (!uploadingRef.current && (now.title !== last.title || now.content !== last.content)) {
                void save();
            }
        },
        [save],
    );

    // Closing the tab with an edit still pending asks first.
    const unsaved = saveState === 'dirty' || saveState === 'saving' || saveState === 'error' || uploading;
    useEffect(() => {
        if (!unsaved) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [unsaved]);

    const togglePin = async () => {
        if (!note) return;
        try {
            const saved = await api.updateNote(noteId, { pinned: !note.pinned });
            setNote(saved);
            onSaved({ ...saved, title: draft.current.title, content: draft.current.content });
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
        }
    };

    const remove = async () => {
        setDeleting(true);
        try {
            deletedRef.current = true;
            await api.deleteNote(noteId);
            setConfirmingDelete(false);
            onDeleted(noteId);
        } catch (error: unknown) {
            deletedRef.current = false;
            toast.error(error instanceof Error && error.message ? error.message : m.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    const statusText = uploading
        ? m.waitingForImages
        : saveState === 'saving'
          ? m.saving
          : saveState === 'dirty'
            ? m.unsaved
            : saveState === 'error'
              ? m.saveFailed
              : note
                ? `${m.saved} · ${formatMessage(m.edited, { time: formatDateTime(note.updated_at, locale) })}`
                : '';

    return (
        <section
            className="flex min-w-0 flex-1 flex-col rounded-md border border-gray-200 bg-white"
            onKeyDown={(event) => {
                // Ctrl/⌘+S saves now instead of opening the browser's "Save page".
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                    event.preventDefault();
                    if (!uploadingRef.current) void save();
                }
            }}
        >
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label={m.back} title={m.back}>
                    <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                </Button>
                <p
                    className={`min-w-0 flex-1 truncate text-xs ${saveState === 'error' ? 'text-red-600' : 'text-gray-500'}`}
                    role="status"
                    aria-live="polite"
                >
                    {statusText}
                </p>
                <Button
                    variant={note?.pinned ? 'tinted' : 'ghost'}
                    size="icon"
                    disabled={!note}
                    onClick={() => void togglePin()}
                    aria-pressed={note?.pinned ?? false}
                    aria-label={note?.pinned ? m.unpin : m.pin}
                    title={note?.pinned ? m.unpin : m.pin}
                >
                    {note?.pinned ? <PinOff className="h-4 w-4" aria-hidden /> : <Pin className="h-4 w-4" aria-hidden />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    disabled={!note}
                    onClick={() => setConfirmingDelete(true)}
                    aria-label={m.delete}
                    title={m.delete}
                >
                    <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
                </Button>
            </div>

            {note ? (
                <div className="space-y-3 p-3 md:p-4">
                    <Input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder={m.titlePlaceholder}
                        aria-label={m.titleLabel}
                        maxLength={200}
                        className="w-full text-base font-semibold"
                    />
                    <RichTextEditor
                        value={content}
                        onChange={setContent}
                        rows={16}
                        placeholder={m.bodyPlaceholder}
                        ariaLabel={m.bodyLabel}
                        uploadImage={uploadImage}
                        pasteHint={m.pasteHint}
                        onUploadingChange={setUploading}
                        onSubmit={() => void save()}
                        autoFocus={!note.content}
                    />
                </div>
            ) : (
                <div className="space-y-3 p-3 md:p-4" aria-busy>
                    <SkeletonBar className="h-8 w-1/2" />
                    <SkeletonBar className="h-40 w-full" />
                </div>
            )}

            <ConfirmDialog
                open={confirmingDelete}
                danger
                title={m.deleteTitle}
                prompt={formatMessage(m.deletePrompt, { title: title.trim() || m.untitled })}
                confirmLabel={m.deleteConfirm}
                cancelLabel={m.cancel}
                workingLabel={m.deleting}
                loading={deleting}
                onConfirm={() => void remove()}
                onCancel={() => setConfirmingDelete(false)}
            />
        </section>
    );
}
