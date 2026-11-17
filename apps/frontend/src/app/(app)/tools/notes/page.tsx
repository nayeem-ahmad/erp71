'use client';

import { useCallback, useEffect, useState } from 'react';
import { ImageIcon, Pin, Plus, Search, StickyNote } from 'lucide-react';
import { Button, Input, PageHeader, PageShell, SkeletonBar } from '@/components/ui';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { sortNotes, upsertNote } from '@/components/notes/note-list';
import type { Note, NoteSummary } from '@/components/notes/types';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/**
 * Tools → Notes: the member's own notes. A list on the left, the open note on
 * the right; on a phone, one or the other.
 */
export default function NotesPage() {
    const { t, locale } = useI18n();
    const m = t.notes;
    const [notes, setNotes] = useState<NoteSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        let live = true;
        const query = search.trim();
        const timer = setTimeout(
            async () => {
                setLoading(true);
                try {
                    const rows = await api.getNotes({ search: query || undefined });
                    if (live) setNotes(sortNotes(Array.isArray(rows) ? rows : []));
                } catch (error: unknown) {
                    if (live) toast.error(error instanceof Error && error.message ? error.message : m.loadFailed);
                } finally {
                    if (live) setLoading(false);
                }
            },
            query ? 300 : 0,
        );
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [search, m.loadFailed]);

    const createNote = async () => {
        setCreating(true);
        try {
            const note = await api.createNote({});
            setNotes((current) => upsertNote(current, note));
            setSelectedId(note.id);
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.createFailed);
        } finally {
            setCreating(false);
        }
    };

    const handleSaved = useCallback((note: Note) => {
        setNotes((current) => upsertNote(current, note));
    }, []);

    const handleDeleted = useCallback(
        (id: string) => {
            setNotes((current) => current.filter((row) => row.id !== id));
            setSelectedId((current) => (current === id ? null : current));
            toast.success(m.deleted);
        },
        [m.deleted],
    );

    const newNoteButton = (
        <Button onClick={() => void createNote()} loading={creating} disabled={creating}>
            <Plus className="h-4 w-4" aria-hidden /> {m.newNote}
        </Button>
    );

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
                actions={newNoteButton}
            />

            <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <aside
                    className={`${selectedId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col gap-2 md:sticky md:top-4 md:w-72`}
                    aria-label={m.listLabel}
                >
                    <div className="relative">
                        <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                        <Input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={m.searchPlaceholder}
                            aria-label={m.searchPlaceholder}
                            className="w-full ps-8"
                        />
                    </div>

                    <div className="rounded-md border border-gray-200 bg-white md:max-h-[70vh] md:overflow-y-auto">
                        {loading && notes.length === 0 ? (
                            <div className="space-y-3 p-3" aria-busy>
                                {[0, 1, 2].map((row) => (
                                    <div key={row} className="space-y-1.5">
                                        <SkeletonBar className="h-4 w-2/3" />
                                        <SkeletonBar className="h-3 w-full" />
                                    </div>
                                ))}
                            </div>
                        ) : notes.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                                <StickyNote className="h-10 w-10 text-gray-200" aria-hidden />
                                <p className="text-sm text-gray-500">{search.trim() ? m.emptySearch : m.empty}</p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {notes.map((note) => {
                                    const active = note.id === selectedId;
                                    return (
                                        <li key={note.id}>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedId(note.id)}
                                                aria-current={active ? 'true' : undefined}
                                                className={`block min-h-touch w-full space-y-0.5 px-3 py-2 text-start transition-colors ${
                                                    active ? 'bg-blue-50' : 'hover:bg-gray-50'
                                                }`}
                                            >
                                                <span className="flex items-center gap-1.5">
                                                    <span
                                                        className={`truncate text-sm font-medium ${active ? 'text-blue-600' : 'text-gray-900'}`}
                                                    >
                                                        {note.title || m.untitled}
                                                    </span>
                                                    {note.pinned && (
                                                        <Pin className="h-3 w-3 shrink-0 text-blue-600" aria-label={m.pinned} />
                                                    )}
                                                    {note.hasImages && (
                                                        <ImageIcon className="h-3 w-3 shrink-0 text-gray-400" aria-label={m.hasImages} />
                                                    )}
                                                </span>
                                                {note.preview && (
                                                    <span className="line-clamp-2 block text-xs text-gray-500">{note.preview}</span>
                                                )}
                                                <span className="block text-xs text-gray-400">
                                                    {formatDateTime(note.updated_at, locale)}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </aside>

                {selectedId ? (
                    <NoteEditor
                        key={selectedId}
                        noteId={selectedId}
                        onSaved={handleSaved}
                        onDeleted={handleDeleted}
                        onBack={() => setSelectedId(null)}
                    />
                ) : (
                    <div className="hidden min-h-[16rem] flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-gray-200 bg-white p-6 text-center md:flex">
                        <StickyNote className="h-12 w-12 text-gray-200" aria-hidden />
                        <p className="text-sm text-gray-500">{m.selectPrompt}</p>
                        {newNoteButton}
                    </div>
                )}
            </div>
        </PageShell>
    );
}
