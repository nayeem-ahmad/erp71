/**
 * The project backlog as a tree — epic → story → task — built from the flat
 * rows `GET /project-backlog/:projectId` (one project) or `GET /project-backlog`
 * (every project with scope) returns.
 *
 * Pure on purpose: the page recomputes it on every keystroke of the search box
 * and after every write, and everything that can go wrong with a hierarchy
 * (orphans, rollups, a match three levels down) is testable here without
 * rendering anything.
 */

export interface BacklogProject {
    id: string;
    code: string;
    name: string;
    short_name?: string | null;
}

export interface BacklogEpic {
    id: string;
    project_id?: string;
    code: string;
    title: string;
    description?: string | null;
    status: string;
    priority: string;
    color: string;
    start_date?: string | null;
    target_date?: string | null;
    sort_order: number;
}

export interface BacklogStory {
    id: string;
    project_id?: string;
    code: string;
    title: string;
    as_a?: string | null;
    i_want?: string | null;
    so_that?: string | null;
    acceptance_criteria?: string | null;
    status: string;
    priority: string;
    story_points?: number | null;
    epic_id?: string | null;
    sort_order: number;
}

export interface BacklogTask {
    id: string;
    project_id?: string;
    key: string;
    reference: number;
    title: string;
    user_story_id?: string | null;
    priority: string;
    due_date?: string | null;
    estimate_hours?: number | null;
    remaining_hours?: number | null;
    logged_hours: number;
    status?: { id: string; name: string; category: string } | null;
    assignee?: { id: string; name?: string | null } | null;
    assigneeEmployee?: { id: string; name?: string | null } | null;
    sprint?: { id: string; name: string } | null;
    _count?: { subtasks: number };
}

export interface BacklogData {
    /** The one project, on a project's own Backlog. */
    project?: BacklogProject;
    /** Every project, on the cross-project screens. */
    projects?: BacklogProject[];
    epics: BacklogEpic[];
    stories: BacklogStory[];
    tasks: BacklogTask[];
}

export interface StoryRollup {
    taskCount: number;
    doneTaskCount: number;
    estimateHours: number;
    loggedHours: number;
    percent: number;
}

export interface EpicRollup {
    storyCount: number;
    doneStoryCount: number;
    points: number;
    donePoints: number;
    taskCount: number;
    doneTaskCount: number;
    /** Stories done out of stories — the unit an epic finishes in, as on the epic card. */
    percent: number;
}

export interface TaskNode {
    kind: 'task';
    id: string;
    task: BacklogTask;
}

export interface StoryNode {
    kind: 'story';
    id: string;
    story: BacklogStory;
    rollup: StoryRollup;
    tasks: TaskNode[];
}

export interface EpicNode {
    kind: 'epic';
    id: string;
    epic: BacklogEpic;
    rollup: EpicRollup;
    stories: StoryNode[];
}

export interface BacklogTree {
    epics: EpicNode[];
    /** Stories filed under no epic. */
    noEpic: StoryNode[];
    /** Tasks filed under no story — work nobody has tied to a requirement yet. */
    unplanned: TaskNode[];
}

export interface BacklogFilters {
    text: string;
    hideDone: boolean;
}

export const NO_BACKLOG_FILTERS: BacklogFilters = { text: '', hideDone: false };

/**
 * Expand-state ids for the nodes that are not a row in the database: the two
 * catch-all groups (one pair per project) and, across projects, the project.
 */
export const noEpicGroup = (projectId: string) => `__no-epic:${projectId}`;
export const unplannedGroup = (projectId: string) => `__unplanned:${projectId}`;
export const projectGroup = (projectId: string) => `__project:${projectId}`;

/** Every project this data spans, in the order the server sent them. */
export function projectsOf(data: BacklogData): BacklogProject[] {
    if (data.projects) return data.projects;
    return data.project ? [data.project] : [];
}

/**
 * The data cut into one slice per project, each shaped like a single project's
 * backlog, so `buildBacklogTree` never has to know it is looking at several.
 * Rows without a `project_id` belong to the only project there is.
 */
export function splitByProject(data: BacklogData): { project: BacklogProject; data: BacklogData }[] {
    const projects = projectsOf(data);
    if (projects.length === 1 && !data.projects) return [{ project: projects[0], data }];
    const of = (row: { project_id?: string }, id: string) => (row.project_id ?? projects[0]?.id) === id;
    return projects.map((project) => ({
        project,
        data: {
            project,
            epics: data.epics.filter((epic) => of(epic, project.id)),
            stories: data.stories.filter((story) => of(story, project.id)),
            tasks: data.tasks.filter((task) => of(task, project.id)),
        },
    }));
}

export const isTaskDone = (task: BacklogTask) => task.status?.category === 'DONE';
export const isStoryDone = (story: BacklogStory) => story.status === 'DONE';
export const isEpicDone = (epic: BacklogEpic) => epic.status === 'DONE' || epic.status === 'CANCELLED';

export function assigneeNameOf(task: BacklogTask): string | null {
    return task.assignee?.name ?? task.assigneeEmployee?.name ?? null;
}

const percentOf = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 100));

export function storyRollup(tasks: BacklogTask[]): StoryRollup {
    const done = tasks.filter(isTaskDone).length;
    return {
        taskCount: tasks.length,
        doneTaskCount: done,
        estimateHours: tasks.reduce((sum, task) => sum + (task.estimate_hours ?? 0), 0),
        loggedHours: tasks.reduce((sum, task) => sum + (task.logged_hours ?? 0), 0),
        percent: percentOf(done, tasks.length),
    };
}

export function epicRollup(stories: StoryNode[]): EpicRollup {
    let points = 0;
    let donePoints = 0;
    let doneStories = 0;
    let taskCount = 0;
    let doneTaskCount = 0;
    for (const node of stories) {
        const size = node.story.story_points ?? 0;
        points += size;
        if (isStoryDone(node.story)) {
            doneStories += 1;
            donePoints += size;
        }
        taskCount += node.rollup.taskCount;
        doneTaskCount += node.rollup.doneTaskCount;
    }
    return {
        storyCount: stories.length,
        doneStoryCount: doneStories,
        points,
        donePoints,
        taskCount,
        doneTaskCount,
        percent: percentOf(doneStories, stories.length),
    };
}

const includes = (value: string | null | undefined, needle: string) =>
    Boolean(value) && (value as string).toLowerCase().includes(needle);

function taskMatches(task: BacklogTask, needle: string): boolean {
    return (
        includes(task.key, needle) ||
        includes(task.title, needle) ||
        includes(assigneeNameOf(task), needle)
    );
}

function storyMatches(story: BacklogStory, needle: string): boolean {
    return includes(story.code, needle) || includes(story.title, needle) || includes(story.i_want, needle);
}

function epicMatches(epic: BacklogEpic, needle: string): boolean {
    return includes(epic.code, needle) || includes(epic.title, needle);
}

/**
 * Folds the flat rows into the tree and applies the filters.
 *
 * Rollups are counted from *every* row before filtering: hiding done tasks is a
 * way of looking at the backlog, and a story that reads 0/2 because its three
 * finished tasks are hidden would be lying about how far along it is.
 *
 * A text match keeps its ancestors, so a hit is never shown without the epic
 * and story it belongs to; and a match on a parent keeps all of its children,
 * because searching for an epic by name means "show me that epic".
 */
export function buildBacklogTree(data: BacklogData, filters: BacklogFilters = NO_BACKLOG_FILTERS): BacklogTree {
    const needle = filters.text.trim().toLowerCase();

    const tasksByStory = new Map<string, BacklogTask[]>();
    const unplannedTasks: BacklogTask[] = [];
    const storyIds = new Set(data.stories.map((story) => story.id));
    for (const task of data.tasks) {
        // A task whose story the viewer cannot see, or that no longer exists,
        // is unplanned as far as this screen is concerned — never dropped.
        if (task.user_story_id && storyIds.has(task.user_story_id)) {
            const list = tasksByStory.get(task.user_story_id) ?? [];
            list.push(task);
            tasksByStory.set(task.user_story_id, list);
        } else {
            unplannedTasks.push(task);
        }
    }

    const keepTask = (task: BacklogTask, parentMatched: boolean) =>
        !(filters.hideDone && isTaskDone(task)) && (!needle || parentMatched || taskMatches(task, needle));

    const buildStory = (story: BacklogStory, parentMatched: boolean): StoryNode | null => {
        const all = tasksByStory.get(story.id) ?? [];
        if (filters.hideDone && isStoryDone(story)) return null;
        const selfMatched = parentMatched || (needle !== '' && storyMatches(story, needle));
        const tasks = all.filter((task) => keepTask(task, selfMatched)).map(toTaskNode);
        if (needle && !selfMatched && tasks.length === 0) return null;
        return { kind: 'story', id: story.id, story, rollup: storyRollup(all), tasks };
    };

    const storiesByEpic = new Map<string, BacklogStory[]>();
    const orphanStories: BacklogStory[] = [];
    const epicIds = new Set(data.epics.map((epic) => epic.id));
    for (const story of data.stories) {
        if (story.epic_id && epicIds.has(story.epic_id)) {
            const list = storiesByEpic.get(story.epic_id) ?? [];
            list.push(story);
            storiesByEpic.set(story.epic_id, list);
        } else {
            orphanStories.push(story);
        }
    }

    const epics: EpicNode[] = [];
    for (const epic of data.epics) {
        if (filters.hideDone && isEpicDone(epic)) continue;
        const all = storiesByEpic.get(epic.id) ?? [];
        // The rollup reads every story, unfiltered, for the reason above.
        const rollup = epicRollup(all.map(unfilteredStory));
        const selfMatched = needle !== '' && epicMatches(epic, needle);
        const stories = all
            .map((story) => buildStory(story, selfMatched))
            .filter((node): node is StoryNode => node !== null);
        if (needle && !selfMatched && stories.length === 0) continue;
        epics.push({ kind: 'epic', id: epic.id, epic, rollup, stories });
    }

    const noEpic = orphanStories
        .map((story) => buildStory(story, false))
        .filter((node): node is StoryNode => node !== null);
    const unplanned = unplannedTasks.filter((task) => keepTask(task, false)).map(toTaskNode);

    return { epics, noEpic, unplanned };

    function unfilteredStory(story: BacklogStory): StoryNode {
        const all = tasksByStory.get(story.id) ?? [];
        return { kind: 'story', id: story.id, story, rollup: storyRollup(all), tasks: [] };
    }
}

function toTaskNode(task: BacklogTask): TaskNode {
    return { kind: 'task', id: task.id, task };
}

export function isTreeEmpty(tree: BacklogTree): boolean {
    return tree.epics.length === 0 && tree.noEpic.length === 0 && tree.unplanned.length === 0;
}

/** How deep the "Expand" menu opens the tree. */
export type ExpandLevel = 'epics' | 'stories' | 'all';

/**
 * The ids to hold open for an expand level: `epics` shows epic rows only,
 * `stories` opens epics to their stories, `all` opens stories to their tasks.
 */
export function expandedFor(data: BacklogData, level: ExpandLevel): Set<string> {
    const open = new Set<string>();
    // A project heading is never what "epics only" means to fold: across
    // projects, every level starts with the projects open.
    for (const project of projectsOf(data)) open.add(projectGroup(project.id));
    if (level === 'epics') return open;
    for (const epic of data.epics) open.add(epic.id);
    for (const project of projectsOf(data)) {
        open.add(noEpicGroup(project.id));
        open.add(unplannedGroup(project.id));
    }
    if (level === 'all') for (const story of data.stories) open.add(story.id);
    return open;
}
