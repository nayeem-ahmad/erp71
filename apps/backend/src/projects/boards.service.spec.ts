import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

describe('BoardsService', () => {
    let service: BoardsService;
    let db: any;
    let columns: any;
    let tasks: any;

    const tenantId = 't1';
    const userId = 'u1';
    /** Sees every project, so the card queries below are unfiltered. */
    const owner: ProjectViewer = { tenantId, userId, userRole: 'OWNER', storeId: 's1' };
    const staff = (id = 'u2'): ProjectViewer => ({ tenantId, userId: id, userRole: 'STAFF', storeId: 's1' });

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
            project: {
                findFirst: jest.fn().mockResolvedValue({ id: 'p1', visibility: 'PUBLIC', manager_id: userId }),
            },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([{ id: 'k1', project_id: 'p1' }]),
                // status_id 's1' is bound to c1, not c2 (see columns.listColumns
                // below), so the default fixture is a genuine cross-column
                // move unless a test overrides it.
                findFirst: jest.fn().mockResolvedValue({ id: 'k1', project_id: 'p1', tenant_id: tenantId, status_id: 's1', deleted_at: null }),
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
        tasks = {
            move: jest.fn().mockResolvedValue({ id: 'k1' }),
            assertTask: jest.fn().mockResolvedValue({ id: 'k1' }),
            create: jest.fn().mockResolvedValue({ id: 'k9', project_id: 'p1' }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BoardsService,
                ProjectAccessService,
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

        const boards = await service.list(owner);

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

        const board = await service.findOne(owner, 'b1');

        expect(db.boardTask.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { board_id: 'b1', tenant_id: tenantId } }),
        );
        expect(board.columns.map((c: any) => c.tasks.map((t: any) => t.id))).toEqual([['k1'], ['k2']]);
        expect(board.unsorted).toEqual([]);
    });

    it('puts a card whose status is bound to nothing into unsorted', async () => {
        db.boardTask.findMany.mockResolvedValue([card('k3', 'p3', 's-loose')]);

        const board = await service.findOne(owner, 'b1');

        expect(board.unsorted.map((t: any) => t.id)).toEqual(['k3']);
        expect(board.columns.every((c: any) => c.tasks.length === 0)).toBe(true);
    });

    it('omits a soft-deleted task from the board', async () => {
        const deleted = card('k4', 'p1', 's1');
        deleted.task.deleted_at = new Date() as never;
        db.boardTask.findMany.mockResolvedValue([deleted]);

        const board = await service.findOne(owner, 'b1');

        expect(board.columns.every((c: any) => c.tasks.length === 0)).toBe(true);
        expect(board.unsorted).toEqual([]);
    });

    it('binds each newly-seen project once when tasks are added', async () => {
        db.projectTask.findMany.mockResolvedValue([
            { id: 'k1', project_id: 'p1' },
            { id: 'k2', project_id: 'p1' },
            { id: 'k3', project_id: 'p2' },
        ]);

        await service.addTasks(owner, 'b1', ['k1', 'k2', 'k3']);

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

        await service.addTasks(owner, 'b1', ['k1']);

        expect(db.boardTask.createMany).toHaveBeenCalledWith(
            expect.objectContaining({ skipDuplicates: true }),
        );
    });

    it('dedupes task ids so a repeated id in the same request does not look missing', async () => {
        db.projectTask.findMany.mockResolvedValue([{ id: 'k1', project_id: 'p1' }]);

        await expect(service.addTasks(owner, 'b1', ['k1', 'k1'])).resolves.toBeDefined();

        expect(db.projectTask.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: { in: ['k1'] }, tenant_id: tenantId, deleted_at: null } }),
        );
    });

    it('rejects a task id that is not in this tenant', async () => {
        db.projectTask.findMany.mockResolvedValue([{ id: 'k1', project_id: 'p1' }]);

        await expect(service.addTasks(owner, 'b1', ['k1', 'ghost'])).rejects.toBeInstanceOf(
            NotFoundException,
        );
        expect(db.boardTask.createMany).not.toHaveBeenCalled();
        expect(columns.bindProject).not.toHaveBeenCalled();
    });

    it('moves a card by writing the task status the column binds for that project', async () => {
        // No siblings currently in the target column, so the moved card is the
        // whole list: dto.sortOrder=1 clamps to index 0, the only legal slot.
        await service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 1 });

        expect(db.boardTask.findFirst).toHaveBeenCalledWith({
            where: { board_id: 'b1', tenant_id: tenantId, task_id: 'k1' },
        });
        expect(db.projectTask.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'k1', tenant_id: tenantId, deleted_at: null } }),
        );
        expect(columns.resolveStatusId).toHaveBeenCalledWith(tenantId, 'b1', 'c2', 'p1');
        expect(tasks.move).toHaveBeenCalledWith(owner, 'k1', {
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

        await service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 });

        expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt1' }, data: { sort_order: 0 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt2' }, data: { sort_order: 1 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt3' }, data: { sort_order: 2 } });
    });

    it('renumbers the target column when a card is inserted in the middle', async () => {
        db.boardTask.findMany.mockResolvedValueOnce([{ id: 'bt2' }, { id: 'bt3' }]);

        await service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 1 });

        expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt2' }, data: { sort_order: 0 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt1' }, data: { sort_order: 1 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt3' }, data: { sort_order: 2 } });
    });

    it('renumbers the target column when a card is inserted at the bottom, clamping an out-of-range index', async () => {
        db.boardTask.findMany.mockResolvedValueOnce([{ id: 'bt2' }, { id: 'bt3' }]);

        // 99 is well past the end of a 2-sibling column; it must clamp to the
        // last legal slot rather than throw or leave a gap.
        await service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 99 });

        expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt2' }, data: { sort_order: 0 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt3' }, data: { sort_order: 1 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt1' }, data: { sort_order: 2 } });
    });

    it('does not call tasks.move for a reorder within the same column', async () => {
        // Task k1 is already in status s1, which is what c1 binds (see
        // columns.listColumns above) — dropping it back into c1 is a reorder,
        // not a move across columns.
        db.projectTask.findFirst.mockResolvedValue({
            id: 'k1',
            project_id: 'p1',
            tenant_id: tenantId,
            status_id: 's1',
            deleted_at: null,
        });
        db.boardTask.findMany.mockResolvedValueOnce([{ id: 'bt2' }]);

        await service.moveCard(owner, 'b1', 'k1', { columnId: 'c1', sortOrder: 0 });

        expect(tasks.move).not.toHaveBeenCalled();
        expect(columns.resolveStatusId).not.toHaveBeenCalled();
        expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt1' }, data: { sort_order: 0 } });
        expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt2' }, data: { sort_order: 1 } });
    });

    it('still calls tasks.move with the resolved status for a genuine cross-column move', async () => {
        // Default fixture: k1's status s1 is bound to c1, dropped onto c2
        // (bound to s2) — the card really is changing columns.
        await service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 });

        expect(columns.resolveStatusId).toHaveBeenCalledWith(tenantId, 'b1', 'c2', 'p1');
        expect(tasks.move).toHaveBeenCalledWith(owner, 'k1', {
            statusId: 's-target',
            sortOrder: 0,
        });
    });

    it('keeps the task’s own status when two statuses bound to one column are reordered in place', async () => {
        // Doing (s1) and Reviewing (s2) are both IN_PROGRESS and both land on
        // the single column c2 — what pickColumnForStatus's category fallback
        // does whenever a project's status names don't match the board's
        // column names. The card sits in Reviewing (the higher-sort-order
        // status); reordering it within c2 must not resolve to Doing.
        columns.listColumns.mockResolvedValue([
            { id: 'c1', name: 'To Do', category: 'TODO', sort_order: 0, wip_limit: null, bindings: [] },
            {
                id: 'c2',
                name: 'In Progress',
                category: 'IN_PROGRESS',
                sort_order: 1,
                wip_limit: null,
                bindings: [{ status_id: 's1' }, { status_id: 's2' }],
            },
        ]);
        db.projectTask.findFirst.mockResolvedValue({
            id: 'k1',
            project_id: 'p1',
            tenant_id: tenantId,
            status_id: 's2',
            deleted_at: null,
        });
        db.boardTask.findMany.mockResolvedValueOnce([{ id: 'bt2' }]);

        await service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 });

        expect(tasks.move).not.toHaveBeenCalled();
        expect(columns.resolveStatusId).not.toHaveBeenCalled();
    });

    it('excludes a soft-deleted task’s card from the sibling renumber', async () => {
        await service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 });

        expect(db.boardTask.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    task: { status_id: { in: ['s2'] }, deleted_at: null },
                }),
            }),
        );
    });

    it('refuses a drop onto a column with no binding for that card’s project, leaving the task alone', async () => {
        columns.resolveStatusId.mockResolvedValue(null);

        await expect(
            service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(tasks.move).not.toHaveBeenCalled();
        expect(db.boardTask.update).not.toHaveBeenCalled();
    });

    it('refuses to move a card that is not on this board', async () => {
        db.boardTask.findFirst.mockResolvedValue(null);

        await expect(
            service.moveCard(owner, 'b1', 'k1', { columnId: 'c2', sortOrder: 0 }),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(tasks.move).not.toHaveBeenCalled();
        expect(db.boardTask.update).not.toHaveBeenCalled();
    });

    it('refuses to read a board from another tenant', async () => {
        db.board.findFirst.mockResolvedValue(null);

        await expect(
            service.findOne({ ...owner, tenantId: 'other' }, 'b1'),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(db.board.findFirst).toHaveBeenCalledWith({
            where: { id: 'b1', tenant_id: 'other', deleted_at: null },
        });
    });

    describe('createCard', () => {
        const dto = { projectId: 'p1', title: 'Write the changelog' };

        it('opens the task in the column it was composed in, not the project default', async () => {
            columns.resolveStatusId.mockResolvedValue('s2');

            await service.createCard(owner, 'b1', 'c2', dto);

            expect(columns.resolveStatusId).toHaveBeenCalledWith(tenantId, 'b1', 'c2', 'p1');
            expect(tasks.create).toHaveBeenCalledWith(
                owner,
                expect.objectContaining({ projectId: 'p1', title: dto.title, statusId: 's2' }),
            );
        });

        it('binds the project first, so the first card composed for it is not orphaned', async () => {
            // addTasks binds too, but it runs after the task exists — the status
            // has to resolve before that, or there is nothing to create with.
            await service.createCard(owner, 'b1', 'c1', dto);

            const bindOrder = columns.bindProject.mock.invocationCallOrder[0];
            const resolveOrder = columns.resolveStatusId.mock.invocationCallOrder[0];
            expect(bindOrder).toBeLessThan(resolveOrder);
        });

        it('puts the task it just created on the board', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'k9', project_id: 'p1' }]);

            await service.createCard(owner, 'b1', 'c1', dto);

            expect(db.boardTask.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [expect.objectContaining({ board_id: 'b1', task_id: 'k9' })],
                }),
            );
        });

        it('refuses a column with no status for this project rather than guessing one', async () => {
            columns.resolveStatusId.mockResolvedValue(null);

            await expect(service.createCard(owner, 'b1', 'c1', dto)).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(tasks.create).not.toHaveBeenCalled();
        });

        it('refuses a column that is not on this board', async () => {
            await expect(service.createCard(owner, 'b1', 'c-nope', dto)).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(tasks.create).not.toHaveBeenCalled();
        });

        it('refuses a project the viewer cannot see, before anything is bound', async () => {
            db.project.findFirst.mockResolvedValue(null);

            await expect(service.createCard(staff('u7'), 'b1', 'c1', dto)).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(columns.bindProject).not.toHaveBeenCalled();
            expect(tasks.create).not.toHaveBeenCalled();
        });
    });

    describe('project visibility', () => {
        it('leaves cards from unreachable projects off a shared board', async () => {
            await service.findOne(staff('u7'), 'b1');

            expect(db.boardTask.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        task: { AND: [{ project: { OR: visibilityOr('u7') } }] },
                    }),
                }),
            );
        });

        it('counts only reachable cards in the board list', async () => {
            await service.list(staff('u7'));

            const [{ include }] = db.board.findMany.mock.calls.at(-1);
            expect(include._count.select.cards.where).toEqual({
                task: { deleted_at: null, AND: [{ project: { OR: visibilityOr('u7') } }] },
            });
        });

        it('refuses to add a task the viewer cannot see', async () => {
            // The filtered lookup finds nothing, which is the same answer a
            // made-up id gets.
            db.projectTask.findMany.mockResolvedValue([]);

            await expect(service.addTasks(staff('u7'), 'b1', ['k1'])).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(db.boardTask.createMany).not.toHaveBeenCalled();
        });

        it('refuses to pull a card the viewer cannot see off a shared board', async () => {
            tasks.assertTask.mockRejectedValue(new NotFoundException('Task not found'));

            await expect(service.removeTask(staff('u7'), 'b1', 'k1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(db.boardTask.deleteMany).not.toHaveBeenCalled();
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
