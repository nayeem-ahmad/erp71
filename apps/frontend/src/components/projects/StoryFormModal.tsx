'use client';

import { useEffect, useState } from 'react';
import {
    Button,
    Field,
    Input,
    Select,
    Textarea,
} from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import type { EpicChip } from '@/components/projects/EpicFormModal';
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
