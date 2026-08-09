'use client';

import { useEffect, useState } from 'react';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { projectLabelOf, type BoardProject } from './board-tasks';

interface PickerProject {
    id: string;
    code: string;
    name: string;
}

interface PickerTask {
    id: string;
    title: string;
    project?: BoardProject | null;
}

interface AddBoardTasksModalProps {
    boardId: string;
    onClose: () => void;
    onAdded: () => void;
}

/** Cross-project task picker used to add existing tasks to a board. */
export default function AddBoardTasksModal({ boardId, onClose, onAdded }: AddBoardTasksModalProps) {
    const { t } = useI18n();
    const m = t.projects.boards;

    const [projects, setProjects] = useState<PickerProject[]>([]);
    const [projectId, setProjectId] = useState('');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [tasks, setTasks] = useState<PickerTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as PickerProject[]))
            .catch(() => setProjects([]));
    }, []);

    // Debounced like the workspace-wide tasks list (projects/tasks/page.tsx) — a
    // fetch per keystroke would hammer the endpoint for no benefit.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.getProjectTasks({
            search: debouncedSearch || undefined,
            projectId: projectId || undefined,
            limit: 50,
        })
            .then((res) => {
                if (!cancelled) setTasks((res?.items ?? []) as PickerTask[]);
            })
            .catch(() => {
                if (!cancelled) setTasks([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [debouncedSearch, projectId]);

    const toggle = (taskId: string) => {
        // A Set (not an array) so re-narrowing the filter never silently drops an
        // earlier pick that has scrolled out of the current results.
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) next.delete(taskId);
            else next.add(taskId);
            return next;
        });
    };

    const submit = async () => {
        if (selected.size === 0) return;
        setSubmitting(true);
        try {
            await api.addBoardTasks(boardId, [...selected]);
            toast.success(m.added);
            onAdded();
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t.common.error);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalShell size="lg" onBackdropClick={onClose}>
            <ModalHeader title={m.addTasksTitle} onClose={onClose} />
            <div className="space-y-4 p-3 md:p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-end">
                    <Field label={m.searchTasks} htmlFor="board-task-search" className="flex-1">
                        <Input
                            id="board-task-search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </Field>
                    <Field label={t.projects.fields.project} htmlFor="board-task-project" className="md:w-52">
                        <Select
                            id="board-task-project"
                            value={projectId}
                            onChange={(event) => setProjectId(event.target.value)}
                        >
                            <option value="">{m.allProjects}</option>
                            {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.code} · {project.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </div>

                {loading ? (
                    <p className="text-sm text-gray-500">{t.common.loading}</p>
                ) : tasks.length === 0 ? (
                    <p className="text-sm text-gray-500">{m.noResults}</p>
                ) : (
                    <div className="space-y-2">
                        {tasks.map((task) => (
                            <label
                                key={task.id}
                                className="flex min-h-touch items-center gap-3 rounded-lg border border-gray-200 p-3"
                            >
                                <Checkbox
                                    aria-label={task.title}
                                    checked={selected.has(task.id)}
                                    onChange={() => toggle(task.id)}
                                />
                                <span className="flex-1 text-sm text-gray-900">{task.title}</span>
                                {task.project ? (
                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                        {projectLabelOf(task.project)}
                                    </span>
                                ) : null}
                            </label>
                        ))}
                    </div>
                )}
            </div>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button onClick={submit} disabled={submitting || selected.size === 0}>
                    {t.common.add} ({m.selectedCount.replace('{count}', String(selected.size))})
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
