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

        const rows = db.boardColumnStatus.createMany.mock.calls[0][0].data;
        expect(rows).toEqual([
            { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c1', status_id: 'p-todo' },
            { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c2', status_id: 'p-doing' },
            { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c4', status_id: 'p-done' },
        ]);
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

        const rows = db.boardColumnStatus.createMany.mock.calls[0][0].data;
        expect(rows).toEqual([
            { tenant_id: tenantId, board_id: 'b1', board_column_id: 'c1', status_id: 'p-todo' },
        ]);
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
