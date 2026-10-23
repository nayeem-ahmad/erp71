import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PreferenceProfilesService } from './preference-profiles.service';
import { PreferencesService } from './preferences.service';

describe('PreferenceProfilesService', () => {
    const db: any = {
        preferenceProfile: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            delete: jest.fn(),
        },
        tenantUser: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        tenantRole: { updateMany: jest.fn() },
        userAlertPreference: { deleteMany: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    };
    const audit: any = { log: jest.fn() };
    const service = new PreferenceProfilesService(db, new PreferencesService(db), audit);
    const ctx: any = { tenantId: 't1', userId: 'admin', userRole: 'OWNER', timezone: 'UTC' };

    const row = (overrides: object = {}) => ({
        id: 'p1',
        tenant_id: 't1',
        name: 'Cashier starter',
        is_default: false,
        prefs: { version: 1, sections: {} },
        created_at: new Date('2026-10-01T00:00:00Z'),
        updated_at: new Date('2026-10-02T03:04:05Z'),
        updated_by: 'admin',
        roles: [],
        ...overrides,
    });
    const duplicate = () =>
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
        });

    beforeEach(() => {
        jest.resetAllMocks();
        db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
        db.$queryRaw.mockResolvedValue([]);
        db.preferenceProfile.findMany.mockResolvedValue([]);
        db.preferenceProfile.findFirst.mockResolvedValue(row());
        db.preferenceProfile.create.mockImplementation(async ({ data }: any) => row({ ...data, id: 'new' }));
        db.preferenceProfile.update.mockImplementation(async ({ data }: any) => row(data));
        db.preferenceProfile.updateMany.mockResolvedValue({ count: 0 });
        db.preferenceProfile.delete.mockResolvedValue(row());
        db.tenantUser.findMany.mockResolvedValue([]);
        db.tenantUser.update.mockResolvedValue({});
        db.tenantUser.updateMany.mockResolvedValue({ count: 0 });
        db.userAlertPreference.deleteMany.mockResolvedValue({ count: 0 });
        audit.log.mockResolvedValue(undefined);
    });

    describe('list and get', () => {
        it('lists the tenant profiles with the roles that use them', async () => {
            db.preferenceProfile.findMany.mockResolvedValue([row({ roles: [{ id: 'r1', name: 'Cashier' }] })]);

            await expect(service.list('t1')).resolves.toEqual([
                {
                    id: 'p1',
                    name: 'Cashier starter',
                    is_default: false,
                    roles: [{ id: 'r1', name: 'Cashier' }],
                    updated_at: '2026-10-02T03:04:05.000Z',
                },
            ]);
            expect(db.preferenceProfile.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: 't1' } }),
            );
        });

        it('gets one with its sections', async () => {
            db.preferenceProfile.findFirst.mockResolvedValue(
                row({ prefs: { version: 1, sections: { sidebar: { appShellOpenGroups: ['sales'] } } } }),
            );

            const detail = await service.get('t1', 'p1');

            expect(detail.sections).toEqual({ sidebar: { appShellOpenGroups: ['sales'] } });
            expect(db.preferenceProfile.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'p1', tenant_id: 't1' } }),
            );
        });

        it('a foreign id is a NotFoundException', async () => {
            db.preferenceProfile.findFirst.mockResolvedValue(null);

            await expect(service.get('t1', 'other')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('create', () => {
        it('create normalises sections and drops unknown keys', async () => {
            await service.create(ctx, {
                name: '  Cashier starter ',
                sections: {
                    sidebar: { appShellOpenGroups: ['sales', 'bad id!'] },
                    bogus: { a: 1 },
                    alerts: 'junk',
                },
            });

            const data = db.preferenceProfile.create.mock.calls[0][0].data;
            expect(data).toMatchObject({
                tenant_id: 't1',
                name: 'Cashier starter',
                is_default: false,
                updated_by: 'admin',
            });
            expect(data.prefs).toEqual({ version: 1, sections: { sidebar: { appShellOpenGroups: ['sales'] } } });
        });

        it('a duplicate name -> ConflictException', async () => {
            db.preferenceProfile.create.mockRejectedValue(duplicate());

            await expect(service.create(ctx, { name: 'Cashier starter' })).rejects.toBeInstanceOf(ConflictException);
            expect(audit.log).not.toHaveBeenCalled();
        });

        it('rejects a blank name', async () => {
            await expect(service.create(ctx, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
            expect(db.preferenceProfile.create).not.toHaveBeenCalled();
        });
    });

    describe('update', () => {
        it('setting is_default clears it on the others in one transaction', async () => {
            await service.update(ctx, 'p1', { is_default: true });

            expect(db.$transaction).toHaveBeenCalledTimes(1);
            expect(db.preferenceProfile.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', is_default: true, id: { not: 'p1' } },
                data: { is_default: false },
            });
            expect(db.preferenceProfile.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ is_default: true }) }),
            );
        });

        it('setting is_default on create clears the others too', async () => {
            await service.create(ctx, { name: 'Everyone', is_default: true });

            expect(db.preferenceProfile.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', is_default: true },
                data: { is_default: false },
            });
        });

        it('a section set to null is removed, others are replaced, the rest kept', async () => {
            db.preferenceProfile.findFirst.mockResolvedValue(
                row({
                    prefs: {
                        version: 1,
                        sections: {
                            sidebar: { appShellOpenGroups: ['sales'] },
                            tableColumns: { orders: { pageSize: 25 } },
                            alerts: { mutedTypes: ['LOW_STOCK'] },
                        },
                    },
                }),
            );

            await service.update(ctx, 'p1', {
                sections: { sidebar: null, tableColumns: { orders: { pageSize: 50 } }, bogus: { x: 1 } },
            });

            const data = db.preferenceProfile.update.mock.calls[0][0].data;
            expect(data.prefs.sections.sidebar).toBeUndefined();
            expect(data.prefs.sections.tableColumns).toEqual({ orders: { pageSize: 50 } });
            expect(data.prefs.sections.alerts).toEqual({ mutedTypes: ['LOW_STOCK'] });
            expect(data.prefs.sections.bogus).toBeUndefined();
            expect(data.updated_by).toBe('admin');
        });

        it('a foreign id is a NotFoundException', async () => {
            db.preferenceProfile.findFirst.mockResolvedValue(null);

            await expect(service.update(ctx, 'other', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
            expect(db.preferenceProfile.update).not.toHaveBeenCalled();
        });

        it('a clashing rename -> ConflictException', async () => {
            db.preferenceProfile.update.mockRejectedValue(duplicate());

            await expect(service.update(ctx, 'p1', { name: 'Taken' })).rejects.toBeInstanceOf(ConflictException);
        });
    });

    describe('remove', () => {
        it('delete leaves roles to fall back', async () => {
            await expect(service.remove(ctx, 'p1')).resolves.toEqual({ success: true });

            expect(db.preferenceProfile.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
            expect(db.tenantRole.updateMany).not.toHaveBeenCalled();
            expect(db.tenantUser.update).not.toHaveBeenCalled();
            expect(db.tenantUser.updateMany).not.toHaveBeenCalled();
        });

        it('a foreign id is a NotFoundException', async () => {
            db.preferenceProfile.findFirst.mockResolvedValue(null);

            await expect(service.remove(ctx, 'other')).rejects.toBeInstanceOf(NotFoundException);
            expect(db.preferenceProfile.delete).not.toHaveBeenCalled();
        });
    });

    describe('apply', () => {
        const targets = (...ids: string[]) => db.tenantUser.findMany.mockResolvedValueOnce(ids.map((user_id) => ({ user_id })));

        it('apply without user_ids targets members whose primary role uses this profile', async () => {
            targets('u1', 'u2');

            await service.apply(ctx, 'p1', { sections: ['sidebar'] });

            const where = db.tenantUser.findMany.mock.calls[0][0].where;
            expect(where.tenant_id).toBe('t1');
            expect(where.OR).toEqual([{ tenantRole: { preference_profile_id: 'p1' } }]);
        });

        it('apply on the default profile also targets members whose role has none and members with no role', async () => {
            db.preferenceProfile.findFirst.mockResolvedValue(row({ is_default: true }));
            targets('u1');

            await service.apply(ctx, 'p1', { sections: ['sidebar'] });

            const where = db.tenantUser.findMany.mock.calls[0][0].where;
            expect(where.OR).toEqual([
                { tenantRole: { preference_profile_id: 'p1' } },
                { tenant_role_id: null },
                { tenantRole: { preference_profile_id: null } },
            ]);
        });

        it('apply never targets the caller unless listed', async () => {
            targets('u1');
            await service.apply(ctx, 'p1', { sections: ['sidebar'] });
            expect(db.tenantUser.findMany.mock.calls[0][0].where.user_id).toEqual({ not: 'admin' });

            targets('admin');
            await service.apply(ctx, 'p1', { sections: ['sidebar'], user_ids: ['admin', 'u1'] });
            const listed = db.tenantUser.findMany.mock.calls[2][0].where;
            expect(listed.user_id).toEqual({ in: ['admin', 'u1'] });
            expect(listed.OR).toBeUndefined();
        });

        it('apply with user_ids ignores ids outside the tenant', async () => {
            // Only u1 is a member of t1; the lookup is tenant-scoped, so 'stranger' is not returned.
            targets('u1');
            db.tenantUser.findMany.mockResolvedValueOnce([{ user_id: 'u1', preferences: null, legacy_browser_sections: [] }]);

            const result = await service.apply(ctx, 'p1', { sections: ['sidebar'], user_ids: ['u1', 'stranger', 'u1'] });

            expect(db.tenantUser.findMany.mock.calls[0][0].where).toMatchObject({
                tenant_id: 't1',
                user_id: { in: ['u1', 'stranger'] },
            });
            const lock = db.$queryRaw.mock.calls[0];
            expect(lock).toBeDefined();
            expect(lock.slice(1)).toContainEqual(['u1']);
            expect(lock.slice(1)).not.toContainEqual(['u1', 'stranger']);
            expect(result).toEqual({ updated: 1 });
            expect(audit.log.mock.calls[0][4]).toMatchObject({ user_ids: ['u1'] });
        });

        it('apply clears invoice_print_prefs, deletes alert rows, removes preference keys and legacy entries only for the chosen sections', async () => {
            targets('u1', 'u2');
            // clearSections reads the locked members once, via the same findMany.
            db.tenantUser.findMany.mockResolvedValueOnce([
                {
                    user_id: 'u1',
                    preferences: { version: 1, sidebar: { appShellOpenGroups: ['sales'] }, tableColumns: { orders: { pageSize: 25 } } },
                    legacy_browser_sections: ['sidebar', 'tableColumns'],
                },
                { user_id: 'u2', preferences: null, legacy_browser_sections: [] },
            ]);

            const result = await service.apply(ctx, 'p1', { sections: ['invoicePrint', 'alerts', 'sidebar'] });

            expect(db.$transaction).toHaveBeenCalledTimes(1);
            expect(db.tenantUser.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', user_id: { in: ['u1', 'u2'] } },
                data: { invoice_print_prefs: Prisma.DbNull },
            });
            expect(db.userAlertPreference.deleteMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', user_id: { in: ['u1', 'u2'] } },
            });
            expect(db.tenantUser.update).toHaveBeenCalledTimes(1);
            const written = db.tenantUser.update.mock.calls[0][0];
            expect(written.data.preferences).toEqual({ version: 1, tableColumns: { orders: { pageSize: 25 } } });
            expect(written.data.legacy_browser_sections).toEqual(['tableColumns']);
            expect(result).toEqual({ updated: 2 });
        });

        it("apply rejects 'device'", async () => {
            await expect(service.apply(ctx, 'p1', { sections: ['device'] as any })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('apply refuses user_ids: null rather than widening to every member', async () => {
            await expect(
                service.apply(ctx, 'p1', { sections: ['sidebar'], user_ids: null as unknown as string[] }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.$transaction).not.toHaveBeenCalled();
            expect(db.tenantUser.findMany).not.toHaveBeenCalled();
        });

        it('apply rejects an empty section list', async () => {
            await expect(service.apply(ctx, 'p1', { sections: [] })).rejects.toBeInstanceOf(BadRequestException);
        });

        it('a foreign id is a NotFoundException', async () => {
            db.preferenceProfile.findFirst.mockResolvedValue(null);

            await expect(service.apply(ctx, 'other', { sections: ['sidebar'] })).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(db.$transaction).not.toHaveBeenCalled();
        });
    });

    describe('audit', () => {
        it('every write is audited', async () => {
            targets();
            await service.create(ctx, { name: 'A' });
            await service.update(ctx, 'p1', { name: 'B' });
            await service.apply(ctx, 'p1', { sections: ['sidebar', 'alerts'], user_ids: ['u1'] });
            await service.remove(ctx, 'p1');

            expect(audit.log.mock.calls.map((c: unknown[]) => c.slice(0, 4))).toEqual([
                ['PREFERENCE_PROFILE_CREATED', 'PreferenceProfile', { userId: 'admin', tenantId: 't1' }, 'new'],
                ['PREFERENCE_PROFILE_UPDATED', 'PreferenceProfile', { userId: 'admin', tenantId: 't1' }, 'p1'],
                ['PREFERENCE_PROFILE_APPLIED', 'PreferenceProfile', { userId: 'admin', tenantId: 't1' }, 'p1'],
                ['PREFERENCE_PROFILE_DELETED', 'PreferenceProfile', { userId: 'admin', tenantId: 't1' }, 'p1'],
            ]);
            expect(audit.log.mock.calls[2][4]).toEqual({ user_ids: [], sections: ['sidebar', 'alerts'] });
        });

        function targets() {
            db.tenantUser.findMany.mockResolvedValue([]);
        }
    });
});
