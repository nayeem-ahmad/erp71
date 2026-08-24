'use client';

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

export interface ComposerProject {
    id: string;
    code: string;
    name: string;
}

/**
 * The "Add a card" affordance at the foot of a board column, the way JIRA and
 * Trello put one at the bottom of every lane.
 *
 * A board draws cards from any project, so the project cannot be inferred from
 * the column — it is picked here and lifted to the page, which holds it across
 * columns so composing a run of cards for one project is one choice, not one
 * per card. The column, not the project's default status, decides the new
 * task's status; the server does that resolution.
 */
export default function BoardCardComposer({
    boardId,
    columnId,
    projects,
    projectId,
    onProjectChange,
    onCreated,
}: {
    boardId: string;
    columnId: string;
    projects: ComposerProject[];
    projectId: string;
    onProjectChange: (next: string) => void;
    onCreated: () => void | Promise<void>;
}) {
    const { t } = useI18n();
    const bm = t.projects.board;

    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const close = () => {
        setOpen(false);
        setTitle('');
    };

    const submit = async () => {
        const trimmed = title.trim();
        if (!trimmed || !projectId || saving) return;
        setSaving(true);
        try {
            await api.createBoardCard(boardId, columnId, { projectId, title: trimmed });
            toast.success(t.projects.task.created);
            // Stays open with the field cleared: adding cards comes in runs, and
            // reopening the composer between each one is the whole friction this
            // control exists to remove.
            setTitle('');
            inputRef.current?.focus();
            await onCreated();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : bm.createFailed);
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex min-h-touch w-full items-center gap-1.5 rounded-md px-2 py-2 text-start text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600"
            >
                <Plus className="h-3.5 w-3.5" />
                {bm.addCard}
            </button>
        );
    }

    return (
        <div className="space-y-2 rounded-md border border-blue-300 bg-white p-2">
            <Textarea
                ref={inputRef}
                autoFocus
                rows={2}
                value={title}
                aria-label={bm.addCard}
                placeholder={bm.newCardPlaceholder}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                    // Enter saves, Shift+Enter breaks the line — a card title is
                    // one line often enough that requiring a mouse click would be
                    // the wrong default.
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        submit();
                    }
                    if (event.key === 'Escape') close();
                }}
            />
            <Select
                aria-label={t.projects.fields.project}
                value={projectId}
                onChange={(event) => onProjectChange(event.target.value)}
            >
                <option value="">{t.projects.task.selectProject}</option>
                {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                        {project.code} · {project.name}
                    </option>
                ))}
            </Select>
            <div className="flex items-center gap-2">
                <Button
                    className="min-h-touch"
                    onClick={submit}
                    disabled={saving || !title.trim() || !projectId}
                >
                    {t.common.add}
                </Button>
                <Button variant="secondary" className="min-h-touch" onClick={close}>
                    {t.common.cancel}
                </Button>
            </div>
            {!projectId && <p className="text-xs text-amber-600">{t.projects.task.projectRequired}</p>}
        </div>
    );
}
