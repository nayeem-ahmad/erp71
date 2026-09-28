'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button, Field, Input, RichTextEditor, Select } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { assigneeNoteFor } from './task-assignee';
import type { ProjectMeta } from './use-project-meta';

export interface TaskEntryValues {
    projectId: string;
    title: string;
    /** Markdown, from the rich text editor. */
    description: string;
    priority: string;
    /** `user:<id>`, `employee:<id>`, or `''` for nobody — see `task-assignee.ts`. */
    assignee: string;
    dueDate: string;
    estimateHours: string;
}

export const EMPTY_TASK_ENTRY: TaskEntryValues = {
    projectId: '',
    title: '',
    description: '',
    priority: 'MEDIUM',
    // The one field the modal used to omit, and the one thing always set next.
    assignee: '',
    dueDate: '',
    estimateHours: '',
};

/**
 * The New Task form: one task, filed with everything it needs.
 *
 * The Tasks page opens it from its header and from the quick-add line's "More
 * fields"; a board opens it from a column's "Add a card". Each caller decides
 * what saving means — a plain task, or a card in a column — so `onSubmit` does
 * the write and the dialog does the rest: validation, the saving state, the
 * toasts, and closing, or clearing itself for the next task of a run.
 */
export default function TaskEntryModal({
    projects,
    initial,
    projectMeta,
    assigneeName,
    subtitle,
    projectLocked = false,
    onSubmit,
    onClose,
}: {
    projects: { id: string; code: string; name: string }[];
    /** Whatever the caller already knows — a project, a holder, a title typed elsewhere. */
    initial: Partial<TaskEntryValues>;
    /**
     * The caller's roster cache (`useProjectMeta`), so the dialog and the page
     * behind it share one read per project.
     */
    projectMeta: {
        load: (projectId: string) => Promise<ProjectMeta>;
        peek: (projectId: string) => ProjectMeta | undefined;
    };
    /**
     * Names a holder the chosen project's roster does not list: the roster is
     * still loading, or they hold work without being on the team. Unanswered,
     * they are "Me" — the one holder a caller preselects who need not hold
     * anything anywhere.
     */
    assigneeName?: (key: string) => string | undefined;
    /** Under the title — where the task is going, when the caller has decided that. */
    subtitle?: ReactNode;
    /**
     * The caller has fixed the project, so there is nothing to pick: a card in
     * a story's lane can only join that story's project.
     */
    projectLocked?: boolean;
    /** Saves the task. Throwing keeps the dialog open, and the message becomes the toast. */
    onSubmit: (values: TaskEntryValues, options: { again: boolean }) => Promise<void>;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const m = t.projects;

    const [form, setForm] = useState<TaskEntryValues>(() => ({ ...EMPTY_TASK_ENTRY, ...initial }));
    const [errors, setErrors] = useState<{ projectId?: string; title?: string }>({});
    const [saving, setSaving] = useState(false);
    const [showPriority, setShowPriority] = useState(false);
    const [showDescription, setShowDescription] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);
    /** Nothing to file against — unless the caller has already fixed the project. */
    const noProject = projects.length === 0 && !projectLocked;

    /**
     * The roster is fetched when a project is **chosen**, not when the Assignee
     * picker is focused.
     *
     * A native `<select>` paints its popup in the same gesture that used to
     * start that fetch, and an already-open popup does not repaint when the
     * options land — so the first open showed nobody and the second showed the
     * team. Which of the two you got depended on your connection, which is what
     * made this look like a per-user problem. `load` de-duplicates, so the
     * `onFocus` below stays as a safety net for a project that never changed.
     */
    // `load` rather than the object: a caller's `useProjectMeta()` is a fresh
    // literal every render, so depending on it would refetch in a loop.
    const { load: loadProjectMeta } = projectMeta;
    useEffect(() => {
        if (form.projectId) void loadProjectMeta(form.projectId);
    }, [form.projectId, loadProjectMeta]);

    const roster = projectMeta.peek(form.projectId)?.assignees ?? [];

    /**
     * Why the Assignee list is short, when it is. An empty team also gets the
     * way out to it, which the bare row pickers on the Tasks page have no room
     * for.
     */
    const assigneeHint = (() => {
        const note = form.projectId
            ? assigneeNoteFor(projectMeta.peek(form.projectId), m.task)
            : undefined;
        if (note !== m.task.assigneeNoTeam) return note;
        return (
            <>
                {note}{' '}
                <Link
                    href={routes.projects.detail(form.projectId)}
                    className="font-medium text-blue-600 hover:underline"
                >
                    {m.task.assigneeAddTeam}
                </Link>
            </>
        );
    })();

    /** `again` keeps the dialog open with the project, for filing a run of tasks. */
    const submit = async (event: React.FormEvent | React.MouseEvent, again: boolean) => {
        event.preventDefault();
        const next: { projectId?: string; title?: string } = {};
        if (!form.projectId) next.projectId = m.task.projectRequired;
        if (!form.title.trim()) next.title = m.task.titleRequired;
        setErrors(next);
        if (next.projectId || next.title) return;

        setSaving(true);
        try {
            await onSubmit(form, { again });
            toast.success(m.task.created);
            if (again) {
                setForm({ ...EMPTY_TASK_ENTRY, projectId: form.projectId, assignee: form.assignee });
                // Straight back to the title: it is the next thing typed.
                titleRef.current?.focus();
            } else {
                onClose();
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.task.createFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        /* Not dismissed by a click beside it: the form holds a title, a
           description and four pickers, and the only thing that ever closed
           it by accident was a mis-aimed click. Escape, Cancel and the
           header's X all still close it. */
        <ModalShell onBackdropClick={onClose} dismissOnBackdrop={false}>
            <form onSubmit={(event) => void submit(event, false)}>
                <ModalHeader title={m.task.newTask} subtitle={subtitle} onClose={onClose} />
                <div className="space-y-3 p-3 md:p-4">
                    {!projectLocked && (
                        <Field
                            label={m.fields.project}
                            required
                            htmlFor="new-task-project"
                            error={errors.projectId}
                            hint={projects.length === 0 ? m.task.noProjects : undefined}
                        >
                            <Select
                                id="new-task-project"
                                value={form.projectId}
                                error={Boolean(errors.projectId)}
                                disabled={projects.length === 0}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setForm((f) => ({ ...f, projectId: value }));
                                    setErrors((current) => ({ ...current, projectId: undefined }));
                                }}
                            >
                                <option value="">{m.task.selectProject}</option>
                                {projects.map((project) => (
                                    <option key={project.id} value={project.id}>
                                        {project.code} · {project.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    )}
                    <Field
                        label={m.task.titleField}
                        required
                        htmlFor="new-task-title"
                        error={errors.title}
                    >
                        <Input
                            ref={titleRef}
                            id="new-task-title"
                            value={form.title}
                            error={Boolean(errors.title)}
                            onChange={(e) => {
                                const value = e.target.value;
                                setForm((f) => ({ ...f, title: value }));
                                setErrors((current) => ({ ...current, title: undefined }));
                            }}
                            autoFocus
                        />
                    </Field>
                    {/* The field the modal used to leave out, and the one
                        thing always set next. It opens on the holder the
                        task would get anyway rather than blank, so the
                        default is visible instead of implied. */}
                    <Field label={m.fields.assignee} htmlFor="new-task-assignee" hint={assigneeHint}>
                        <Select
                            id="new-task-assignee"
                            value={form.assignee}
                            onFocus={() => form.projectId && void projectMeta.load(form.projectId)}
                            onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}
                        >
                            <option value="">{m.task.unassigned}</option>
                            {roster.map((person) => (
                                <option key={person.value} value={person.value}>
                                    {person.label}
                                </option>
                            ))}
                            {/* Whoever is preselected, even before the
                                roster has loaded — otherwise the select
                                falls back to its first option and the
                                form quietly disagrees with itself. */}
                            {form.assignee && !roster.some((person) => person.value === form.assignee) && (
                                <option value={form.assignee}>
                                    {assigneeName?.(form.assignee) ?? m.quickAdd.me}
                                </option>
                            )}
                        </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={m.task.dueDate} htmlFor="new-task-due">
                            <Input
                                id="new-task-due"
                                type="date"
                                value={form.dueDate}
                                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                            />
                        </Field>
                        <Field label={m.task.estimate} htmlFor="new-task-estimate">
                            <Input
                                id="new-task-estimate"
                                type="number"
                                min="0"
                                step="0.25"
                                value={form.estimateHours}
                                onChange={(e) => setForm((f) => ({ ...f, estimateHours: e.target.value }))}
                            />
                        </Field>
                    </div>

                    {/* Priority is quiet until it is not MEDIUM. Four
                        tasks in five never leave the default, and a
                        select that always says "Medium" is a row of the
                        form spent saying nothing. */}
                    {showPriority || form.priority !== 'MEDIUM' ? (
                        <Field label={m.fields.priority} htmlFor="new-task-priority">
                            <Select
                                id="new-task-priority"
                                value={form.priority}
                                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                            >
                                {Object.entries(m.priority).map(([key, label]) => (
                                    <option key={key} value={key}>
                                        {label}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setShowPriority(true)}
                            className="min-h-touch text-sm text-blue-600 hover:underline"
                        >
                            {m.quickAdd.setPriority}
                        </button>
                    )}

                    {/* Collapsed, because it was the tallest control in
                        the dialog serving the field most tasks never
                        get. */}
                    {showDescription || form.description ? (
                        <Field label={m.description.title}>
                            <RichTextEditor
                                rows={4}
                                maxLength={5000}
                                value={form.description}
                                placeholder={m.description.placeholder}
                                ariaLabel={m.description.title}
                                onChange={(value) => setForm((f) => ({ ...f, description: value }))}
                            />
                        </Field>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setShowDescription(true)}
                            className="min-h-touch text-sm text-blue-600 hover:underline"
                        >
                            {m.quickAdd.addDescription}
                        </button>
                    )}
                </div>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    {/* Filing a run of tasks is the case the old dialog
                        served worst: one save, one dismissal, one reopen,
                        one re-pick of the project, for every task. */}
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={saving || noProject}
                        onClick={(event) => void submit(event, true)}
                    >
                        {m.quickAdd.saveAndAdd}
                    </Button>
                    <Button type="submit" disabled={saving || noProject}>
                        {t.common.save}
                    </Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
