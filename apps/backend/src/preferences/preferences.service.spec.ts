import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_ALERT_PREFS, DEFAULT_INVOICE_PRINT_PREFS } from '@erp71/shared-types';
import { PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
    const db: any = {
        tenantUser: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        preferenceProfile: { findFirst: jest.fn() },
        userAlertPreference: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    };
    const service = new PreferencesService(db);
    const membership = { tenant_id_user_id: { tenant_id: 't1', user_id: 'u1' } };

    const profile = (sections: object, extra: object = {}) => ({
        id: 'p1',
        name: 'Cashier starter',
        prefs: { version: 1, sections },
        ...extra,
    });
    const member = (overrides: object = {}) => ({
        invoice_print_prefs: null,
        preferences: null,
        legacy_browser_sections: [],
        tenantRole: { preferenceProfile: null },
        ...overrides,
    });

    beforeEach(() => {
        jest.resetAllMocks();
        db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
        db.$queryRaw.mockResolvedValue([]);
        db.tenantUser.findUnique.mockResolvedValue(member());
        db.tenantUser.findMany.mockResolvedValue([]);
        db.tenantUser.update.mockResolvedValue({});
        db.tenantUser.updateMany.mockResolvedValue({ count: 0 });
        db.preferenceProfile.findFirst.mockResolvedValue(null);
        db.userAlertPreference.findUnique.mockResolvedValue(null);
        db.userAlertPreference.upsert.mockResolvedValue({});
        db.userAlertPreference.deleteMany.mockResolvedValue({ count: 0 });
    });

    describe('profileFor', () => {
        it("uses the primary role's profile", async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ tenantRole: { preferenceProfile: profile({ sidebar: { appShellOpenGroups: ['sales'] } }) } }),
            );

            await expect(service.profileFor('t1', 'u1')).resolves.toEqual({
                id: 'p1',
                name: 'Cashier starter',
                prefs: { version: 1, sections: { sidebar: { appShellOpenGroups: ['sales'] } } },
            });
            expect(db.tenantUser.findUnique).toHaveBeenCalledWith({
                where: membership,
                select: expect.objectContaining({
                    tenantRole: { select: { preferenceProfile: true } },
                }),
            });
            expect(db.preferenceProfile.findFirst).not.toHaveBeenCalled();
        });

        it('falls back to the default profile when the role has none', async () => {
            db.preferenceProfile.findFirst.mockResolvedValue(profile({}, { id: 'pd', name: 'Everyone' }));

            await expect(service.profileFor('t1', 'u1')).resolves.toMatchObject({ id: 'pd', name: 'Everyone' });
            expect(db.preferenceProfile.findFirst).toHaveBeenCalledWith({
                where: { tenant_id: 't1', is_default: true },
            });
        });

        it('falls back to the default profile when the member has no role', async () => {
            db.tenantUser.findUnique.mockResolvedValue(member({ tenantRole: null }));
            db.preferenceProfile.findFirst.mockResolvedValue(profile({}, { id: 'pd', name: 'Everyone' }));

            await expect(service.profileFor('t1', 'u1')).resolves.toMatchObject({ id: 'pd' });
        });

        it('returns null when there is neither', async () => {
            await expect(service.profileFor('t1', 'u1')).resolves.toBeNull();
        });

        it('normalises what the profile holds', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ tenantRole: { preferenceProfile: profile({ sidebar: 'junk', device: { paperSize: 'A3' } }) } }),
            );
            await expect(service.profileFor('t1', 'u1')).resolves.toMatchObject({ prefs: { version: 1, sections: {} } });
        });
    });

    describe('resolveFor', () => {
        it('gives the built-in values to a member with nothing set and no profile', async () => {
            const result = await service.resolveFor('t1', 'u1');
            expect(result.profile).toBeNull();
            expect(result.legacy_browser_sections).toEqual([]);
            expect(result.sections.invoicePrint).toEqual({ value: DEFAULT_INVOICE_PRINT_PREFS, source: 'default' });
            expect(result.sections.alerts).toEqual({ value: DEFAULT_ALERT_PREFS, source: 'default' });
        });

        it('lists legacy_browser_sections', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ legacy_browser_sections: ['tableView', 'sidebar', 'bogus'] }),
            );
            const result = await service.resolveFor('t1', 'u1');
            expect(result.legacy_browser_sections).toEqual(['tableView', 'sidebar']);
        });

        it("reads the alert row as the member's whole answer", async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ tenantRole: { preferenceProfile: profile({ alerts: { mutedTypes: ['LOW_STOCK'], quiet: { from: 60 } } }) } }),
            );
            db.userAlertPreference.findUnique.mockResolvedValue({
                muted_types: [],
                quiet_enabled: false,
                quiet_from: 1320,
                quiet_to: 480,
            });

            const { sections } = await service.resolveFor('t1', 'u1');
            expect(sections.alerts).toEqual({
                value: { mutedTypes: [], quiet: { enabled: false, from: 1320, to: 480 } },
                source: 'member',
            });
            expect(db.userAlertPreference.findUnique).toHaveBeenCalledWith({
                where: { user_id_tenant_id: { user_id: 'u1', tenant_id: 't1' } },
            });
        });

        it('no alert row → profile alerts', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ tenantRole: { preferenceProfile: profile({ alerts: { mutedTypes: ['LOW_STOCK'], quiet: { from: 60 } } }) } }),
            );
            const { sections, profile: summary } = await service.resolveFor('t1', 'u1');
            expect(summary).toEqual({ id: 'p1', name: 'Cashier starter' });
            expect(sections.alerts).toEqual({
                value: { mutedTypes: ['LOW_STOCK'], quiet: { enabled: true, from: 60, to: 480 } },
                source: 'profile',
            });
        });

        it('device carries only profile-set fields', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ tenantRole: { preferenceProfile: profile({ device: { paperSize: 'Thermal80' } }) } }),
            );
            const { sections } = await service.resolveFor('t1', 'u1');
            expect(sections.device).toEqual({ value: { paperSize: 'Thermal80' }, source: 'profile' });
        });

        it("reads the member's own invoice layout and saved columns over the profile", async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({
                    invoice_print_prefs: { version: 1, padding: 'wide' },
                    preferences: { version: 1, tableColumns: { 'sales.list': { hidden: ['tax'] } } },
                    tenantRole: {
                        preferenceProfile: profile({
                            invoicePrint: { padding: 'compact', balance: 'never' },
                            tableColumns: { 'sales.list': { pageSize: 50 } },
                        }),
                    },
                }),
            );
            const { sections } = await service.resolveFor('t1', 'u1');
            expect(sections.invoicePrint).toMatchObject({
                value: { padding: 'wide', balance: 'never' },
                source: 'member',
            });
            expect(sections.tableColumns).toEqual({
                value: { 'sales.list': { hidden: ['tax'] } },
                source: 'member',
            });
        });

        it('NotFoundException for a non-member', async () => {
            db.tenantUser.findUnique.mockResolvedValue(null);
            await expect(service.resolveFor('t1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('saveSection', () => {
        it('invoicePrint stores only the submitted fields onto the stored layer', async () => {
            db.tenantUser.findUnique.mockResolvedValue(member({ invoice_print_prefs: { version: 1, padding: 'wide' } }));

            await service.saveSection('t1', 'u1', 'invoicePrint', { footer_text: null });

            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: membership,
                data: { invoice_print_prefs: { padding: 'wide', footer_text: null } },
            });
        });

        it('invoicePrint drops fields it cannot read instead of storing them', async () => {
            await service.saveSection('t1', 'u1', 'invoicePrint', { padding: 'huge', bogus: 1, balance: 'never' });
            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: membership,
                data: { invoice_print_prefs: { balance: 'never' } },
            });
        });

        it('returns the resolved section', async () => {
            db.tenantUser.findUnique
                .mockResolvedValueOnce(member())
                .mockResolvedValue(member({ invoice_print_prefs: { balance: 'never' } }));
            const saved = await service.saveSection('t1', 'u1', 'invoicePrint', { balance: 'never' });
            expect(saved.source).toBe('member');
            expect(saved.value).toMatchObject({ balance: 'never' });
        });

        it('tableColumns replaces one list and deletes on null', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({
                    preferences: {
                        version: 1,
                        tableColumns: { 'sales.list': { hidden: ['a'], order: ['b'] }, 'products.list': { hidden: ['c'] } },
                    },
                    legacy_browser_sections: ['tableColumns', 'sidebar'],
                }),
            );

            await service.saveSection('t1', 'u1', 'tableColumns', {
                'sales.list': { pageSize: 25 },
                'products.list': null,
                'bad id!': { hidden: ['x'] },
            });

            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: membership,
                data: {
                    preferences: { version: 1, tableColumns: { 'sales.list': { pageSize: 25 } } },
                    legacy_browser_sections: ['sidebar'],
                },
            });
        });

        it('tableView merges global field by field and replaces or deletes single lists', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({
                    preferences: {
                        version: 1,
                        tableView: {
                            global: { density: 'compact', striped: false },
                            tables: { a: { density: 'cozy', fontSize: 'lg' }, b: { density: 'cozy' } },
                        },
                    },
                }),
            );

            await service.saveSection('t1', 'u1', 'tableView', {
                global: { fontSize: 'sm' },
                tables: { a: { striped: true }, b: null },
            });

            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: membership,
                data: {
                    preferences: {
                        version: 1,
                        tableView: {
                            global: { density: 'compact', striped: false, fontSize: 'sm' },
                            tables: { a: { striped: true } },
                        },
                    },
                    legacy_browser_sections: [],
                },
            });
        });

        it('sidebar replaces the open groups and leaves other sections alone', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({
                    preferences: { version: 1, sidebar: { appShellOpenGroups: ['a'] }, tableColumns: { x: { hidden: ['q'] } } },
                }),
            );
            await service.saveSection('t1', 'u1', 'sidebar', { appShellOpenGroups: ['b', 'c'] });
            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: membership,
                data: {
                    preferences: {
                        version: 1,
                        tableColumns: { x: { hidden: ['q'] } },
                        sidebar: { appShellOpenGroups: ['b', 'c'] },
                    },
                    legacy_browser_sections: [],
                },
            });
        });

        it('sidebar refuses a body without a list of groups', async () => {
            await expect(service.saveSection('t1', 'u1', 'sidebar', { appShellOpenGroups: 'a' })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.tenantUser.update).not.toHaveBeenCalled();
        });

        it('locks the TenantUser row before writing preferences', async () => {
            await service.saveSection('t1', 'u1', 'sidebar', { appShellOpenGroups: ['a'] });
            expect(db.$queryRaw).toHaveBeenCalledTimes(1);
            expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.tenantUser.update.mock.invocationCallOrder[0]);
        });

        it('removes the section from legacy_browser_sections', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ legacy_browser_sections: ['tableView', 'tableColumns', 'sidebar'] }),
            );
            await service.saveSection('t1', 'u1', 'sidebar', { appShellOpenGroups: ['a'] });
            expect(db.tenantUser.update.mock.calls[0][0].data.legacy_browser_sections).toEqual(['tableView', 'tableColumns']);
        });

        it('alerts upserts the row starting from the resolved values', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ tenantRole: { preferenceProfile: profile({ alerts: { quiet: { from: 60, to: 120 } } }) } }),
            );

            await service.saveSection('t1', 'u1', 'alerts', { mutedTypes: ['LOW_STOCK', 'NOT_A_TYPE'], quiet: { enabled: false } });

            const row = { muted_types: ['LOW_STOCK'], quiet_enabled: false, quiet_from: 60, quiet_to: 120 };
            expect(db.userAlertPreference.upsert).toHaveBeenCalledWith({
                where: { user_id_tenant_id: { user_id: 'u1', tenant_id: 't1' } },
                create: { user_id: 'u1', tenant_id: 't1', ...row },
                update: row,
            });
            expect(db.tenantUser.update).not.toHaveBeenCalled();
        });

        it('alerts keeps the existing row for fields the body does not carry', async () => {
            db.userAlertPreference.findUnique.mockResolvedValue({
                muted_types: ['LARGE_SALE'],
                quiet_enabled: true,
                quiet_from: 100,
                quiet_to: 200,
            });
            await service.saveSection('t1', 'u1', 'alerts', { quiet: { to: 300 } });
            expect(db.userAlertPreference.upsert.mock.calls[0][0].update).toEqual({
                muted_types: ['LARGE_SALE'],
                quiet_enabled: true,
                quiet_from: 100,
                quiet_to: 300,
            });
        });

        it('device → BadRequestException', async () => {
            await expect(service.saveSection('t1', 'u1', 'device' as any, { paperSize: 'A4' })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('an unknown key → BadRequestException', async () => {
            await expect(service.saveSection('t1', 'u1', 'nope' as any, {})).rejects.toBeInstanceOf(BadRequestException);
        });

        it('refuses a body that is not an object', async () => {
            await expect(service.saveSection('t1', 'u1', 'tableColumns', [] as any)).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });

        it('NotFoundException for a non-member', async () => {
            db.tenantUser.findUnique.mockResolvedValue(null);
            await expect(service.saveSection('t1', 'u1', 'sidebar', { appShellOpenGroups: [] })).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('resetSection', () => {
        beforeEach(() => {
            db.tenantUser.findMany.mockResolvedValue([
                { user_id: 'u1', preferences: null, legacy_browser_sections: [] },
            ]);
        });

        it('invoicePrint → invoice_print_prefs set to Prisma.DbNull', async () => {
            await service.resetSection('t1', 'u1', 'invoicePrint');
            expect(db.tenantUser.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', user_id: { in: ['u1'] } },
                data: { invoice_print_prefs: Prisma.DbNull },
            });
        });

        it('alerts → row deleted', async () => {
            await service.resetSection('t1', 'u1', 'alerts');
            expect(db.userAlertPreference.deleteMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', user_id: { in: ['u1'] } },
            });
        });

        it('tableView → key removed and section taken off the legacy list', async () => {
            db.tenantUser.findMany.mockResolvedValue([
                {
                    user_id: 'u1',
                    preferences: { version: 1, tableView: { global: { density: 'cozy' } }, sidebar: { appShellOpenGroups: ['a'] } },
                    legacy_browser_sections: ['tableView', 'sidebar'],
                },
            ]);
            await service.resetSection('t1', 'u1', 'tableView');
            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: membership,
                data: {
                    preferences: { version: 1, sidebar: { appShellOpenGroups: ['a'] } },
                    legacy_browser_sections: ['sidebar'],
                },
            });
        });

        it('locks the row first, and 404s for a non-member', async () => {
            db.tenantUser.findMany.mockResolvedValue([]);
            await expect(service.resetSection('t1', 'u1', 'tableView')).rejects.toBeInstanceOf(NotFoundException);
            expect(db.$queryRaw).toHaveBeenCalled();
        });

        it('device → BadRequestException', async () => {
            await expect(service.resetSection('t1', 'u1', 'device' as any)).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('clearSections', () => {
        it('removes only the listed sections for the listed members of the tenant', async () => {
            db.tenantUser.findMany.mockResolvedValue([
                {
                    user_id: 'u1',
                    preferences: { version: 1, tableView: { global: { density: 'cozy' } }, sidebar: { appShellOpenGroups: ['a'] } },
                    legacy_browser_sections: ['tableView', 'tableColumns', 'sidebar'],
                },
                {
                    user_id: 'u2',
                    preferences: { version: 1, tableColumns: { x: { hidden: ['q'] } } },
                    legacy_browser_sections: ['tableColumns'],
                },
                // Nothing to remove: must not be written to.
                { user_id: 'u3', preferences: { version: 1, sidebar: { appShellOpenGroups: ['z'] } }, legacy_browser_sections: [] },
            ]);

            const touched = await service.clearSections(db, 't1', ['u1', 'u2', 'u3'], ['invoicePrint', 'alerts', 'tableView', 'tableColumns']);

            expect(touched).toBe(3);
            expect(db.tenantUser.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', user_id: { in: ['u1', 'u2', 'u3'] } },
                data: { invoice_print_prefs: Prisma.DbNull },
            });
            expect(db.userAlertPreference.deleteMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', user_id: { in: ['u1', 'u2', 'u3'] } },
            });
            expect(db.tenantUser.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', user_id: { in: ['u1', 'u2', 'u3'] } },
                select: { user_id: true, preferences: true, legacy_browser_sections: true },
            });
            expect(db.tenantUser.update).toHaveBeenCalledTimes(2);
            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: { tenant_id_user_id: { tenant_id: 't1', user_id: 'u1' } },
                data: {
                    preferences: { version: 1, sidebar: { appShellOpenGroups: ['a'] } },
                    legacy_browser_sections: ['sidebar'],
                },
            });
            // Nothing left of u2's answers: the column goes back to null.
            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: { tenant_id_user_id: { tenant_id: 't1', user_id: 'u2' } },
                data: { preferences: Prisma.DbNull, legacy_browser_sections: [] },
            });
        });

        it('leaves the invoice layout and alert rows alone when those sections are not listed', async () => {
            await service.clearSections(db, 't1', ['u1'], ['sidebar']);
            expect(db.tenantUser.updateMany).not.toHaveBeenCalled();
            expect(db.userAlertPreference.deleteMany).not.toHaveBeenCalled();
        });

        it('does nothing for no members or no sections', async () => {
            await expect(service.clearSections(db, 't1', [], ['sidebar'])).resolves.toBe(0);
            await expect(service.clearSections(db, 't1', ['u1'], [])).resolves.toBe(0);
            expect(db.tenantUser.findMany).not.toHaveBeenCalled();
        });
    });
});
