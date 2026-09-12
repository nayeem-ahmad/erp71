import { Test, TestingModule } from '@nestjs/testing';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectSettingsService } from './project-settings.service';
import { RemainingHoursService } from './remaining-hours.service';
import { ProjectActivityService } from './project-activity.service';
import { ProjectAccessService } from './project-access.service';
import { DatabaseService } from '../database/database.service';

/**
 * The sparkline in the list's Remaining column. The property that matters is
 * that it costs ONE query however long the page is — a `findMany` per row is
 * the obvious implementation and is an N+1 that grows with the page size.
 */
describe('ProjectTasksService remaining trend', () => {
    let service: ProjectTasksService;
    let db: any;

    const row = (id: string) => ({
        id,
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        status: { category: 'TODO' },
    });

    beforeEach(async () => {
        db = {
            projectTask: {
                findMany: jest.fn().mockResolvedValue([row('t1'), row('t2'), row('t3')]),
                count: jest.fn().mockResolvedValue(3),
            },
            projectTimeEntry: { groupBy: jest.fn().mockResolvedValue([]) },
            $queryRaw: jest.fn().mockResolvedValue([
                { task_id: 't1', new_hours: '8' },
                { task_id: 't1', new_hours: '5' },
                { task_id: 't1', new_hours: '3' },
                { task_id: 't2', new_hours: '4' },
            ]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectTasksService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectSettingsService, useValue: {} },
                { provide: RemainingHoursService, useValue: { write: jest.fn() } },
                { provide: ProjectActivityService, useValue: { record: jest.fn() } },
                {
                    provide: ProjectAccessService,
                    useValue: { taskFilter: jest.fn().mockResolvedValue({}) },
                },
            ],
        }).compile();

        service = module.get(ProjectTasksService);
    });

    const list = () =>
        service.list({ tenantId: 'tenant-1', userId: 'user-1' } as never, {} as never);

    it('costs one query for the whole page', async () => {
        await list();

        expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('attaches each task its own readings, oldest first', async () => {
        const page = await list();

        expect((page.items[0] as never as { remaining_trend: number[] }).remaining_trend).toEqual([
            8, 5, 3,
        ]);
    });

    // One reading has no shape to draw; the column shows the figure alone.
    it('gives no trend to a task with a single reading', async () => {
        const page = await list();

        expect(page.items[1]).not.toHaveProperty('remaining_trend');
    });

    it('gives no trend to a task with no readings at all', async () => {
        const page = await list();

        expect(page.items[2]).not.toHaveProperty('remaining_trend');
    });

    it('does not query at all for an empty page', async () => {
        db.projectTask.findMany.mockResolvedValue([]);
        db.projectTask.count.mockResolvedValue(0);

        await list();

        expect(db.$queryRaw).not.toHaveBeenCalled();
    });
});
