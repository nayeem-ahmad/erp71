import { buildBacklogTree, expandedFor, splitByProject, type BacklogData, type BacklogTask } from './backlog-tree';
import {
    applyMove,
    dropModeFor,
    flattenBacklog,
    isNoOp,
    orderedIdsFor,
    resolveDrop,
    stepMove,
    type BacklogMove,
    type VisibleRow,
} from './backlog-rows';

const task = (overrides: Partial<BacklogTask> = {}): BacklogTask => ({
    id: 't1',
    key: 'OTB-1',
    reference: 1,
    title: 'Wire callback URL',
    user_story_id: 's1',
    priority: 'MEDIUM',
    logged_hours: 0,
    status: { id: 'todo', name: 'To Do', category: 'TODO' },
    ...overrides,
});

const epic = (id: string, overrides = {}) => ({
    id,
    code: `OTB-${id.toUpperCase()}`,
    title: `Epic ${id}`,
    status: 'OPEN',
    priority: 'MEDIUM',
    color: 'BLUE',
    sort_order: 0,
    ...overrides,
});

const story = (id: string, epicId: string | null, overrides = {}) => ({
    id,
    code: `OTB-${id.toUpperCase()}`,
    title: `Story ${id}`,
    status: 'BACKLOG',
    priority: 'MEDIUM',
    epic_id: epicId,
    sort_order: 0,
    ...overrides,
});

/**
 * e1 ─ s1 ─ t1, t2
 *    └ s2 ─ t3
 * e2 ─ s3
 * no epic ─ s4
 * no story ─ t4
 */
const data = (): BacklogData => ({
    project: { id: 'p1', code: 'OTB', name: 'Online till' },
    epics: [epic('e1'), epic('e2', { color: 'AMBER' })],
    stories: [story('s1', 'e1'), story('s2', 'e1'), story('s3', 'e2'), story('s4', null)],
    tasks: [
        task(),
        task({ id: 't2', key: 'OTB-2', title: 'Refund flow' }),
        task({ id: 't3', key: 'OTB-3', user_story_id: 's2' }),
        task({ id: 't4', key: 'OTB-4', user_story_id: null }),
    ],
});

function rowsOf(input: BacklogData = data(), projectHeadings = false): VisibleRow[] {
    const sections = splitByProject(input).map(({ project, data: slice }) => ({
        project,
        tree: buildBacklogTree(slice),
    }));
    return flattenBacklog(sections, expandedFor(input, 'all'), { projectHeadings, addRows: true, filtering: false });
}

const keys = (rows: VisibleRow[]) => rows.map((row) => row.key);

describe('flattenBacklog', () => {
    it('lists every open row in tree order, with an add row at the foot of each group', () => {
        expect(keys(rowsOf())).toEqual([
            'epic:e1',
            'story:s1',
            'task:t1',
            'task:t2',
            'addTask:s1',
            'story:s2',
            'task:t3',
            'addTask:s2',
            'addStory:e1',
            'epic:e2',
            'story:s3',
            'addTask:s3',
            'addStory:e2',
            'noEpic:p1',
            'story:s4',
            'addTask:s4',
            'addStory:none:p1',
            'unplanned:p1',
            'task:t4',
            'addTask:none:p1',
        ]);
    });

    it('carries depth, parent and the epic colour down the block', () => {
        const rows = rowsOf();
        const t1 = rows.find((row) => row.key === 'task:t1')!;
        expect(t1).toMatchObject({ depth: 2, parentKey: 'story:s1', parentId: 's1', edge: 'BLUE' });
        const s3 = rows.find((row) => row.key === 'story:s3')!;
        expect(s3).toMatchObject({ depth: 1, parentId: 'e2', edge: 'AMBER' });
        expect(rows.find((row) => row.key === 'story:s4')!.edge).toBeUndefined();
    });

    it('skips what is folded', () => {
        const input = data();
        const sections = [{ project: input.project!, tree: buildBacklogTree(input) }];
        const rows = flattenBacklog(sections, new Set(['e1']), { projectHeadings: false, addRows: false, filtering: false });
        expect(keys(rows)).toEqual(['epic:e1', 'story:s1', 'story:s2', 'epic:e2', 'noEpic:p1', 'unplanned:p1']);
    });

    it('heads each project and indents under it on the cross-project screens', () => {
        const rows = rowsOf({ ...data(), project: undefined, projects: [data().project!] }, true);
        expect(rows[0]).toMatchObject({ key: 'project:p1', kind: 'project', depth: 0 });
        expect(rows.find((row) => row.key === 'epic:e1')!.depth).toBe(1);
        expect(rows.find((row) => row.key === 'task:t1')!.depth).toBe(3);
    });
});

describe('resolveDrop', () => {
    const rows = rowsOf();

    it('puts an epic beside another epic, after it when dragged down', () => {
        expect(resolveDrop(rows, 'epic:e1', 'epic:e2')).toMatchObject({
            kind: 'epic',
            id: 'e1',
            parentId: null,
            anchorId: 'e2',
            position: 'after',
        });
    });

    it('treats a drop anywhere inside an epic as that epic', () => {
        expect(resolveDrop(rows, 'epic:e2', 'task:t1')).toMatchObject({ anchorId: 'e1', position: 'before' });
    });

    it('moves a story beside a story in another epic, taking that epic', () => {
        expect(resolveDrop(rows, 'story:s1', 'story:s3')).toMatchObject({
            kind: 'story',
            parentId: 'e2',
            anchorId: 's3',
            position: 'after',
        });
    });

    it('drops a story onto an epic heading as the last story of that epic', () => {
        expect(resolveDrop(rows, 'story:s4', 'epic:e1')).toMatchObject({ parentId: 'e1', anchorId: null });
    });

    it('drops a story onto "No epic" out of its epic', () => {
        expect(resolveDrop(rows, 'story:s1', 'noEpic:p1')).toMatchObject({ parentId: null, anchorId: null });
    });

    it('drops a story onto a task beside that task’s story', () => {
        expect(resolveDrop(rows, 'story:s3', 'task:t3')).toMatchObject({
            parentId: 'e1',
            anchorId: 's2',
            position: 'after',
        });
    });

    it('moves a task beside a task under another story', () => {
        expect(resolveDrop(rows, 'task:t1', 'task:t3')).toMatchObject({
            kind: 'task',
            parentId: 's2',
            anchorId: 't3',
            position: 'after',
        });
    });

    it('drops a task onto a story as its last task, and onto "Tasks without a story" out of every story', () => {
        expect(resolveDrop(rows, 'task:t4', 'story:s3')).toMatchObject({ parentId: 's3', anchorId: null });
        expect(resolveDrop(rows, 'task:t1', 'unplanned:p1')).toMatchObject({ parentId: null, anchorId: null });
    });

    it('refuses the drops that mean nothing', () => {
        expect(resolveDrop(rows, 'task:t1', 'epic:e2')).toBeNull();
        expect(resolveDrop(rows, 'epic:e1', 'noEpic:p1')).toBeNull();
        expect(resolveDrop(rows, 'story:s1', 'unplanned:p1')).toBeNull();
        expect(resolveDrop(rows, 'task:t1', 'task:t1')).toBeNull();
        expect(resolveDrop(rows, 'noEpic:p1', 'epic:e1')).toBeNull();
    });

    it('refuses a drop into another project', () => {
        const other = rows.map((row) => (row.key === 'story:s3' ? { ...row, projectId: 'p2' } : row));
        expect(resolveDrop(other, 'story:s1', 'story:s3')).toBeNull();
    });
});

describe('dropModeFor', () => {
    const rows = rowsOf();
    const over = (key: string) => rows.find((row) => row.key === key)!;

    it('draws a line beside a sibling and a box around a new parent', () => {
        expect(dropModeFor(resolveDrop(rows, 'task:t1', 'task:t3')!, over('task:t3'))).toBe('after');
        expect(dropModeFor(resolveDrop(rows, 'task:t4', 'story:s3')!, over('story:s3'))).toBe('into');
    });
});

describe('stepMove', () => {
    const rows = rowsOf();

    it('moves a row one place among its siblings', () => {
        expect(stepMove(rows, 'task:t2', -1)).toMatchObject({ id: 't2', parentId: 's1', anchorId: 't1', position: 'before' });
        expect(stepMove(rows, 'story:s1', 1)).toMatchObject({ parentId: 'e1', anchorId: 's2', position: 'after' });
    });

    it('stops at either end of the group rather than leaving it', () => {
        expect(stepMove(rows, 'task:t1', -1)).toBeNull();
        expect(stepMove(rows, 'story:s2', 1)).toBeNull();
    });

    it('ignores rows that are not items', () => {
        expect(stepMove(rows, 'noEpic:p1', 1)).toBeNull();
    });
});

describe('orderedIdsFor / applyMove / isNoOp', () => {
    const move = (overrides: Partial<BacklogMove>): BacklogMove => ({
        kind: 'task',
        id: 't1',
        projectId: 'p1',
        parentId: 's1',
        anchorId: null,
        position: 'after',
        ...overrides,
    });

    it('works out the target group’s whole order from the data', () => {
        expect(orderedIdsFor(data(), move({ anchorId: 't2', position: 'after' }))).toEqual(['t2', 't1']);
        expect(orderedIdsFor(data(), move({ parentId: 's2', anchorId: 't3', position: 'before' }))).toEqual(['t1', 't3']);
        expect(orderedIdsFor(data(), move({ kind: 'story', id: 's4', parentId: 'e1' }))).toEqual(['s1', 's2', 's4']);
    });

    it('re-parents and reorders the rows straight away', () => {
        const next = applyMove(data(), move({ parentId: 's2', anchorId: 't3', position: 'before' }));
        expect(next.tasks.find((row) => row.id === 't1')!.user_story_id).toBe('s2');
        const s2 = next.tasks.filter((row) => row.user_story_id === 's2').map((row) => row.id);
        expect(s2).toEqual(['t1', 't3']);
        // Rows outside the move keep their order.
        expect(next.tasks.filter((row) => row.user_story_id !== 's2').map((row) => row.id)).toEqual(['t2', 't4']);
    });

    it('moves a story out of its epic', () => {
        const next = applyMove(data(), move({ kind: 'story', id: 's1', parentId: null }));
        expect(next.stories.find((row) => row.id === 's1')!.epic_id).toBeNull();
        expect(next.stories.filter((row) => row.epic_id === null).map((row) => row.id)).toEqual(['s4', 's1']);
    });

    it('reorders epics', () => {
        const next = applyMove(data(), move({ kind: 'epic', id: 'e2', parentId: null, anchorId: 'e1', position: 'before' }));
        expect(next.epics.map((row) => row.id)).toEqual(['e2', 'e1']);
    });

    it('knows a drop that changes nothing', () => {
        expect(isNoOp(data(), move({ anchorId: 't2', position: 'before' }))).toBe(true);
        expect(isNoOp(data(), move({ anchorId: 't2', position: 'after' }))).toBe(false);
        expect(isNoOp(data(), move({ parentId: 's2' }))).toBe(false);
    });
});
