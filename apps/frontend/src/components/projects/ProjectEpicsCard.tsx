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
import { LABEL_COLORS, labelClass } from '@/components/projects/board-tasks';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

export interface EpicProgress {
    storyCount: number;
    doneStoryCount: number;
    storyPoints: number;
    doneStoryPoints: number;
    taskCount: number;
    doneTaskCount: number;
    percentComplete: number;
}

export interface Epic {
    id: string;
    project_id?: string;
    reference: number;
    /** The editable ID people see — `OTB-E2`. */
    code: string;
    title: string;
    description?: string | null;
    status: string;
    priority: string;
    color: string;
    start_date?: string | null;
    target_date?: string | null;
    project?: { id: string; code: string; name: string; short_name?: string | null } | null;
    progress?: EpicProgress;
}

/** The slice of an epic a story row shows as its chip. */
export interface EpicChip {
    id: string;
    code: string;
    title: string;
    color: string;
}

interface EpicStory {
    id: string;
    code: string;
    title: string;
    status: string;
    story_points?: number | null;
}

export const EPIC_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/** Finished is a success; dropped scope is neutral, not an error. */
export const EPIC_STATUS_TONE: Record<string, StatusBadgeTone> = {
    OPEN: 'neutral',
    IN_PROGRESS: 'info',
    DONE: 'success',
    CANCELLED: 'neutral',
};

/** Matches the story card, so a story reads the same inside an epic. */
const STORY_STATUS_TONE: Record<string, StatusBadgeTone> = {
    BACKLOG: 'neutral',
    READY: 'info',
    IN_PROGRESS: 'info',
    DONE: 'success',
};

/** The epic's code as a coloured chip, as it appears beside a story. */
export function EpicBadge({ epic, className = '' }: { epic: EpicChip; className?: string }) {
    return (
        <span
            title={`${epic.code} · ${epic.title}`}
            className={`inline-flex max-w-[10rem] shrink-0 items-center truncate rounded px-1.5 py-0.5 text-xs font-medium ${labelClass(epic.color)} ${className}`}
        >
            {epic.code}
        </span>
    );
}

/** Stories done out of stories, as a thin bar — the unit an epic finishes in. */
function ProgressBar({ percent }: { percent: number }) {
    return (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden>
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
        </div>
    );
}

/**
 * A project's epics, each with the stories that deliver it.
 *
 * Mirrors `ProjectStoriesCard` one level up: the stories are fetched per epic
 * when it is opened, while the counts in the collapsed row come with the list.
 * A story can be written straight into an epic from here, which is the
 * shortest path from "we need online payments" to the stories that say how.
 */
export default function ProjectEpicsCard({
    projectId,
    projectCode,
    epics,
    onEpicsChanged,
    onStoriesChanged,
    openEpicId,
}: {
    projectId: string;
    /** Prefix of a new epic's default ID — `OTB` for `OTB-E2`. */
    projectCode?: string;
    /** The project's epics, or null while they are still being read. */
    epics: Epic[] | null;
    onEpicsChanged: () => void | Promise<void>;
    /** The story card's chips and filters go stale when an epic changes. */
    onStoriesChanged?: () => void | Promise<void>;
    /** An epic to arrive expanded, from `?epic=<id>`. */
    openEpicId?: string | null;
}) {
    const { t } = useI18n();
    const m = t.projects;

    const [editing, setEditing] = useState<Epic | 'new' | null>(null);
    const [pendingDelete, setPendingDelete] = useState<Epic | null>(null);
    const [deleting, setDeleting] = useState(false);

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await api.deleteProjectEpic(pendingDelete.id);
            toast.success(m.epics.deleted);
            setPendingDelete(null);
            await onEpicsChanged();
            await onStoriesChanged?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.epics.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="rounded-md border border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
                <h2 className="text-sm font-medium">{m.epics.title}</h2>
                <button
                    type="button"
                    onClick={() => setEditing('new')}
                    className="inline-flex min-h-touch items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {m.epics.add}
                </button>
            </div>

            {epics === null ? (
                <p className="p-3 text-sm text-gray-500">{t.common.loading}</p>
            ) : epics.length === 0 ? (
                <p className="p-3 text-sm text-gray-500">{m.epics.empty}</p>
            ) : (
                <ul className="divide-y divide-gray-200">
                    {epics.map((epic) => (
                        <EpicRow
                            key={epic.id}
                            projectId={projectId}
                            epic={epic}
                            initiallyOpen={epic.id === openEpicId}
                            onEdit={() => setEditing(epic)}
                            onDelete={() => setPendingDelete(epic)}
                            onStoriesChanged={async () => {
                                await onEpicsChanged();
                                await onStoriesChanged?.();
                            }}
                        />
                    ))}
                </ul>
            )}

            {editing && (
                <EpicFormModal
                    projectId={projectId}
                    projectCode={projectCode}
                    epic={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null);
                        await onEpicsChanged();
                        // A renamed or recoloured epic changes every story chip.
                        await onStoriesChanged?.();
                    }}
                />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                title={m.epics.deleteEpic}
                prompt={m.epics.deletePrompt.replace('{title}', pendingDelete ? pendingDelete.title : '')}
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

function EpicRow({
    projectId,
    epic,
    initiallyOpen = false,
    onEdit,
    onDelete,
    onStoriesChanged,
}: {
    projectId: string;
    epic: Epic;
    initiallyOpen?: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onStoriesChanged: () => void | Promise<void>;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const [open, setOpen] = useState(initiallyOpen);
    const [stories, setStories] = useState<EpicStory[] | null>(null);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const loadStories = useCallback(async () => {
        try {
            const detail = await api.getProjectEpic(epic.id);
            setStories(((detail as { stories?: EpicStory[] })?.stories ?? []) as EpicStory[]);
        } catch {
            setStories([]);
        }
    }, [epic.id]);

    useEffect(() => {
        if (open && stories === null) loadStories();
    }, [open, stories, loadStories]);

    const addStory = async (event: React.FormEvent) => {
        event.preventDefault();
        const title = draft.trim();
        if (!title) return;
        setSaving(true);
        try {
            await api.createProjectStory({ projectId, title, epicId: epic.id });
            toast.success(m.stories.created);
            setDraft('');
            await loadStories();
            await onStoriesChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.stories.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const progress = epic.progress;

    return (
        <li>
            <div className="flex items-center gap-2 px-3 py-2">
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
                    <EpicBadge epic={epic} />
                    <span className="min-w-0 flex-1 truncate text-sm" title={epic.title}>
                        {epic.title}
                    </span>
                </button>
                {progress && (
                    <div className="hidden w-28 shrink-0 space-y-0.5 md:block">
                        <span className="block text-xs text-gray-500">
                            {fmt(m.epics.storyProgress, {
                                done: progress.doneStoryCount,
                                total: progress.storyCount,
                            })}
                        </span>
                        <ProgressBar percent={progress.percentComplete} />
                    </div>
                )}
                <StatusBadge tone={EPIC_STATUS_TONE[epic.status] ?? 'neutral'} className="shrink-0">
                    {m.epics.statuses[epic.status as keyof typeof m.epics.statuses] ?? epic.status}
                </StatusBadge>
                <button
                    type="button"
                    onClick={onEdit}
                    title={m.epics.edit}
                    aria-label={m.epics.edit}
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
                    {epic.description && (
                        <p className="whitespace-pre-line text-sm text-gray-700">{epic.description}</p>
                    )}

                    {progress && (
                        <p className="text-xs text-gray-500">
                            {fmt(m.epics.storyProgress, {
                                done: progress.doneStoryCount,
                                total: progress.storyCount,
                            })}
                            {' · '}
                            {fmt(m.epics.pointsProgress, {
                                done: progress.doneStoryPoints,
                                total: progress.storyPoints,
                            })}
                            {' · '}
                            {fmt(m.epics.taskProgress, {
                                done: progress.doneTaskCount,
                                total: progress.taskCount,
                            })}
                        </p>
                    )}

                    {stories === null ? (
                        <p className="text-sm text-gray-500">{t.common.loading}</p>
                    ) : stories.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.epics.noStories}</p>
                    ) : (
                        <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
                            {stories.map((story) => (
                                <li
                                    key={story.id}
                                    className="flex min-h-touch items-center gap-2 px-2 py-1.5 text-sm"
                                >
                                    <span className="shrink-0 text-xs tabular-nums text-gray-500">
                                        {story.code}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate" title={story.title}>
                                        {story.title}
                                    </span>
                                    {story.story_points != null && (
                                        <span className="hidden shrink-0 text-xs text-gray-500 md:inline">
                                            {fmt(m.stories.pointsShort, { points: story.story_points })}
                                        </span>
                                    )}
                                    <StatusBadge
                                        tone={STORY_STATUS_TONE[story.status] ?? 'neutral'}
                                        className="shrink-0"
                                    >
                                        {m.stories.statuses[story.status as keyof typeof m.stories.statuses]
                                            ?? story.status}
                                    </StatusBadge>
                                </li>
                            ))}
                        </ul>
                    )}

                    <form onSubmit={addStory} className="flex flex-wrap items-center gap-2">
                        <Input
                            value={draft}
                            placeholder={m.epics.storyPlaceholder}
                            aria-label={m.epics.addStory}
                            onChange={(e) => setDraft(e.target.value)}
                            className="min-w-0 flex-1"
                        />
                        <Button type="submit" disabled={saving || !draft.trim()} className="min-h-touch">
                            {m.epics.addStory}
                        </Button>
                    </form>
                </div>
            )}
        </li>
    );
}

/** A project the modal can file a new epic under, when it is not opened from one. */
export interface EpicProjectOption {
    id: string;
    code: string;
    name: string;
}

const EMPTY_FORM = {
    projectId: '',
    code: '',
    title: '',
    description: '',
    status: 'OPEN',
    priority: 'MEDIUM',
    color: 'BLUE',
    startDate: '',
    targetDate: '',
};

type EpicForm = typeof EMPTY_FORM;

const formOf = (epic: Epic): EpicForm => ({
    projectId: '',
    code: epic.code,
    title: epic.title,
    description: epic.description ?? '',
    status: epic.status,
    priority: epic.priority,
    color: epic.color,
    startDate: epic.start_date ? epic.start_date.slice(0, 10) : '',
    targetDate: epic.target_date ? epic.target_date.slice(0, 10) : '',
});

type FormErrors = Partial<Record<'projectId' | 'code' | 'title', string>>;

/**
 * Write or edit one epic. Opened from a project's card it is already filed
 * under that project; opened from the cross-project list it asks which one.
 */
export function EpicFormModal({
    projectId,
    projectCode,
    projects,
    initialProjectId,
    epic,
    onClose,
    onSaved,
}: {
    projectId?: string;
    projectCode?: string;
    projects?: EpicProjectOption[];
    initialProjectId?: string;
    /** Null for a new epic. */
    epic: Epic | null;
    onClose: () => void;
    onSaved: () => void | Promise<void>;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const [form, setForm] = useState<EpicForm>(
        epic ? formOf(epic) : { ...EMPTY_FORM, projectId: initialProjectId ?? '' },
    );
    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState(false);

    const set = (patch: Partial<EpicForm>) => setForm((previous) => ({ ...previous, ...patch }));
    const clearError = (field: keyof FormErrors) =>
        setErrors((previous) => ({ ...previous, [field]: undefined }));

    const pickProject = !epic && !projectId;
    const targetProjectId = projectId ?? form.projectId;
    const prefix = projectCode ?? projects?.find((project) => project.id === targetProjectId)?.code;

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        const code = form.code.trim();
        const next: FormErrors = {};
        if (pickProject && !form.projectId) next.projectId = m.epics.projectRequired;
        if (!form.title.trim()) next.title = m.epics.titleRequired;
        if (epic && !code) next.code = m.epics.codeRequired;
        else if (/\s/.test(code)) next.code = m.epics.codeNoSpaces;
        if (Object.values(next).some(Boolean)) {
            setErrors(next);
            return;
        }
        setSaving(true);
        try {
            const payload = {
                title: form.title.trim(),
                ...(code ? { code } : {}),
                description: form.description.trim(),
                status: form.status,
                priority: form.priority,
                color: form.color,
                // `''` clears a date on edit; the server reads it as "none".
                startDate: form.startDate,
                targetDate: form.targetDate,
            };
            if (epic) await api.updateProjectEpic(epic.id, payload);
            else await api.createProjectEpic({ ...payload, projectId: targetProjectId });
            toast.success(epic ? m.epics.updated : m.epics.created);
            await onSaved();
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : m.epics.saveFailed;
            if (/epic id/i.test(message)) setErrors({ code: message });
            else toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell onBackdropClick={onClose} dismissOnBackdrop={false} size="md">
            <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
                <ModalHeader title={epic ? m.epics.edit : m.epics.add} onClose={onClose} />
                <div className="space-y-3 overflow-y-auto p-4">
                    {pickProject && (
                        <Field
                            label={m.fields.project}
                            htmlFor="epic-project"
                            required
                            error={errors.projectId}
                        >
                            <Select
                                id="epic-project"
                                value={form.projectId}
                                error={Boolean(errors.projectId)}
                                onChange={(e) => {
                                    clearError('projectId');
                                    set({ projectId: e.target.value });
                                }}
                            >
                                <option value="">{m.epics.pickProject}</option>
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
                            label={m.epics.code}
                            htmlFor="epic-code"
                            required={Boolean(epic)}
                            error={errors.code}
                            hint={
                                epic || errors.code
                                    ? undefined
                                    : fmt(m.epics.codeHint, { example: `${prefix ?? 'OTB'}-E1` })
                            }
                        >
                            <Input
                                id="epic-code"
                                value={form.code}
                                maxLength={40}
                                error={Boolean(errors.code)}
                                placeholder={prefix ? `${prefix}-E…` : m.epics.codeAuto}
                                onChange={(e) => {
                                    clearError('code');
                                    set({ code: e.target.value });
                                }}
                            />
                        </Field>
                        <Field label={m.task.titleField} htmlFor="epic-title" required error={errors.title}>
                            <Input
                                id="epic-title"
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

                    <Field label={m.epics.description} htmlFor="epic-description">
                        <Textarea
                            id="epic-description"
                            rows={4}
                            maxLength={5000}
                            value={form.description}
                            placeholder={m.epics.descriptionPlaceholder}
                            onChange={(e) => set({ description: e.target.value })}
                        />
                    </Field>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Field label={m.fields.status} htmlFor="epic-status">
                            <Select
                                id="epic-status"
                                value={form.status}
                                onChange={(e) => set({ status: e.target.value })}
                            >
                                {EPIC_STATUSES.map((status) => (
                                    <option key={status} value={status}>
                                        {m.epics.statuses[status]}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.fields.priority} htmlFor="epic-priority">
                            <Select
                                id="epic-priority"
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
                        <Field label={m.epics.color} htmlFor="epic-color">
                            <Select
                                id="epic-color"
                                value={form.color}
                                onChange={(e) => set({ color: e.target.value })}
                            >
                                {LABEL_COLORS.map((color) => (
                                    <option key={color} value={color}>
                                        {m.labels.colors[color]}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.epics.startDate} htmlFor="epic-start">
                            <Input
                                id="epic-start"
                                type="date"
                                value={form.startDate}
                                onChange={(e) => set({ startDate: e.target.value })}
                            />
                        </Field>
                        <Field label={m.epics.targetDate} htmlFor="epic-target">
                            <Input
                                id="epic-target"
                                type="date"
                                value={form.targetDate}
                                onChange={(e) => set({ targetDate: e.target.value })}
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
