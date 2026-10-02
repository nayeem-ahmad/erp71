'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Select, Textarea } from '@/components/ui';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { assigneeColumns } from './task-assignee';
import type { ProjectAssignee } from './use-project-meta';

export interface ComposerProject {
    id: string;
    code: string;
    name: string;
}

/** The card the composer asks its caller to save. */
export interface ComposerCard {
    projectId: string;
    title: string;
    /** Both columns, every time — see `assigneeColumns`. */
    assigneeId: string;
    assigneeEmployeeId: string;
    userStoryId?: string;
}

/** What the composer hands the New Task form, so nothing typed is lost on the way. */
export interface ComposerDraft {
    title: string;
    /** The holder the card would have gone to, in the `user:`/`employee:` key space. */
    assignee: string;
    /** Names `assignee` for a form whose roster has not arrived yet. */
    assigneeLabel: string;
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
 *
 * A saved card closes the composer: the card itself is the confirmation, and
 * the page brings it into view — an open form under it pushed it out of sight
 * in a long column. Focus goes back to "Add a card", so the next card is still
 * one keystroke away. "More fields" trades the line for the full New Task form,
 * carrying over whatever was already typed and picked.
 *
 * The caller does the write: a board files the card into a column, a sprint
 * commits it to the sprint (and, in its card view, to a status).
 */
export default function BoardCardComposer({
    create,
    projects,
    projectId,
    onProjectChange,
    defaultAssignee,
    assignees,
    defaultAssigneeLabel,
    onAssigneeMenuOpen,
    onCreated,
    onOpenFull,
    userStory,
    projectLocked = false,
    compact = false,
    label,
}: {
    /** Saves the card. Throwing keeps the composer open, and the message becomes the toast. */
    create: (card: ComposerCard) => Promise<unknown>;
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
    /** Gets `create`'s answer — on a board, the reloaded board naming the card just made. */
    onCreated: (result: unknown) => void | Promise<void>;
    /** Opens the full New Task form for this spot, seeded with the draft. */
    onOpenFull: (draft: ComposerDraft) => void;
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
    /** The trigger's words, where "Add a card" is not what the page calls its rows. */
    label?: string;
}) {
    const { t } = useI18n();
    const bm = t.projects.board;
    const triggerLabel = label ?? bm.addCard;

    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    /**
     * Set by a save, so the render that swaps the form back for the trigger
     * can put focus on it. Not every close does this: Cancel and "More fields"
     * send the reader elsewhere on purpose.
     */
    const refocus = useRef(false);

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

    useEffect(() => {
        if (open || !refocus.current) return;
        refocus.current = false;
        triggerRef.current?.focus();
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
            const result = await create({
                projectId,
                title: trimmed,
                ...assigneeColumns(chosen),
                ...(userStory ? { userStoryId: userStory.id } : {}),
            });
            toast.success(t.projects.task.created);
            refocus.current = true;
            close();
            await onCreated(result);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : bm.createFailed);
        } finally {
            setSaving(false);
        }
    };

    const openFull = () => {
        onOpenFull({
            title: title.trim(),
            assignee: chosen,
            assigneeLabel:
                assignees.find((person) => person.value === chosen)?.label ?? defaultAssigneeLabel,
        });
        close();
    };

    if (!open) {
        return (
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(true)}
                className={`flex min-h-touch w-full items-center gap-1.5 rounded-md px-2 py-2 text-start text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600 ${
                    compact
                        ? 'md:min-h-0 md:py-1 md:opacity-0 md:focus:opacity-100 md:group-focus-within/cell:opacity-100 md:group-hover/cell:opacity-100'
                        : ''
                }`}
            >
                <Plus className="h-3.5 w-3.5" />
                {triggerLabel}
            </button>
        );
    }

    return (
        <div className="space-y-2 rounded-md border border-blue-300 bg-white p-2">
            <Textarea
                autoFocus
                rows={2}
                value={title}
                aria-label={triggerLabel}
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
            <div className="flex flex-wrap items-center gap-2">
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
                {/* The full form, for a card that needs a due date, an
                    estimate or a description before it is worth saving. */}
                <Button
                    variant="ghost"
                    className="min-h-touch"
                    disabled={saving}
                    onClick={openFull}
                >
                    {t.projects.quickAdd.more}
                </Button>
            </div>
            {!projectId && <p className="text-xs text-amber-600">{t.projects.task.projectRequired}</p>}
        </div>
    );
}
