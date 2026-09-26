'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Checkbox, Input, Select } from '@/components/ui';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import { EpicFormModal, type Epic } from '@/components/projects/EpicFormModal';
import { StoryFormModal, type UserStory } from '@/components/projects/StoryFormModal';
import type { ChipOption } from '@/components/projects/ChipPopover';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import BacklogTree from './BacklogTree';
import BacklogBulkBar, { type BulkAction, type SelectedItem } from './BacklogBulkBar';
import type { RowEdit } from './BacklogRow';
import {
    buildBacklogTree,
    expandedFor,
    noEpicGroup,
    projectsOf,
    splitByProject,
    storyRollup,
    unplannedGroup,
    type BacklogData,
    type ExpandLevel,
} from './backlog-tree';
import {
    applyMove,
    flattenBacklog,
    isItem,
    isNoOp,
    orderedIdsFor,
    type BacklogMove,
    type ItemKind,
    type VisibleRow,
} from './backlog-rows';
import { useBacklogOptions } from './use-backlog-options';

function readExpanded(key: string): Set<string> | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === 'string')) : null;
    } catch {
        return null;
    }
}

function writeExpanded(key: string, expanded: Set<string>) {
    try {
        localStorage.setItem(key, JSON.stringify([...expanded]));
    } catch {
        // Private mode or a full quota: the tree still works, it just forgets.
    }
}

type Editing =
    | { kind: 'epic'; epic: Epic | null; projectId?: string }
    | { kind: 'story'; story: UserStory | null; projectId?: string }
    | null;

export interface BacklogHeaderContext {
    data: BacklogData | null;
    newEpic: () => void;
    newStory: () => void;
    reload: () => Promise<unknown>;
}

export interface BacklogWorkspaceProps {
    /** One project's backlog. Omit for every project's scope at once. */
    projectId?: string;
    /** Which level a first visit opens the tree to. */
    initialLevel?: ExpandLevel;
    /** Where the fold state is remembered. */
    storageKey: string;
    header: (context: BacklogHeaderContext) => ReactNode;
}

/**
 * The Backlog — epics, their stories and those stories' tasks as one tree — with
 * everything that works on it: filters, folding, selection and bulk actions,
 * drag / "Move to" / keyboard moves, inline edits, and the epic, story and task
 * editors. One component behind three screens: a project's Backlog, and the
 * cross-project Epics and User stories pages, which differ only in how far the
 * tree opens and whether projects head it.
 */
export default function BacklogWorkspace({ projectId, initialLevel = 'stories', storageKey, header }: BacklogWorkspaceProps) {
    const { t, fmt } = useI18n();
    const m = t.projects;
    const searchParams = useSearchParams();
    const crossProject = !projectId;

    const [data, setData] = useState<BacklogData | null>(null);
    const [failed, setFailed] = useState(false);
    const [text, setText] = useState('');
    const [hideDone, setHideDone] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [anchor, setAnchor] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<Editing>(null);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    /** Cross-project only: narrow the tree to one project. */
    const [onlyProject, setOnlyProject] = useState('');
    /**
     * Cross-project only: every project the viewer can write into, for the
     * "New epic" / "New story" picker. The tree lists only projects that
     * already have scope, and a project with none is exactly where the first
     * epic has to go.
     */
    const [allProjects, setAllProjects] = useState<{ id: string; code: string; name: string }[] | null>(null);
    const options = useBacklogOptions();

    useEffect(() => {
        if (!crossProject) return;
        let live = true;
        api.getProjects({ limit: 100 })
            .then((result: { items?: { id: string; code: string; name: string }[] } | null) => {
                if (live) setAllProjects(result?.items ?? []);
            })
            .catch(() => {
                if (live) setAllProjects(null);
            });
        return () => {
            live = false;
        };
    }, [crossProject]);

    const load = useCallback(async () => {
        try {
            const result = (await (projectId ? api.getProjectBacklog(projectId) : api.getAllProjectsBacklog())) as BacklogData;
            setData(result);
            setFailed(false);
            return result;
        } catch (error) {
            setFailed(true);
            toast.error(error instanceof Error ? error.message : m.backlog.loadFailed);
            return null;
        }
    }, [projectId, m.backlog.loadFailed]);

    // A deep link (`?story=`, `?epic=`, `?task=`) opens its editor once, on the
    // first load — the links the cross-project lists and the old project cards
    // hand out.
    const deepLinked = useRef(false);
    useEffect(() => {
        let live = true;
        load().then((result) => {
            if (!live || !result) return;
            // First visit opens the tree to the level the screen is about.
            const open = readExpanded(storageKey) ?? expandedFor(result, initialLevel);
            if (!deepLinked.current) {
                deepLinked.current = true;
                const storyId = searchParams?.get('story');
                const epicId = searchParams?.get('epic');
                const taskId = searchParams?.get('task');
                const story = storyId ? result.stories.find((row) => row.id === storyId) : undefined;
                const epic = epicId ? result.epics.find((row) => row.id === epicId) : undefined;
                if (story?.epic_id) open.add(story.epic_id);
                if (story) openStoryFrom(result, story.id);
                else if (epic) openEpicFrom(result, epic.id);
                if (taskId) setOpenTaskId(taskId);
            }
            setExpanded(open);
        });
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, storageKey, initialLevel]);

    const updateExpanded = useCallback(
        (next: Set<string>) => {
            setExpanded(next);
            writeExpanded(storageKey, next);
        },
        [storageKey],
    );

    const openGroup = (id: string) => {
        setExpanded((previous) => {
            if (previous.has(id)) return previous;
            const next = new Set(previous).add(id);
            writeExpanded(storageKey, next);
            return next;
        });
    };

    const filtering = Boolean(text.trim()) || hideDone;

    const sections = useMemo(
        () =>
            data
                ? splitByProject(data)
                      .filter(({ project }) => !onlyProject || project.id === onlyProject)
                      .map(({ project, data: slice }) => ({
                          project,
                          tree: buildBacklogTree(slice, { text, hideDone }),
                      }))
                : [],
        [data, text, hideDone, onlyProject],
    );

    // While searching every match is shown, whatever is folded: a hit hidden
    // inside a collapsed epic is a hit nobody finds.
    const visibleExpanded = useMemo(
        () => (text.trim() && data ? expandedFor(data, 'all') : expanded),
        [text, data, expanded],
    );

    const rows = useMemo(
        () =>
            flattenBacklog(
                // Across projects, a project with nothing left after filtering
                // is dropped rather than drawn as an empty heading.
                crossProject && filtering
                    ? sections.filter(({ tree }) => tree.epics.length + tree.noEpic.length + tree.unplanned.length > 0)
                    : sections,
                visibleExpanded,
                { projectHeadings: crossProject, addRows: true, filtering },
            ),
        [sections, visibleExpanded, crossProject, filtering],
    );

    // ── Editors ────────────────────────────────────────────────────────────

    function openEpicFrom(source: BacklogData, epicId: string) {
        const epic = source.epics.find((row) => row.id === epicId);
        if (!epic) return;
        const owner = epic.project_id ?? projectId;
        setEditing({ kind: 'epic', epic: { ...epic, reference: 0, project_id: owner } as Epic, projectId: owner });
    }

    function openStoryFrom(source: BacklogData, storyId: string) {
        const story = source.stories.find((row) => row.id === storyId);
        if (!story) return;
        const owner = story.project_id ?? projectId;
        const rollup = storyRollup(source.tasks.filter((task) => task.user_story_id === story.id));
        setEditing({
            kind: 'story',
            projectId: owner,
            story: {
                ...story,
                reference: 0,
                project_id: owner,
                progress: {
                    taskCount: rollup.taskCount,
                    doneTaskCount: rollup.doneTaskCount,
                    percentComplete: rollup.percent,
                },
            },
        });
    }

    const onOpen = (row: VisibleRow) => {
        if (!data) return;
        if (row.kind === 'epic') openEpicFrom(data, row.id);
        else if (row.kind === 'story') openStoryFrom(data, row.id);
        else if (row.kind === 'task') setOpenTaskId(row.id);
    };

    const onToggle = (row: VisibleRow) => {
        const next = new Set(expanded);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        updateExpanded(next);
    };

    // ── Selection ──────────────────────────────────────────────────────────

    const onSelect = (row: VisibleRow, extend: boolean) => {
        setSelected((previous) => {
            const next = new Set(previous);
            if (extend && anchor) {
                // Shift extends from the last row picked to this one, over the
                // item rows in between as they are drawn.
                const items = rows.filter(isItem);
                const from = items.findIndex((candidate) => candidate.key === anchor);
                const to = items.findIndex((candidate) => candidate.key === row.key);
                if (from >= 0 && to >= 0) {
                    const [start, end] = from < to ? [from, to] : [to, from];
                    for (const item of items.slice(start, end + 1)) next.add(item.key);
                    return next;
                }
            }
            if (next.has(row.key)) next.delete(row.key);
            else next.add(row.key);
            return next;
        });
        setAnchor(row.key);
    };

    /** The selection resolved against the data, so a row folded out of view stays selected. */
    const selectedItems = useMemo<SelectedItem[]>(() => {
        if (!data) return [];
        const items: SelectedItem[] = [];
        const owner = (row: { project_id?: string }) => row.project_id ?? projectId ?? '';
        for (const key of selected) {
            const [kind, id] = key.split(':') as [ItemKind, string];
            const source =
                kind === 'epic'
                    ? data.epics.find((row) => row.id === id)
                    : kind === 'story'
                      ? data.stories.find((row) => row.id === id)
                      : data.tasks.find((row) => row.id === id);
            if (source) items.push({ kind, id, projectId: owner(source) });
        }
        return items;
    }, [data, selected, projectId]);

    // ── Moves ──────────────────────────────────────────────────────────────

    const onMove = async (move: BacklogMove) => {
        if (!data || isNoOp(data, move)) return;
        const orderedIds = orderedIdsFor(data, move);
        // Straight to where it was dropped; the reload below settles it.
        setData(applyMove(data, move));
        if (move.kind === 'story') openGroup(move.parentId ?? noEpicGroup(move.projectId));
        if (move.kind === 'task') openGroup(move.parentId ?? unplannedGroup(move.projectId));
        try {
            if (move.kind === 'task') {
                await api.reorderBacklogTasks(move.projectId, { id: move.id, parentId: move.parentId, orderedIds });
            } else {
                await api.reorderBacklogScope(move.projectId, {
                    kind: move.kind,
                    id: move.id,
                    ...(move.kind === 'story' ? { parentId: move.parentId } : {}),
                    orderedIds,
                });
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.backlog.moveFailed);
        }
        await load();
    };

    const onMoveTo = (row: VisibleRow, parentId: string | null) => {
        if (!isItem(row) || row.kind === 'epic') return;
        void onMove({ kind: row.kind, id: row.id, projectId: row.projectId, parentId, anchorId: null, position: 'after' });
    };

    const parentOptions = useCallback(
        (kind: 'story' | 'task', owner: string): ChipOption[] => {
            if (!data) return [];
            const inProject = (row: { project_id?: string }) => (row.project_id ?? projectId) === owner;
            if (kind === 'story') {
                return data.epics.filter(inProject).map((epic) => ({ value: epic.id, label: `${epic.code} · ${epic.title}` }));
            }
            const epicCode = new Map(data.epics.map((epic) => [epic.id, epic.code]));
            return data.stories.filter(inProject).map((story) => ({
                value: story.id,
                label: `${story.code} · ${story.title}`,
                subtitle: story.epic_id ? epicCode.get(story.epic_id) : undefined,
            }));
        },
        [data, projectId],
    );

    const moveTargets = (row: VisibleRow) =>
        row.kind === 'story' || row.kind === 'task' ? parentOptions(row.kind, row.projectId) : [];

    // ── Inline edits ───────────────────────────────────────────────────────

    const onEdit = async (row: VisibleRow, edit: RowEdit) => {
        try {
            if (row.kind === 'epic') {
                await api.updateProjectEpic(row.id, { [edit.field]: edit.value });
            } else if (row.kind === 'story') {
                const field = edit.field === 'points' ? 'storyPoints' : edit.field;
                await api.updateProjectStory(row.id, { [field]: edit.value });
            } else if (row.kind === 'task') {
                if (edit.field === 'status') await api.updateProjectTask(row.id, { statusId: edit.value });
                else if (edit.field === 'priority') await api.updateProjectTask(row.id, { priority: edit.value });
                else if (edit.field === 'assignee') {
                    const key = String(edit.value ?? '');
                    // Both columns every time: '' clears the one not chosen, so
                    // a task never holds a user and an employee at once.
                    await api.updateProjectTask(row.id, {
                        assigneeId: key.startsWith('user:') ? key.slice(5) : '',
                        assigneeEmployeeId: key.startsWith('employee:') ? key.slice(9) : '',
                    });
                }
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.backlog.editFailed);
        }
        await load();
    };

    // ── Bulk ───────────────────────────────────────────────────────────────

    const runBulk = async (action: BulkAction) => {
        if (selectedItems.length === 0) return;
        setBusy(true);
        let updated = 0;
        const skipped: string[] = [];
        // One request per project and kind: the routes are per project, and
        // scope and tasks sit behind different permissions.
        const groups = new Map<string, SelectedItem[]>();
        for (const item of selectedItems) {
            const key = `${item.projectId}|${item.kind}`;
            groups.set(key, [...(groups.get(key) ?? []), item]);
        }
        try {
            for (const items of groups.values()) {
                const { kind, projectId: owner } = items[0];
                const ids = items.map((item) => item.id);
                const verb = action.action === 'move' ? (kind === 'story' ? 'epic' : 'story') : action.action;
                const value = 'value' in action ? action.value : undefined;
                const result = (await (kind === 'task'
                    ? api.bulkBacklogTasks(owner, { ids, action: verb, value })
                    : api.bulkBacklogScope(owner, { kind, ids, action: verb, value }))) as {
                    updated: number;
                    skipped: { id: string; reason: string }[];
                };
                updated += result.updated;
                for (const row of result.skipped) skipped.push(row.reason);
            }
            if (skipped.length === 0) toast.success(fmt(m.backlog.bulkDone, { count: updated }));
            else {
                toast.error(
                    fmt(m.backlog.bulkSkipped, { updated, skipped: skipped.length, reason: [...new Set(skipped)][0] }),
                );
            }
            setSelected(new Set());
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.backlog.bulkFailed);
        } finally {
            setBusy(false);
        }
        await load();
    };

    // ── Adding ─────────────────────────────────────────────────────────────

    const onAdd = async (row: VisibleRow, title: string) => {
        try {
            if (row.kind === 'addStory') {
                await api.createProjectStory({
                    projectId: row.projectId,
                    title,
                    ...(row.parentId ? { epicId: row.parentId } : {}),
                });
                openGroup(row.parentId ?? noEpicGroup(row.projectId));
            } else {
                await api.createProjectTask({
                    projectId: row.projectId,
                    title,
                    ...(row.parentId ? { userStoryId: row.parentId } : {}),
                });
                openGroup(row.parentId ?? unplannedGroup(row.projectId));
            }
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.backlog.createFailed);
            throw error;
        }
    };

    // ── Render ─────────────────────────────────────────────────────────────

    const projectOptions = useMemo(
        () => allProjects ?? (data ? projectsOf(data).map(({ id, code, name }) => ({ id, code, name })) : []),
        [allProjects, data],
    );
    const editingProjectId = editing?.projectId ?? projectId;
    const editingProjectCode = projectOptions.find((project) => project.id === editingProjectId)?.code;
    const epicChips = useMemo(
        () =>
            (data?.epics ?? [])
                .filter((epic) => (epic.project_id ?? projectId) === editingProjectId)
                .map(({ id, code, title, color }) => ({ id, code, title, color })),
        [data, editingProjectId, projectId],
    );

    const empty = data && data.epics.length === 0 && data.stories.length === 0 && data.tasks.length === 0;

    return (
        <>
            {header({
                data,
                newEpic: () => setEditing({ kind: 'epic', epic: null }),
                newStory: () => setEditing({ kind: 'story', story: null }),
                reload: load,
            })}

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                    type="search"
                    value={text}
                    placeholder={m.backlog.searchPlaceholder}
                    aria-label={m.backlog.searchPlaceholder}
                    className="md:max-w-sm"
                    onChange={(event) => setText(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-3">
                    {crossProject && data ? (
                        <Select
                            aria-label={m.fields.project}
                            value={onlyProject}
                            className="w-auto"
                            onChange={(event) => setOnlyProject(event.target.value)}
                        >
                            <option value="">{m.backlog.allProjects}</option>
                            {projectsOf(data).map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.code} · {project.name}
                                </option>
                            ))}
                        </Select>
                    ) : null}
                    <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                        <Checkbox checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} />
                        {m.backlog.hideDone}
                    </label>
                    <Select
                        aria-label={m.backlog.expand}
                        value=""
                        disabled={!data}
                        className="w-auto"
                        onChange={(event) => {
                            const level = event.target.value as ExpandLevel;
                            if (data && level) updateExpanded(expandedFor(data, level));
                        }}
                    >
                        <option value="">{m.backlog.expand}</option>
                        <option value="epics">{m.backlog.expandEpics}</option>
                        <option value="stories">{m.backlog.expandStories}</option>
                        <option value="all">{m.backlog.expandAll}</option>
                    </Select>
                </div>
            </div>

            <BacklogBulkBar
                items={selectedItems}
                busy={busy}
                onRun={(action) => void runBulk(action)}
                onClear={() => setSelected(new Set())}
                moveTargets={parentOptions}
                columnsOf={options.columnsOf}
                membersOf={options.membersOf}
                wantOptions={options.want}
            />

            <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
                {!data ? (
                    <p className="p-4 text-sm text-gray-500">{failed ? m.backlog.loadFailed : t.common.loading}</p>
                ) : rows.length === 0 && filtering ? (
                    <p className="p-4 text-sm text-gray-500">{m.backlog.emptyFiltered}</p>
                ) : (
                    <>
                        {empty ? (
                            <p className="border-b border-gray-100 p-4 text-sm text-gray-500">
                                {crossProject ? m.backlog.emptyAll : m.backlog.empty}
                            </p>
                        ) : null}
                        <BacklogTree
                            rows={rows}
                            selected={selected}
                            canEdit
                            onToggle={onToggle}
                            onOpen={onOpen}
                            onSelect={onSelect}
                            onMove={(move) => void onMove(move)}
                            onEdit={(row, edit) => void onEdit(row, edit)}
                            moveTargets={moveTargets}
                            onMoveTo={onMoveTo}
                            onAdd={onAdd}
                            columnsOf={options.columnsOf}
                            membersOf={options.membersOf}
                            wantOptions={options.want}
                        />
                    </>
                )}
            </section>
            <p className="hidden text-xs text-gray-400 md:block">{m.backlog.keyboardHint}</p>

            {editing?.kind === 'epic' ? (
                <EpicFormModal
                    projectId={editingProjectId}
                    projectCode={editingProjectCode}
                    projects={crossProject ? projectOptions : undefined}
                    epic={editing.epic}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null);
                        await load();
                    }}
                />
            ) : null}

            {editing?.kind === 'story' ? (
                <StoryFormModal
                    projectId={editingProjectId}
                    projectCode={editingProjectCode}
                    projects={crossProject ? projectOptions : undefined}
                    story={editing.story}
                    epics={editingProjectId ? epicChips : undefined}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null);
                        await load();
                    }}
                />
            ) : null}

            {openTaskId ? (
                <TaskDetailPanel taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={load} />
            ) : null}
        </>
    );
}

