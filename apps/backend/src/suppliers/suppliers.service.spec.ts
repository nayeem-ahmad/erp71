jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'skipped' }),
    voidAutoPostedVoucher: jest.fn().mockResolvedValue(undefined),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { DatabaseService } from '../database/database.service';
import { SupplierPaymentDirectionDto } from './supplier.dto';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
    let service: SuppliersService;
    let db: any;

    beforeEach(async () => {
        db = {
            supplier: {
                findUnique: jest.fn(),
                create: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
                upsert: jest.fn(),
            },
            supplierCreditTransaction: {
                count: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                findFirst: jest.fn(),
            },
            supplierPaymentAllocation: {
                aggregate: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
            },
            purchase: {
                findMany: jest.fn(),
                update: jest.fn(),
            },
            $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SuppliersService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<SuppliersService>(SuppliersService);
    });

    it('creates a supplier for the tenant', async () => {
        db.supplier.findUnique.mockResolvedValue(null);
        db.supplier.create.mockResolvedValue({ id: 'sup-1', name: 'ACME Supply' });

        const result = await service.create('tenant-1', { name: 'ACME Supply' });

        expect(db.supplier.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenant_id: 'tenant-1', name: 'ACME Supply' }),
        });
        expect(result.id).toBe('sup-1');
    });

    it('rejects duplicate supplier names per tenant', async () => {
        db.supplier.findUnique.mockResolvedValue({ id: 'sup-existing', deleted_at: null });

        await expect(service.create('tenant-1', { name: 'ACME Supply' })).rejects.toThrow(BadRequestException);
    });

    // The unique index spans soft-deleted rows, so a deleted supplier keeps its
    // name. Refusing the name would leave the shopkeeper unable to add a
    // supplier they cannot see anywhere — and the one they added never reaches
    // the purchase picker.
    it('brings back a soft-deleted supplier rather than refusing its name', async () => {
        db.supplier.findUnique.mockResolvedValue({ id: 'sup-deleted', deleted_at: new Date() });
        db.supplier.update.mockResolvedValue({ id: 'sup-deleted', name: 'ACME Supply' });

        const result = await service.create('tenant-1', { name: 'ACME Supply', phone: '01700000000' });

        expect(db.supplier.create).not.toHaveBeenCalled();
        expect(db.supplier.update).toHaveBeenCalledWith({
            where: { id: 'sup-deleted' },
            data: expect.objectContaining({ deleted_at: null, name: 'ACME Supply', phone: '01700000000' }),
        });
        expect(result.id).toBe('sup-deleted');
    });

    it('trims the supplier name so a stray space cannot create a second row', async () => {
        db.supplier.findUnique.mockResolvedValue(null);
        db.supplier.create.mockResolvedValue({ id: 'sup-1' });

        await service.create('tenant-1', { name: '  ACME Supply  ' });

        expect(db.supplier.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenant_id_name: { tenant_id: 'tenant-1', name: 'ACME Supply' } },
            }),
        );
        expect(db.supplier.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ name: 'ACME Supply' }),
        });
    });

    it('refuses a blank name rather than listing a supplier nobody can read', async () => {
        await expect(service.create('tenant-1', { name: '   ' })).rejects.toThrow(BadRequestException);
        expect(db.supplier.create).not.toHaveBeenCalled();
    });

    it('says a rename is blocked by a deleted supplier, not by a visible one', async () => {
        db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'Old Name' });
        db.supplier.findUnique.mockResolvedValue({ id: 'sup-deleted', deleted_at: new Date() });

        await expect(service.update('tenant-1', 'sup-1', { name: 'ACME Supply' }))
            .rejects.toThrow(/deleted supplier/i);
    });

    describe('importRows', () => {
        it('counts a live supplier of the same name as a duplicate', async () => {
            db.supplier.findUnique.mockResolvedValue({ id: 'sup-1', deleted_at: null });

            const result = await service.importRows('tenant-1', [{ name: 'ACME Supply' }], 'skip');

            expect(result).toMatchObject({ created: 0, skipped: 1 });
            expect(db.supplier.upsert).not.toHaveBeenCalled();
        });

        // Skipping the row leaves nothing behind; updating the tombstone in
        // place leaves a supplier still hidden from every list. Either way the
        // import reports a supplier that never reaches the purchase picker.
        it('brings a soft-deleted supplier back instead of skipping its row', async () => {
            db.supplier.findUnique.mockResolvedValue({ id: 'sup-deleted', deleted_at: new Date() });

            const result = await service.importRows(
                'tenant-1',
                [{ name: 'ACME Supply', phone: '01700000000' }],
                'skip',
            );

            expect(result).toMatchObject({ created: 1, skipped: 0 });
            expect(db.supplier.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id_name: { tenant_id: 'tenant-1', name: 'ACME Supply' } },
                    update: expect.objectContaining({ deleted_at: null, phone: '01700000000' }),
                }),
            );
        });
    });

    it('returns paginated supplier lists', async () => {
        db.supplier.findMany.mockResolvedValue([{ id: 'sup-1' }]);
        db.supplier.count.mockResolvedValue(1);

        const result = await service.findAll('tenant-1', 1, 100);

        expect(result.items).toEqual([{ id: 'sup-1' }]);
        expect(result.total).toBe(1);
    });

    it('throws when supplier is missing', async () => {
        db.supplier.findFirst.mockResolvedValue(null);

        await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('records a supplier credit payment and reduces due balance', async () => {
        db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 500, name: 'ACME' });
        db.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
            const tx = {
                supplierCreditTransaction: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockResolvedValue({ id: 'tx-1', type: 'PAYMENT', payment_number: 'SPY-00001' }),
                },
                supplier: { update: jest.fn().mockResolvedValue({ id: 'sup-1', due_balance: 300 }) },
            };
            return fn(tx);
        });

        const result = await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200 });

        expect(result.type).toBe('PAYMENT');
    });

    it('allows supplier prepayment above payable balance', async () => {
        db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 100, name: 'ACME' });
        db.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
            const tx = {
                supplierCreditTransaction: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockResolvedValue({ id: 'tx-1', type: 'PAYMENT', payment_number: 'SPY-00001' }),
                },
                supplier: { update: jest.fn().mockResolvedValue({ id: 'sup-1', due_balance: -50 }) },
            };
            return fn(tx);
        });

        const result = await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 150 });

        expect(result.type).toBe('PAYMENT');
    });

    describe('supplier payment posting', () => {
        // Regression cover for "Purchase Payable never clears": purchases credit the
        // payable on every tenant, but recordCreditPayment never posted, so nothing
        // ever debited it and the liability grew forever.
        const mockTx = (type: 'PAYMENT' | 'PAYOUT') => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 500, name: 'ACME' });
            db.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn({
                supplierCreditTransaction: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockResolvedValue({
                        id: 'tx-1',
                        type,
                        payment_number: 'SPY-00001',
                        created_at: new Date('2026-07-17T00:00:00Z'),
                    }),
                },
                supplier: { update: jest.fn().mockResolvedValue({ id: 'sup-1' }) },
            }));
        };

        beforeEach(() => {
            (autoPostFromRules as jest.Mock).mockClear();
            (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'skipped' });
        });

        it('posts direction "pay" when paying the supplier, so Purchase Payable is debited', async () => {
            mockTx('PAYMENT');

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200 });

            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'supplier_payment',
                conditionKey: 'payment_direction',
                conditionValue: 'pay',
                sourceId: 'tx-1',
                amount: 200,
            }));
        });

        it('posts direction "receive" for a payout, mirroring dueDelta', async () => {
            // dueDelta: PAYMENT reduces due, PAYOUT increases it. The voucher must
            // move in the same direction or the ledger and due_balance diverge.
            mockTx('PAYOUT');

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                amount: 200,
                direction: SupplierPaymentDirectionDto.RECEIVE,
            });

            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
                conditionValue: 'receive',
            }));
        });

        it('surfaces the voucher on the returned payment', async () => {
            // Asserting the RESULT, not just that the call happened — a posting that
            // returns 'skipped' is invisible unless the caller reports it.
            mockTx('PAYMENT');
            (autoPostFromRules as jest.Mock).mockResolvedValue({
                postingStatus: 'posted',
                voucherId: 'v-1',
                voucherNumber: 'CP-00001',
            });

            const result: any = await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200 });

            expect(result.posting_status).toBe('posted');
            expect(result.voucher_id).toBe('v-1');
            expect(result.voucher_number).toBe('CP-00001');
        });

        it('scopes the posting to the tenant and the payment row', async () => {
            mockTx('PAYMENT');

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200 });

            expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({
                tenantId: 'tenant-1',
                sourceModule: 'suppliers',
                sourceType: 'supplier_payment',
                sourceId: 'tx-1',
            }));
        });
    });

    describe('how the money moved', () => {
        let tx: any;

        beforeEach(() => {
            (autoPostFromRules as jest.Mock).mockClear();
            (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'skipped' });
            (voidAutoPostedVoucher as jest.Mock).mockClear();
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 500, name: 'ACME' });
            tx = {
                supplierCreditTransaction: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockResolvedValue({ id: 'tx-1', type: 'PAYMENT', payment_number: 'SPY-00001' }),
                    update: jest.fn().mockResolvedValue({ id: 'tx-1' }),
                    delete: jest.fn().mockResolvedValue({ id: 'tx-1' }),
                },
                supplier: {
                    findFirst: jest.fn().mockResolvedValue({ id: 'sup-1', due_balance: 300, name: 'ACME' }),
                    update: jest.fn().mockResolvedValue({ id: 'sup-1' }),
                },
                account: { findFirst: jest.fn() },
                paymentMethod: { findFirst: jest.fn().mockResolvedValue(null) },
                postingRule: { findFirst: jest.fn().mockResolvedValue(null) },
            };
            db.$transaction.mockImplementation(async (fn: (t: any) => Promise<unknown>) => fn(tx));
        });

        const postedWith = () => (autoPostFromRules as jest.Mock).mock.calls[0][0];

        it('stores the method and credits the account linked to it when paying the supplier', async () => {
            tx.paymentMethod.findFirst.mockResolvedValue({ account_id: 'acc-nagad', type: 'Mobile Wallet' });

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200, paymentMethod: 'Nagad' });

            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ payment_method: 'Nagad', account_id: 'acc-nagad' }),
            }));
            // Dr Purchase Payable / Cr <Nagad>.
            expect(postedWith()).toEqual(expect.objectContaining({ overrideCreditAccountId: 'acc-nagad' }));
            expect(postedWith().overrideDebitAccountId).toBeUndefined();
        });

        it('debits the chosen account when money comes back from the supplier', async () => {
            tx.supplierCreditTransaction.create.mockResolvedValue({ id: 'tx-2', type: 'PAYOUT', payment_number: 'SPO-00001' });
            tx.account.findFirst.mockResolvedValue({ id: 'acc-bank' });

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                amount: 80,
                direction: SupplierPaymentDirectionDto.RECEIVE,
                paymentMethod: 'Bank',
                accountId: 'acc-bank',
            });

            expect(postedWith()).toEqual(expect.objectContaining({ overrideDebitAccountId: 'acc-bank' }));
            expect(postedWith().overrideCreditAccountId).toBeUndefined();
        });

        it('falls back to the mode account the sale rules name when the method has none', async () => {
            tx.paymentMethod.findFirst.mockResolvedValue({ account_id: null, type: 'Bank' });
            tx.postingRule.findFirst.mockResolvedValue({ debit_account_id: 'acc-main-bank' });

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200, paymentMethod: 'Bank' });

            expect(tx.postingRule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ condition_value: 'bank' }),
            }));
            expect(postedWith()).toEqual(expect.objectContaining({ overrideCreditAccountId: 'acc-main-bank' }));
        });

        it('posts to the rule default when no method is given', async () => {
            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200 });

            expect(tx.paymentMethod.findFirst).not.toHaveBeenCalled();
            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ payment_method: null, account_id: null }),
            }));
            expect(postedWith().overrideCreditAccountId).toBeUndefined();
            expect(postedWith().overrideDebitAccountId).toBeUndefined();
        });

        it('voids and re-posts the voucher on edit, keeping the recorded method', async () => {
            db.supplierCreditTransaction.findFirst.mockResolvedValue({
                id: 'tx-1',
                supplier_id: 'sup-1',
                type: 'PAYMENT',
                amount: 200,
                notes: null,
                payment_number: 'SPY-00001',
                payment_method: 'Nagad',
                account_id: 'acc-nagad',
                created_at: new Date('2026-07-17T00:00:00Z'),
            });
            db.supplierPaymentAllocation.aggregate.mockResolvedValue({ _sum: { amount: null } });

            await service.updateCreditPayment('tenant-1', 'tx-1', { amount: 250 });

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'supplier_payment', 'tx-1');
            expect(tx.supplierCreditTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ amount: 250, payment_method: 'Nagad', account_id: 'acc-nagad' }),
            }));
            expect(postedWith()).toEqual(expect.objectContaining({
                sourceId: 'tx-1',
                amount: 250,
                conditionValue: 'pay',
                overrideCreditAccountId: 'acc-nagad',
            }));
        });

        it('voids the voucher when a payment is deleted', async () => {
            db.supplierCreditTransaction.findFirst.mockResolvedValue({
                id: 'tx-1', supplier_id: 'sup-1', type: 'PAYMENT', amount: 200,
            });
            db.supplierPaymentAllocation.count = jest.fn().mockResolvedValue(0);

            await service.deleteCreditPayment('tenant-1', 'tx-1');

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'supplier_payment', 'tx-1');
            expect(tx.supplierCreditTransaction.delete).toHaveBeenCalledWith({ where: { id: 'tx-1' } });
        });
    });

    describe('bill allocations', () => {
        function mockTxForPayment() {
            const tx = {
                supplierCreditTransaction: {
                    create: jest.fn().mockResolvedValue({ id: 'tx-1', type: 'PAYMENT', payment_number: 'SPY-00001' }),
                    findFirst: jest.fn().mockResolvedValue(null),
                },
                supplier: { update: jest.fn().mockResolvedValue({}) },
                purchase: {
                    findMany: jest.fn().mockResolvedValue([
                        { id: 'purchase-1', total_amount: 100, paid_amount: 0, purchase_number: 'PUR-00001' },
                    ]),
                    update: jest.fn().mockResolvedValue({}),
                },
                supplierPaymentAllocation: {
                    create: jest.fn().mockResolvedValue({}),
                },
            };
            db.$transaction.mockImplementation((fn: (tx: any) => Promise<unknown>) => fn(tx));
            return tx;
        }

        it('allocates part of a payment to an open bill at recording time', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 100, name: 'ACME' });
            const tx = mockTxForPayment();

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                amount: 100,
                allocations: [{ purchaseId: 'purchase-1', amount: 60 }],
            });

            expect(tx.supplierPaymentAllocation.create).toHaveBeenCalledWith({
                data: { tenant_id: 'tenant-1', transaction_id: 'tx-1', purchase_id: 'purchase-1', amount: 60 },
            });
            expect(tx.purchase.update).toHaveBeenCalledWith({
                where: { id: 'purchase-1' },
                data: { paid_amount: 60, payment_status: 'PARTIAL' },
            });
        });

        it('rejects an allocation total that exceeds the payment amount', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 100, name: 'ACME' });
            mockTxForPayment();

            await expect(
                service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                    amount: 50,
                    allocations: [{ purchaseId: 'purchase-1', amount: 60 }],
                }),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects an allocation that exceeds a bill\'s balance due', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 100, name: 'ACME' });
            const tx = mockTxForPayment();
            tx.purchase.findMany.mockResolvedValue([
                { id: 'purchase-1', total_amount: 100, paid_amount: 80, purchase_number: 'PUR-00001' },
            ]);

            await expect(
                service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                    amount: 100,
                    allocations: [{ purchaseId: 'purchase-1', amount: 50 }],
                }),
            ).rejects.toThrow(BadRequestException);
        });

        it('allocates an existing unapplied advance to a bill later', async () => {
            db.supplierPaymentAllocation.aggregate.mockResolvedValue({ _sum: { amount: 40 } });
            const tx = mockTxForPayment();

            db.supplierCreditTransaction.findFirst
                .mockResolvedValueOnce({ id: 'tx-1', type: 'PAYMENT', amount: 100, supplier_id: 'sup-1' })
                .mockResolvedValueOnce({
                    id: 'tx-1',
                    type: 'PAYMENT',
                    amount: 100,
                    supplier: { id: 'sup-1', name: 'ACME', phone: null },
                    creator: null,
                });

            await service.allocatePayment('tenant-1', 'tx-1', {
                allocations: [{ purchaseId: 'purchase-1', amount: 60 }],
            });

            expect(tx.supplierPaymentAllocation.create).toHaveBeenCalledWith({
                data: { tenant_id: 'tenant-1', transaction_id: 'tx-1', purchase_id: 'purchase-1', amount: 60 },
            });
        });

        it('rejects allocating more than the remaining unapplied amount on a payment', async () => {
            db.supplierCreditTransaction.findFirst.mockResolvedValue({
                id: 'tx-1',
                type: 'PAYMENT',
                amount: 100,
                supplier_id: 'sup-1',
            });
            db.supplierPaymentAllocation.aggregate.mockResolvedValue({ _sum: { amount: 90 } });
            mockTxForPayment();

            await expect(
                service.allocatePayment('tenant-1', 'tx-1', {
                    allocations: [{ purchaseId: 'purchase-1', amount: 60 }],
                }),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('getBillingSummary()', () => {
        it('returns open bills and the total unapplied advance for a supplier', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'ACME', due_balance: 40 });
            db.purchase.findMany.mockResolvedValue([
                {
                    id: 'purchase-1',
                    purchase_number: 'PUR-00001',
                    total_amount: 100,
                    paid_amount: 60,
                    payment_status: 'PARTIAL',
                    created_at: new Date('2026-01-01'),
                },
            ]);
            db.supplierCreditTransaction.findMany.mockResolvedValue([
                { amount: 100, allocations: [{ amount: 60 }] },
                { amount: 30, allocations: [] },
            ]);

            const result = await service.getBillingSummary('tenant-1', 'sup-1');

            expect(result.unallocated_advance).toBe(70);
            expect(result.open_bills).toEqual([
                expect.objectContaining({ id: 'purchase-1', balance_due: 40 }),
            ]);
        });
    });

    describe('getCreditLedger()', () => {
        it('enriches CREDIT_PURCHASE rows with bill status and PAYMENT rows with their allocations', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'ACME', phone: null, due_balance: 40 });
            db.supplierCreditTransaction.count.mockResolvedValue(2);
            db.supplierCreditTransaction.findMany.mockResolvedValue([
                {
                    id: 'tx-1',
                    type: 'CREDIT_PURCHASE',
                    amount: 100,
                    balance_after: 100,
                    reference_type: 'PURCHASE',
                    reference_id: 'purchase-1',
                    created_at: new Date('2026-01-01'),
                },
                {
                    id: 'tx-2',
                    type: 'PAYMENT',
                    amount: 60,
                    balance_after: 40,
                    reference_type: null,
                    reference_id: null,
                    created_at: new Date('2026-01-02'),
                },
            ]);
            db.purchase.findMany.mockResolvedValue([
                { id: 'purchase-1', payment_status: 'PARTIAL', paid_amount: 60, total_amount: 100 },
            ]);
            db.supplierPaymentAllocation.findMany.mockResolvedValue([
                { transaction_id: 'tx-2', amount: 60, purchase: { id: 'purchase-1', purchase_number: 'PUR-00001' } },
            ]);

            const result = await service.getCreditLedger('tenant-1', 'sup-1');

            expect(result.transactions[0]).toEqual(
                expect.objectContaining({
                    id: 'tx-1',
                    bill: { payment_status: 'PARTIAL', paid_amount: 60, total_amount: 100, balance_due: 40 },
                }),
            );
            expect(result.transactions[1]).toEqual(
                expect.objectContaining({
                    id: 'tx-2',
                    allocations: [{ purchaseId: 'purchase-1', purchaseNumber: 'PUR-00001', amount: 60 }],
                    unapplied_amount: 0,
                }),
            );
        });
    });
});