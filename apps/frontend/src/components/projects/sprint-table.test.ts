import { NO_LANE, dayTotals, groupSprintTasks, sprintStats, sumHours, type SprintTask } from './sprint-table';

const task = (id: string, overrides: Partial<SprintTask> = {}): SprintTask => ({
    id,
    title: id,
    estimate_hours: '8',
    remaining_hours: '4',
    logged_hours: 3,
    status: { id: 'todo', name: 'To do', category: 'TODO' },
    ...overrides,
});

describe('groupSprintTasks', () => {
    it('keeps one lane when swimlanes are off', () => {
        const lanes = groupSprintTasks([task('a'), task('b')], 'none');
        expect(lanes).toHaveLength(1);
        expect(lanes[0].tasks.map((t) => t.id)).toEqual(['a', 'b']);
    });

    it('lanes by assignee, reading both assignee columns, with nobody last', () => {
        const lanes = groupSprintTasks(
            [
                task('a'),
                task('b', { assignee: { id: 'u2', name: 'Zara', email: 'z@x' } }),
                task('c', { assigneeEmployee: { id: 'e1', name: 'Arif' } }),
                task('d', { assignee: { id: 'u2', name: 'Zara', email: 'z@x' } }),
            ],
            'assignee',
        );
        expect(lanes.map((lane) => lane.title)).toEqual(['Arif', 'Zara', null]);
        expect(lanes[1].tasks.map((t) => t.id)).toEqual(['b', 'd']);
        expect(lanes[2].key).toBe(NO_LANE);
    });

    it('lanes by story in code order, OTB-2 before OTB-10', () => {
        const lanes = groupSprintTasks(
            [
                task('a', { userStory: { id: 's10', code: 'OTB-10', title: 'Ten' } }),
                task('b'),
                task('c', { userStory: { id: 's2', code: 'OTB-2', title: 'Two' } }),
            ],
            'story',
        );
        expect(lanes.map((lane) => lane.code ?? lane.key)).toEqual(['OTB-2', 'OTB-10', NO_LANE]);
    });
});

describe('sums', () => {
    it('totals estimate, spent and remaining', () => {
        expect(sumHours([task('a'), task('b', { remaining_hours: null })])).toEqual({
            estimate: 16,
            spent: 6,
            remaining: 4,
        });
    });

    it('leaves a day nobody has a reading for blank rather than zero', () => {
        const totals = dayTotals(
            [task('a'), task('b')],
            { a: [8, 6, null], b: [null, 2, null] },
            3,
        );
        expect(totals).toEqual([8, 8, null]);
    });
});

describe('sprintStats', () => {
    it('reports progress, done count, days left and the gap to the ideal line', () => {
        const stats = sprintStats(
            [task('a'), task('b', { status: { id: 'd', name: 'Done', category: 'DONE' }, remaining_hours: 0 })],
            [
                { date: '2026-08-06', ideal: 10, actual: 12, committed: 16, isWorkingDay: true },
                { date: '2026-08-07', ideal: 10, actual: null, committed: null, isWorkingDay: false },
                { date: '2026-08-09', ideal: 0, actual: null, committed: null, isWorkingDay: true },
            ],
            '2026-08-06',
        );
        expect(stats.doneCount).toBe(1);
        expect(stats.taskCount).toBe(2);
        expect(stats.progress).toBe(75);
        expect(stats.workingDaysLeft).toBe(2);
        // Two hours more left than the ideal says — behind.
        expect(stats.variance).toBe(-2);
    });
});
