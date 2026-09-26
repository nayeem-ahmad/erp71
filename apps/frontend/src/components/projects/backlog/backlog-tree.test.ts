import {
    buildBacklogTree,
    noEpicGroup,
    projectGroup,
    splitByProject,
    unplannedGroup,
    expandedFor,
    isTreeEmpty,
    type BacklogData,
    type BacklogTask,
} from './backlog-tree';

const task = (overrides: Partial<BacklogTask> = {}): BacklogTask => ({
    id: 't1',
    key: 'OTB-1',
    reference: 1,
    title: 'Wire callback URL',
    user_story_id: 's1',
    priority: 'MEDIUM',
    logged_hours: 0,
    estimate_hours: 4,
    status: { id: 'todo', name: 'To Do', category: 'TODO' },
    assignee: null,
    assigneeEmployee: null,
    ...overrides,
});

const data = (overrides: Partial<BacklogData> = {}): BacklogData => ({
    project: { id: 'p1', code: 'OTB', name: 'Online till' },
    epics: [
        { id: 'e1', code: 'OTB-E1', title: 'Checkout payments', status: 'IN_PROGRESS', priority: 'HIGH', color: 'BLUE', sort_order: 0 },
        { id: 'e2', code: 'OTB-E2', title: 'Loyalty', status: 'OPEN', priority: 'MEDIUM', color: 'AMBER', sort_order: 1 },
    ],
    stories: [
        { id: 's1', code: 'OTB-3', title: 'Pay with bKash', status: 'IN_PROGRESS', priority: 'HIGH', story_points: 5, epic_id: 'e1', sort_order: 0 },
        { id: 's2', code: 'OTB-4', title: 'Pay with Nagad', status: 'DONE', priority: 'MEDIUM', story_points: 3, epic_id: 'e1', sort_order: 1 },
        { id: 's3', code: 'OTB-5', title: 'Receipt printing', status: 'BACKLOG', priority: 'LOW', story_points: null, epic_id: null, sort_order: 2 },
    ],
    tasks: [
        task(),
        task({ id: 't2', key: 'OTB-2', title: 'Refund flow', logged_hours: 2, status: { id: 'done', name: 'Done', category: 'DONE' } }),
        task({ id: 't3', key: 'OTB-6', title: 'Nagad sandbox', user_story_id: 's2', status: { id: 'done', name: 'Done', category: 'DONE' } }),
        task({ id: 't4', key: 'OTB-7', title: 'Fix the printer', user_story_id: null, assignee: { id: 'u1', name: 'Rahim' } }),
    ],
    ...overrides,
});

describe('buildBacklogTree', () => {
    it('nests stories under their epics and tasks under their stories', () => {
        const tree = buildBacklogTree(data());
        expect(tree.epics.map((epic) => epic.id)).toEqual(['e1', 'e2']);
        expect(tree.epics[0].stories.map((story) => story.id)).toEqual(['s1', 's2']);
        expect(tree.epics[0].stories[0].tasks.map((node) => node.id)).toEqual(['t1', 't2']);
        expect(tree.noEpic.map((story) => story.id)).toEqual(['s3']);
        expect(tree.unplanned.map((node) => node.id)).toEqual(['t4']);
    });

    it('rolls tasks up into stories, and stories into epics', () => {
        const tree = buildBacklogTree(data());
        expect(tree.epics[0].stories[0].rollup).toEqual({
            taskCount: 2,
            doneTaskCount: 1,
            estimateHours: 8,
            loggedHours: 2,
            percent: 50,
        });
        expect(tree.epics[0].rollup).toMatchObject({
            storyCount: 2,
            doneStoryCount: 1,
            points: 8,
            donePoints: 3,
            taskCount: 3,
            doneTaskCount: 2,
            percent: 50,
        });
    });

    it('files a story whose epic is gone under "No epic" rather than dropping it', () => {
        const input = data();
        input.stories[0].epic_id = 'e-deleted';
        expect(buildBacklogTree(input).noEpic.map((story) => story.id)).toContain('s1');
    });

    it('treats a task whose story is not visible as unplanned', () => {
        const input = data();
        input.tasks[0].user_story_id = 's-hidden';
        expect(buildBacklogTree(input).unplanned.map((node) => node.id)).toContain('t1');
    });

    it('hides done rows but keeps the rollups honest', () => {
        const tree = buildBacklogTree(data(), { text: '', hideDone: true });
        expect(tree.epics[0].stories.map((story) => story.id)).toEqual(['s1']);
        expect(tree.epics[0].stories[0].tasks.map((node) => node.id)).toEqual(['t1']);
        expect(tree.epics[0].stories[0].rollup.taskCount).toBe(2);
        expect(tree.epics[0].rollup.storyCount).toBe(2);
    });

    it('keeps the ancestors of a task that matches the search', () => {
        const tree = buildBacklogTree(data(), { text: 'refund', hideDone: false });
        expect(tree.epics.map((epic) => epic.id)).toEqual(['e1']);
        expect(tree.epics[0].stories.map((story) => story.id)).toEqual(['s1']);
        expect(tree.epics[0].stories[0].tasks.map((node) => node.id)).toEqual(['t2']);
        expect(tree.noEpic).toEqual([]);
        expect(tree.unplanned).toEqual([]);
    });

    it('shows everything under an epic that matches by name', () => {
        const tree = buildBacklogTree(data(), { text: 'OTB-E1', hideDone: false });
        expect(tree.epics).toHaveLength(1);
        expect(tree.epics[0].stories.map((story) => story.id)).toEqual(['s1', 's2']);
        expect(tree.epics[0].stories[0].tasks).toHaveLength(2);
    });

    it('finds a task by who it is assigned to', () => {
        const tree = buildBacklogTree(data(), { text: 'rahim', hideDone: false });
        expect(tree.unplanned.map((node) => node.id)).toEqual(['t4']);
        expect(tree.epics).toEqual([]);
    });

    it('reports an empty tree when nothing matches', () => {
        expect(isTreeEmpty(buildBacklogTree(data(), { text: 'zzz', hideDone: false }))).toBe(true);
        expect(isTreeEmpty(buildBacklogTree(data()))).toBe(false);
    });
});

describe('expandedFor', () => {
    it('opens only the project headings for epics only', () => {
        expect([...expandedFor(data(), 'epics')]).toEqual([projectGroup('p1')]);
    });

    it("opens epics and the project's catch-all groups for stories", () => {
        const open = expandedFor(data(), 'stories');
        expect([...open].sort()).toEqual(
            [projectGroup('p1'), noEpicGroup('p1'), unplannedGroup('p1'), 'e1', 'e2'].sort(),
        );
    });

    it('opens stories too for everything', () => {
        const open = expandedFor(data(), 'all');
        expect(open.has('s1')).toBe(true);
        expect(open.has('s3')).toBe(true);
    });
});

describe('splitByProject', () => {
    it('returns a single project backlog as it is', () => {
        const input = data();
        const [only, ...rest] = splitByProject(input);
        expect(rest).toEqual([]);
        expect(only.project.id).toBe('p1');
        expect(only.data).toBe(input);
    });

    it('cuts cross-project data into one slice per project, in the server’s order', () => {
        const input: BacklogData = {
            projects: [
                { id: 'p1', code: 'OTB', name: 'Online till' },
                { id: 'p2', code: 'WMS', name: 'Warehouse' },
            ],
            epics: [
                { ...data().epics[0], project_id: 'p2' },
                { ...data().epics[1], project_id: 'p1' },
            ],
            stories: [{ ...data().stories[0], project_id: 'p1', epic_id: 'e2' }],
            tasks: [{ ...task(), project_id: 'p1' }],
        };
        const slices = splitByProject(input);
        expect(slices.map((slice) => slice.project.code)).toEqual(['OTB', 'WMS']);
        expect(slices[0].data.epics.map((epic) => epic.id)).toEqual(['e2']);
        expect(slices[0].data.stories).toHaveLength(1);
        expect(slices[1].data.epics.map((epic) => epic.id)).toEqual(['e1']);
        expect(slices[1].data.tasks).toEqual([]);
    });
});
