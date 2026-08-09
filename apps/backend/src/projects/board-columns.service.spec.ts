import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BoardColumnsService, pickColumnForStatus } from './board-columns.service';
import { ProjectSettingsService } from './project-settings.service';
import { DatabaseService } from '../database/database.service';

const COLUMNS = [
    { id: 'c1', name: 'To Do', category: 'TODO', sort_order: 0 },
    { id: 'c2', name: 'In Progress', category: 'IN_PROGRESS', sort_order: 1 },
    { id: 'c3', name: 'In Review', category: 'IN_PROGRESS', sort_order: 2 },
    { id: 'c4', name: 'Done', category: 'DONE', sort_order: 3 },
];

describe('pickColumnForStatus', () => {
    it('matches on name', () => {
        expect(pickColumnForStatus(COLUMNS, { id: 's', name: 'In Review', category: 'TODO' })).toBe('c3');
    });

    it('matches on name ignoring case and surrounding whitespace', () => {
        expect(pickColumnForStatus(COLUMNS, { id: 's', name: '  in progress ', category: 'DONE' })).toBe('c2');
    });

    it('falls back to the lowest sort_order column of the same category', () => {
        expect(pickColumnForStatus(COLUMNS, { id: 's', name: 'Doing', category: 'IN_PROGRESS' })).toBe('c2');
    });

    it('returns null when neither name nor category matches', () => {
        expect(pickColumnForStatus([COLUMNS[0]], { id: 's', name: 'Doing', category: 'IN_PROGRESS' })).toBeNull();
    });
});

describe('BoardColumnsService', () => {
    let service: BoardColumnsService;
    let db: any;
    let settings: any;

    const tenantId = 't1';

    beforeEach(async () => {
        db = {
            board: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', tenant_id: tenantId }) },
            boardColumn: {
                findMany: jest.fn().mockResolvedValue(COLUMNS.map((c) => ({ ...c, board_id: 'b1' }))),
                createMany: jest.fn().mockResolvedValue({ count: 4 }),
            },
            boardColumnStatus: {
                findMany: jest.fn().mockResolvedValue([]),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            projectTaskStatus: { findMany: jest.fn().mockResolvedValue([]) },
        };
        settings = {
            listTaskStatuses: jest.fn().mockResolvedValue([
                { id: 't-todo', name: 'To Do', category: 'TODO', sort_order: 0 },
                { id: 't-prog', name: 'In Progress', category: 'IN_PROGRESS', sort_order: 1 },
                { id: 't-rev', name: 'In Review', category: 'IN_PROGRESS', sort_order: 2 },
                { id: 't-done', name: 'Done', category: 'DONE', sort_order: 3 },
            ]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BoardColumnsService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectSettingsService, useValue: settings },
            ],
        }).compile();
        service = module.get(BoardColumnsService);
    });

    it('seeds a new board from the tenant status template', async () => {
        await service.seedColumnsForNewBoard(tenantId, 'b1');

        expect(settings.listTaskStatuses).toHaveBeenCalledWith(tenantId, false);
        const rows = db.boardColumn.createMany.mock.calls[0][0].data;
        expect(rows.map((r: any) => r.name)).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
        expect(rows.every((r: any) => r.board_id === 'b1' && r.tenant_id === tenantId)).toBe(true);
    });

    it('binds every status of a project in one pass, not just one', async () => {
        settings.listTaskStatuses.mockResolvedValue([
            { id: 'p-todo', name: 'To Do', category: 'TODO', sort_order: 0 },
            { id: 'p-doing', name: 'Doing', category: 'IN_PROGRESS', sort_order: 1 },
            { id: 'p-done', name: 'Done', category: 'DONE', sort_order: 2 },
        ]);

        await service.bindProject(tenantId, 'b1', 'p1');

        // Assert the whole call, not just `.data`: `skipDuplicates` is the only
        // thing standing between two concurrent binds of the same project and a
        // violation of the (board_id, status_id) unique — losing it silently
        // would not fail any other test here.
        expect(db.boardColumnStatus.createMany).toHaveBeenCalledWith({
            data: [
                { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c1', status_id: 'p-todo' },
                { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c2', status_id: 'p-doing' },
                { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c4', status_id: 'p-done' },
            ],
            skipDuplicates: true,
        });
    });

    it('never overwrites a binding that already exists, so a manual override survives', async () => {
        settings.listTaskStatuses.mockResolvedValue([
            { id: 'p-todo', name: 'To Do', category: 'TODO', sort_order: 0 },
            { id: 'p-doing', name: 'Doing', category: 'IN_PROGRESS', sort_order: 1 },
        ]);
        db.boardColumnStatus.findMany.mockResolvedValue([
            { status_id: 'p-doing', board_column_id: 'c3' },
        ]);

        await service.bindProject(tenantId, 'b1', 'p1');

        // Same reasoning as the test above: check `skipDuplicates` reached
        // Prisma, not just the row data.
        expect(db.boardColumnStatus.createMany).toHaveBeenCalledWith({
            data: [
                { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c1', status_id: 'p-todo' },
            ],
            skipDuplicates: true,
        });
    });

    it('writes nothing when no status can be placed', async () => {
        db.boardColumn.findMany.mockResolvedValue([]);
        settings.listTaskStatuses.mockResolvedValue([
            { id: 'p-doing', name: 'Doing', category: 'IN_PROGRESS', sort_order: 0 },
        ]);

        await service.bindProject(tenantId, 'b1', 'p1');

        expect(db.boardColumnStatus.createMany).not.toHaveBeenCalled();
    });

    it('resolves a column to the bound status of the given project', async () => {
        db.boardColumnStatus.findMany.mockResolvedValue([
            { status_id: 'p-doing', board_column_id: 'c2', status: { id: 'p-doing', project_id: 'p1', sort_order: 3 } },
            { status_id: 'q-doing', board_column_id: 'c2', status: { id: 'q-doing', project_id: 'p2', sort_order: 0 } },
        ]);

        await expect(service.resolveStatusId(tenantId, 'b1', 'c2', 'p1')).resolves.toBe('p-doing');
        await expect(service.resolveStatusId(tenantId, 'b1', 'c2', 'p2')).resolves.toBe('q-doing');
    });

    it('picks the lowest sort_order when a column binds several statuses of one project', async () => {
        db.boardColumnStatus.findMany.mockResolvedValue([
            { status_id: 'p-b', board_column_id: 'c2', status: { id: 'p-b', project_id: 'p1', sort_order: 5 } },
            { status_id: 'p-a', board_column_id: 'c2', status: { id: 'p-a', project_id: 'p1', sort_order: 2 } },
        ]);

        await expect(service.resolveStatusId(tenantId, 'b1', 'c2', 'p1')).resolves.toBe('p-a');
    });

    it('resolves to null when the column has no binding for that project', async () => {
        db.boardColumnStatus.findMany.mockResolvedValue([]);
        await expect(service.resolveStatusId(tenantId, 'b1', 'c2', 'p9')).resolves.toBeNull();
    });

    it('refuses a board belonging to another tenant', async () => {
        db.board.findFirst.mockResolvedValue(null);
        await expect(service.listColumns('other', 'b1')).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('BoardColumnsService column CRUD', () => {
    let service: BoardColumnsService;
    let db: any;

    const tenantId = 't1';

    beforeEach(async () => {
        db = {
            board: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', tenant_id: tenantId }) },
            boardColumn: {
                findMany: jest.fn().mockResolvedValue(COLUMNS.map((c) => ({ ...c, board_id: 'b1' }))),
                findFirst: jest.fn().mockResolvedValue({ id: 'c2', board_id: 'b1', tenant_id: tenantId }),
                create: jest.fn().mockResolvedValue({ id: 'c9' }),
                update: jest.fn().mockResolvedValue({ id: 'c2' }),
                delete: jest.fn().mockResolvedValue({ id: 'c2' }),
                aggregate: jest.fn().mockResolvedValue({ _max: { sort_order: 3 } }),
            },
            boardColumnStatus: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
            projectTaskStatus: {
                findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BoardColumnsService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectSettingsService, useValue: { listTaskStatuses: jest.fn() } },
            ],
        }).compile();
        service = module.get(BoardColumnsService);
    });

    it('appends a new column after the last one when no sortOrder is given', async () => {
        await service.createColumn(tenantId, 'b1', { name: 'Blocked', category: 'TODO' });

        expect(db.boardColumn.create).toHaveBeenCalledWith({
            data: {
                tenant_id: tenantId,
                board_id: 'b1',
                name: 'Blocked',
                category: 'TODO',
                sort_order: 4,
                wip_limit: null,
            },
        });
    });

    it('replaces a column’s bindings wholesale', async () => {
        await service.setBindings(tenantId, 'b1', 'c2', ['s1', 's2']);

        expect(db.boardColumnStatus.deleteMany).toHaveBeenCalledWith({
            where: { board_id: 'b1', tenant_id: tenantId, board_column_id: 'c2' },
        });
        expect(db.boardColumnStatus.createMany).toHaveBeenCalledWith({
            data: [
                { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c2', status_id: 's1' },
                { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c2', status_id: 's2' },
            ],
            skipDuplicates: true,
        });
    });

    it('steals a status from whichever other column on this board held it', async () => {
        await service.setBindings(tenantId, 'b1', 'c2', ['s1']);

        // A status may sit in only one column per board, so binding it here must
        // clear it elsewhere or the (board_id, status_id) unique rejects the write.
        expect(db.boardColumnStatus.deleteMany).toHaveBeenCalledWith({
            where: { board_id: 'b1', tenant_id: tenantId, status_id: { in: ['s1'] } },
        });
    });

    it('rejects a status id that is not a real status in this tenant', async () => {
        db.projectTaskStatus.findMany.mockResolvedValue([{ id: 's1' }]);
        await expect(service.setBindings(tenantId, 'b1', 'c2', ['s1', 'ghost'])).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it('refuses to touch a column belonging to a different board', async () => {
        db.boardColumn.findFirst.mockResolvedValue(null);
        await expect(service.deleteColumn(tenantId, 'b1', 'c2')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes a column that belongs to this board', async () => {
        await service.deleteColumn(tenantId, 'b1', 'c2');
        expect(db.boardColumn.delete).toHaveBeenCalledWith({ where: { id: 'c2' } });
    });

    it('uses the given sortOrder instead of appending after the last column', async () => {
        await service.createColumn(tenantId, 'b1', { name: 'Blocked', category: 'TODO', sortOrder: 0 });

        expect(db.boardColumn.aggregate).not.toHaveBeenCalled();
        expect(db.boardColumn.create).toHaveBeenCalledWith({
            data: {
                tenant_id: tenantId,
                board_id: 'b1',
                name: 'Blocked',
                category: 'TODO',
                sort_order: 0,
                wip_limit: null,
            },
        });
    });

    it('constrains the status lookup in setBindings to this tenant', async () => {
        await service.setBindings(tenantId, 'b1', 'c2', ['s1', 's2']);

        expect(db.projectTaskStatus.findMany).toHaveBeenCalledWith({
            where: { id: { in: ['s1', 's2'] }, tenant_id: tenantId },
            select: { id: true },
        });
    });

    it('maps every updateColumn field to its snake_case column', async () => {
        await service.updateColumn(tenantId, 'b1', 'c2', {
            name: 'Renamed',
            category: 'DONE',
            sortOrder: 2,
            wipLimit: 5,
        });

        expect(db.boardColumn.update).toHaveBeenCalledWith({
            where: { id: 'c2' },
            data: {
                name: 'Renamed',
                category: 'DONE',
                sort_order: 2,
                wip_limit: 5,
            },
        });
    });

    it('omits fields that were not supplied rather than sending them as undefined', async () => {
        await service.updateColumn(tenantId, 'b1', 'c2', { name: 'Renamed' });

        expect(db.boardColumn.update).toHaveBeenCalledWith({
            where: { id: 'c2' },
            data: { name: 'Renamed' },
        });
        const data = db.boardColumn.update.mock.calls[0][0].data;
        expect(Object.keys(data)).toEqual(['name']);
    });

    it('clears a WIP limit by sending wip_limit: null, not by dropping the field', async () => {
        await service.updateColumn(tenantId, 'b1', 'c2', { wipLimit: null });

        expect(db.boardColumn.update).toHaveBeenCalledWith({
            where: { id: 'c2' },
            data: { wip_limit: null },
        });
    });

    it('refuses to update a column belonging to a different board', async () => {
        db.boardColumn.findFirst.mockResolvedValue(null);
        await expect(service.updateColumn(tenantId, 'b1', 'c2', { name: 'X' })).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });
});
