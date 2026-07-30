import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectTimeService } from './project-time.service';
import { RemainingHoursService } from './remaining-hours.service';
import { DatabaseService } from '../database/database.service';

describe('ProjectTimeService', () => {
    let service: ProjectTimeService;
    let db: any;
    let remaining: { write: jest.Mock };

    const task = {
        id: 'task-1',
        project_id: 'project-1',
        sprint_id: 'sprint-1',
        remaining_hours: 8,
    };

    beforeEach(async () => {
        remaining = { write: jest.fn().mockResolvedValue(true) };

        db = {
            projectTask: { findFirst: jest.fn().mockResolvedValue(task) },
            projectTimeEntry: {
                create: jest.fn().mockResolvedValue({ id: 'entry-1' }),
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                update: jest.fn(),
                delete: jest.fn().mockResolvedValue({}),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectTimeService,
                { provide: DatabaseService, useValue: db },
                { provide: RemainingHoursService, useValue: remaining },
            ],
        }).compile();

        service = module.get(ProjectTimeService);
    });

    const log = (overrides: Record<string, unknown> = {}) =>
        service.create('tenant-1', 'user-1', {
            taskId: 'task-1',
            workDate: '2026-08-03',
            hours: 3,
            ...overrides,
        } as never);

    it('suggests the remainder after logged hours when none is supplied', async () => {
        await log();

        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({
                previousHours: 8,
                newHours: 5,
                source: 'TIME_LOGGED',
            }),
        );
    });

    it('accepts a remainder that did not go down — work absorbed, nothing closer to done', async () => {
        await log({ hours: 3, remainingHours: 8 });

        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({ newHours: 8 }),
        );
    });

    it('accepts a remainder that went up, and calls it a re-estimate not progress', async () => {
        await log({ hours: 2, remainingHours: 14 });

        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({ newHours: 14, source: 'RE_ESTIMATED' }),
        );
    });

    it('never suggests a negative remainder', async () => {
        db.projectTask.findFirst.mockResolvedValue({ ...task, remaining_hours: 1 });
        await log({ hours: 5 });

        expect(remaining.write).toHaveBeenCalledWith(expect.objectContaining({ newHours: 0 }));
    });

    it('links the log row to the entry that caused it', async () => {
        await log();
        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({ timeEntryId: 'entry-1' }),
        );
    });

    it('stamps the log with the sprint the task is in right now', async () => {
        await log();
        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({ sprintId: 'sprint-1' }),
        );
    });

    it('refuses to log against a task from another tenant', async () => {
        db.projectTask.findFirst.mockResolvedValue(null);
        await expect(log()).rejects.toBeInstanceOf(NotFoundException);
        expect(db.projectTimeEntry.create).not.toHaveBeenCalled();
    });

    describe('remove', () => {
        it('gives the hours back so the sprint is not short by work nobody did', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValue({
                id: 'entry-1',
                hours: 3,
                task: { id: 'task-1', project_id: 'project-1', sprint_id: 'sprint-1', remaining_hours: 5 },
            });

            await service.remove('tenant-1', 'user-1', 'entry-1');

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({
                    previousHours: 5,
                    newHours: 8,
                    source: 'TIME_ENTRY_DELETED',
                }),
            );
        });

        it('rejects an entry belonging to another tenant', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValue(null);
            await expect(service.remove('tenant-1', 'user-1', 'entry-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(db.projectTimeEntry.delete).not.toHaveBeenCalled();
        });
    });

    it('scopes the listing to the tenant', async () => {
        await service.list('tenant-1', {} as never);
        expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant-1' }),
            }),
        );
    });
});
