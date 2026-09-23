import { ConflictException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const viewer = { tenantId: 't1', userId: 'u1' } as never;

function makeDb() {
    return {
        project: {
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'p1' }),
            update: jest.fn().mockResolvedValue({ id: 'p1' }),
        },
        projectCodeHistory: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
        },
    };
}

describe('choosing a project code', () => {
    let db: ReturnType<typeof makeDb>;
    let service: ProjectsService;

    beforeEach(() => {
        db = makeDb();
        service = new ProjectsService(db as never, {} as never, {} as never);
    });

    it('refuses a code another project already holds', async () => {
        db.project.findFirst.mockResolvedValue({ id: 'other' });
        await expect(service.assertCodeFree('t1', 'ERP')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a code held only by history, so an old task key keeps pointing at one project', async () => {
        db.projectCodeHistory.findFirst.mockResolvedValue({ project_id: 'other' });
        await expect(service.assertCodeFree('t1', 'PRJ-0002')).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts a code nobody holds', async () => {
        await expect(service.assertCodeFree('t1', 'ERP')).resolves.toBeUndefined();
    });

    it('lets a project keep its own code', async () => {
        // Renaming a project without changing its code must not collide with
        // itself.
        db.project.findFirst.mockResolvedValue({ id: 'p1' });
        await expect(service.assertCodeFree('t1', 'ERP', 'p1')).resolves.toBeUndefined();
    });

    it('scopes both checks to the tenant', async () => {
        // Codes are unique per tenant, not globally: two workspaces each hold
        // a PRJ-0002 in production.
        await service.assertCodeFree('t1', 'ERP');
        expect(db.project.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ tenant_id: 't1' }) }),
        );
        expect(db.projectCodeHistory.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ tenant_id: 't1' }) }),
        );
    });
});

describe('retiring a project code', () => {
    let db: ReturnType<typeof makeDb>;
    let service: ProjectsService;

    beforeEach(() => {
        db = makeDb();
        service = new ProjectsService(db as never, {} as never, {} as never);
    });

    it('writes the old code to history when it changes', async () => {
        await service.retireCode('t1', 'p1', 'PRJ-0002', 'ERP');
        expect(db.projectCodeHistory.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ tenant_id: 't1', project_id: 'p1', code: 'PRJ-0002' }),
            }),
        );
    });

    it('writes nothing when the code is unchanged', async () => {
        await service.retireCode('t1', 'p1', 'ERP', 'ERP');
        expect(db.projectCodeHistory.create).not.toHaveBeenCalled();
    });

    it('writes nothing when the project had no code', async () => {
        await service.retireCode('t1', 'p1', null, 'ERP');
        expect(db.projectCodeHistory.create).not.toHaveBeenCalled();
    });
});
