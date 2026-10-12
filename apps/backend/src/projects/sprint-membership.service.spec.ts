import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { SprintMembershipService } from './sprint-membership.service';

describe('SprintMembershipService', () => {
    const service = new SprintMembershipService();
    const at = new Date('2026-08-05T10:00:00.000Z');
    let db: any;

    const tasks = (rows: Array<{ id: string; sprint_id: string | null; remaining_hours?: number | null }>) =>
        db.projectTask.findMany.mockResolvedValue(
            rows.map((row) => ({ remaining_hours: null, ...row })),
        );

    beforeEach(() => {
        db = {
            projectTask: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            sprintTask: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        };
    });

    describe('moveTasks', () => {
        it('opens a row for a task joining from the backlog', async () => {
            tasks([{ id: 't1', sprint_id: null }]);

            const result = await service.moveTasks(db, 'tenant-1', ['t1'], 'sprint-2', 'REMOVED', { at });

            expect(db.projectTask.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 'tenant-1',
                id: { in: ['t1'] },
            });
            expect(db.projectTask.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', id: { in: ['t1'] } },
                data: { sprint_id: 'sprint-2' },
            });
            expect(db.sprintTask.createMany).toHaveBeenCalledWith({
                data: [{ tenant_id: 'tenant-1', sprint_id: 'sprint-2', task_id: 't1', added_at: at }],
            });
            expect(result).toEqual({ moved: 1, leftSprintIds: [] });
        });

        it('closes the old row and opens a new one when a task switches sprint', async () => {
            tasks([{ id: 't1', sprint_id: 'sprint-1', remaining_hours: 6 }]);

            const result = await service.moveTasks(db, 'tenant-1', ['t1'], 'sprint-2', 'REMOVED', { at });

            expect(db.sprintTask.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', task_id: { in: ['t1'] }, removed_at: null },
                data: { removed_at: at, outcome: 'REMOVED', remaining_at_close: 6, carried_to_sprint_id: null },
            });
            expect(db.sprintTask.createMany).toHaveBeenCalled();
            expect(result.leftSprintIds).toEqual(['sprint-1']);
        });

        it('leaves a task alone when it is already in the target sprint', async () => {
            tasks([{ id: 't1', sprint_id: 'sprint-2' }]);

            const result = await service.moveTasks(db, 'tenant-1', ['t1'], 'sprint-2', 'REMOVED');

            expect(db.projectTask.updateMany).not.toHaveBeenCalled();
            expect(db.sprintTask.updateMany).not.toHaveBeenCalled();
            expect(db.sprintTask.createMany).not.toHaveBeenCalled();
            expect(result).toEqual({ moved: 0, leftSprintIds: [] });
        });

        it('only closes when the task goes back to the backlog', async () => {
            tasks([{ id: 't1', sprint_id: 'sprint-1', remaining_hours: 2 }]);

            await service.moveTasks(db, 'tenant-1', ['t1'], null, 'RETURNED_TO_BACKLOG', { at });

            expect(db.sprintTask.updateMany.mock.calls[0][0].data.outcome).toBe('RETURNED_TO_BACKLOG');
            expect(db.projectTask.updateMany.mock.calls[0][0].data).toEqual({ sprint_id: null });
            expect(db.sprintTask.createMany).not.toHaveBeenCalled();
        });

        it('records where a carried task went', async () => {
            tasks([{ id: 't1', sprint_id: 'sprint-1', remaining_hours: 3 }]);

            await service.moveTasks(db, 'tenant-1', ['t1'], 'sprint-2', 'CARRIED_OVER', { at });

            expect(db.sprintTask.updateMany.mock.calls[0][0].data).toMatchObject({
                outcome: 'CARRIED_OVER',
                carried_to_sprint_id: 'sprint-2',
            });
        });

        it('closes tasks with the same hours in one write, and different hours separately', async () => {
            tasks([
                { id: 't1', sprint_id: 'sprint-1', remaining_hours: 4 },
                { id: 't2', sprint_id: 'sprint-1', remaining_hours: 4 },
                { id: 't3', sprint_id: 'sprint-0', remaining_hours: null },
            ]);

            const result = await service.moveTasks(db, 'tenant-1', ['t1', 't2', 't3', 't1'], 'sprint-2', 'REMOVED', { at });

            expect(db.sprintTask.updateMany).toHaveBeenCalledTimes(2);
            expect(db.sprintTask.updateMany.mock.calls[0][0].where.task_id).toEqual({ in: ['t1', 't2'] });
            expect(db.sprintTask.updateMany.mock.calls[1][0].data.remaining_at_close).toBeNull();
            expect(result).toEqual({ moved: 3, leftSprintIds: ['sprint-1', 'sprint-0'] });
        });

        it('closes a stale open row even for a task the backlog holds', async () => {
            tasks([{ id: 't1', sprint_id: null, remaining_hours: 2 }]);

            await service.moveTasks(db, 'tenant-1', ['t1'], 'sprint-2', 'REMOVED', { at });

            expect(db.sprintTask.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: 'tenant-1', task_id: { in: ['t1'] }, removed_at: null } }),
            );
            expect(db.sprintTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
                db.sprintTask.createMany.mock.invocationCallOrder[0],
            );
        });

        it('runs as one transaction when handed the root client', async () => {
            const tx = db;
            const root = { ...db, $transaction: jest.fn(async (run: (t: unknown) => unknown) => run(tx)) };
            tasks([{ id: 't1', sprint_id: 'sprint-1' }]);

            const result = await service.moveTasks(root, 'tenant-1', ['t1'], 'sprint-2', 'REMOVED');

            expect(root.$transaction).toHaveBeenCalledTimes(1);
            expect(result.moved).toBe(1);
        });

        it('asks nothing of the database for an empty list', async () => {
            expect(await service.moveTasks(db, 'tenant-1', [], 'sprint-2', 'REMOVED')).toEqual({
                moved: 0,
                leftSprintIds: [],
            });
            expect(db.projectTask.findMany).not.toHaveBeenCalled();
        });
    });

    describe('closeInPlace', () => {
        it('closes the rows of tasks that stay where they are', async () => {
            tasks([{ id: 't1', sprint_id: 'sprint-1', remaining_hours: 0 }]);

            const closed = await service.closeInPlace(db, 'tenant-1', 'sprint-1', ['t1'], 'DONE', at);

            expect(db.projectTask.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 'tenant-1',
                id: { in: ['t1'] },
                sprint_id: 'sprint-1',
            });
            expect(db.sprintTask.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', task_id: { in: ['t1'] }, removed_at: null },
                data: { removed_at: at, outcome: 'DONE', remaining_at_close: 0, carried_to_sprint_id: null },
            });
            expect(db.projectTask.updateMany).not.toHaveBeenCalled();
            expect(closed).toBe(1);
        });
    });
});

/**
 * A history with a bypass is not a history. Every change to a task's sprint
 * must go through SprintMembershipService so the SprintTask rows follow it —
 * this scans the module for anyone writing the column directly instead.
 */
describe('ProjectTask.sprint_id has exactly one writer', () => {
    /** The `data: { ... }` object of every `projectTask` write in a source file. */
    const dataBlocks = (source: string): string[] => {
        const blocks: string[] = [];
        const call = /projectTask\.(create|createMany|update|updateMany|upsert)\s*\(/g;
        let match: RegExpExecArray | null;
        while ((match = call.exec(source)) !== null) {
            const end = closing(source, match.index + match[0].length - 1, '(', ')');
            const args = source.slice(match.index, end);
            const data = /\bdata\s*:\s*\{/g;
            let found: RegExpExecArray | null;
            while ((found = data.exec(args)) !== null) {
                const open = found.index + found[0].length - 1;
                blocks.push(args.slice(open, closing(args, open, '{', '}') + 1));
            }
        }
        return blocks;
    };

    function closing(text: string, from: number, open: string, close: string): number {
        let depth = 0;
        for (let i = from; i < text.length; i += 1) {
            if (text[i] === open) depth += 1;
            if (text[i] === close) {
                depth -= 1;
                if (depth === 0) return i;
            }
        }
        return text.length;
    }

    const assignsSprint = (source: string) =>
        dataBlocks(source).filter((block) => /\bsprint_id\s*:/.test(block) || /\bsprint\s*:\s*\{/.test(block));

    it('is not assigned by any projectTask write outside SprintMembershipService', () => {
        const offenders: string[] = [];
        for (const file of readdirSync(__dirname)) {
            if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
            if (file === 'sprint-membership.service.ts') continue;
            const source = readFileSync(join(__dirname, file), 'utf8');
            for (const block of assignsSprint(source)) {
                offenders.push(`${file} → ${block.replace(/\s+/g, ' ').slice(0, 120)}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('would catch a direct write, but not a filter on the column', () => {
        const sneaky = `
            await tx.projectTask.updateMany({
                where: { sprint_id: sprintId },
                data: { sort_order: 1, sprint_id: null },
            });
            await this.db.projectTask.updateMany({
                where: { tenant_id: tenantId, sprint_id: sprintId },
                data: { deleted_at: new Date() },
            });
        `;
        expect(assignsSprint(sneaky)).toHaveLength(1);
    });
});
