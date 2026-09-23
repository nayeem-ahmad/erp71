import { Test, TestingModule } from '@nestjs/testing';
import {
    BadRequestException,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';

describe('BoardsService', () => {
    let service: BoardsService;
    let db: any;
    let columns: any;
    let tasks: any;
    let assets: any;

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
            boardSlugHistory: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({}),
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
        assets = {
            isEnabled: jest.fn().mockReturnValue(true),
            uploadBuffer: jest
                .fn()
                .mockResolvedValue({ url: 'https://cdn/new.jpg', publicId: 'retail/t1/project-boards/new', bytes: 10 }),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BoardsService,
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
                { provide: BoardColumnsService, useValue: columns },
                { provide: ProjectTasksService, useValue: tasks },
                { provide: AssetsService, useValue: assets },
            ],
        }).compile();
        service = module.get(BoardsService);
    });

    it('seeds columns when a board is created', async () => {
        await service.create(tenantId, userId, { name: 'Release' });

        expect(db.board.create).toHaveBeenCalledWith({
            // `slug` is derived from the name — see url-keys/board-slug.ts.
            data: { tenant_id: tenantId, name: 'Release', slug: 'release', description: null, created_by: userId },
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
            where: { tenant_id: 'other', deleted_at: null, OR: [{ id: 'b1' }, { slug: 'b1' }] },
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

        it('hands the composed assignee to the task it creates', async () => {
            await service.createCard(owner, 'b1', 'c1', {
                ...dto,
                assigneeId: 'u9',
                assigneeEmployeeId: '',
            });

            expect(tasks.create).toHaveBeenCalledWith(
                owner,
                expect.objectContaining({ assigneeId: 'u9', assigneeEmployeeId: '' }),
            );
        });

        it('hands over an employee holder the same way', async () => {
            await service.createCard(owner, 'b1', 'c1', {
                ...dto,
                assigneeId: '',
                assigneeEmployeeId: 'e3',
            });

            expect(tasks.create).toHaveBeenCalledWith(
                owner,
                expect.objectContaining({ assigneeId: '', assigneeEmployeeId: 'e3' }),
            );
        });

        // A card composed with nobody picked must not silently land on the
        // person composing it — `tasks.create` reads '' as "no holder".
        it('leaves the holder unset when the composer sent none', async () => {
            await service.createCard(owner, 'b1', 'c1', dto);

            expect(tasks.create).toHaveBeenCalledWith(
                owner,
                expect.objectContaining({ assigneeId: undefined, assigneeEmployeeId: undefined }),
            );
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

    describe('background', () => {
        /** A board already wearing an uploaded picture. */
        const withImage = () =>
            db.board.findFirst.mockResolvedValue({
                id: 'b1',
                tenant_id: tenantId,
                name: 'Release',
                background_color: null,
                background_image_url: 'https://cdn/old.jpg',
                background_image_key: 'retail/t1/project-boards/old',
            });

        const pixel =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

        it('renames without touching the background', async () => {
            withImage();

            await service.update(tenantId, 'b1', { name: 'Release 2' });

            expect(db.board.update).toHaveBeenCalledWith({
                where: { id: 'b1' },
                data: { name: 'Release 2' },
            });
            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('drops the image when a colour is picked, file and all', async () => {
            withImage();

            await service.update(tenantId, 'b1', { backgroundColor: 'BLUE' });

            expect(db.board.update).toHaveBeenCalledWith({
                where: { id: 'b1' },
                data: {
                    background_color: 'BLUE',
                    background_image_url: null,
                    background_image_key: null,
                },
            });
            // Or the tenant is billed forever for a picture no board can show.
            expect(assets.deleteFile).toHaveBeenCalledWith('retail/t1/project-boards/old', 'image');
        });

        it('clears the colour with an explicit null', async () => {
            await service.update(tenantId, 'b1', { backgroundColor: null });

            expect(db.board.update).toHaveBeenCalledWith({
                where: { id: 'b1' },
                data: {
                    background_color: null,
                    background_image_url: null,
                    background_image_key: null,
                },
            });
        });

        it('stores an uploaded image with the key needed to delete it later', async () => {
            await service.setBackgroundImage(tenantId, 'b1', { imageBase64: pixel });

            expect(assets.uploadBuffer).toHaveBeenCalledWith(
                expect.any(Buffer),
                't1/project-boards',
                'background',
                'image',
            );
            expect(db.board.update).toHaveBeenCalledWith({
                where: { id: 'b1' },
                data: {
                    background_image_url: 'https://cdn/new.jpg',
                    background_image_key: 'retail/t1/project-boards/new',
                    background_color: null,
                },
            });
        });

        it('removes the picture it replaced', async () => {
            withImage();

            await service.setBackgroundImage(tenantId, 'b1', { imageBase64: pixel });

            expect(assets.deleteFile).toHaveBeenCalledWith('retail/t1/project-boards/old', 'image');
        });

        it('refuses a payload that is not an image', async () => {
            await expect(
                service.setBackgroundImage(tenantId, 'b1', {
                    imageBase64: 'data:application/pdf;base64,JVBERi0=',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(assets.uploadBuffer).not.toHaveBeenCalled();
        });

        it('says so plainly when storage is not configured', async () => {
            assets.isEnabled.mockReturnValue(false);

            await expect(
                service.setBackgroundImage(tenantId, 'b1', { imageBase64: pixel }),
            ).rejects.toBeInstanceOf(ServiceUnavailableException);
            expect(db.board.update).not.toHaveBeenCalled();
        });

        it('clearing takes both columns and the file', async () => {
            withImage();

            await service.clearBackground(tenantId, 'b1');

            expect(db.board.update).toHaveBeenCalledWith({
                where: { id: 'b1' },
                data: {
                    background_color: null,
                    background_image_url: null,
                    background_image_key: null,
                },
            });
            expect(assets.deleteFile).toHaveBeenCalledWith('retail/t1/project-boards/old', 'image');
        });

        it('sends the background out with the board', async () => {
            db.board.findFirst.mockResolvedValue({
                id: 'b1',
                tenant_id: tenantId,
                name: 'Release',
                description: null,
                background_color: 'PURPLE',
                background_image_url: null,
            });

            const board = await service.findOne(owner, 'b1');

            expect(board.background_color).toBe('PURPLE');
            expect(board.background_image_url).toBeNull();
        });

        it('sends it out with the board list too, so the list can show it', async () => {
            db.board.findMany.mockResolvedValue([
                {
                    id: 'b1',
                    name: 'Release',
                    description: null,
                    created_at: new Date(),
                    background_color: 'AMBER',
                    background_image_url: null,
                    _count: { cards: 2 },
                },
            ]);

            const [board] = await service.list(owner);

            expect(board.background_color).toBe('AMBER');
        });

        it('never leaks the storage key to the browser', async () => {
            withImage();
            db.board.findMany.mockResolvedValue([
                {
                    id: 'b1',
                    name: 'Release',
                    description: null,
                    created_at: new Date(),
                    background_image_url: 'https://cdn/old.jpg',
                    background_image_key: 'retail/t1/project-boards/old',
                    _count: { cards: 0 },
                },
            ]);
            // What the writes hand back, not just what the reads do: the
            // `public_id` is how this service deletes a replaced picture, and
            // the browser has no use for it on any route.
            db.board.update.mockResolvedValue({
                id: 'b1',
                name: 'Release',
                background_image_url: 'https://cdn/new.jpg',
                background_image_key: 'retail/t1/project-boards/new',
            });

            const [listed] = await service.list(owner);
            const opened = await service.findOne(owner, 'b1');
            const renamed = await service.update(tenantId, 'b1', { name: 'Release 2' });
            const uploaded = await service.setBackgroundImage(tenantId, 'b1', {
                imageBase64: pixel,
            });
            const cleared = await service.clearBackground(tenantId, 'b1');

            for (const shape of [listed, opened, renamed, uploaded, cleared]) {
                expect(shape).not.toHaveProperty('background_image_key');
            }
            // The URL still goes out — it is what the page renders.
            expect(uploaded).toHaveProperty('background_image_url', 'https://cdn/new.jpg');
        });
    });
    /**
     * The bulk half of the board: the column menu's "move all cards to", the
     * selection bar's actions, and "sort cards". All three end in the same
     * per-column renumber the single-card drop uses, so the assertions below
     * are about *which* rows come out in which order.
     */
    describe('bulk card actions', () => {
        /**
         * A board membership row as both halves of these calls read it: the
         * `{ id, task_id }` the renumber selects, plus the joined task the
         * closing `findOne` walks.
         */
        const membership = (id: string, taskId: string, statusId = 's1') => ({
            ...card(taskId, 'p1', statusId),
            id,
            task_id: taskId,
        });

        beforeEach(() => {
            db.projectTask.findMany.mockResolvedValue([
                { id: 'k1', project_id: 'p1', status_id: 's1' },
                { id: 'k2', project_id: 'p1', status_id: 's1' },
            ]);
            db.boardTask.findMany.mockResolvedValue([
                membership('bt1', 'k1'),
                membership('bt2', 'k2'),
            ]);
        });

        it('moves several cards into one column and appends them in the order sent', async () => {
            db.boardTask.findMany
                // The membership lookup for the two cards being moved…
                .mockResolvedValueOnce([membership('bt1', 'k1'), membership('bt2', 'k2')])
                // …then the target column's own rows, inside the transaction.
                .mockResolvedValueOnce([membership('bt9', 'k9', 's2')]);

            await service.moveCards(owner, 'b1', { taskIds: ['k2', 'k1'], columnId: 'c2' });

            // One status resolution per project, not per card.
            expect(columns.resolveStatusId).toHaveBeenCalledTimes(1);
            expect(tasks.move).toHaveBeenCalledTimes(2);
            expect(tasks.move).toHaveBeenCalledWith(owner, 'k2', {
                statusId: 's-target',
                sortOrder: Number.MAX_SAFE_INTEGER,
            });
            // The card already in c2 keeps the top; the two arrive under it in
            // the order the request listed them.
            expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt9' }, data: { sort_order: 0 } });
            expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt2' }, data: { sort_order: 1 } });
            expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt1' }, data: { sort_order: 2 } });
        });

        it('refuses the whole move when one card’s project is unmapped, before writing anything', async () => {
            columns.resolveStatusId.mockResolvedValue(null);

            await expect(
                service.moveCards(owner, 'b1', { taskIds: ['k1', 'k2'], columnId: 'c2' }),
            ).rejects.toBeInstanceOf(BadRequestException);

            // A half-applied bulk move is worse than a refused one: nothing
            // moved, so nothing has to be worked out afterwards.
            expect(tasks.move).not.toHaveBeenCalled();
            expect(db.boardTask.update).not.toHaveBeenCalled();
        });

        it('leaves a card that is already in the target column alone rather than rewriting its status', async () => {
            // Both cards are in s1, which c1 binds — "move to c1" is a no-op
            // for the status and a reposition for the board.
            await service.moveCards(owner, 'b1', { taskIds: ['k1', 'k2'], columnId: 'c1' });

            expect(tasks.move).not.toHaveBeenCalled();
            expect(db.boardTask.update).toHaveBeenCalled();
        });

        it('refuses a card that is not on this board', async () => {
            db.boardTask.findMany.mockResolvedValueOnce([membership('bt1', 'k1')]);

            await expect(
                service.moveCards(owner, 'b1', { taskIds: ['k1', 'k2'], columnId: 'c2' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('scopes the bulk move’s task lookup to what the viewer may see', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'k1', project_id: 'p1', status_id: 's1' }]);

            await expect(
                service.moveCards(staff(), 'b1', { taskIds: ['k1', 'k2'], columnId: 'c2' }),
            ).rejects.toBeInstanceOf(NotFoundException);

            expect(db.projectTask.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        AND: [{ project: { OR: visibilityOr('u2') } }],
                    }),
                }),
            );
        });

        it('takes several cards off the board in one call without touching the tasks', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'k1' }, { id: 'k2' }]);

            await service.removeCards(owner, 'b1', ['k1', 'k2', 'k1']);

            expect(db.boardTask.deleteMany).toHaveBeenCalledWith({
                // Deduped: a repeated id is not a second card.
                where: { board_id: 'b1', tenant_id: tenantId, task_id: { in: ['k1', 'k2'] } },
            });
            expect(db.projectTask.update).toBeUndefined();
        });

        it('refuses a bulk remove that reaches a card the viewer cannot see', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'k1' }]);

            await expect(service.removeCards(staff(), 'b1', ['k1', 'k2'])).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(db.boardTask.deleteMany).not.toHaveBeenCalled();
        });

        it('writes a sorted column back in the order it was given', async () => {
            db.boardTask.findMany.mockResolvedValue([
                membership('bt1', 'k1'),
                membership('bt2', 'k2'),
                membership('bt3', 'k3'),
            ]);

            await service.orderCards(owner, 'b1', 'c1', ['k3', 'k1', 'k2']);

            expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt3' }, data: { sort_order: 0 } });
            expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt1' }, data: { sort_order: 1 } });
            expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt2' }, data: { sort_order: 2 } });
        });

        it('leaves a card it was not sent in the slot it already holds', async () => {
            db.boardTask.findMany.mockResolvedValue([
                membership('bt1', 'k1'),
                membership('bt2', 'k2'),
                membership('bt3', 'k3'),
            ]);

            // k2 is filtered out of the view doing the sorting — it must not be
            // swept to the bottom of a column its owner cannot see.
            await service.orderCards(owner, 'b1', 'c1', ['k3', 'k1']);

            expect(db.boardTask.update).toHaveBeenNthCalledWith(1, { where: { id: 'bt3' }, data: { sort_order: 0 } });
            expect(db.boardTask.update).toHaveBeenNthCalledWith(2, { where: { id: 'bt2' }, data: { sort_order: 1 } });
            expect(db.boardTask.update).toHaveBeenNthCalledWith(3, { where: { id: 'bt1' }, data: { sort_order: 2 } });
        });

        it('ignores an id that is no longer in the column rather than refusing the sort', async () => {
            db.boardTask.findMany.mockResolvedValue([membership('bt1', 'k1')]);

            await expect(service.orderCards(owner, 'b1', 'c1', ['gone', 'k1'])).resolves.toBeDefined();
            expect(db.boardTask.update).toHaveBeenCalledWith({ where: { id: 'bt1' }, data: { sort_order: 0 } });
        });

        it('404s a column that is not on this board', async () => {
            await expect(
                service.moveCards(owner, 'b1', { taskIds: ['k1'], columnId: 'nope' }),
            ).rejects.toBeInstanceOf(NotFoundException);
            await expect(service.orderCards(owner, 'b1', 'nope', ['k1'])).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });
});
