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
        // Every real transaction below is a same-model batch of updates, so a
        // callback invoked with the top-level mock stands in fine for a tx client.
        db.$transaction = jest.fn(async (cb: any) => cb(db));

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

    it('lists boards with a card count scoped to non-deleted tasks', async () => {
        const createdAt = new Date();
        db.board.findMany.mockResolvedValue([
            { id: 'b1', name: 'Release', description: null, created_at: createdAt, _count: { cards: 6 } },
        ]);

        const boards = await service.list(tenantId);

        expect(db.board.findMany).toHaveBeenCalledWith({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { created_at: 'desc' },
            include: { _count: { select: { cards: { where: { task: { deleted_at: null } } } } } },
        });
        expect(boards).toEqual([
            { id: 'b1', name: 'Release', description: null, created_at: createdAt, card_count: 6 },
        ]);
    });

    it('groups cards into the column their status is bound to', async () => {
        db.boardTask.findMany.mockResolvedValue([card('k1', 'p1', 's1'), card('k2', 'p2', 's2')]);

        const board = await service.findOne(tenantId, 'b1');

        expect(db.boardTask.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { board_id: 'b1', tenant_id: tenantId } }),
        );
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

        expect(db.projectTask.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: { in: ['k1', 'k2', 'k3'] }, tenant_id: tenantId, deleted_at: null },
            }),
        );
        expect(columns.bindProject).toHaveBeenCalledTimes(2);
        expect(columns.bindProject).toHaveBeenCalledWith(tenantId, 'b1', 'p1');
        expect(columns.bindProject).toHaveBeenCalledWith(tenantId, 'b1', 'p2');
    });

    it('does not error when re-adding a card already on the board', async () => {
        db.projectTask.findMany.mockResolvedValue([{ id: 'k1', project_id: 'p1' }]);

        await service.addTasks(tenantId, userId, 'b1', ['k1']);

        expect(db.boardTask.createMany).toHaveBeenCalledWith(
            expect.objectContaining({ skipDuplicates: true }),
        );
    });

    it('dedupes task ids so a repeated id in the same request does not look missing', async () => {
        db.projectTask.findMany.mockResolvedValue([{ id: 'k1', project_id: 'p1' }]);

        await expect(service.addTasks(tenantId, userId, 'b1', ['k1', 'k1'])).resolves.toBeDefined();

        expect(db.projectTask.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: { in: ['k1'] }, tenant_id: tenantId, deleted_at: null } }),
        );
    });

    it('rejects a task id that is not in this tenant', async () => {
        db.projectTask.findMany.mockResolvedValue([{ id: 'k1', project_id: 'p1' }]);

        await expect(service.addTasks(tenantId, userId, 'b1', ['k1', 'ghost'])).rejects.toBeInstanceOf(
            NotFoundException,
        );
        expect(db.boardTask.createMany).not.toHaveBeenCalled();
        expect(columns.bindProject).not.toHaveBeenCalled();
    });

    it('moves a card by writing the task status the column binds for that project', async () => {
        // No siblings currently in the target column, so the moved card is the
        // whole list: dto.sortOrder=1 clamps to index 0, the only legal slot.
        await service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 1 });

        expect(db.boardTask.findFirst).toHaveBeenCalledWith({
            where: { board_id: 'b1', tenant_id: tenantId, task_id: 'k1' },
        });
        expect(db.projectTask.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'k1', tenant_id: tenantId, deleted_at: null } }),
        );
        expect(columns.resolveStatusId).toHaveBeenCalledWith(tenantId, 'b1', 'c2', 'p1');
        expect(tasks.move).toHaveBeenCalledWith(tenantId, userId, 'k1', {
            statusId: 's-target',
            sortOrder: 1,
        });
        expect(db.boardTask.update).toHaveBeenCalledWith({
            where: { id: 'bt1' },
            data: { sort_order: 0 },
        });
    });

    it('renumbers the target column when a card is inserted at the top', async () => {
        // 'bt1' (task k1) is the card being moved (default findFirst mock).
        // Two cards already sit in the target column c2, ordered bt2, bt3.
        db.boardTask.findMany.mockResolvedValueOnce([{ id: 'bt2' }, { id: 'bt3' }]);

        await service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 });

        expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt1' }, data: { sort_order: 0 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt2' }, data: { sort_order: 1 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt3' }, data: { sort_order: 2 } });
    });

    it('renumbers the target column when a card is inserted in the middle', async () => {
        db.boardTask.findMany.mockResolvedValueOnce([{ id: 'bt2' }, { id: 'bt3' }]);

        await service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 1 });

        expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt2' }, data: { sort_order: 0 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt1' }, data: { sort_order: 1 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt3' }, data: { sort_order: 2 } });
    });

    it('renumbers the target column when a card is inserted at the bottom, clamping an out-of-range index', async () => {
        db.boardTask.findMany.mockResolvedValueOnce([{ id: 'bt2' }, { id: 'bt3' }]);

        // 99 is well past the end of a 2-sibling column; it must clamp to the
        // last legal slot rather than throw or leave a gap.
        await service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 99 });

        expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt2' }, data: { sort_order: 0 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt3' }, data: { sort_order: 1 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt1' }, data: { sort_order: 2 } });
    });

    it('refuses a drop onto a column with no binding for that card’s project, leaving the task alone', async () => {
        columns.resolveStatusId.mockResolvedValue(null);

        await expect(
            service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(tasks.move).not.toHaveBeenCalled();
        expect(db.boardTask.update).not.toHaveBeenCalled();
    });

    it('refuses to move a card that is not on this board', async () => {
        db.boardTask.findFirst.mockResolvedValue(null);

        await expect(
            service.moveCard(tenantId, userId, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 }),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(tasks.move).not.toHaveBeenCalled();
        expect(db.boardTask.update).not.toHaveBeenCalled();
    });

    it('refuses to read a board from another tenant', async () => {
        db.board.findFirst.mockResolvedValue(null);

        await expect(service.findOne('other', 'b1')).rejects.toBeInstanceOf(NotFoundException);

        expect(db.board.findFirst).toHaveBeenCalledWith({
            where: { id: 'b1', tenant_id: 'other', deleted_at: null },
        });
    });

    it('soft-deletes rather than dropping the row', async () => {
        await service.remove(tenantId, 'b1');

        expect(db.board.update).toHaveBeenCalledWith({
            where: { id: 'b1' },
            data: { deleted_at: expect.any(Date) },
        });
    });
});
