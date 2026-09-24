'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Input, Select } from '@/components/ui';
import { Tabs, TabPanel } from '@/components/ui/compact/Tabs';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { hours, type SprintTask } from './sprint-table';

type BacklogTab = 'tasks' | 'stories';

interface Story {
    id: string;
    code: string;
    title: string;
    status: string;
    project?: { id: string; code: string; name: string } | null;
    progress?: { taskCount: number; doneTaskCount: number };
}

/**
 * The backlog, opened only when somebody is adding work — the sprint page
 * itself is about what has been committed, and a permanent second list beside
 * it pushed the table off the screen.
 *
 * Two ways in: individual tasks, or whole stories. A story is committed by
 * committing its open tasks (a story holds no hours of its own), which the
 * server does in one call so a story with twenty tasks is not twenty requests.
 */
export default function SprintBacklogModal({
    sprintId,
    sprintName,
    onClose,
    onAdded,
}: {
    sprintId: string;
    sprintName: string;
    onClose: () => void;
    onAdded: () => void;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects;

    const [tab, setTab] = useState<BacklogTab>('tasks');
    const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);
    // A tenant-level sprint draws from every project, so this filter is what
    // keeps the lists usable once there is more than a handful.
    const [projectId, setProjectId] = useState('');
    const [search, setSearch] = useState('');
    const [tasks, setTasks] = useState<SprintTask[] | null>(null);
    const [stories, setStories] = useState<Story[] | null>(null);
    const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
    const [selectedStories, setSelectedStories] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api.getProjects({ limit: 100 })
            .then((res) => setProjects((res?.items ?? []) as { id: string; code: string; name: string }[]))
            .catch(() => setProjects([]));
    }, []);

    const loadTasks = useCallback(async () => {
        try {
            const page = await api.getProjectTasks({
                backlogOnly: 'true',
                limit: 200,
                ...(projectId ? { projectId } : {}),
                ...(search.trim() ? { search: search.trim() } : {}),
            });
            // A finished task has nothing left to burn, so it is no candidate.
            setTasks(
                ((page?.items ?? []) as SprintTask[]).filter((task) => task.status?.category !== 'DONE'),
            );
        } catch (error) {
            setTasks([]);
            toast.error(error instanceof Error ? error.message : m.sprint.loadFailed);
        }
    }, [projectId, search, m.sprint.loadFailed]);

    const loadStories = useCallback(async () => {
        try {
            const res = await api.getProjectStories({
                ...(projectId ? { projectId } : {}),
                ...(search.trim() ? { search: search.trim() } : {}),
            });
            const list = (Array.isArray(res) ? res : []) as Story[];
            setStories(
                list.filter(
                    (story) =>
                        story.status !== 'DONE' &&
                        (story.progress?.taskCount ?? 0) > (story.progress?.doneTaskCount ?? 0),
                ),
            );
        } catch (error) {
            setStories([]);
            toast.error(error instanceof Error ? error.message : m.sprint.loadFailed);
        }
    }, [projectId, search, m.sprint.loadFailed]);

    // Debounced so typing a search does not fire a request per keystroke.
    useEffect(() => {
        const handle = setTimeout(() => {
            if (tab === 'tasks') void loadTasks();
            else void loadStories();
        }, 250);
        return () => clearTimeout(handle);
    }, [tab, loadTasks, loadStories]);

    const toggle = (setter: typeof setSelectedTasks, id: string) =>
        setter((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const selectedHours = useMemo(
        () =>
            (tasks ?? [])
                .filter((task) => selectedTasks.has(task.id))
                .reduce((sum, task) => sum + hours(task.remaining_hours), 0),
        [tasks, selectedTasks],
    );

    const add = async () => {
        setBusy(true);
        try {
            const result = (tab === 'tasks'
                ? await api.assignTasksToSprint(sprintId, [...selectedTasks])
                : await api.assignStoriesToSprint(sprintId, [...selectedStories])) as { assigned?: number };
            const count = result?.assigned ?? 0;
            if (count === 0 && tab === 'stories') toast.info(m.sprint.nothingAdded);
            else toast.success(fmt(m.sprint.tasksAdded, { count }));
            onAdded();
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.sprint.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const selectionCount = tab === 'tasks' ? selectedTasks.size : selectedStories.size;

    return (
        <ModalShell size="xl" onBackdropClick={onClose}>
            <ModalHeader
                title={fmt(m.sprint.addWorkTitle, { name: sprintName })}
                onClose={onClose}
                closeLabel={t.common.close}
            />
            <div className="space-y-3 p-3 md:p-4">
                <Tabs<BacklogTab>
                    idPrefix="sprint-backlog"
                    label={m.sprint.backlog}
                    tabs={[
                        { key: 'tasks', label: m.sprint.tabTasks },
                        { key: 'stories', label: m.sprint.tabStories },
                    ]}
                    value={tab}
                    onChange={(next) => next && setTab(next)}
                />
                <div className="flex flex-wrap gap-2">
                    <Input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.sprint.searchBacklog}
                        aria-label={m.sprint.searchBacklog}
                        className="min-w-0 flex-1"
                    />
                    <Select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        aria-label={m.fields.project}
                        className="w-44"
                    >
                        <option value="">{m.tasks.allProjects}</option>
                        {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                                {project.code}
                            </option>
                        ))}
                    </Select>
                </div>

                <TabPanel tabKey="tasks" value={tab} idPrefix="sprint-backlog">
                    {tasks == null ? null : tasks.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.sprint.emptyBacklog}</p>
                    ) : (
                        <ul className="max-h-[50vh] divide-y divide-gray-200 overflow-y-auto rounded-md border border-gray-200">
                            {tasks.map((task) => (
                                <li key={task.id}>
                                    <label className="flex min-h-touch cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                                        <Checkbox
                                            checked={selectedTasks.has(task.id)}
                                            onChange={() => toggle(setSelectedTasks, task.id)}
                                        />
                                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                                        {task.userStory && (
                                            <span className="hidden shrink-0 text-xs text-gray-500 sm:inline">
                                                {task.userStory.code}
                                            </span>
                                        )}
                                        {/* The project has to be on the row: this list mixes them. */}
                                        <span className="shrink-0 text-xs text-gray-500">
                                            {task.project?.code ?? '—'}
                                        </span>
                                        <span className="w-12 shrink-0 text-end text-xs tabular-nums text-gray-500">
                                            {hours(task.remaining_hours)}h
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
                </TabPanel>

                <TabPanel tabKey="stories" value={tab} idPrefix="sprint-backlog">
                    <p className="mb-2 text-xs text-gray-500">{m.sprint.storyHint}</p>
                    {stories == null ? null : stories.length === 0 ? (
                        <p className="text-sm text-gray-500">{m.sprint.emptyStories}</p>
                    ) : (
                        <ul className="max-h-[50vh] divide-y divide-gray-200 overflow-y-auto rounded-md border border-gray-200">
                            {stories.map((story) => (
                                <li key={story.id}>
                                    <label className="flex min-h-touch cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                                        <Checkbox
                                            checked={selectedStories.has(story.id)}
                                            onChange={() => toggle(setSelectedStories, story.id)}
                                        />
                                        <span className="shrink-0 text-xs font-medium text-gray-600">
                                            {story.code}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate">{story.title}</span>
                                        <span className="shrink-0 text-xs text-gray-500">
                                            {fmt(m.sprint.openTasks, {
                                                count:
                                                    (story.progress?.taskCount ?? 0) -
                                                    (story.progress?.doneTaskCount ?? 0),
                                            })}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
                </TabPanel>
            </div>
            <ModalFooter>
                <span className="me-auto text-xs text-gray-500">
                    {tab === 'tasks'
                        ? fmt(m.sprint.selectedHours, { count: selectedTasks.size, hours: selectedHours })
                        : selectedStories.size}
                </span>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button disabled={busy || selectionCount === 0} onClick={() => void add()}>
                    {m.sprint.addToSprint}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
