import { NotFoundException } from '@nestjs/common';
import { BoardsController } from './boards.controller';
import { ProjectTasksController } from './project-tasks.controller';

const tenant = { tenantId: 't1', userId: 'u1' } as never;

describe('resolving a board slug over HTTP', () => {
    const boards = { resolveSlug: jest.fn() };
    const controller = new BoardsController(boards as never, {} as never);

    beforeEach(() => jest.clearAllMocks());

    it('hands the slug to the service rather than reading it as an id', async () => {
        // The guard against declaring @Get(':id') first: Nest matches in
        // declaration order, and /resolve/erp71 would otherwise reach findOne
        // with id="resolve".
        boards.resolveSlug.mockResolvedValue({ boardId: 'b1', currentSlug: 'erp71', moved: false });

        expect(await controller.resolveBoard(tenant, 'erp71')).toEqual({
            id: 'b1',
            currentKey: 'erp71',
            moved: false,
        });
        expect(boards.resolveSlug).toHaveBeenCalledWith('t1', 'erp71');
    });

    it('reports a move so the caller can redirect', async () => {
        boards.resolveSlug.mockResolvedValue({ boardId: 'b1', currentSlug: 'platform', moved: true });

        expect(await controller.resolveBoard(tenant, 'erp71')).toEqual({
            id: 'b1',
            currentKey: 'platform',
            moved: true,
        });
    });

    it('404s a slug nobody has held', async () => {
        boards.resolveSlug.mockResolvedValue(null);
        await expect(controller.resolveBoard(tenant, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('resolving a task key over HTTP', () => {
    const tasks = { resolveTaskKey: jest.fn() };
    const controller = new ProjectTasksController(
        tasks as never, {} as never, {} as never, {} as never,
    );

    beforeEach(() => jest.clearAllMocks());

    it('hands the key to the service', async () => {
        tasks.resolveTaskKey.mockResolvedValue({ taskId: 'k1', currentKey: 'ERP-14', moved: false });

        expect(await controller.resolveTask(tenant, 'ERP-14')).toEqual({
            id: 'k1',
            currentKey: 'ERP-14',
            moved: false,
        });
        expect(tasks.resolveTaskKey).toHaveBeenCalledWith('t1', 'ERP-14');
    });

    it('404s an unknown key', async () => {
        tasks.resolveTaskKey.mockResolvedValue(null);
        await expect(controller.resolveTask(tenant, 'ERP-999')).rejects.toBeInstanceOf(NotFoundException);
    });
});
