'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { assigneeColumns } from './task-assignee';
import type { ProjectAssignee } from './use-project-meta';

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
    defaultAssignee,
    assignees,
    defaultAssigneeLabel,
    onAssigneeMenuOpen,
    onCreated,
    userStory,
    projectLocked = false,
    compact = false,
}: {
    boardId: string;
    columnId: string;
    projects: ComposerProject[];
    projectId: string;
    onProjectChange: (next: string) => void;
    /**
     * Who the card lands on unless the picker below says otherwise — the
     * board's assignee filter, or the signed-in user when nothing is filtered.
     * In the `user:<id>` / `employee:<id>` key space, `''` for nobody.
     */
    defaultAssignee: string;
    /** The chosen project's roster, once the page has loaded it. */
    assignees: ProjectAssignee[];
    /** Names `defaultAssignee` while the roster is still on its way. */
    defaultAssigneeLabel: string;
    /** Fetches that roster lazily — a board need not pay for it unopened. */
    onAssigneeMenuOpen: () => void;
    onCreated: () => void | Promise<void>;
    /**
     * The story a card composed here joins — set in a story swimlane, so the
     * card lands in the row it was typed into rather than in No story.
     */
    userStory?: { id: string; code: string; title: string };
    /**
     * The project is decided by where the composer sits, not picked: a story
     * lane only takes tasks from its story's project. The picker is hidden
     * rather than disabled, because a greyed-out choice invites a question the
     * lane heading already answers.
     */
    projectLocked?: boolean;
    /**
     * A lane cell's composer: on a pointer device it stays out of sight until
     * the cell is hovered or focused, since a grouped board has one per lane
     * per column and a grid of "Add a card" buttons drowns the cards. Touch
     * has no hover, so there it is always shown.
     */
    compact?: boolean;
}) {
    const { t } = useI18n();
    const bm = t.projects.board;

    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    /**
     * Who this card goes to. `null` means "nobody has overridden it", which is
     * what lets the default keep tracking the filter — an override is a real
     * choice about one run of cards and must survive the saves in between, so
     * it cannot simply be reset after each one.
     */
    const [assignee, setAssignee] = useState<string | null>(null);
    const chosen = assignee ?? defaultAssignee;

    // Reopening the composer is a fresh start: whatever the filter says now is
    // the right default again.
    useEffect(() => {
        if (!open) setAssignee(null);
    }, [open]);

    const close = () => {
        setOpen(false);
        setTitle('');
    };

    const submit = async () => {
        const trimmed = title.trim();
        if (!trimmed || !projectId || saving) return;
        setSaving(true);
        try {
            await api.createBoardCard(boardId, columnId, {
                projectId,
                title: trimmed,
                // Both columns, every time — see the API client's note.
                ...assigneeColumns(chosen),
                ...(userStory ? { userStoryId: userStory.id } : {}),
            });
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
                className={`flex min-h-touch w-full items-center gap-1.5 rounded-md px-2 py-2 text-start text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600 ${
                    compact
                        ? 'md:min-h-0 md:py-1 md:opacity-0 md:focus:opacity-100 md:group-focus-within/cell:opacity-100 md:group-hover/cell:opacity-100'
                        : ''
                }`}
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
            {userStory && (
                <p className="truncate text-xs text-gray-500" title={userStory.title}>
                    <span className="font-mono text-blue-700">{userStory.code}</span> {userStory.title}
                </p>
            )}
            {!projectLocked && (
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
            )}
            <Select
                aria-label={bm.assignCardTo}
                value={chosen}
                onFocus={onAssigneeMenuOpen}
                onChange={(event) => setAssignee(event.target.value)}
            >
                <option value="">{t.projects.task.unassigned}</option>
                {/* The default can name somebody the roster has not arrived for
                    yet — or somebody holding a card on this board who is no
                    longer on the project's team. Either way the select must
                    still show them, or it would silently fall back to
                    "Unassigned" and quietly drop the choice on save. */}
                {chosen !== '' && !assignees.some((person) => person.value === chosen) && (
                    <option value={chosen}>{defaultAssigneeLabel}</option>
                )}
                {assignees.map((person) => (
                    <option key={person.value} value={person.value}>
                        {person.label}
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
