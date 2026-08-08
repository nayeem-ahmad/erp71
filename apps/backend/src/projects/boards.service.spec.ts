import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
import { ProjectTasksService } from './project-tasks.service';
import { DatabaseService } from '../database/database.service';

describe('BoardsService', () => {
    let service: BoardsService;
    let db: any;
    let columns: any;
    let tasks: any;

    const tenantId = 't1';
    const userId = 'u1';

    const card = (id: string, projectId: string, statusId: string) => ({
        id,
        board_id: 'b1',
        task_id: id,
        sort_order: 0,
        task: {
            id,
            title: `Task ${id}`,
            priority: 'MEDIUM',
            status_id: statusId,
            project_id: projectId,
            deleted_at: null,
            project: { id: projectId, code: projectId.toUpperCase(), name: projectId, short_name: null },
            labels: [],
            checklistItems: [],
            _count: { subtasks: 0, comments: 0 },
        },
    });

    beforeEach(async () => {
        db = {
            board: {
                findFirst: jest.fn().mockResolvedValue({ id: 'b1', tenant_id: tenantId, name: 'Release', description: null }),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({ id: 'b1', name: 'Release' }),
                update: jest.fn().mockResolvedValue({ id: 'b1' }),
            },
            boardTask: {
                findMany: jest.fn().mockResolvedValue([]),
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                aggregate: jest.fn().mockResolvedValue({ _max: { sort_order: 2 } }),
                update: jest.fn().mockResolvedValue({}),
                findFirst: jest.fn().mockResolvedValue({ id: 'bt1', board_id: 'b1', task_id: 'k1' }),
            },
            boardColumnStatus: { findMany: jest.fn().mockResolvedValue([]) },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([{ id: 'k1', project_id: 'p1' }]),
                findFirst: jest.fn().mockResolvedValue({ id: 'k1', project_id: 'p1', tenant_id: tenantId, deleted_at: null }),
            },
        };
        columns = {
            seedColumnsForNewBoard: jest.fn().mockResolvedValue(undefined),
            bindProject: jest.fn().mockResolvedValue(undefined),
            resolveStatusId: jest.fn().mockResolvedValue('s-target'),
            listColumns: jest.fn().mockResolvedValue([
                { id: 'c1', name: 'To Do', category: 'TODO', sort_order: 0, wip_limit: null, bindings: [{ status_id: 's1' }] },
                { id: 'c2', name: 'Done', category: 'DONE', sort_order: 1, wip_limit: null, bindings: [{ status_id: 's2' }] },
            ]),
        };
        tasks = { move: jest.fn().mockResolvedValue({ id: 'k1' }) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BoardsService,
                { provide: DatabaseService, useValue: db },
                { provide: BoardColumnsService, useValue: columns },
                { provide: ProjectTasksService, useValue: tasks },
            ],
        }).compile();
        service = module.get(BoardsService);
    });

    it('seeds columns when a board is created', async () => {
        await service.create(tenantId, userId, { name: 'Release' });

        expect(db.board.create).toHaveBeenCalledWith({
            data: { tenant_id: tenantId, name: 'Release', description: null, created_by: userId },
        });
        expect(columns.seedColumnsForNewBoard).toHaveBeenCalledWith(tenantId, 'b1');
    });

    it('groups cards into the column their status is bound to', async () => {
        db.boardTask.findMany.mockResolvedValue([card('k1', 'p1', 's1'), card('k2', 'p2', 's2')]);

        const board = await service.findOne(tenantId, 'b1');

        expect(board.columns.map((c: any) => c.tasks.map((t: any) => t.id))).toEqual([['k1'], ['k2']]);
        expect(board.unsorted).toEqual([]);
    });

    it('puts a card whose status is bound to nothing into unsorted', async () => {
        db.boardTask.findMany.mockResolvedValue([card('k3', 'p3', 's-loose')]);

        const board = await service.findOne(tenantId, 'b1');

        expect(board.unsorted.map((t: any) => t.id)).toEqual(['k3']);
        expect(board.columns.every((c: any) => c.tasks.length === 0)).toBe(true);
    });

    it('omits a soft-deleted task from the board', async () => {
        const deleted = card('k4', 'p1', 's1');
        deleted.task.deleted_at = new Date() as never;
        db.boardTask.findMany.mockResolvedValue([deleted]);

        const board = await service.findOne(tenantId, 'b1');

        expect(board.columns.every((c: any) => c.tasks.length === 0)).toBe(true);
        expect(board.unsorted).toEqual([]);
    });

    it('binds each newly-seen project once when tasks are added', async () => {
        db.projectTask.findMany.mockResolvedValue([
            { id: 'k1', project_id: 'p1' },
            { id: 'k2', project_id: 'p1' },
            { id: 'k3', project_id: 'p2' },
        ]);

        await service.addTasks(tenantId, userId, 'b1', ['k1', 'k2', 'k3']);

        expect(columns.bindProject).toHaveBeenCalledTimes(2);
        expect(columns.bindProject).toHaveBeenCalledWith(tenantId, 'b1', 'p1');
        expect(columns.bindProject).toHaveBeenCalledWith(tenantId, 'b1', 'p2');
    });

    it('rejects a task id that is not in this tenant', async () => {
        db.projectTask.findMany.mockResolvedValue([{ id: 'k1', project_id: 'p1' }]);

        await expect(service.addTasks(tenantId, userId, 'b1', ['k1', 'ghost'])).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it('moves a card by writing the task status the column binds for that project', async () => {
        await service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 1 });

        expect(columns.resolveStatusId).toHaveBeenCalledWith(tenantId, 'b1', 'c2', 'p1');
        expect(tasks.move).toHaveBeenCalledWith(tenantId, userId, 'k1', {
            statusId: 's-target',
            sortOrder: 1,
        });
        expect(db.boardTask.update).toHaveBeenCalledWith({
            where: { id: 'bt1' },
            data: { sort_order: 1 },
        });
    });

    it('refuses a drop onto a column with no binding for that card’s project, leaving the task alone', async () => {
        columns.resolveStatusId.mockResolvedValue(null);

        await expect(
            service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(tasks.move).not.toHaveBeenCalled();
        expect(db.boardTask.update).not.toHaveBeenCalled();
    });

    it('refuses to read a board from another tenant', async () => {
        db.board.findFirst.mockResolvedValue(null);
        await expect(service.findOne('other', 'b1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes rather than dropping the row', async () => {
        await service.remove(tenantId, 'b1');

        expect(db.board.update).toHaveBeenCalledWith({
            where: { id: 'b1' },
            data: { deleted_at: expect.any(Date) },
        });
    });
});
