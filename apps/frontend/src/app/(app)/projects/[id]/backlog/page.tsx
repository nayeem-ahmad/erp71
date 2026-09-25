'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, Checkbox, Input, PageHeader, PageShell, Select } from '@/components/ui';
import TaskDetailPanel from '@/components/projects/TaskDetailPanel';
import { EpicFormModal, type Epic } from '@/components/projects/ProjectEpicsCard';
import { StoryFormModal, type UserStory } from '@/components/projects/ProjectStoriesCard';
import BacklogTree from '@/components/projects/backlog/BacklogTree';
import {
    NO_EPIC_GROUP,
    UNPLANNED_GROUP,
    buildBacklogTree,
    expandedFor,
    isTreeEmpty,
    storyRollup,
    type BacklogData,
    type ExpandLevel,
} from '@/components/projects/backlog/backlog-tree';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { projectChildBreadcrumbs } from '@/lib/page-breadcrumbs';

/** What is folded is a standing preference per project, like a board's lanes. */
const expandedKey = (projectId: string) => `project-backlog-expanded:${projectId}`;

function readExpanded(projectId: string): Set<string> | null {
    try {
        const raw = localStorage.getItem(expandedKey(projectId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === 'string')) : null;
    } catch {
        return null;
    }
}

function writeExpanded(projectId: string, expanded: Set<string>) {
    try {
        localStorage.setItem(expandedKey(projectId), JSON.stringify([...expanded]));
    } catch {
        // Private mode or a full quota: the tree still works, it just forgets.
    }
}

type Editing =
    | { kind: 'epic'; epic: Epic | null }
    | { kind: 'story'; story: UserStory | null; epicId?: string | null }
    | null;

/**
 * One project's backlog as a tree: epics, the user stories under each, and the
 * tasks under each story, with what is done rolled up at every level.
 *
 * Replaces hopping between the epic card, the story card and the board to see
 * how a piece of scope breaks down. Editing reuses the modals those cards
 * already use, so an epic or story has one editor wherever it is opened.
 */
export default function ProjectBacklogPage() {
    const params = useParams<{ id: string }>();
    const projectId = params.id;
    const { t } = useI18n();
    const m = t.projects;

    const [data, setData] = useState<BacklogData | null>(null);
    const [failed, setFailed] = useState(false);
    const [text, setText] = useState('');
    const [hideDone, setHideDone] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [editing, setEditing] = useState<Editing>(null);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const result = (await api.getProjectBacklog(projectId)) as BacklogData;
            setData(result);
            setFailed(false);
            return result;
        } catch (error) {
            setFailed(true);
            toast.error(error instanceof Error ? error.message : m.backlog.loadFailed);
            return null;
        }
    }, [projectId, m.backlog.loadFailed]);

    useEffect(() => {
        let live = true;
        load().then((result) => {
            if (!live || !result) return;
            // First visit opens epics to their stories: the shape of the scope
            // at a glance, with tasks one click away.
            setExpanded(readExpanded(projectId) ?? expandedFor(result, 'stories'));
        });
        return () => {
            live = false;
        };
    }, [load, projectId]);

    const updateExpanded = useCallback(
        (next: Set<string>) => {
            setExpanded(next);
            writeExpanded(projectId, next);
        },
        [projectId],
    );

    const toggle = (id: string) => {
        const next = new Set(expanded);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        updateExpanded(next);
    };

    const open = (id: string) => {
        if (expanded.has(id)) return;
        updateExpanded(new Set(expanded).add(id));
    };

    const tree = useMemo(
        () => (data ? buildBacklogTree(data, { text, hideDone }) : null),
        [data, text, hideDone],
    );

    // While searching every match is shown, whatever is folded: a hit hidden
    // inside a collapsed epic is a hit nobody finds.
    const visibleExpanded = useMemo(
        () => (text.trim() && data ? expandedFor(data, 'all') : expanded),
        [text, data, expanded],
    );

    const epicChips = useMemo(
        () => (data?.epics ?? []).map(({ id, code, title, color }) => ({ id, code, title, color })),
        [data],
    );

    const addStory = async (epicId: string | null, title: string) => {
        try {
            await api.createProjectStory({ projectId, title, ...(epicId ? { epicId } : {}) });
            open(epicId ?? NO_EPIC_GROUP);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.backlog.createFailed);
            throw error;
        }
    };

    const addTask = async (storyId: string | null, title: string) => {
        try {
            await api.createProjectTask({ projectId, title, ...(storyId ? { userStoryId: storyId } : {}) });
            open(storyId ?? UNPLANNED_GROUP);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.backlog.createFailed);
            throw error;
        }
    };

    const openEpic = (epicId: string) => {
        const epic = data?.epics.find((row) => row.id === epicId);
        if (epic) setEditing({ kind: 'epic', epic: { ...epic, reference: 0, project_id: projectId } as Epic });
    };

    const openStory = (storyId: string) => {
        const story = data?.stories.find((row) => row.id === storyId);
        if (!story || !data) return;
        const rollup = storyRollup(data.tasks.filter((task) => task.user_story_id === story.id));
        setEditing({
            kind: 'story',
            story: {
                ...story,
                reference: 0,
                project_id: projectId,
                progress: {
                    taskCount: rollup.taskCount,
                    doneTaskCount: rollup.doneTaskCount,
                    percentComplete: rollup.percent,
                },
            },
        });
    };

    const project = data?.project ?? null;
    const title = project ? `${project.code} · ${m.backlog.title}` : m.backlog.title;

    return (
        <PageShell>
            <PageHeader
                title={title}
                subtitle={m.backlog.subtitle}
                breadcrumbs={projectChildBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.projects,
                    project,
                    m.backlog.title,
                )}
                actions={
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="secondary"
                            className="min-h-touch"
                            onClick={() => setEditing({ kind: 'story', story: null })}
                        >
                            <Plus className="h-4 w-4" />
                            {m.stories.add}
                        </Button>
                        <Button className="min-h-touch" onClick={() => setEditing({ kind: 'epic', epic: null })}>
                            <Plus className="h-4 w-4" />
                            {m.epics.add}
                        </Button>
                    </div>
                }
            />

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                    type="search"
                    value={text}
                    placeholder={m.backlog.searchPlaceholder}
                    aria-label={m.backlog.searchPlaceholder}
                    className="md:max-w-sm"
                    onChange={(event) => setText(event.target.value)}
                />
                <div className="flex items-center gap-3">
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

            <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
                {!data ? (
                    <p className="p-4 text-sm text-gray-500">{failed ? m.backlog.loadFailed : t.common.loading}</p>
                ) : tree && isTreeEmpty(tree) && (text.trim() || hideDone) ? (
                    <p className="p-4 text-sm text-gray-500">{m.backlog.emptyFiltered}</p>
                ) : (
                    <>
                        {data.epics.length === 0 && data.stories.length === 0 && data.tasks.length === 0 ? (
                            <p className="border-b border-gray-100 p-4 text-sm text-gray-500">{m.backlog.empty}</p>
                        ) : null}
                        {tree ? (
                            <BacklogTree
                                tree={tree}
                                expanded={visibleExpanded}
                                onToggle={toggle}
                                onOpenEpic={openEpic}
                                onOpenStory={openStory}
                                onOpenTask={setOpenTaskId}
                                onAddStory={addStory}
                                onAddTask={addTask}
                                canEdit
                                filtering={Boolean(text.trim()) || hideDone}
                            />
                        ) : null}
                    </>
                )}
            </section>

            {editing?.kind === 'epic' ? (
                <EpicFormModal
                    projectId={projectId}
                    projectCode={project?.code}
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
                    projectId={projectId}
                    projectCode={project?.code}
                    story={editing.story}
                    epics={epicChips}
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
        </PageShell>
    );
}
