jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn().mockResolvedValue({ postingStatus: 'skipped' }),
    voidAutoPostedVoucher: jest.fn().mockResolvedValue(undefined),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
            paymentMethod: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
            store: {
                findFirst: jest.fn().mockResolvedValue({ id: 'store-1' }),
                findMany: jest.fn().mockResolvedValue([
                    { id: 'store-1', name: 'Main', code: 'S1' },
                    { id: 'branch-a', name: 'Branch A', code: 'A' },
                ]),
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

        const result = await service.create('tenant-1', { name: 'ACME Supply' }, { storeId: 'store-1' });

        expect(db.supplier.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenant_id: 'tenant-1', name: 'ACME Supply' }),
        });
        expect(result.id).toBe('sup-1');
    });

    it('rejects duplicate supplier names per tenant', async () => {
        db.supplier.findUnique.mockResolvedValue({ id: 'sup-existing', deleted_at: null });

        await expect(service.create('tenant-1', { name: 'ACME Supply' }, { storeId: 'store-1' })).rejects.toThrow(BadRequestException);
    });

    // The unique index spans soft-deleted rows, so a deleted supplier keeps its
    // name. Refusing the name would leave the shopkeeper unable to add a
    // supplier they cannot see anywhere — and the one they added never reaches
    // the purchase picker.
    it('brings back a soft-deleted supplier rather than refusing its name', async () => {
        db.supplier.findUnique.mockResolvedValue({ id: 'sup-deleted', deleted_at: new Date() });
        db.supplier.update.mockResolvedValue({ id: 'sup-deleted', name: 'ACME Supply' });

        const result = await service.create('tenant-1', { name: 'ACME Supply', phone: '01700000000' }, { storeId: 'store-1' });

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

        await service.create('tenant-1', { name: '  ACME Supply  ' }, { storeId: 'store-1' });

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
        await expect(service.create('tenant-1', { name: '   ' }, { storeId: 'store-1' })).rejects.toThrow(BadRequestException);
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

            const result = await service.importRows('tenant-1', [{ name: 'ACME Supply' }], 'skip', 'store-1');

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
                'skip', 'store-1',
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
                $queryRaw: jest.fn().mockResolvedValue([{ next: '1' }]),
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
                $queryRaw: jest.fn().mockResolvedValue([{ next: '1' }]),
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
                $queryRaw: jest.fn().mockResolvedValue([{ next: '1' }]),
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

    // The tender a payment was made with: kept on the row, and its ledger
    // account takes the cash leg instead of Cash in Hand.
    describe('payment method', () => {
        let tx: any;
        const cashLeg = () => (autoPostFromRules as jest.Mock).mock.calls
            .map((c: any[]) => c[0])
            .find((input: any) => input.conditionValue !== 'discount');

        beforeEach(() => {
            (autoPostFromRules as jest.Mock).mockClear();
            (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'skipped' });
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 5000, name: 'ACME' });
            tx = {
                $queryRaw: jest.fn().mockResolvedValue([{ next: '1' }]),
                supplierCreditTransaction: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockResolvedValue({ id: 'tx-1', payment_number: 'SPY-00001' }),
                    update: jest.fn().mockResolvedValue({ id: 'tx-1' }),
                },
                supplier: {
                    findFirst: jest.fn().mockResolvedValue({ id: 'sup-1', due_balance: 5000, name: 'ACME' }),
                    update: jest.fn().mockResolvedValue({ id: 'sup-1' }),
                },
                paymentMethod: db.paymentMethod,
            };
            db.$transaction.mockImplementation(async (fn: (t: any) => Promise<unknown>) => fn(tx));
        });

        it('keeps the method on a payment and credits its account', async () => {
            db.paymentMethod.findFirst.mockResolvedValue({ id: 'pm-bank', name: 'City Bank', account_id: 'acc-bank' });

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 2000, paymentMethodId: 'pm-bank' });

            expect(db.paymentMethod.findFirst.mock.calls[0][0].where).toEqual({ id: 'pm-bank', tenant_id: 'tenant-1', is_active: true });
            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ payment_method_id: 'pm-bank', payment_method_name: 'City Bank' }),
            }));
            expect(cashLeg()).toEqual(expect.objectContaining({ conditionValue: 'pay', overrideCreditAccountId: 'acc-bank' }));
            expect(cashLeg().overrideDebitAccountId).toBeUndefined();
        });

        it('debits the method\'s account on a refund received', async () => {
            db.paymentMethod.findFirst.mockResolvedValue({ id: 'pm-bkash', name: 'bKash', account_id: 'acc-bkash' });

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                amount: 300,
                direction: SupplierPaymentDirectionDto.RECEIVE,
                paymentMethodId: 'pm-bkash',
            });

            expect(cashLeg()).toEqual(expect.objectContaining({ conditionValue: 'receive', overrideDebitAccountId: 'acc-bkash' }));
            expect(cashLeg().overrideCreditAccountId).toBeUndefined();
        });

        it('refuses a method that is not this tenant\'s active one, before writing anything', async () => {
            db.paymentMethod.findFirst.mockResolvedValue(null);

            await expect(service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 100, paymentMethodId: 'pm-x' }))
                .rejects.toThrow(BadRequestException);
            expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
        });

        it('records no method and overrides nothing when none is sent', async () => {
            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 100 });

            expect(db.paymentMethod.findFirst).not.toHaveBeenCalled();
            expect(tx.supplierCreditTransaction.create.mock.calls[0][0].data.payment_method_id).toBeUndefined();
            expect(cashLeg().overrideCreditAccountId).toBeUndefined();
        });

        describe('on an edit', () => {
            const stored = {
                id: 'tx-1', tenant_id: 'tenant-1', supplier_id: 'sup-1', type: 'PAYMENT', amount: 200,
                discount_amount: 0, payment_number: 'SPY-00001', notes: null, created_at: new Date('2026-10-01T05:00:00Z'),
                payment_method_id: 'pm-cash', payment_method_name: 'Cash',
            };

            beforeEach(() => {
                db.supplierCreditTransaction.findFirst.mockResolvedValue(stored);
                db.supplierPaymentAllocation.aggregate.mockResolvedValue({ _sum: { amount: null } });
            });

            it('switches to a new method and reposts to its account', async () => {
                db.paymentMethod.findFirst.mockResolvedValue({ id: 'pm-bank', name: 'City Bank', account_id: 'acc-bank' });

                await service.updateCreditPayment('tenant-1', 'tx-1', { paymentMethodId: 'pm-bank' });

                expect(tx.supplierCreditTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                    data: expect.objectContaining({ payment_method_id: 'pm-bank', payment_method_name: 'City Bank' }),
                }));
                expect(cashLeg()).toEqual(expect.objectContaining({ overrideCreditAccountId: 'acc-bank' }));
            });

            it('keeps the stored method and reposts to its current account', async () => {
                db.paymentMethod.findFirst.mockResolvedValue({ account_id: 'acc-drawer' });

                await service.updateCreditPayment('tenant-1', 'tx-1', { amount: 250 });

                expect(db.paymentMethod.findFirst.mock.calls[0][0].where).toEqual({ id: 'pm-cash', tenant_id: 'tenant-1' });
                expect(tx.supplierCreditTransaction.update.mock.calls[0][0].data.payment_method_id).toBeUndefined();
                expect(cashLeg()).toEqual(expect.objectContaining({ overrideCreditAccountId: 'acc-drawer' }));
            });
        });
    });

    // Every supplier belongs to one branch; a member limited to some branches
    // reaches only theirs — see supplier-visibility.ts.
    describe('branch scope', () => {
        const SCOPE = ['branch-a'];

        it('lists only the scoped suppliers', async () => {
            db.supplier.findMany.mockResolvedValue([]);
            db.supplier.count.mockResolvedValue(0);

            await service.findAll('tenant-1', 1, 20, { scope: SCOPE });

            expect(db.supplier.findMany.mock.calls[0][0].where).toMatchObject({ store_id: { in: SCOPE } });
        });

        it('answers 404 for a supplier of another branch', async () => {
            db.supplier.findFirst.mockResolvedValue(null);

            await expect(service.findOne('tenant-1', 'sup-other', SCOPE)).rejects.toBeInstanceOf(NotFoundException);
            expect(db.supplier.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'sup-other', store_id: { in: SCOPE } });
        });

        it('adds a supplier to the header branch, or the one named if the caller may use it', async () => {
            db.supplier.findUnique.mockResolvedValue(null);
            db.supplier.create.mockResolvedValue({ id: 'sup-1' });

            await service.create('tenant-1', { name: 'Fresh Farms' }, { storeId: 'branch-a', scope: SCOPE });
            expect(db.supplier.create.mock.calls[0][0].data.store_id).toBe('branch-a');

            await expect(service.create('tenant-1', { name: 'Elsewhere', store_id: 'store-1' }, { scope: SCOPE }))
                .rejects.toThrow('You can only add suppliers to your own branches.');
        });

        it('refuses a move to another branch from a member who cannot see every branch', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'Fresh Farms', store_id: 'branch-a' });

            await expect(service.update('tenant-1', 'sup-1', { store_id: 'store-1' }, { scope: SCOPE, canSetBranch: false }))
                .rejects.toThrow('Only an owner can move a supplier to another branch.');
            expect(db.supplier.update).not.toHaveBeenCalled();
        });

        it('lets an owner move a supplier to another branch of the tenant', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'Fresh Farms', store_id: 'branch-a' });
            db.supplier.update.mockResolvedValue({ id: 'sup-1' });

            await service.update('tenant-1', 'sup-1', { store_id: 'store-1' }, { canSetBranch: true });

            expect(db.supplier.update.mock.calls[0][0].data.store_id).toBe('store-1');
        });

        it('imports a row to its own branch column, else the file\'s, and fails an unknown branch alone', async () => {
            db.supplier.findUnique.mockResolvedValue(null);
            db.supplier.upsert = jest.fn().mockResolvedValue({});

            const result = await service.importRows(
                'tenant-1',
                [{ name: 'Own', branch: 'A' }, { name: 'File' }, { name: 'Nowhere', branch: 'Sylhet' }],
                'skip',
                'store-1',
            );

            expect(db.supplier.upsert.mock.calls.map(([args]: any[]) => args.create.store_id)).toEqual(['branch-a', 'store-1']);
            expect(result.errors).toEqual([expect.stringMatching(/unknown branch "Sylhet"/)]);
        });

        it('records a payment under the supplier\'s branch and posts its voucher there', async () => {
            (autoPostFromRules as jest.Mock).mockClear();
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 500, name: 'ACME', store_id: 'branch-a' });
            const tx = {
                $queryRaw: jest.fn().mockResolvedValue([{ next: '1' }]),
                supplierCreditTransaction: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockResolvedValue({ id: 'tx-1', payment_number: 'SPY-00001' }),
                },
                supplier: { update: jest.fn() },
            };
            db.$transaction.mockImplementation(async (fn: (t: any) => Promise<unknown>) => fn(tx));

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 200 }, undefined, SCOPE);

            expect(db.supplier.findFirst.mock.calls[0][0].where).toMatchObject({ store_id: { in: SCOPE } });
            expect(tx.supplierCreditTransaction.create.mock.calls[0][0].data.store_id).toBe('branch-a');
            expect((autoPostFromRules as jest.Mock).mock.calls[0][0].storeId).toBe('branch-a');
        });

        it('lists the payments of the page\'s branch, within the caller\'s suppliers', async () => {
            db.supplierCreditTransaction.findMany.mockResolvedValue([]);
            db.supplierCreditTransaction.count.mockResolvedValue(0);

            await service.listCreditPayments('tenant-1', { timezone: 'Asia/Dhaka', branch: 'branch-a', scope: SCOPE } as any);

            expect(db.supplierCreditTransaction.findMany.mock.calls[0][0].where).toMatchObject({
                store_id: 'branch-a',
                supplier: { store_id: { in: SCOPE } },
            });
        });
    });

    describe('bill allocations', () => {
        function mockTxForPayment() {
            const tx = {
                $queryRaw: jest.fn().mockResolvedValue([{ next: '1' }]),
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

    describe('payment date and serial', () => {
        const existing = {
            id: 'tx-1', tenant_id: 'tenant-1', supplier_id: 'sup-1', type: 'PAYMENT',
            amount: 200, discount_amount: 0, payment_number: 'SPY-00001', notes: null,
            created_at: new Date('2026-08-15T04:00:00Z'),
            supplier: { id: 'sup-1', name: 'ACME' }, creator: null,
        };

        function mockTx() {
            const tx = {
                $queryRaw: jest.fn().mockResolvedValue([{ next: '1' }]),
                supplierCreditTransaction: {
                    create: jest.fn().mockResolvedValue({ id: 'tx-new' }),
                    findFirst: jest.fn().mockResolvedValue(null),
                    update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'tx-1', ...data })),
                },
                supplier: {
                    findFirst: jest.fn().mockResolvedValue({ id: 'sup-1', name: 'ACME', due_balance: 800 }),
                    update: jest.fn().mockResolvedValue({}),
                },
            };
            db.$transaction.mockImplementation((fn: (t: any) => Promise<unknown>) => fn(tx));
            return tx;
        }

        const postedCalls = () => (autoPostFromRules as jest.Mock).mock.calls.map((c: any[]) => c[0]);

        beforeEach(() => {
            (autoPostFromRules as jest.Mock).mockClear();
            (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'skipped' });
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 1000, name: 'ACME' });
            db.supplierPaymentAllocation.aggregate.mockResolvedValue({ _sum: { amount: null } });
        });

        it('records a backdated payment at the picked time, read in the tenant zone, and dates its voucher to match', async () => {
            const tx = mockTx();

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 100, date: '2026-10-01T09:30' }, 'Asia/Dhaka');

            const picked = new Date('2026-10-01T03:30:00Z');
            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ created_at: picked }) }),
            );
            expect(postedCalls()[0].date).toEqual(picked);
        });

        it('refuses a payment dated in the future', async () => {
            const tx = mockTx();
            const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString();

            await expect(service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 100, date: tomorrow }))
                .rejects.toThrow('Payment date cannot be in the future');
            expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
        });

        it('records a typed serial as given, and refuses one already taken', async () => {
            const tx = mockTx();

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 100, paymentNumber: 'BILL-77' });
            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ payment_number: 'BILL-77' }) }),
            );
            expect(tx.$queryRaw).not.toHaveBeenCalled();
            expect(postedCalls()[0].referenceNumber).toBe('BILL-77');

            tx.supplierCreditTransaction.findFirst.mockResolvedValue({ id: 'tx-other' });
            await expect(service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 100, paymentNumber: 'SPY-00002' }))
                .rejects.toThrow(new ConflictException('Serial SPY-00002 is already used by another payment.'));
        });

        it('writes a typed serial in the series the way the series does, and refuses one ahead of it', async () => {
            const tx = mockTx();
            tx.supplierCreditTransaction.findFirst.mockImplementation(async ({ where }: any) =>
                (where.payment_number === 'SPY-00002' ? { id: 'tx-other' } : null));
            await expect(service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 100, paymentNumber: 'spy-2' }))
                .rejects.toThrow(new ConflictException('Serial SPY-00002 is already used by another payment.'));

            tx.supplierCreditTransaction.findFirst.mockResolvedValue(null);
            tx.$queryRaw.mockResolvedValue([{ next: '12' }]);
            await expect(service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 100, paymentNumber: 'SPY-000125' }))
                .rejects.toThrow(BadRequestException);
            expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
        });

        it('update moves the date and renames the serial, reposting under both', async () => {
            db.supplierCreditTransaction.findFirst.mockResolvedValue(existing);
            const tx = mockTx();

            await service.updateCreditPayment(
                'tenant-1', 'tx-1', { date: '2026-08-10T18:00:00+06:00', paymentNumber: 'BILL-900' }, 'Asia/Dhaka',
            );

            const moved = new Date('2026-08-10T12:00:00Z');
            expect(tx.supplierCreditTransaction.findFirst).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', payment_number: 'BILL-900', id: { not: 'tx-1' } },
                select: { id: true },
            });
            expect(tx.supplierCreditTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ created_at: moved, payment_number: 'BILL-900' }),
            }));
            expect(postedCalls()[0]).toMatchObject({ date: moved, referenceNumber: 'BILL-900' });
        });

        it('update keeps the date and serial when neither is sent', async () => {
            db.supplierCreditTransaction.findFirst.mockResolvedValue(existing);
            const tx = mockTx();

            await service.updateCreditPayment('tenant-1', 'tx-1', { amount: 300 });

            expect(tx.supplierCreditTransaction.findFirst).not.toHaveBeenCalled();
            expect(tx.supplierCreditTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ created_at: existing.created_at, payment_number: 'SPY-00001' }),
            }));
        });

        it('previews the next serial in the series the direction draws from', async () => {
            db.$queryRaw = jest.fn().mockResolvedValue([{ next: '5' }]);

            await expect(service.getNextPaymentNumber('tenant-1', SupplierPaymentDirectionDto.RECEIVE))
                .resolves.toEqual({ payment_number: 'SPO-00005' });
        });
    });

    describe('payment discount', () => {
        function mockTx(opts: { bills?: any[] } = {}) {
            const tx = {
                $queryRaw: jest.fn().mockResolvedValue([{ next: '1' }]),
                supplierCreditTransaction: {
                    create: jest.fn().mockResolvedValue({
                        id: 'tx-1', type: 'PAYMENT', payment_number: 'SPY-00001',
                        created_at: new Date('2026-09-30T00:00:00Z'),
                    }),
                    findFirst: jest.fn().mockResolvedValue(null),
                    update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'tx-1', ...data })),
                    delete: jest.fn().mockResolvedValue({}),
                },
                supplier: {
                    findFirst: jest.fn(),
                    update: jest.fn().mockResolvedValue({}),
                },
                purchase: {
                    findMany: jest.fn().mockResolvedValue(opts.bills ?? []),
                    update: jest.fn().mockResolvedValue({}),
                },
                supplierPaymentAllocation: { create: jest.fn().mockResolvedValue({}) },
            };
            db.$transaction.mockImplementation((fn: (t: any) => Promise<unknown>) => fn(tx));
            return tx;
        }

        const postedCalls = () => (autoPostFromRules as jest.Mock).mock.calls.map((c: any[]) => c[0]);

        beforeEach(() => {
            (autoPostFromRules as jest.Mock).mockClear();
            (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'skipped' });
            (voidAutoPostedVoucher as jest.Mock).mockClear();
        });

        it('settles amount + discount, posts the discount leg, and lets both clear a bill', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 5000, name: 'ACME' });
            const tx = mockTx({ bills: [{ id: 'purchase-1', total_amount: 5000, paid_amount: 0, purchase_number: 'PUR-1' }] });

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                amount: 4998,
                discount: 2,
                allocations: [{ purchaseId: 'purchase-1', amount: 5000 }],
            });

            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ amount: 4998, discount_amount: 2, balance_after: 0 }),
            }));
            expect(tx.supplier.update).toHaveBeenCalledWith({ where: { id: 'sup-1' }, data: { due_balance: 0 } });
            expect(tx.purchase.update).toHaveBeenCalledWith({
                where: { id: 'purchase-1' },
                data: { paid_amount: 5000, payment_status: 'PAID' },
            });

            const calls = postedCalls();
            expect(calls).toHaveLength(2);
            expect(calls[0]).toMatchObject({ conditionValue: 'pay', amount: 4998 });
            expect(calls[0].legKey).toBeUndefined();
            expect(calls[1]).toMatchObject({
                eventType: 'supplier_payment',
                conditionKey: 'payment_direction',
                conditionValue: 'discount',
                legKey: 'discount',
                sourceId: 'tx-1',
                amount: 2,
                partyType: 'SUPPLIER',
                partyId: 'sup-1',
            });
        });

        it('allows a discount-only settlement and posts no cash leg', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 2, name: 'ACME' });
            mockTx();

            await service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 0, discount: 2 });

            const calls = postedCalls();
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({ conditionValue: 'discount', legKey: 'discount', amount: 2 });
        });

        it('rejects a discount on money received from the supplier', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 100, name: 'ACME' });
            await expect(service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                amount: 50, discount: 1, direction: SupplierPaymentDirectionDto.RECEIVE,
            })).rejects.toThrow(BadRequestException);
        });

        it('rejects a discount larger than what is left after the payment', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 100, name: 'ACME' });
            await expect(service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', { amount: 95, discount: 6 }))
                .rejects.toThrow(BadRequestException);
        });

        it('rejects allocations beyond amount + discount', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 5000, name: 'ACME' });
            mockTx({ bills: [{ id: 'purchase-1', total_amount: 5000, paid_amount: 0, purchase_number: 'PUR-1' }] });

            await expect(service.recordCreditPayment('tenant-1', 'sup-1', 'user-1', {
                amount: 4990, discount: 2, allocations: [{ purchaseId: 'purchase-1', amount: 5000 }],
            })).rejects.toThrow(BadRequestException);
        });

        // Regression: editing a supplier payment used to leave its original
        // voucher in the GL, so the books and due_balance drifted apart.
        it('update voids both legs and reposts them at the payment\'s own date', async () => {
            const createdAt = new Date('2026-09-01T00:00:00Z');
            db.supplierCreditTransaction.findFirst.mockResolvedValue({
                id: 'tx-1', tenant_id: 'tenant-1', supplier_id: 'sup-1', type: 'PAYMENT',
                amount: 200, discount_amount: 5, payment_number: 'SPY-00001', notes: null, created_at: createdAt,
                supplier: { id: 'sup-1', name: 'ACME' }, creator: null,
            });
            db.supplierPaymentAllocation.aggregate.mockResolvedValue({ _sum: { amount: null } });
            const tx = mockTx();
            // Due after the original payment: 1000 - 200 - 5
            tx.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'ACME', due_balance: 795 });

            await service.updateCreditPayment('tenant-1', 'tx-1', { amount: 300, discount: 2 });

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'supplier_payment', 'tx-1');
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'supplier_payment', 'tx-1', 'discount');
            expect(tx.supplierCreditTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ amount: 300, discount_amount: 2, balance_after: 698 }),
            }));
            const calls = postedCalls();
            expect(calls.map((c: any) => c.legKey)).toEqual([undefined, 'discount']);
            expect(calls[0]).toMatchObject({ amount: 300, date: createdAt, referenceNumber: 'SPY-00001' });
            expect(calls[1]).toMatchObject({ amount: 2, date: createdAt });
        });

        it('update refuses to shrink amount + discount below what is allocated', async () => {
            db.supplierCreditTransaction.findFirst.mockResolvedValue({
                id: 'tx-1', supplier_id: 'sup-1', type: 'PAYMENT', amount: 200, discount_amount: 5,
                supplier: { id: 'sup-1' }, creator: null,
            });
            db.supplierPaymentAllocation.aggregate.mockResolvedValue({ _sum: { amount: 205 } });

            await expect(service.updateCreditPayment('tenant-1', 'tx-1', { discount: 0 }))
                .rejects.toThrow(BadRequestException);
        });

        it('delete reverses amount + discount and voids both legs', async () => {
            db.supplierCreditTransaction.findFirst.mockResolvedValue({
                id: 'tx-1', supplier_id: 'sup-1', type: 'PAYMENT', amount: 200, discount_amount: 5,
                supplier: { id: 'sup-1' }, creator: null,
            });
            db.supplierPaymentAllocation.count = jest.fn().mockResolvedValue(0);
            const tx = mockTx();
            tx.supplier.findFirst.mockResolvedValue({ id: 'sup-1', due_balance: 795 });

            await service.deleteCreditPayment('tenant-1', 'tx-1');

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'supplier_payment', 'tx-1');
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(tx, 'tenant-1', 'supplier_payment', 'tx-1', 'discount');
            expect(tx.supplier.update).toHaveBeenCalledWith({ where: { id: 'sup-1' }, data: { due_balance: 1000 } });
        });

        it('counts the discount as applicable when reporting the unapplied advance', async () => {
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'ACME', due_balance: 0 });
            db.purchase.findMany.mockResolvedValue([]);
            db.supplierCreditTransaction.findMany.mockResolvedValue([
                { id: 'tx-1', amount: 98, discount_amount: 2, allocations: [{ amount: 60 }] },
            ]);

            const summary = await service.getBillingSummary('tenant-1', 'sup-1');

            expect(summary.unallocated_advance).toBe(40);
        });
    });
});
