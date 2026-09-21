import { ProjectTasksService } from './project-tasks.service';

function makeDb() {
    return {
        project: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        projectCodeHistory: { findFirst: jest.fn().mockResolvedValue(null) },
        projectTask: { findFirst: jest.fn().mockResolvedValue(null) },
    };
}

function makeService(db: ReturnType<typeof makeDb>) {
    return new ProjectTasksService(db as never, {} as never, {} as never, {} as never, {} as never);
}

describe('resolving a task by key', () => {
    let db: ReturnType<typeof makeDb>;
    let service: ProjectTasksService;

    beforeEach(() => {
        db = makeDb();
        service = makeService(db);
    });

    it('resolves a current key', async () => {
        db.project.findFirst.mockResolvedValue({ id: 'p1', code: 'ERP' });
        db.projectTask.findFirst.mockResolvedValue({ id: 't1', reference: 14 });

        expect(await service.resolveTaskKey('tenant1', 'ERP-14')).toEqual({
            taskId: 't1',
            currentKey: 'ERP-14',
            moved: false,
        });
    });

    it('resolves a key naming a retired project code and reports the move', async () => {
        db.projectCodeHistory.findFirst.mockResolvedValue({ project_id: 'p1' });
        db.project.findUnique.mockResolvedValue({ id: 'p1', code: 'ERP' });
        db.projectTask.findFirst.mockResolvedValue({ id: 't1', reference: 14 });

        expect(await service.resolveTaskKey('tenant1', 'PRJ-0002-14')).toEqual({
            taskId: 't1',
            currentKey: 'ERP-14',
            moved: true,
        });
    });

    it('returns null for an unparseable key without touching the database', async () => {
        expect(await service.resolveTaskKey('tenant1', 'nonsense')).toBeNull();
        expect(db.project.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when the code matches nothing, rather than re-splitting', async () => {
        expect(await service.resolveTaskKey('tenant1', 'D1-BR3-7')).toBeNull();
    });

    it('returns null when the project exists but the reference does not', async () => {
        db.project.findFirst.mockResolvedValue({ id: 'p1', code: 'ERP' });
        expect(await service.resolveTaskKey('tenant1', 'ERP-999')).toBeNull();
    });

    it('scopes the project lookup to the tenant', async () => {
        // Two tenants each have a project coded PRJ-0002 in production, with
        // 655 and 82 tasks. An unscoped lookup resolves across workspaces.
        db.project.findFirst.mockResolvedValue({ id: 'p1', code: 'PRJ-0002' });
        db.projectTask.findFirst.mockResolvedValue({ id: 't1', reference: 14 });

        await service.resolveTaskKey('tenant1', 'PRJ-0002-14');

        expect(db.project.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant1', code: 'PRJ-0002' }),
            }),
        );
    });

    it('scopes the history lookup to the tenant too', async () => {
        db.projectCodeHistory.findFirst.mockResolvedValue(null);
        await service.resolveTaskKey('tenant1', 'OLD-1');

        expect(db.projectCodeHistory.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant1', code: 'OLD' }),
            }),
        );
    });
});

describe('numbering a new task', () => {
    let db: ReturnType<typeof makeDb>;
    let service: ProjectTasksService;

    beforeEach(() => {
        db = makeDb();
        service = makeService(db);
    });

    it('takes the next number from the highest, not from a count', async () => {
        // Deleting task 2 must not hand its number to the next task written:
        // two tasks called ERP-2 make every older note about one of them wrong.
        db.projectTask.findFirst.mockResolvedValue({ reference: 7 });
        expect(await service.nextReference('p1')).toBe(8);
    });

    it('starts at 1 in an empty project', async () => {
        expect(await service.nextReference('p1')).toBe(1);
    });
});
