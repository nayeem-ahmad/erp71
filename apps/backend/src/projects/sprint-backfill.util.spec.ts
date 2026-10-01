import { burndownCauseForSource, historyRows, replayPoints } from './sprint-backfill.util';

const at = (iso: string) => new Date(iso);

describe('replayPoints', () => {
    it('emits one point per log row with the running totals', () => {
        const points = replayPoints({
            logs: [
                { taskId: 't1', hours: 8, source: 'TASK_CREATED', changedAt: at('2026-08-02T04:00:00Z') },
                { taskId: 't2', hours: 5, source: 'TASK_CREATED', changedAt: at('2026-08-02T05:00:00Z') },
                { taskId: 't1', hours: 6, source: 'TIME_LOGGED', changedAt: at('2026-08-03T06:00:00Z') },
                { taskId: 't2', hours: 0, source: 'TASK_COMPLETED', changedAt: at('2026-08-03T07:00:00Z') },
            ],
            snapshots: [],
        });

        expect(points.map((p) => [p.remaining, p.committed, p.taskCount, p.doneTaskCount, p.cause])).toEqual([
            [8, 8, 1, 0, 'TASK_ADDED'],
            [13, 13, 2, 0, 'TASK_ADDED'],
            [11, 13, 2, 0, 'WORK_LOGGED'],
            [6, 13, 2, 1, 'STATUS_CHANGED'],
        ]);
        expect(points[2]).toMatchObject({ taskId: 't1', recordedAt: at('2026-08-03T06:00:00Z') });
    });

    it('orders the log itself rather than trusting the caller', () => {
        const points = replayPoints({
            logs: [
                { taskId: 't1', hours: 2, source: 'TIME_LOGGED', changedAt: at('2026-08-03T00:00:00Z') },
                { taskId: 't1', hours: 4, source: 'TASK_CREATED', changedAt: at('2026-08-02T00:00:00Z') },
            ],
            snapshots: [],
        });
        expect(points.map((p) => p.remaining)).toEqual([4, 2]);
    });

    it('takes committed from the latest snapshot on or before that day, when there is one', () => {
        const points = replayPoints({
            logs: [{ taskId: 't1', hours: 3, source: 'TIME_LOGGED', changedAt: at('2026-08-03T06:00:00Z') }],
            snapshots: [
                { date: '2026-08-02', remaining: 4, committed: 40, taskCount: 5, doneTaskCount: 0 },
                { date: '2026-08-04', remaining: 1, committed: 50, taskCount: 6, doneTaskCount: 1 },
            ],
        });
        expect(points.find((p) => p.cause === 'WORK_LOGGED')!.committed).toBe(40);
    });

    it('never lets committed fall below the work that has joined since the last snapshot', () => {
        const points = replayPoints({
            logs: [
                { taskId: 't1', hours: 8, source: 'TASK_CREATED', changedAt: at('2026-08-02T04:00:00Z') },
                { taskId: 't2', hours: 6, source: 'TASK_CREATED', changedAt: at('2026-08-03T04:00:00Z') },
            ],
            snapshots: [{ date: '2026-08-02', remaining: 8, committed: 8, taskCount: 1, doneTaskCount: 0 }],
        });
        expect(points[1]).toMatchObject({ remaining: 14, committed: 14 });
    });

    it("fills a snapshot's day that has no log row with one BACKFILLED point at 23:50 Dhaka", () => {
        const points = replayPoints({
            logs: [{ taskId: 't1', hours: 8, source: 'TASK_CREATED', changedAt: at('2026-08-02T04:00:00Z') }],
            snapshots: [
                { date: '2026-08-02', remaining: 8, committed: 8, taskCount: 1, doneTaskCount: 0 },
                { date: '2026-08-03', remaining: 7, committed: 8, taskCount: 1, doneTaskCount: 0 },
            ],
        });

        expect(points).toHaveLength(2);
        expect(points[1]).toEqual({
            recordedAt: at('2026-08-03T17:50:00Z'),
            remaining: 7,
            committed: 8,
            taskCount: 1,
            doneTaskCount: 0,
            cause: 'BACKFILLED',
            taskId: null,
        });
    });

    it('files a log row under its Dhaka day, as the old snapshots were', () => {
        // 03:00 Dhaka on 4 Aug is 21:00 UTC on 3 Aug.
        const points = replayPoints({
            logs: [{ taskId: 't1', hours: 5, source: 'TIME_LOGGED', changedAt: at('2026-08-03T21:00:00Z') }],
            snapshots: [
                { date: '2026-08-03', remaining: 9, committed: 9, taskCount: 1, doneTaskCount: 0 },
                { date: '2026-08-04', remaining: 5, committed: 12, taskCount: 1, doneTaskCount: 0 },
            ],
        });
        // The 4 Aug snapshot has a log row that day, so it adds no point of its
        // own; the log point reads the 4 Aug committed figure.
        expect(points.map((p) => p.cause)).toEqual(['BACKFILLED', 'WORK_LOGGED']);
        expect(points[1].committed).toBe(12);
    });

    it('keeps only points before a cut-off, so live points recorded since deploy are not duplicated', () => {
        const points = replayPoints({
            logs: [
                { taskId: 't1', hours: 8, source: 'TASK_CREATED', changedAt: at('2026-08-02T04:00:00Z') },
                { taskId: 't1', hours: 6, source: 'TIME_LOGGED', changedAt: at('2026-08-03T04:00:00Z') },
            ],
            snapshots: [],
            before: at('2026-08-03T00:00:00Z'),
        });
        expect(points).toHaveLength(1);
    });

    it('returns nothing for a sprint with no history', () => {
        expect(replayPoints({ logs: [], snapshots: [] })).toEqual([]);
    });
});

describe('historyRows', () => {
    const sprint = (id: string, status: string) => ({
        id,
        tenantId: 'tenant-1',
        status,
        startDate: at('2026-08-02T00:00:00Z'),
        endDate: at('2026-08-13T00:00:00Z'),
    });

    it('opens a row for every task now in an open sprint, dated by its first log there', () => {
        const rows = historyRows({
            sprints: [sprint('s-active', 'ACTIVE')],
            tasks: [
                { id: 't1', sprintId: 's-active' },
                { id: 't2', sprintId: 's-active' },
            ],
            logs: [
                { taskId: 't1', sprintId: 's-active', hours: 5, changedAt: at('2026-08-04T03:00:00Z') },
            ],
            existingOpenTaskIds: new Set(),
            existingPairs: new Set(),
        });

        expect(rows).toEqual([
            { tenantId: 'tenant-1', sprintId: 's-active', taskId: 't1', addedAt: at('2026-08-04T03:00:00Z'), removedAt: null, outcome: null, remainingAtClose: null },
            { tenantId: 'tenant-1', sprintId: 's-active', taskId: 't2', addedAt: at('2026-08-02T00:00:00Z'), removedAt: null, outcome: null, remainingAtClose: null },
        ]);
    });

    it("rebuilds a completed sprint's carried tasks from the log", () => {
        const rows = historyRows({
            sprints: [sprint('s-done', 'COMPLETED')],
            tasks: [
                { id: 't-finished', sprintId: 's-done' },
                { id: 't-carried', sprintId: null },
            ],
            logs: [
                { taskId: 't-carried', sprintId: 's-done', hours: 8, changedAt: at('2026-08-02T03:00:00Z') },
                { taskId: 't-carried', sprintId: 's-done', hours: 5, changedAt: at('2026-08-06T03:00:00Z') },
            ],
            existingOpenTaskIds: new Set(),
            existingPairs: new Set(),
        });

        const byTask = Object.fromEntries(rows.map((row) => [row.taskId, row]));
        expect(byTask['t-finished']).toMatchObject({ outcome: 'DONE', removedAt: at('2026-08-13T17:59:00Z') });
        expect(byTask['t-carried']).toMatchObject({
            outcome: 'RETURNED_TO_BACKLOG',
            addedAt: at('2026-08-02T03:00:00Z'),
            remainingAtClose: 5,
        });
    });

    it('skips what is already recorded, so a second run adds nothing', () => {
        const input = {
            sprints: [sprint('s-active', 'ACTIVE'), sprint('s-done', 'COMPLETED')],
            tasks: [
                { id: 't1', sprintId: 's-active' },
                { id: 't2', sprintId: 's-done' },
            ],
            logs: [],
            existingOpenTaskIds: new Set(['t1']),
            existingPairs: new Set(['s-done:t2']),
        };
        expect(historyRows(input)).toEqual([]);
    });

    it('opens no row for a task that already has an open row elsewhere', () => {
        // Moved after the deploy, before the backfill: it has an open row in
        // its new sprint, and a second open row would break the unique index.
        const rows = historyRows({
            sprints: [sprint('s-active', 'ACTIVE')],
            tasks: [{ id: 't1', sprintId: 's-active' }],
            logs: [],
            existingOpenTaskIds: new Set(['t1']),
            existingPairs: new Set(),
        });
        expect(rows).toEqual([]);
    });
});

describe('burndownCauseForSource', () => {
    it.each([
        ['TIME_LOGGED', 'WORK_LOGGED'],
        ['TIME_ENTRY_DELETED', 'WORK_LOGGED'],
        ['RE_ESTIMATED', 'RE_ESTIMATED'],
        ['TASK_CREATED', 'TASK_ADDED'],
        ['TASK_COMPLETED', 'STATUS_CHANGED'],
        ['TASK_REOPENED', 'STATUS_CHANGED'],
    ])('maps %s to %s', (source, cause) => {
        expect(burndownCauseForSource(source)).toBe(cause);
    });
});
