import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectSettingsService } from './project-settings.service';
import { ProjectAccessService } from './project-access.service';
import { DatabaseService } from '../database/database.service';
import { OWNER, staff } from './project-access.test-support';

describe('ProjectsService.burndown', () => {
    let service: ProjectsService;
    let db: any;
    let access: any;

    const log = (taskId: string, hours: number, iso: string) => ({
        task_id: taskId,
        new_hours: hours,
        changed_at: new Date(`${iso}T10:00:00.000Z`),
    });

    beforeEach(async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-10T12:00:00.000Z'));

        db = {
            project: {
                findFirst: jest.fn().mockResolvedValue({
                    start_date: new Date('2026-09-01T00:00:00.000Z'),
                    target_end_date: new Date('2026-09-30T00:00:00.000Z'),
                }),
            },
            projectTaskRemainingLog: {
                findMany: jest.fn().mockResolvedValue([
                    log('t1', 16, '2026-09-02'),
                    log('t1', 10, '2026-09-05'),
                ]),
            },
        };

        access = {
            relatedFilter: jest.fn(),
            // The real one throws NotFound for a project the viewer cannot see;
            // the visibility tests below re-stub it to do exactly that.
            assertProjectVisible: jest.fn().mockResolvedValue({ id: 'project-1' }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectsService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectSettingsService, useValue: {} },
                { provide: ProjectAccessService, useValue: access },
            ],
        }).compile();

        service = module.get(ProjectsService);
    });

    afterEach(() => jest.useRealTimers());

    const run = () => service.burndown(OWNER, 'project-1');

    it('is scoped to the tenant as well as the project', async () => {
        await run();

        expect(db.projectTaskRemainingLog.findMany.mock.calls[0][0].where).toEqual({
            tenant_id: 'tenant-1',
            project_id: 'project-1',
        });
    });

    it('reads the log once rather than once per day', async () => {
        await run();

        expect(db.projectTaskRemainingLog.findMany).toHaveBeenCalledTimes(1);
    });

    it('carries the figure across the days between writes', async () => {
        const { series } = await run();
        const on = (date: string) => series.find((point) => point.date === date);

        expect(on('2026-09-03')?.actual).toBe(16);
        expect(on('2026-09-06')?.actual).toBe(10);
    });

    it('says nothing about days before the first write', async () => {
        const { series } = await run();

        expect(series.find((point) => point.date === '2026-09-01')?.actual).toBeNull();
    });

    /**
     * `target_end_date` is optional where a sprint's dates are not, and a
     * made-up deadline would make every project without one look late.
     */
    it('draws an ideal line when the project says where it starts and ends', async () => {
        const { series, hasIdeal } = await run();

        expect(hasIdeal).toBe(true);
        expect(series.some((point) => point.ideal != null)).toBe(true);
    });

    it('draws no ideal line when the project has no target end date', async () => {
        db.project.findFirst.mockResolvedValue({
            start_date: new Date('2026-09-01T00:00:00.000Z'),
            target_end_date: null,
        });

        const { series, hasIdeal } = await run();

        expect(hasIdeal).toBe(false);
        expect(series.every((point) => point.ideal === null)).toBe(true);
    });

    it('runs the window out to the target when the target is still ahead', async () => {
        const { endDate } = await run();

        expect(endDate).toBe('2026-09-30');
    });

    it('stops at today when the target is already behind', async () => {
        db.project.findFirst.mockResolvedValue({
            start_date: new Date('2026-09-01T00:00:00.000Z'),
            target_end_date: new Date('2026-09-04T00:00:00.000Z'),
        });

        const { endDate } = await run();

        expect(endDate).toBe('2026-09-10');
    });

    // Work logged before the nominal start date is still work that happened.
    it('opens the window on the first write when that precedes the start date', async () => {
        db.project.findFirst.mockResolvedValue({
            start_date: new Date('2026-09-08T00:00:00.000Z'),
            target_end_date: new Date('2026-09-30T00:00:00.000Z'),
        });

        const { startDate } = await run();

        expect(startDate).toBe('2026-09-02');
    });

    it('answers with an empty series for a project nothing has been logged against', async () => {
        db.projectTaskRemainingLog.findMany.mockResolvedValue([]);

        expect(await run()).toEqual({ series: [], hasIdeal: false });
    });

    it('refuses a project in another tenant', async () => {
        access.assertProjectVisible.mockRejectedValue(new NotFoundException('Project not found'));

        await expect(run()).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * The chart hangs off a project, so it is exactly as visible as one. Before
     * this, the route took a tenant id rather than a viewer and asked only
     * `{ id, tenant_id }` — so anyone holding VIEW_PROJECTS could read the
     * day-by-day remaining hours of a private project they were not a member of.
     */
    describe('visibility', () => {
        it('asks whether this viewer may see the project at all', async () => {
            const viewer = staff();

            await service.burndown(viewer, 'project-1');

            expect(access.assertProjectVisible).toHaveBeenCalledWith(viewer, 'project-1');
        });

        it('refuses a private project the viewer is not on', async () => {
            access.assertProjectVisible.mockRejectedValue(new NotFoundException('Project not found'));

            await expect(service.burndown(staff(), 'project-1')).rejects.toBeInstanceOf(NotFoundException);
            // Nothing is read once the gate has refused.
            expect(db.projectTaskRemainingLog.findMany).not.toHaveBeenCalled();
        });

        it('still serves a member the project they are on', async () => {
            const { series } = await service.burndown(staff(), 'project-1');

            expect(series.length).toBeGreaterThan(0);
        });
    });
});
