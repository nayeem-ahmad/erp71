'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import {
    Button,
    ConfirmDialog,
    Field,
    Input,
    Select,
    StatusBadge,
    Textarea,
    type StatusBadgeTone,
} from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { EpicBadge, type EpicChip } from '@/components/projects/ProjectEpicsCard';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

export interface StoryTask {
    id: string;
    title: string;
    status?: { id: string; name: string; category: string } | null;
    assignee?: { id: string; name?: string | null; email: string } | null;
    assigneeEmployee?: { id: string; name?: string | null } | null;
}

export interface UserStory {
    id: string;
    reference: number;
    /** The editable ID people see — `OTB-3`. */
    code: string;
    title: string;
    as_a?: string | null;
    i_want?: string | null;
    so_that?: string | null;
    acceptance_criteria?: string | null;
    status: string;
    priority: string;
    story_points?: number | null;
    project_id?: string;
    epic_id?: string | null;
    /** The epic it is filed under, as the list returns it for the chip. */
    epic?: EpicChip | null;
    progress?: { taskCount: number; doneTaskCount: number; percentComplete: number };
    tasks?: StoryTask[];
}

const STATUSES = ['BACKLOG', 'READY', 'IN_PROGRESS', 'DONE'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/** Only "accepted" is a success; everything before it is still in flight. */
const STATUS_TONE: Record<string, StatusBadgeTone> = {
    BACKLOG: 'neutral',
    READY: 'info',
    IN_PROGRESS: 'info',
    DONE: 'success',
};

const EMPTY_FORM = {
    projectId: '',
    code: '',
    title: '',
    asA: '',
    iWant: '',
    soThat: '',
    acceptanceCriteria: '',
    status: 'BACKLOG',
    priority: 'MEDIUM',
    storyPoints: '',
    epicId: '',
};

type StoryForm = typeof EMPTY_FORM;

const formOf = (story: UserStory): StoryForm => ({
    projectId: '',
    code: story.code,
    title: story.title,
    asA: story.as_a ?? '',
    iWant: story.i_want ?? '',
    soThat: story.so_that ?? '',
    acceptanceCriteria: story.acceptance_criteria ?? '',
    status: story.status,
    priority: story.priority,
    storyPoints: story.story_points == null ? '' : String(story.story_points),
    epicId: story.epic_id ?? story.epic?.id ?? '',
});

/**
 * A project's user stories, with the tasks that deliver each one under it.
 *
 * The tasks are fetched per story when the story is opened rather than with the
 * list: a backlog of forty stories would otherwise pull the project's entire
 * task table through a second endpoint on every page load, to draw rows almost
 * nobody expands. The counts in the collapsed header come with the list, so a
 * closed story still says how much work is under it and how much is done —
 * without that, the collapse would just make people open every row to check.
 */
export default function ProjectStoriesCard({
    projectId,
    projectCode,
    stories,
    onStoriesChanged,
    onTasksChanged,
    onOpenTask,
    openStoryId,
    epics,
}: {
    projectId: string;
    /** Prefix of a new story's default ID — `OTB` for `OTB-4`. */
    projectCode?: string;
    /** The project's backlog, or null while it is still being read. */
    stories: UserStory[] | null;
    /** Re-read the backlog: a story was written, or its task counts moved. */
    onStoriesChanged: () => void | Promise<void>;
    /** The project's flat task table is stale once a story grows or loses one. */
    onTasksChanged?: () => void | Promise<void>;
    /** Opens the shared task panel, which the page already owns. */
    onOpenTask?: (taskId: string) => void;
    /**
     * A story to arrive expanded, from `?story=<id>` — how the cross-project
     * backlog hands a row over to the project that owns it. Only the *initial*
     * state of that row: collapsing it afterwards is not fought, so the link
     * opens a story rather than pinning one open.
     */
    openStoryId?: string | null;
    /** The project's epics, for the story form's picker. */
    epics?: EpicChip[];
}) {
    const { t } = useI18n();
    const m = t.projects;

    const [editing, setEditing] = useState<UserStory | 'new' | null>(null);
    const [pendingDelete, setPendingDelete] = useState<UserStory | null>(null);
    const [deleting, setDeleting] = useState(false);

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteProjectStory(pendingDelete.id);
            toast.success(m.stories.deleted);
            setPendingDelete(null);
            await onStoriesChanged();
            // The tasks kept their place in the project; they only lost the
            // grouping, so the table behind this has to be re-read too.
            await onTasksChanged?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.stories.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="rounded-md border border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
                <h2 className="text-sm font-medium">{m.stories.title}</h2>
                <button
                    type="button"
                    onClick={() => setEditing('new')}
                    className="inline-flex min-h-touch items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {m.stories.add}
                </button>
            </div>

            {stories === null ? (
                <p className="p-3 text-sm text-gray-500">{t.common.loading}</p>
            ) : stories.length === 0 ? (
                <p className="p-3 text-sm text-gray-500">{m.stories.empty}</p>
            ) : (
                <ul className="divide-y divide-gray-200">
                    {stories.map((story) => (
                        <StoryRow
                            key={story.id}
                            projectId={projectId}
                            story={story}
                            initiallyOpen={story.id === openStoryId}
                            onEdit={() => setEditing(story)}
                            onDelete={() => setPendingDelete(story)}
                            onOpenTask={onOpenTask}
                            onTasksChanged={async () => {
                                // The story's own counts moved with the task.
                                await onStoriesChanged();
                                await onTasksChanged?.();
                            }}
                        />
                    ))}
                </ul>
            )}

            {editing && (
                <StoryFormModal
                    projectId={projectId}
                    projectCode={projectCode}
                    story={editing === 'new' ? null : editing}
                    epics={epics}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null);
                        await onStoriesChanged();
                    }}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={m.stories.deleteStory}
                prompt={m.stories.deletePrompt.replace(
                    '{title}',
                    pendingDelete ? pendingDelete.title : '',
                )}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}

function StoryRow({
    projectId,
    story,
    initiallyOpen = false,
    onEdit,
    onDelete,
    onOpenTask,
    onTasksChanged,
}: {
    projectId: string;
    story: UserStory;
    /** Seeds `open` only — see `openStoryId` on the card. */
    initiallyOpen?: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onOpenTask?: (taskId: string) => void;
    onTasksChanged: () => void | Promise<void>;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const [open, setOpen] = useState(initiallyOpen);
    const [tasks, setTasks] = useState<StoryTask[] | null>(null);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const loadTasks = useCallback(async () => {
        try {
            const detail = await api.getProjectStory(story.id);
            setTasks(((detail as { tasks?: StoryTask[] })?.tasks ?? []) as StoryTask[]);
        } catch {
            setTasks([]);
        }
    }, [story.id]);

    useEffect(() => {
        if (open && tasks === null) loadTasks();
    }, [open, tasks, loadTasks]);

    const addTask = async (event: React.FormEvent) => {
        event.preventDefault();
        const title = draft.trim();
        if (!title) return;
        setSaving(true);
        try {
            await api.createProjectTask({ projectId, title, userStoryId: story.id });
            toast.success(m.task.created);
            setDraft('');
            await loadTasks();
            await onTasksChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.createFailed);
        } finally {
            setSaving(false);
        }
    };

    const progress = story.progress ?? { taskCount: 0, doneTaskCount: 0, percentComplete: 0 };
    const narrative = story.as_a || story.i_want || story.so_that;

    return (
        <li>
            <div className="flex items-center gap-2 px-3 py-2">
                {/* The reference and the title are inside the toggle, not
                    beside it: a chevron alone is a 16px target on the one row
                    people tap most, and this makes the whole line the target. */}
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((was) => !was)}
                    className="flex min-h-touch min-w-0 flex-1 items-center gap-2 text-start text-gray-700"
                >
                    <ChevronDown
                        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                        aria-hidden
                    />
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">
                        {story.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm" title={story.title}>
                        {story.title}
                    </span>
                </button>
                {story.epic && <EpicBadge epic={story.epic} className="hidden md:inline-flex" />}
                {story.story_points != null && (
                    <span className="hidden shrink-0 text-xs text-gray-500 md:inline">
                        {fmt(m.stories.pointsShort, { points: story.story_points })}
                    </span>
                )}
                <span className="hidden shrink-0 text-xs text-gray-500 md:inline">
                    {fmt(m.stories.taskProgress, {
                        done: progress.doneTaskCount,
                        total: progress.taskCount,
                    })}
                </span>
                <StatusBadge tone={STATUS_TONE[story.status] ?? 'neutral'} className="shrink-0">
                    {m.stories.statuses[story.status as keyof typeof m.stories.statuses] ??
                        story.status}
                </StatusBadge>
                <button
                    type="button"
                    onClick={onEdit}
                    title={m.stories.edit}
                    aria-label={m.stories.edit}
                    className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                    <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    title={t.common.delete}
                    aria-label={t.common.delete}
                    className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            {open && (
                <div className="space-y-2 border-t border-gray-200 bg-gray-50 px-3 py-2">
                    {narrative && (
                        <p className="text-sm text-gray-700">
                            {fmt(m.stories.narrative, {
                                asA: story.as_a ?? '—',
                                iWant: story.i_want ?? '—',
                                soThat: story.so_that ?? '—',
                            })}
                        </p>
                    )}

                    {story.acceptance_criteria && (
                        <div>
                            <h3 className="text-xs font-medium text-gray-500">
                                {m.stories.acceptance}
                            </h3>
                            <p className="whitespace-pre-line text-sm text-gray-700">
                                {story.acceptance_criteria}
                            </p>
                        </div>
                    )}

                    {tasks === null ? (
                        <p className="text-sm text-gray-500">{t.common.loading}</p>
                    ) : tasks.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.stories.noTasks}</p>
                    ) : (
                        <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
                            {tasks.map((task) => (
                                <li key={task.id}>
                                    <button
                                        type="button"
                                        onClick={() => onOpenTask?.(task.id)}
                                        className="flex min-h-touch w-full items-center gap-2 px-2 py-1.5 text-start text-sm hover:bg-gray-50"
                                    >
                                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                                        {task.status && (
                                            <StatusBadge
                                                tone={
                                                    task.status.category === 'DONE'
                                                        ? 'success'
                                                        : 'neutral'
                                                }
                                                className="shrink-0"
                                            >
                                                {task.status.name}
                                            </StatusBadge>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* The point of the whole card: a story is only worth
                        writing if the work under it can start from here. */}
                    <form onSubmit={addTask} className="flex flex-wrap items-center gap-2">
                        <Input
                            value={draft}
                            placeholder={m.stories.taskPlaceholder}
                            aria-label={m.stories.addTask}
                            onChange={(e) => setDraft(e.target.value)}
                            className="min-w-0 flex-1"
                        />
                        <Button type="submit" disabled={saving || !draft.trim()} className="min-h-touch">
                            {m.stories.addTask}
                        </Button>
                    </form>
                </div>
            )}
        </li>
    );
}

/** A project the modal can file a new story under, when it is not opened from one. */
export interface StoryProjectOption {
    id: string;
    code: string;
    name: string;
}

type FormErrors = Partial<Record<'projectId' | 'code' | 'title', string>>;

/**
 * Write or edit one story. Opened from a project's card it is already filed
 * under that project; opened from the cross-project list it asks which one.
 */
export function StoryFormModal({
    projectId,
    projectCode,
    projects,
    initialProjectId,
    story,
    epics,
    onClose,
    onSaved,
}: {
    /** The project a new story goes into. Omit to show a project picker. */
    projectId?: string;
    /** That project's code, for the default-ID hint. */
    projectCode?: string;
    /** The picker's options, when `projectId` is omitted. */
    projects?: StoryProjectOption[];
    /** Pre-selects the picker. */
    initialProjectId?: string;
    /** Null for a new story. */
    story: UserStory | null;
    /**
     * The epics the story can be filed under. Omit and the modal reads the
     * target project's own — the cross-project list does not have them.
     */
    epics?: EpicChip[];
    onClose: () => void;
    onSaved: () => void | Promise<void>;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const [form, setForm] = useState<StoryForm>(
        story ? formOf(story) : { ...EMPTY_FORM, projectId: initialProjectId ?? '' },
    );
    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState(false);

    const set = (patch: Partial<StoryForm>) => setForm((previous) => ({ ...previous, ...patch }));
    const clearError = (field: keyof FormErrors) =>
        setErrors((previous) => ({ ...previous, [field]: undefined }));

    const pickProject = !story && !projectId;
    // Once a story has tasks its status follows them; only the grooming call
    // (Backlog ↔ Ready) is left to a person, and only until work starts.
    const hasTasks = (story?.progress?.taskCount ?? story?.tasks?.length ?? 0) > 0;
    const statusLocked = hasTasks && (story?.status === 'IN_PROGRESS' || story?.status === 'DONE');
    const statusOptions = hasTasks && !statusLocked ? (['BACKLOG', 'READY'] as const) : STATUSES;
    const targetProjectId = projectId ?? form.projectId;
    const prefix = projectCode ?? projects?.find((project) => project.id === targetProjectId)?.code;

    // An epic is per project, so the picker follows the project the story is in.
    const [fetchedEpics, setFetchedEpics] = useState<EpicChip[]>([]);
    const epicProjectId = story?.project_id ?? targetProjectId;
    useEffect(() => {
        if (epics || !epicProjectId) {
            setFetchedEpics([]);
            return;
        }
        let live = true;
        api.getProjectEpics({ projectId: epicProjectId })
            .then((rows: unknown) => {
                if (live) setFetchedEpics(Array.isArray(rows) ? (rows as EpicChip[]) : []);
            })
            .catch(() => {
                if (live) setFetchedEpics([]);
            });
        return () => {
            live = false;
        };
    }, [epics, epicProjectId]);
    const epicOptions = epics ?? fetchedEpics;

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        const code = form.code.trim();
        const next: FormErrors = {};
        if (pickProject && !form.projectId) next.projectId = m.stories.projectRequired;
        if (!form.title.trim()) next.title = m.stories.titleRequired;
        // Editing can change the ID but not remove it; a new story may leave it
        // blank and be numbered by the server.
        if (story && !code) next.code = m.stories.codeRequired;
        else if (/\s/.test(code)) next.code = m.stories.codeNoSpaces;
        if (Object.values(next).some(Boolean)) {
            setErrors(next);
            return;
        }
        setSaving(true);
        try {
            const payload = {
                title: form.title.trim(),
                ...(code ? { code } : {}),
                asA: form.asA.trim(),
                iWant: form.iWant.trim(),
                soThat: form.soThat.trim(),
                acceptanceCriteria: form.acceptanceCriteria.trim(),
                status: form.status,
                priority: form.priority,
                // `null`, not `''`: an empty string would arrive as a genuine
                // zero — a story sized at nothing rather than one nobody sized.
                storyPoints: form.storyPoints === '' ? null : Number(form.storyPoints),
                // `''` takes an edited story out of its epic; a new one just has none.
                ...(story || form.epicId ? { epicId: form.epicId } : {}),
            };
            if (story) await api.updateProjectStory(story.id, payload);
            else await api.createProjectStory({ ...payload, projectId: targetProjectId });
            toast.success(story ? m.stories.updated : m.stories.created);
            await onSaved();
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : m.stories.saveFailed;
            // A taken ID is the one server refusal with a field to point at.
            if (/story id/i.test(message)) setErrors({ code: message });
            else toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell onBackdropClick={onClose} dismissOnBackdrop={false} size="xl">
            <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
                <ModalHeader
                    title={story ? m.stories.edit : m.stories.add}
                    onClose={onClose}
                />
                {/* Two columns from md up so the whole story fits on one
                    screen: what is being asked for on the left, how it is
                    judged and tracked on the right. A phone stacks them and
                    scrolls, as every bottom sheet does. */}
                <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-2">
                    <div className="space-y-3">
                        {pickProject && (
                            <Field
                                label={m.fields.project}
                                htmlFor="story-project"
                                required
                                error={errors.projectId}
                            >
                                <Select
                                    id="story-project"
                                    value={form.projectId}
                                    error={Boolean(errors.projectId)}
                                    onChange={(e) => {
                                        clearError('projectId');
                                        // The chosen epic belonged to the old project.
                                        set({ projectId: e.target.value, epicId: '' });
                                    }}
                                >
                                    <option value="">{m.stories.pickProject}</option>
                                    {(projects ?? []).map((project) => (
                                        <option key={project.id} value={project.id}>
                                            {project.code} · {project.name}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        )}

                        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                            <Field
                                label={m.stories.code}
                                htmlFor="story-code"
                                required={Boolean(story)}
                                error={errors.code}
                                hint={
                                    story || errors.code
                                        ? undefined
                                        : fmt(m.stories.codeHint, { example: `${prefix ?? 'OTB'}-1` })
                                }
                            >
                                <Input
                                    id="story-code"
                                    value={form.code}
                                    maxLength={40}
                                    error={Boolean(errors.code)}
                                    placeholder={prefix ? `${prefix}-…` : m.stories.codeAuto}
                                    onChange={(e) => {
                                        clearError('code');
                                        set({ code: e.target.value });
                                    }}
                                />
                            </Field>
                            <Field
                                label={m.task.titleField}
                                htmlFor="story-title"
                                required
                                error={errors.title}
                            >
                                <Input
                                    id="story-title"
                                    value={form.title}
                                    maxLength={300}
                                    error={Boolean(errors.title)}
                                    autoFocus={!pickProject}
                                    onChange={(e) => {
                                        clearError('title');
                                        set({ title: e.target.value });
                                    }}
                                />
                            </Field>
                        </div>

                        {/* Three fields rather than one paragraph: a story missing
                            its *why* is the one worth noticing, and a single blob
                            hides that it is missing. */}
                        <Field label={m.stories.asA} htmlFor="story-as-a">
                            <Textarea
                                id="story-as-a"
                                rows={2}
                                maxLength={500}
                                value={form.asA}
                                placeholder={m.stories.asAPlaceholder}
                                onChange={(e) => set({ asA: e.target.value })}
                            />
                        </Field>
                        <Field label={m.stories.iWant} htmlFor="story-i-want">
                            <Textarea
                                id="story-i-want"
                                rows={3}
                                maxLength={2000}
                                value={form.iWant}
                                placeholder={m.stories.iWantPlaceholder}
                                onChange={(e) => set({ iWant: e.target.value })}
                            />
                        </Field>
                        <Field label={m.stories.soThat} htmlFor="story-so-that">
                            <Textarea
                                id="story-so-that"
                                rows={2}
                                maxLength={2000}
                                value={form.soThat}
                                placeholder={m.stories.soThatPlaceholder}
                                onChange={(e) => set({ soThat: e.target.value })}
                            />
                        </Field>
                    </div>

                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                            <Field
                                label={m.fields.status}
                                htmlFor="story-status"
                                hint={hasTasks ? m.stories.statusDerived : undefined}
                            >
                                <Select
                                    id="story-status"
                                    value={form.status}
                                    disabled={statusLocked}
                                    onChange={(e) => set({ status: e.target.value })}
                                >
                                    {(statusLocked ? [form.status] : statusOptions).map((status) => (
                                        <option key={status} value={status}>
                                            {m.stories.statuses[status as (typeof STATUSES)[number]]}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={m.fields.priority} htmlFor="story-priority">
                                <Select
                                    id="story-priority"
                                    value={form.priority}
                                    onChange={(e) => set({ priority: e.target.value })}
                                >
                                    {PRIORITIES.map((priority) => (
                                        <option key={priority} value={priority}>
                                            {m.priority[priority]}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={m.stories.points} htmlFor="story-points">
                                <Input
                                    id="story-points"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={form.storyPoints}
                                    onChange={(e) => set({ storyPoints: e.target.value })}
                                />
                            </Field>
                        </div>
                        {/* Spans the row: under a third-width column it wrapped
                            to four lines and pushed the whole column down. */}
                        <p className="-mt-1 text-xs text-gray-500">{m.stories.pointsHint}</p>

                        <Field label={m.epics.field} htmlFor="story-epic">
                            <Select
                                id="story-epic"
                                value={form.epicId}
                                disabled={!epicProjectId}
                                onChange={(e) => set({ epicId: e.target.value })}
                            >
                                <option value="">{m.epics.none}</option>
                                {epicOptions.map((epic) => (
                                    <option key={epic.id} value={epic.id}>
                                        {epic.code} · {epic.title}
                                    </option>
                                ))}
                            </Select>
                        </Field>

                        <Field label={m.stories.acceptance} htmlFor="story-acceptance">
                            <Textarea
                                id="story-acceptance"
                                rows={pickProject ? 12 : 8}
                                maxLength={5000}
                                value={form.acceptanceCriteria}
                                placeholder={m.stories.acceptancePlaceholder}
                                onChange={(e) => set({ acceptanceCriteria: e.target.value })}
                            />
                        </Field>
                    </div>
                </div>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {t.common.save}
                    </Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
