import { NotFoundException } from '@nestjs/common';
import { DEFAULT_INVOICE_PRINT_PREFS, normalizeInvoicePrintPrefs } from '@erp71/shared-types';
import { PreferencesService } from '../preferences/preferences.service';
import { SalesSettingsService } from './sales-settings.service';

describe('SalesSettingsService — member invoice print preferences', () => {
    // The real PreferencesService over a mocked database, so these cases pin what
    // a member actually gets back rather than how the two services call each other.
    const db: any = {
        tenantUser: { findUnique: jest.fn(), update: jest.fn() },
        preferenceProfile: { findFirst: jest.fn() },
        userAlertPreference: { findUnique: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    };
    const service = new SalesSettingsService(db, new PreferencesService(db));

    const membership = { tenant_id_user_id: { tenant_id: 't1', user_id: 'u1' } };
    const member = (invoice_print_prefs: unknown, preferenceProfile: unknown = null) => ({
        invoice_print_prefs,
        preferences: null,
        legacy_browser_sections: [],
        tenantRole: { preferenceProfile },
    });
    const profile = (invoicePrint: object) => ({
        id: 'p1',
        tenant_id: 't1',
        name: 'Cashier starter',
        prefs: { version: 1, sections: { invoicePrint } },
    });

    beforeEach(() => {
        jest.resetAllMocks();
        db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
        db.$queryRaw.mockResolvedValue([]);
        db.tenantUser.findUnique.mockResolvedValue(member(null));
        db.tenantUser.update.mockResolvedValue({});
        db.preferenceProfile.findFirst.mockResolvedValue(null);
        db.userAlertPreference.findUnique.mockResolvedValue(null);
    });

    describe('getMemberInvoicePrint', () => {
        it("reads the signed-in member's own row in this workspace", async () => {
            db.tenantUser.findUnique.mockResolvedValue(member({ version: 1, table_style: 'grid' }));

            await expect(service.getMemberInvoicePrint('t1', 'u1')).resolves.toEqual({
                ...DEFAULT_INVOICE_PRINT_PREFS,
                table_style: 'grid',
            });
            expect(db.tenantUser.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({ where: membership }),
            );
        });

        it('gives a member who never saved anything the built-in layout', async () => {
            await expect(service.getMemberInvoicePrint('t1', 'u1')).resolves.toEqual(
                DEFAULT_INVOICE_PRINT_PREFS,
            );
        });

        it("a new member gets the profile's layout", async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member(null, profile({ padding: 'wide', footer_text: 'Thanks!', signature_space_mm: 30 })),
            );

            await expect(service.getMemberInvoicePrint('t1', 'u1')).resolves.toEqual({
                ...DEFAULT_INVOICE_PRINT_PREFS,
                padding: 'wide',
                footer_text: 'Thanks!',
                signature_space_mm: 30,
            });
        });

        it('a filled-out pre-release blob wins over a profile that sets footer_text, table_borders and signature_space_mm', async () => {
            // KH Tradind: saved before those fields existed, then filled out.
            db.tenantUser.findUnique.mockResolvedValue(
                member(
                    {
                        version: 1,
                        padding: 'wide',
                        serial_column: true,
                        footer_text: 'Our own line',
                        table_borders: 'columns',
                        signature_space_mm: 20,
                    },
                    profile({ footer_text: 'Profile line', table_borders: 'none', signature_space_mm: 40 }),
                ),
            );

            await expect(service.getMemberInvoicePrint('t1', 'u1')).resolves.toMatchObject({
                padding: 'wide',
                serial_column: true,
                footer_text: 'Our own line',
                table_borders: 'columns',
                signature_space_mm: 20,
            });
        });

        it.each([
            ['a bare version', { version: 1 }],
            ['the legacy warranty switch', { version: 1, hide_empty_warranty: true }],
            ['an empty footer', { version: 1, footer_text: '' }],
            ['a null footer', { version: 1, footer_text: null }],
            ['a partly saved layout', { version: 1, padding: 'narrow', balance: 'never' }],
            [
                'a full set',
                {
                    version: 1,
                    layout: 'standard',
                    padding: 'wide',
                    balance: 'always',
                    table_style: 'grid',
                    amount_in_words: true,
                    serial_column: true,
                    signature_lines: true,
                    hide_empty_discount: true,
                    warranty_column: 'never',
                    table_borders: 'columns',
                    footer_text: 'Thank you for shopping',
                    signature_space_mm: 25,
                },
            ],
        ])('no profile → exactly normalizeInvoicePrintPrefs(stored): %s', async (_label, stored) => {
            db.tenantUser.findUnique.mockResolvedValue(member(stored));

            await expect(service.getMemberInvoicePrint('t1', 'u1')).resolves.toEqual(
                normalizeInvoicePrintPrefs(stored),
            );
        });

        it('refuses a user who is not a member of the workspace', async () => {
            db.tenantUser.findUnique.mockResolvedValue(null);
            await expect(service.getMemberInvoicePrint('t1', 'u1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('updateMemberInvoicePrint', () => {
        it('stores only the submitted fields', async () => {
            db.tenantUser.findUnique.mockResolvedValue(
                member({ version: 1, padding: 'wide', serial_column: true }),
            );

            const result = await service.updateMemberInvoicePrint('t1', 'u1', { balance: 'never' });

            // Written only to this member's row in this workspace, and only what the member has
            // answered: the other built-in values are not frozen in as the member's own.
            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: membership,
                data: { invoice_print_prefs: { padding: 'wide', serial_column: true, balance: 'never' } },
            });
            // The mocked row does not change after the write, so this is what it read back.
            expect(result).toEqual({
                ...DEFAULT_INVOICE_PRINT_PREFS,
                padding: 'wide',
                serial_column: true,
            });
        });

        it("does not freeze the profile into the member's own answers", async () => {
            db.tenantUser.findUnique.mockResolvedValue(member(null, profile({ padding: 'wide' })));

            await service.updateMemberInvoicePrint('t1', 'u1', { balance: 'never' });

            expect(db.tenantUser.update.mock.calls[0][0].data).toEqual({
                invoice_print_prefs: { balance: 'never' },
            });
        });

        it('stores an empty footer as "no footer" and null as the default footer', async () => {
            db.tenantUser.findUnique.mockResolvedValue(member({ footer_text: 'Old' }));

            await service.updateMemberInvoicePrint('t1', 'u1', { footer_text: '' });
            await service.updateMemberInvoicePrint('t1', 'u1', { footer_text: null });

            expect(db.tenantUser.update.mock.calls[0][0].data.invoice_print_prefs).toEqual({ footer_text: '' });
            expect(db.tenantUser.update.mock.calls[1][0].data.invoice_print_prefs).toEqual({ footer_text: null });
        });

        it('refuses a user who is not a member of the workspace', async () => {
            db.tenantUser.findUnique.mockResolvedValue(null);
            await expect(
                service.updateMemberInvoicePrint('t1', 'u1', { padding: 'narrow' }),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.tenantUser.update).not.toHaveBeenCalled();
        });
    });
});

describe('SalesSettingsService — show_customer_credit', () => {
    const db = { salesSettings: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
    const service = new SalesSettingsService(db as any, {} as any);

    beforeEach(() => jest.clearAllMocks());

    it('is off for a tenant whose row predates the flag', async () => {
        db.salesSettings.findUnique.mockResolvedValue({ id: 's1', tenant_id: 't1' });
        await expect(service.get('t1')).resolves.toMatchObject({ show_customer_credit: false });
    });

    it('is written only when the request carries it', async () => {
        db.salesSettings.findUnique.mockResolvedValue({ id: 's1', tenant_id: 't1', paper_size: 'A4', reference_number_format: 'YYMM-#' });
        db.salesSettings.update.mockImplementation(({ data }) => Promise.resolve({ id: 's1', tenant_id: 't1', ...data }));

        await service.update('t1', { paper_size: 'A4' as any });
        expect(db.salesSettings.update.mock.calls[0][0].data).not.toHaveProperty('show_customer_credit');

        await expect(service.update('t1', { show_customer_credit: true })).resolves.toMatchObject({ show_customer_credit: true });
    });
});
