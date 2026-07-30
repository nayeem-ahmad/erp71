import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { RemainingHoursService, RemainingSource } from './remaining-hours.service';
import { DatabaseService } from '../database/database.service';

describe('RemainingHoursService', () => {
    let service: RemainingHoursService;
    let db: any;

    beforeEach(async () => {
        db = {
            projectTask: { update: jest.fn().mockResolvedValue({}) },
            projectTaskRemainingLog: {
                create: jest.fn().mockResolvedValue({}),
                findMany: jest.fn().mockResolvedValue([]),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [RemainingHoursService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(RemainingHoursService);
    });

    const write = (overrides: Record<string, unknown> = {}) =>
        service.write({
            tenantId: 'tenant-1',
            taskId: 'task-1',
            projectId: 'project-1',
            sprintId: 'sprint-1',
            previousHours: 8,
            newHours: 5,
            source: RemainingSource.TIME_LOGGED,
            userId: 'user-1',
            ...overrides,
        } as never);

    describe('suggestAfterTimeLog', () => {
        it('suggests the remainder after the logged hours', () => {
            expect(RemainingHoursService.suggestAfterTimeLog(8, 3)).toBe(5);
        });

        it('never suggests a negative remainder', () => {
            expect(RemainingHoursService.suggestAfterTimeLog(2, 5)).toBe(0);
        });

        it('treats an unestimated task as having nothing left rather than NaN', () => {
            expect(RemainingHoursService.suggestAfterTimeLog(null, 3)).toBe(0);
        });
    });

    describe('write', () => {
        it('updates the column and logs the change in one call', async () => {
            await write();

            expect(db.projectTask.update).toHaveBeenCalledWith({
                where: { id: 'task-1' },
                data: { remaining_hours: 5 },
            });
            expect(db.projectTaskRemainingLog.create).toHaveBeenCalledTimes(1);
        });

        it('records previous, new and delta so a burndown query is a plain SUM', async () => {
            await write();

            const logged = db.projectTaskRemainingLog.create.mock.calls[0][0].data;
            expect(logged.previous_hours).toBe(8);
            expect(logged.new_hours).toBe(5);
            expect(logged.delta).toBe(-3);
        });

        it('records a positive delta when a re-estimate raises the remainder', async () => {
            await write({ previousHours: 4, newHours: 10, source: RemainingSource.RE_ESTIMATED });

            const logged = db.projectTaskRemainingLog.create.mock.calls[0][0].data;
            expect(logged.delta).toBe(6);
            expect(logged.source).toBe('RE_ESTIMATED');
        });

        it('freezes the sprint on the row so a later sprint move cannot rewrite history', async () => {
            await write({ sprintId: 'sprint-original' });

            expect(db.projectTaskRemainingLog.create.mock.calls[0][0].data.sprint_id).toBe(
                'sprint-original',
            );
        });

        it('writes an opening row with a null previous value', async () => {
            await write({ previousHours: null, newHours: 8, source: RemainingSource.TASK_CREATED });

            const logged = db.projectTaskRemainingLog.create.mock.calls[0][0].data;
            expect(logged.previous_hours).toBeNull();
            expect(logged.new_hours).toBe(8);
            expect(logged.delta).toBe(8);
        });

        it('records nothing when the value did not actually change', async () => {
            const changed = await write({ previousHours: 5, newHours: 5 });

            expect(changed).toBe(false);
            expect(db.projectTask.update).not.toHaveBeenCalled();
            expect(db.projectTaskRemainingLog.create).not.toHaveBeenCalled();
        });

        it('treats a sub-cent difference as unchanged rather than logging noise', async () => {
            const changed = await write({ previousHours: 5.001, newHours: 5.002 });
            expect(changed).toBe(false);
        });

        it('writes through a caller-supplied transaction client when given one', async () => {
            const tx = {
                projectTask: { update: jest.fn().mockResolvedValue({}) },
                projectTaskRemainingLog: { create: jest.fn().mockResolvedValue({}) },
            };

            await service.write(
                {
                    tenantId: 'tenant-1',
                    taskId: 'task-1',
                    projectId: 'project-1',
                    previousHours: 8,
                    newHours: 5,
                    source: RemainingSource.TIME_LOGGED,
                } as never,
                tx as never,
            );

            expect(tx.projectTask.update).toHaveBeenCalled();
            expect(tx.projectTaskRemainingLog.create).toHaveBeenCalled();
            expect(db.projectTask.update).not.toHaveBeenCalled();
        });
    });
});

/**
 * A history with a bypass is not a history. Everything that changes
 * `remaining_hours` must go through RemainingHoursService so the log row is
 * written in the same breath — this scans the module for anyone writing the
 * column directly instead.
 */
describe('remaining_hours has exactly one writer', () => {
    /**
     * Scans the argument object of every `projectTask` write in the module.
     * Scoped to that delegate on purpose: `SprintSnapshot.remaining_hours` is a
     * different column on a different table, and `select: { remaining_hours:
     * true }` is a read.
     */
    const findTaskWrites = (source: string): string[] => {
        const found: string[] = [];
        const call = /projectTask\.(create|update|updateMany|upsert)\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = call.exec(source)) !== null) {
            let depth = 0;
            let end = match.index + match[0].length - 1;
            for (let i = end; i < source.length; i += 1) {
                if (source[i] === '(') depth += 1;
                if (source[i] === ')') {
                    depth -= 1;
                    if (depth === 0) {
                        end = i;
                        break;
                    }
                }
            }
            const args = source.slice(match.index, end);
            // A write sets the column; `remaining_hours: true` inside a select
            // clause is a projection. The value is captured rather than
            // excluded by lookahead, because `\s*` happily backtracks to
            // zero-width and lets a lookahead match the space before `true`.
            const assignment = /remaining_hours\s*:\s*([A-Za-z0-9_.$]+)/g;
            let assigned: RegExpExecArray | null;
            while ((assigned = assignment.exec(args)) !== null) {
                if (assigned[1] === 'true' || assigned[1] === 'false') continue;
                found.push(`${match[1]}: ${args.replace(/\s+/g, ' ').slice(0, 120)}`);
                break;
            }
        }
        return found;
    };

    it('is not assigned by any projectTask write outside RemainingHoursService', () => {
        const dir = __dirname;
        const offenders: string[] = [];

        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.ts')) continue;
            if (file === 'remaining-hours.service.ts') continue;
            if (file.endsWith('.spec.ts')) continue;

            const source = readFileSync(join(dir, file), 'utf8');
            for (const write of findTaskWrites(source)) offenders.push(`${file} → ${write}`);
        }

        expect(offenders).toEqual([]);
    });

    it('would catch a direct write if one were introduced', () => {
        const sneaky = `
            await this.db.projectTask.update({
                where: { id: taskId },
                data: { remaining_hours: 0 },
            });
        `;
        expect(findTaskWrites(sneaky)).toHaveLength(1);
    });

    it('does not mistake a select projection for a write', () => {
        const reading = `
            await this.db.projectTask.findFirst({
                select: { remaining_hours: true },
            });
            await this.db.projectTask.update({
                where: { id },
                data: { sprint_id: null },
                select: { remaining_hours: true },
            });
        `;
        expect(findTaskWrites(reading)).toEqual([]);
    });
});
