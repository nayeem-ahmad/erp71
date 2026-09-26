'use client';

import { useState } from 'react';
import {
    Button,
    Field,
    Input,
    Select,
    Textarea,
    type StatusBadgeTone,
} from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { LABEL_COLORS } from '@/components/projects/board-tasks';
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

export const EPIC_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/** Finished is a success; dropped scope is neutral, not an error. */
export const EPIC_STATUS_TONE: Record<string, StatusBadgeTone> = {
    OPEN: 'neutral',
    IN_PROGRESS: 'info',
    DONE: 'success',
    CANCELLED: 'neutral',
};

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
