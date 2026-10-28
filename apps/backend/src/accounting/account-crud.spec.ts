import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { AccountCategory, AccountType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';

/**
 * Update/delete for the chart of accounts. The delete paths are the sharp edge:
 * the database would happily drop an account that vouchers still point at.
 */
describe('AccountingService — chart of accounts update/delete', () => {
    let service: AccountingService;

    const db = {
        accountGroup: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        accountSubgroup: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        account: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        voucherDetail: { count: jest.fn() },
        postingRule: { count: jest.fn() },
        accountBudget: { count: jest.fn() },
        recurringJournalLine: { count: jest.fn() },
        recurringVoucherLine: { count: jest.fn() },
        voucherTemplateLine: { count: jest.fn() },
        paymentRecord: { count: jest.fn() },
        paymentMethod: { count: jest.fn(), findMany: jest.fn() },
        store: { findFirst: jest.fn() },
        purchasePayment: { count: jest.fn() },
        salesReturnPayment: { count: jest.fn() },
        purchaseReturnPayment: { count: jest.fn() },
    };

    /** No relation references the account unless a test says otherwise. */
    const noReferences = () => {
        db.voucherDetail.count.mockResolvedValue(0);
        db.postingRule.count.mockResolvedValue(0);
        db.accountBudget.count.mockResolvedValue(0);
        db.recurringJournalLine.count.mockResolvedValue(0);
        db.recurringVoucherLine.count.mockResolvedValue(0);
        db.voucherTemplateLine.count.mockResolvedValue(0);
        db.paymentRecord.count.mockResolvedValue(0);
        db.paymentMethod.count.mockResolvedValue(0);
        db.purchasePayment.count.mockResolvedValue(0);
        db.salesReturnPayment.count.mockResolvedValue(0);
        db.purchaseReturnPayment.count.mockResolvedValue(0);
    };

    beforeEach(async () => {
        jest.resetAllMocks();

        // Code allocation reads the tenant's codes on every create/update.
        db.accountGroup.findMany.mockResolvedValue([]);
        db.accountSubgroup.findMany.mockResolvedValue([]);
        db.account.findMany.mockResolvedValue([]);
        db.paymentMethod.findMany.mockResolvedValue([]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => any) => fn() } },
            ],
        }).compile();

        service = module.get(AccountingService);
    });

    describe('deleteAccount', () => {
        beforeEach(() => {
            db.account.findFirst.mockResolvedValue({ id: 'account-1' });
        });

        it('refuses to delete an account that has journal postings', async () => {
            noReferences();
            db.voucherDetail.count.mockResolvedValue(4);

            await expect(service.deleteAccount('tenant-1', 'account-1')).rejects.toBeInstanceOf(
                ConflictException,
            );
            expect(db.account.delete).not.toHaveBeenCalled();
        });

        it('refuses to delete an account wired into a posting rule', async () => {
            noReferences();
            db.postingRule.count.mockResolvedValue(1);

            await expect(service.deleteAccount('tenant-1', 'account-1')).rejects.toThrow(
                /posting rule/,
            );
            expect(db.account.delete).not.toHaveBeenCalled();
        });

        it('refuses to delete an account a payment record points at', async () => {
            // PaymentRecord.account_id is onDelete: SetNull, so the database would
            // accept this delete and silently drop the payment's accounting link.
            noReferences();
            db.paymentRecord.count.mockResolvedValue(2);

            await expect(service.deleteAccount('tenant-1', 'account-1')).rejects.toThrow(
                /payment record/,
            );
            expect(db.account.delete).not.toHaveBeenCalled();
        });

        it.each([
            ['paymentMethod', 'a payment method links to'],
            ['purchasePayment', 'a purchase payment points at'],
            ['salesReturnPayment', 'a sales return refund points at'],
            ['purchaseReturnPayment', 'a purchase return receipt points at'],
        ] as const)('refuses to delete an account %s', async (relation, _label) => {
            // These account_id columns are onDelete: SetNull: the database would
            // accept the delete and silently drop the posting link.
            noReferences();
            db[relation].count.mockResolvedValue(1);

            await expect(service.deleteAccount('tenant-1', 'account-1')).rejects.toBeInstanceOf(
                ConflictException,
            );
            expect(db.account.delete).not.toHaveBeenCalled();
        });

        it('names the payment method, purchase payment and return payments that block a delete', async () => {
            noReferences();
            db.paymentMethod.count.mockResolvedValue(2);
            db.purchasePayment.count.mockResolvedValue(1);
            db.salesReturnPayment.count.mockResolvedValue(3);
            db.purchaseReturnPayment.count.mockResolvedValue(4);

            await expect(service.deleteAccount('tenant-1', 'account-1')).rejects.toThrow(
                /2 payment method\(s\), 1 purchase payment\(s\), 3 sales return payment\(s\), 4 purchase return payment\(s\)/,
            );
        });

        it('reports every blocking relation at once', async () => {
            noReferences();
            db.voucherDetail.count.mockResolvedValue(3);
            db.accountBudget.count.mockResolvedValue(1);

            await expect(service.deleteAccount('tenant-1', 'account-1')).rejects.toThrow(
                /3 journal posting\(s\), 1 budget line\(s\)/,
            );
        });

        it('deletes an account nothing references', async () => {
            noReferences();
            db.account.delete.mockResolvedValue({ id: 'account-1' });

            await expect(service.deleteAccount('tenant-1', 'account-1')).resolves.toEqual({
                id: 'account-1',
            });
            expect(db.account.delete).toHaveBeenCalledWith({ where: { id: 'account-1' } });
        });

        it('does not reach another tenant’s account', async () => {
            db.account.findFirst.mockResolvedValue(null);

            await expect(service.deleteAccount('tenant-1', 'account-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('deleteAccountGroup', () => {
        it('refuses to delete a group that still holds accounts', async () => {
            db.accountGroup.findFirst.mockResolvedValue({
                id: 'group-1',
                _count: { accounts: 5, subgroups: 0 },
            });

            await expect(service.deleteAccountGroup('tenant-1', 'group-1')).rejects.toThrow(
                /5 account\(s\)/,
            );
            expect(db.accountGroup.delete).not.toHaveBeenCalled();
        });

        it('refuses to delete a group that still holds subgroups', async () => {
            db.accountGroup.findFirst.mockResolvedValue({
                id: 'group-1',
                _count: { accounts: 0, subgroups: 2 },
            });

            await expect(service.deleteAccountGroup('tenant-1', 'group-1')).rejects.toThrow(
                /2 subgroup\(s\)/,
            );
        });

        it('deletes an empty group', async () => {
            db.accountGroup.findFirst.mockResolvedValue({
                id: 'group-1',
                _count: { accounts: 0, subgroups: 0 },
            });
            db.accountGroup.delete.mockResolvedValue({ id: 'group-1' });

            await expect(service.deleteAccountGroup('tenant-1', 'group-1')).resolves.toEqual({
                id: 'group-1',
            });
        });
    });

    describe('deleteAccountSubgroup', () => {
        it('refuses to delete a subgroup that still holds accounts', async () => {
            db.accountSubgroup.findFirst.mockResolvedValue({
                id: 'subgroup-1',
                _count: { accounts: 3 },
            });

            await expect(
                service.deleteAccountSubgroup('tenant-1', 'subgroup-1'),
            ).rejects.toThrow(/3 account\(s\)/);
            expect(db.accountSubgroup.delete).not.toHaveBeenCalled();
        });

        it('deletes an empty subgroup', async () => {
            db.accountSubgroup.findFirst.mockResolvedValue({
                id: 'subgroup-1',
                _count: { accounts: 0 },
            });
            db.accountSubgroup.delete.mockResolvedValue({ id: 'subgroup-1' });

            await expect(
                service.deleteAccountSubgroup('tenant-1', 'subgroup-1'),
            ).resolves.toEqual({ id: 'subgroup-1' });
        });
    });

    describe('updateAccount', () => {
        const baseDto = {
            groupId: 'group-2',
            name: 'Cash in Hand',
            category: AccountCategory.GENERAL,
        };

        it('refuses to move a posted account into a group of a different type', async () => {
            db.account.findFirst.mockResolvedValue({ id: 'account-1', type: 'asset', code: '110101' });
            db.accountGroup.findFirst.mockResolvedValue({ id: 'group-2', type: 'expense', code: '51' });
            db.voucherDetail.count.mockResolvedValue(7);

            await expect(
                service.updateAccount('tenant-1', 'account-1', baseDto),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(db.account.update).not.toHaveBeenCalled();
        });

        it('allows a cross-type move while the account is unused, deriving the new type', async () => {
            db.account.findFirst.mockResolvedValue({ id: 'account-1', type: 'asset', code: '110101' });
            db.accountGroup.findFirst.mockResolvedValue({ id: 'group-2', type: 'expense', code: '51' });
            db.voucherDetail.count.mockResolvedValue(0);
            db.account.findUnique.mockResolvedValue(null);
            db.account.update.mockResolvedValue({ id: 'account-1' });

            await service.updateAccount('tenant-1', 'account-1', baseDto);

            expect(db.account.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'account-1' },
                    data: expect.objectContaining({ type: 'expense', group_id: 'group-2' }),
                }),
            );
        });

        it('detaches the subgroup when none is supplied', async () => {
            db.account.findFirst.mockResolvedValue({ id: 'account-1', type: 'asset', code: '110101' });
            db.accountGroup.findFirst.mockResolvedValue({ id: 'group-2', type: 'asset', code: '11' });
            db.account.findUnique.mockResolvedValue(null);
            db.account.update.mockResolvedValue({ id: 'account-1' });

            await service.updateAccount('tenant-1', 'account-1', baseDto);

            expect(db.account.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ subgroup_id: null }),
                }),
            );
        });

        it('rejects a subgroup that belongs to a different group', async () => {
            db.account.findFirst.mockResolvedValue({ id: 'account-1', type: 'asset', code: '110101' });
            db.accountGroup.findFirst.mockResolvedValue({ id: 'group-2', type: 'asset', code: '11' });
            db.accountSubgroup.findFirst.mockResolvedValue(null);

            await expect(
                service.updateAccount('tenant-1', 'account-1', {
                    ...baseDto,
                    subgroupId: 'subgroup-from-elsewhere',
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('rejects a name already taken by another account', async () => {
            db.account.findFirst.mockImplementation(async ({ where }: { where: { name?: string } }) =>
                where.name
                    ? { id: 'account-9' }
                    : { id: 'account-1', type: 'asset', code: '110101' },
            );
            db.accountGroup.findFirst.mockResolvedValue({ id: 'group-2', type: 'asset', code: '11' });

            await expect(
                service.updateAccount('tenant-1', 'account-1', baseDto),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('lets an account keep its own name', async () => {
            db.account.findFirst.mockResolvedValue({ id: 'account-1', type: 'asset', code: '110101' });
            db.accountGroup.findFirst.mockResolvedValue({ id: 'group-2', type: 'asset', code: '11' });
            db.account.findUnique.mockResolvedValue({ id: 'account-1' });
            db.account.update.mockResolvedValue({ id: 'account-1' });

            await expect(
                service.updateAccount('tenant-1', 'account-1', baseDto),
            ).resolves.toEqual({ id: 'account-1' });
        });
    });

    describe('updateAccountGroup', () => {
        it('renames a group without touching its type', async () => {
            db.accountGroup.findFirst.mockResolvedValue({ id: 'group-1', type: 'asset' });
            db.accountGroup.findUnique.mockResolvedValue(null);
            db.accountGroup.update.mockResolvedValue({ id: 'group-1' });

            await service.updateAccountGroup('tenant-1', 'group-1', { name: 'Short-term Assets' });

            expect(db.accountGroup.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { name: 'Short-term Assets' } }),
            );
        });

        it('rejects a name already taken by another group', async () => {
            db.accountGroup.findFirst.mockResolvedValue({ id: 'group-1', type: 'asset' });
            db.accountGroup.findUnique.mockResolvedValue({ id: 'group-9' });

            await expect(
                service.updateAccountGroup('tenant-1', 'group-1', { name: 'Fixed Assets' }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('does not reach another tenant’s group', async () => {
            db.accountGroup.findFirst.mockResolvedValue(null);

            await expect(
                service.updateAccountGroup('tenant-1', 'group-1', { name: 'Anything' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('updateAccountSubgroup', () => {
        it('checks the name against siblings in the same group', async () => {
            db.accountSubgroup.findFirst.mockResolvedValue({ id: 'subgroup-1', group_id: 'group-1' });
            db.accountSubgroup.findUnique.mockResolvedValue(null);
            db.accountSubgroup.update.mockResolvedValue({ id: 'subgroup-1' });

            await service.updateAccountSubgroup('tenant-1', 'subgroup-1', { name: 'Receivables' });

            expect(db.accountSubgroup.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { group_id_name: { group_id: 'group-1', name: 'Receivables' } },
                }),
            );
        });

        it('rejects a name already used by a sibling subgroup', async () => {
            db.accountSubgroup.findFirst.mockResolvedValue({ id: 'subgroup-1', group_id: 'group-1' });
            db.accountSubgroup.findUnique.mockResolvedValue({ id: 'subgroup-9' });

            await expect(
                service.updateAccountSubgroup('tenant-1', 'subgroup-1', { name: 'Cash and Bank' }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('createAccount branch drawer', () => {
        const group = { id: 'group-1', tenant_id: 'tenant-1', type: 'asset', code: '11' };

        function draft(overrides: Record<string, unknown> = {}) {
            return {
                groupId: 'group-1',
                name: 'Main Cash',
                type: AccountType.ASSET,
                category: AccountCategory.CASH,
                ...overrides,
            };
        }

        beforeEach(() => {
            db.accountGroup.findFirst.mockResolvedValue(group);
            db.account.findFirst.mockResolvedValue(null);
            db.store.findFirst.mockResolvedValue({ id: 'store-bb', tenant_id: 'tenant-1' });
            db.paymentMethod.findMany.mockResolvedValue([]);
            db.account.create.mockResolvedValue({ id: 'account-new' });
        });

        it('rejects a bank account that names a branch', async () => {
            await expect(
                service.createAccount('tenant-1', draft({
                    name: 'Premier Bank',
                    category: AccountCategory.BANK,
                    storeId: 'store-bb',
                })),
            ).rejects.toThrow('Only a cash drawer belongs to a branch.');
            expect(db.account.create).not.toHaveBeenCalled();
        });

        it('rejects a second cash drawer for the same branch', async () => {
            db.account.findFirst.mockImplementation(async ({ where }: { where: { store_id?: string } }) =>
                where.store_id ? { id: 'drawer-1' } : null,
            );

            await expect(
                service.createAccount('tenant-1', draft({ storeId: 'store-bb' })),
            ).rejects.toThrow('This branch already has a cash drawer.');
            expect(db.account.create).not.toHaveBeenCalled();
        });

        it('still refuses a cash drawer when the branch is omitted', async () => {
            await expect(
                service.createAccount('tenant-1', draft({ name: 'Main Cash' })),
            ).rejects.toThrow('A cash drawer needs a branch.');
            expect(db.account.create).not.toHaveBeenCalled();
        });

        it('saves an unlinked wallet as shared when the chart sends no branch', async () => {
            db.account.create.mockResolvedValue({ id: 'upay' });

            await expect(
                service.createAccount('tenant-1', draft({ name: 'Upay', storeId: null })),
            ).resolves.toEqual({ id: 'upay' });
            expect(db.account.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ name: 'Upay', store_id: null }),
                }),
            );
        });

        it('accepts a bKash wallet with no branch', async () => {
            db.account.create.mockResolvedValue({ id: 'bkash' });

            await expect(
                service.createAccount('tenant-1', draft({ name: 'bKash Account' })),
            ).resolves.toEqual({ id: 'bkash' });
            expect(db.account.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ name: 'bKash Account', store_id: null }),
                }),
            );
        });

        it('accepts one drawer on each of two branches, even with the same name', async () => {
            db.account.create
                .mockResolvedValueOnce({ id: 'drawer-bb' })
                .mockResolvedValueOnce({ id: 'drawer-pc' });

            await service.createAccount('tenant-1', draft({ storeId: 'store-bb' }));
            await service.createAccount('tenant-1', draft({ name: 'Main Cash', storeId: 'store-pc' }));

            expect(db.account.create).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({ data: expect.objectContaining({ store_id: 'store-bb' }) }),
            );
            expect(db.account.create).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({ data: expect.objectContaining({ name: 'Main Cash', store_id: 'store-pc' }) }),
            );
        });
    });
});
