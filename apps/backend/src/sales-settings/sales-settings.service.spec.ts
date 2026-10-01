import { NotFoundException } from '@nestjs/common';
import { DEFAULT_INVOICE_PRINT_PREFS } from '@erp71/shared-types';
import { SalesSettingsService } from './sales-settings.service';

describe('SalesSettingsService — member invoice print preferences', () => {
    const db = {
        tenantUser: { findUnique: jest.fn(), update: jest.fn() },
    };
    const service = new SalesSettingsService(db as any);

    const membership = { tenant_id_user_id: { tenant_id: 't1', user_id: 'u1' } };

    beforeEach(() => jest.clearAllMocks());

    describe('getMemberInvoicePrint', () => {
        it("reads the signed-in member's own row in this workspace", async () => {
            db.tenantUser.findUnique.mockResolvedValue({
                invoice_print_prefs: { version: 1, table_style: 'grid' },
            });

            await expect(service.getMemberInvoicePrint('t1', 'u1')).resolves.toEqual({
                ...DEFAULT_INVOICE_PRINT_PREFS,
                table_style: 'grid',
            });
            expect(db.tenantUser.findUnique).toHaveBeenCalledWith({
                where: membership,
                select: { invoice_print_prefs: true },
            });
        });

        it('gives a member who never saved anything the built-in layout', async () => {
            db.tenantUser.findUnique.mockResolvedValue({ invoice_print_prefs: null });
            await expect(service.getMemberInvoicePrint('t1', 'u1')).resolves.toEqual(
                DEFAULT_INVOICE_PRINT_PREFS,
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
        it('merges the change onto what the member already saved', async () => {
            db.tenantUser.findUnique.mockResolvedValue({
                invoice_print_prefs: { version: 1, padding: 'wide', serial_column: true },
            });
            db.tenantUser.update.mockImplementation(({ data }) =>
                Promise.resolve({ invoice_print_prefs: data.invoice_print_prefs }),
            );

            const result = await service.updateMemberInvoicePrint('t1', 'u1', {
                balance: 'never',
            });

            const expected = {
                ...DEFAULT_INVOICE_PRINT_PREFS,
                padding: 'wide',
                serial_column: true,
                balance: 'never',
            };
            expect(result).toEqual(expected);
            // Written only to this member's row in this workspace — another
            // member, or the same person in another workspace, is untouched.
            expect(db.tenantUser.update).toHaveBeenCalledWith({
                where: membership,
                data: { invoice_print_prefs: expected },
                select: { invoice_print_prefs: true },
            });
        });

        it('stores an empty footer as "no footer" and null as the default footer', async () => {
            db.tenantUser.findUnique.mockResolvedValue({ invoice_print_prefs: { footer_text: 'Old' } });
            db.tenantUser.update.mockImplementation(({ data }) =>
                Promise.resolve({ invoice_print_prefs: data.invoice_print_prefs }),
            );

            await expect(
                service.updateMemberInvoicePrint('t1', 'u1', { footer_text: '' }),
            ).resolves.toMatchObject({ footer_text: '' });
            await expect(
                service.updateMemberInvoicePrint('t1', 'u1', { footer_text: null }),
            ).resolves.toMatchObject({ footer_text: null });
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
