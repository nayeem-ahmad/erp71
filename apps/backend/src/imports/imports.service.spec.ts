import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ImportsService } from './imports.service';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { postMultiLeg } from '../accounting/posting.utils';

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    resolveWarehouseId: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    postMultiLeg: jest.fn(),
}));

describe('ImportsService', () => {
    let service: ImportsService;
    let db: any;
    let tx: any;

    /** The tenant's seeded chart, keyed by the names the service looks up. */
    const ACCOUNTS: Record<string, string> = {
        'Goods in Transit': 'acc-transit',
        'LC Margin & Advance to Bank': 'acc-margin',
        'Advance Income Tax (AIT)': 'acc-ait',
        'VAT Rebate Receivable': 'acc-vat',
        'LC Acceptance Payable': 'acc-lc-payable',
        'LC & Bank Charges': 'acc-bank-charges',
        'FX Gain': 'acc-fx-gain',
        'FX Loss': 'acc-fx-loss',
        Purchases: 'acc-purchases',
        'Purchase Payable': 'acc-payable',
        'Accrued Import Charges': 'acc-accrued',
        'Import Charges Written Off': 'acc-written-off',
    };

    /**
     * A two-line USD shipment: 10 widgets at $100 and 10 gadgets at $300, at
     * 120 BDT/USD. Goods value 480,000 BDT.
     */
    const shipment = (overrides: Record<string, unknown> = {}) => ({
        id: 'ship-1',
        tenant_id: 'tenant-1',
        store_id: 'store-1',
        supplier_id: 'sup-1',
        purchase_id: null,
        reference_number: 'IMP-2526-00001',
        status: 'CUSTOMS',
        currency: 'USD',
        fx_rate_at_open: '120.000000',
        fx_rate_at_settle: null,
        accepted_at: null,
        acceptance_due_date: null,
        tenor_days: null,
        notes: null,
        invoice_value_fc: '4000.00',
        supplier: { id: 'sup-1', name: 'Shenzhen Trading Co' },
        items: [
            {
                id: 'item-1',
                product_id: 'prod-1',
                quantity: 10,
                unit_price_fc: '100.0000',
                net_weight_kg: '9.000',
                cbm: null,
                landed_unit_cost: null,
                product: { name: 'Widget' },
            },
            {
                id: 'item-2',
                product_id: 'prod-2',
                quantity: 10,
                unit_price_fc: '300.0000',
                net_weight_kg: '1.000',
                cbm: null,
                landed_unit_cost: null,
                product: { name: 'Gadget' },
            },
        ],
        costs: [],
        documents: [],
        ...overrides,
    });

    beforeEach(async () => {
        tx = {
            account: {
                findFirst: jest.fn(({ where }: any) =>
                    Promise.resolve(ACCOUNTS[where.name] ? { id: ACCOUNTS[where.name] } : null),
                ),
            },
            documentSequence: {
                upsert: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({ next_number: 2 }),
            },
            product: { findMany: jest.fn() },
            importShipment: {
                create: jest.fn(),
                update: jest.fn(),
                // Every claim-then-act path guards with updateMany, so the
                // default has to be "this caller won the race".
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ship-1', status: 'CLOSED' }),
            },
            importShipmentItem: { deleteMany: jest.fn(), update: jest.fn() },
            importCost: {
                create: jest.fn(),
                update: jest.fn(),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUniqueOrThrow: jest.fn(),
            },
            purchase: { create: jest.fn().mockResolvedValue({ id: 'purchase-1', purchase_number: 'PUR-IMP-2526-00001' }) },
            purchaseItem: { create: jest.fn() },
            supplier: { findFirst: jest.fn().mockResolvedValue({ due_balance: '0' }), update: jest.fn() },
            supplierCreditTransaction: { create: jest.fn() },
        };

        db = {
            $transaction: jest.fn(async (cb: any) => cb(tx)),
            store: { findFirst: jest.fn() },
            supplier: { findFirst: jest.fn() },
            importShipment: {
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn().mockResolvedValue(0),
                update: jest.fn(),
                delete: jest.fn(),
            },
            importCost: {
                findMany: jest.fn(),
                groupBy: jest.fn().mockResolvedValue([]),
                update: jest.fn(),
                delete: jest.fn(),
            },
            importDocument: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [ImportsService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(ImportsService);

        (resolveWarehouseId as jest.Mock).mockResolvedValue('wh-1');
        (applyInventoryMovement as jest.Mock).mockClear().mockResolvedValue(0);
        (postMultiLeg as jest.Mock).mockClear().mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'JV-00001',
        });
    });

    describe('create', () => {
        beforeEach(() => {
            db.store.findFirst.mockResolvedValue({ id: 'store-1' });
            db.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
            tx.product.findMany.mockResolvedValue([
                { id: 'prod-1', hs_code: '8414.51.00', net_weight_kg: '9.000', cbm: '0.0500' },
            ]);
            tx.importShipment.create.mockResolvedValue({ id: 'ship-1' });
        });

        const dto = (overrides: Record<string, unknown> = {}) => ({
            storeId: 'store-1',
            supplierId: 'sup-1',
            currency: 'USD',
            fxRateAtOpen: 120,
            items: [{ productId: 'prod-1', quantity: 10, unitPriceFc: 100 }],
            ...overrides,
        });

        it('numbers the shipment from the import series', async () => {
            await service.create('tenant-1', 'user-1', dto() as any);

            expect(tx.importShipment.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ reference_number: expect.stringMatching(/^IMP-\d{4}-\d{5}$/) }),
                }),
            );
        });

        it('snapshots the product’s customs figures onto the item', async () => {
            await service.create('tenant-1', 'user-1', dto() as any);

            const items = tx.importShipment.create.mock.calls[0][0].data.items.create;
            // A later HS reclassification must not retroactively change how
            // this entry was assessed.
            expect(items[0]).toMatchObject({ hs_code: '8414.51.00', net_weight_kg: '9.000' });
        });

        it('lets the caller override a snapshot for this shipment', async () => {
            await service.create('tenant-1', 'user-1', dto({
                items: [{ productId: 'prod-1', quantity: 10, unitPriceFc: 100, hsCode: '8414.59.00' }],
            }) as any);

            const items = tx.importShipment.create.mock.calls[0][0].data.items.create;
            expect(items[0].hs_code).toBe('8414.59.00');
        });

        it('computes the invoice value in the foreign currency', async () => {
            await service.create('tenant-1', 'user-1', dto() as any);

            expect(Number(tx.importShipment.create.mock.calls[0][0].data.invoice_value_fc)).toBe(1000);
        });

        it('refuses a foreign-currency shipment with no rate', async () => {
            await expect(
                service.create('tenant-1', 'user-1', dto({ fxRateAtOpen: undefined }) as any),
            ).rejects.toThrow(BadRequestException);
        });

        it('allows a BDT shipment with no rate', async () => {
            await expect(
                service.create('tenant-1', 'user-1', dto({ currency: 'BDT', fxRateAtOpen: undefined }) as any),
            ).resolves.toBeDefined();
        });

        it('refuses a product from another workspace', async () => {
            tx.product.findMany.mockResolvedValue([]);
            await expect(service.create('tenant-1', 'user-1', dto() as any)).rejects.toThrow(
                /products do not exist/,
            );
        });
    });

    describe('cost sheet', () => {
        it('allocates freight on weight and duty on value', async () => {
            const sheet = service.buildCostSheet(
                shipment({
                    costs: [
                        { cost_type: 'FREIGHT', description: null, amount_bdt: '10000.00', allocation_basis: 'WEIGHT', is_capitalized: true },
                        { cost_type: 'CUSTOMS_DUTY', description: null, amount_bdt: '48000.00', allocation_basis: 'VALUE', is_capitalized: true },
                    ],
                }) as any,
            );

            expect(sheet.goods_value_bdt).toBe(480000);
            expect(sheet.capitalized_charges_bdt).toBe(58000);
            expect(sheet.total_landed_bdt).toBe(538000);

            // Freight 90:10 by weight, duty 25:75 by value.
            expect(sheet.items[0].allocated_charges_bdt).toBe(9000 + 12000);
            expect(sheet.items[1].allocated_charges_bdt).toBe(1000 + 36000);
        });

        it('keeps recoverable charges out of the goods’ cost', async () => {
            const sheet = service.buildCostSheet(
                shipment({
                    costs: [
                        { cost_type: 'CUSTOMS_DUTY', description: null, amount_bdt: '48000.00', allocation_basis: 'VALUE', is_capitalized: true },
                        // Rebatable, so it must not reach inventory.
                        { cost_type: 'VAT', description: null, amount_bdt: '79200.00', allocation_basis: 'VALUE', is_capitalized: false },
                        { cost_type: 'AIT', description: null, amount_bdt: '24000.00', allocation_basis: 'VALUE', is_capitalized: false },
                    ],
                }) as any,
            );

            expect(sheet.capitalized_charges_bdt).toBe(48000);
            expect(sheet.non_capitalized_bdt).toBe(103200);
            expect(sheet.total_landed_bdt).toBe(528000);
        });

        it('allocates to the paisa across the lines', async () => {
            const sheet = service.buildCostSheet(
                shipment({
                    costs: [
                        { cost_type: 'CF_AGENT', description: null, amount_bdt: '10000.00', allocation_basis: 'VALUE', is_capitalized: true },
                    ],
                }) as any,
            );

            const allocated = sheet.items.reduce((sum, item) => sum + item.allocated_charges_bdt, 0);
            expect(Number(allocated.toFixed(2))).toBe(10000);
        });

        it('reports a projected unit cost before receipt and no actual one', async () => {
            const sheet = service.buildCostSheet(shipment() as any);

            // $100 at 120 BDT, with no charges recorded yet.
            expect(sheet.items[0].projected_unit_cost).toBe(12000);
            expect(sheet.items[0].landed_unit_cost).toBeNull();
        });
    });

    describe('addCost', () => {
        beforeEach(() => {
            db.importShipment.findFirst.mockResolvedValue(shipment());
            tx.importCost.create.mockResolvedValue({ id: 'cost-1' });
            tx.importCost.update.mockResolvedValue({ id: 'cost-1', voucher_id: 'voucher-1' });
        });

        it('debits goods in transit for a capitalised charge', async () => {
            await service.addCost('tenant-1', 'user-1', 'ship-1', {
                costType: 'CUSTOMS_DUTY',
                amount: 48000,
                paidFromAccountId: 'acc-bank',
            } as any);

            expect(postMultiLeg).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: 'import_cost',
                    legs: [
                        expect.objectContaining({ accountId: 'acc-transit', debit: 48000 }),
                        expect.objectContaining({ accountId: 'acc-bank', credit: 48000 }),
                    ],
                }),
            );
        });

        it('debits the rebate receivable for VAT, never inventory', async () => {
            await service.addCost('tenant-1', 'user-1', 'ship-1', {
                costType: 'VAT',
                amount: 79200,
                paidFromAccountId: 'acc-bank',
            } as any);

            const legs = (postMultiLeg as jest.Mock).mock.calls[0][0].legs;
            expect(legs[0]).toMatchObject({ accountId: 'acc-vat', debit: 79200 });
            expect(legs.map((leg: any) => leg.accountId)).not.toContain('acc-transit');
        });

        it('routes AIT to the advance-tax account', async () => {
            await service.addCost('tenant-1', 'user-1', 'ship-1', {
                costType: 'AIT',
                amount: 24000,
                paidFromAccountId: 'acc-bank',
            } as any);

            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs[0].accountId).toBe('acc-ait');
        });

        it('accrues a charge against a liability rather than not posting it', async () => {
            // A C&F bill that has arrived but not been paid still has to reach
            // the landed cost — and the ledger. This used to post nothing on the
            // grounds that there was nowhere honest to credit it; the honest
            // credit is an accrual, and without one the receipt went on to
            // credit Goods in Transit for a debit that was never made.
            await service.addCost('tenant-1', 'user-1', 'ship-1', {
                costType: 'CF_AGENT',
                amount: 5000,
            } as any);

            expect(tx.importCost.create).toHaveBeenCalled();
            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs).toEqual([
                expect.objectContaining({ accountId: 'acc-transit', debit: 5000 }),
                expect.objectContaining({ accountId: 'acc-accrued', credit: 5000 }),
            ]);
        });

        it('translates a foreign-currency charge into BDT', async () => {
            await service.addCost('tenant-1', 'user-1', 'ship-1', {
                costType: 'FREIGHT',
                amount: 500,
                currency: 'USD',
                fxRate: 120,
                paidFromAccountId: 'acc-bank',
            } as any);

            expect(Number(tx.importCost.create.mock.calls[0][0].data.amount_bdt)).toBe(60000);
        });

        it('refuses a foreign-currency charge with no rate', async () => {
            await expect(
                service.addCost('tenant-1', 'user-1', 'ship-1', {
                    costType: 'FREIGHT',
                    amount: 500,
                    currency: 'USD',
                } as any),
            ).rejects.toThrow(/exchange rate is required/);
        });

        it('defaults the allocation basis from the cost type', async () => {
            await service.addCost('tenant-1', 'user-1', 'ship-1', {
                costType: 'FREIGHT',
                amount: 10000,
            } as any);

            expect(tx.importCost.create.mock.calls[0][0].data.allocation_basis).toBe('WEIGHT');
        });

        it('refuses a cost against a received shipment', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ status: 'RECEIVED', purchase_id: 'purchase-1' }));

            await expect(
                service.addCost('tenant-1', 'user-1', 'ship-1', { costType: 'CF_AGENT', amount: 5000 } as any),
            ).rejects.toThrow(/has been received/);
        });

        it('explains itself when the import accounts are not seeded', async () => {
            tx.account.findFirst.mockResolvedValue(null);

            await expect(
                service.addCost('tenant-1', 'user-1', 'ship-1', {
                    costType: 'CUSTOMS_DUTY',
                    amount: 100,
                    paidFromAccountId: 'acc-bank',
                } as any),
            ).rejects.toThrow(/accounting bootstrap/);
        });
    });

    describe('receive', () => {
        const received = () =>
            shipment({
                costs: [
                    { cost_type: 'FREIGHT', description: null, amount_bdt: '10000.00', allocation_basis: 'WEIGHT', is_capitalized: true },
                    { cost_type: 'CUSTOMS_DUTY', description: null, amount_bdt: '48000.00', allocation_basis: 'VALUE', is_capitalized: true },
                    { cost_type: 'VAT', description: null, amount_bdt: '79200.00', allocation_basis: 'VALUE', is_capitalized: false },
                ],
            });

        beforeEach(() => {
            db.importShipment.findFirst.mockResolvedValue(received());
            tx.importShipment.update.mockResolvedValue({ id: 'ship-1', status: 'RECEIVED' });
        });

        it('emits an ordinary purchase, which is the whole point', async () => {
            await service.receive('tenant-1', 'user-1', 'ship-1', {} as any);

            expect(tx.purchase.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    purchase_number: 'PUR-IMP-2526-00001',
                    reference_number: 'IMP-2526-00001',
                    supplier_id: 'sup-1',
                }),
            });
        });

        it('bills the supplier only for their invoice, not for duty and freight', async () => {
            await service.receive('tenant-1', 'user-1', 'ship-1', {} as any);

            // Duty is owed to Customs and freight to the shipping line. Putting
            // them in the payable would overstate what the supplier is owed by
            // 58,000 and never reconcile against their statement.
            expect(Number(tx.purchase.create.mock.calls[0][0].data.total_amount)).toBe(480000);
            expect(Number(tx.supplierCreditTransaction.create.mock.calls[0][0].data.amount)).toBe(480000);
        });

        it('moves stock at the landed cost, not the invoice price', async () => {
            await service.receive('tenant-1', 'user-1', 'ship-1', {} as any);

            const costs = (applyInventoryMovement as jest.Mock).mock.calls.map(([, args]) => [
                args.productId,
                args.unitCost,
            ]);

            // Widget: 120,000 goods + 9,000 freight + 12,000 duty = 141,000 / 10.
            // Gadget: 360,000 goods + 1,000 freight + 36,000 duty = 397,000 / 10.
            expect(costs).toEqual([
                ['prod-1', 14100],
                ['prod-2', 39700],
            ]);
        });

        it('records the invoice price on the purchase line so the bill reconciles', async () => {
            await service.receive('tenant-1', 'user-1', 'ship-1', {} as any);

            const lines = tx.purchaseItem.create.mock.calls.map(([{ data }]: any) => Number(data.unit_cost));
            expect(lines).toEqual([12000, 36000]);
        });

        it('stamps the landed cost onto the shipment item', async () => {
            await service.receive('tenant-1', 'user-1', 'ship-1', {} as any);

            expect(tx.importShipmentItem.update).toHaveBeenCalledWith({
                where: { id: 'item-1' },
                data: { landed_unit_cost: expect.anything() },
            });
        });

        it('posts one balanced multi-leg entry', async () => {
            await service.receive('tenant-1', 'user-1', 'ship-1', {} as any);

            const call = (postMultiLeg as jest.Mock).mock.calls.at(-1)![0];
            expect(call.eventType).toBe('import_receipt');

            const debits = call.legs.reduce((sum: number, leg: any) => sum + (leg.debit ?? 0), 0);
            const credits = call.legs.reduce((sum: number, leg: any) => sum + (leg.credit ?? 0), 0);
            expect(debits).toBe(credits);

            // Inventory takes the landed total; transit is cleared of exactly
            // what was booked to it; the payable is the supplier's invoice.
            expect(call.legs).toEqual([
                expect.objectContaining({ accountId: 'acc-purchases', debit: 538000 }),
                expect.objectContaining({ accountId: 'acc-transit', credit: 58000 }),
                expect.objectContaining({ accountId: 'acc-payable', credit: 480000, partyType: 'SUPPLIER', partyId: 'sup-1' }),
            ]);
        });

        it('refuses to receive twice', async () => {
            db.importShipment.findFirst.mockResolvedValue(received());
            (db.importShipment.findFirst as jest.Mock).mockResolvedValue(
                shipment({ purchase_id: 'purchase-1', status: 'RECEIVED' }),
            );

            await expect(service.receive('tenant-1', 'user-1', 'ship-1', {} as any)).rejects.toThrow(
                /already been received/,
            );
        });

        it('refuses a cancelled shipment', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ status: 'CANCELLED' }));
            await expect(service.receive('tenant-1', 'user-1', 'ship-1', {} as any)).rejects.toThrow(
                /cancelled/,
            );
        });

        it('refuses a shipment with no items', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ items: [] }));
            await expect(service.receive('tenant-1', 'user-1', 'ship-1', {} as any)).rejects.toThrow(
                /no items/,
            );
        });

        it('refuses a foreign-currency shipment with no rate', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ fx_rate_at_open: null }));
            await expect(service.receive('tenant-1', 'user-1', 'ship-1', {} as any)).rejects.toThrow(
                /no exchange rate/,
            );
        });
    });

    describe('updateStatus', () => {
        beforeEach(() => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ status: 'SHIPPED' }));
            db.importShipment.update.mockResolvedValue({ id: 'ship-1' });
        });

        it('moves the shipment forward', async () => {
            await service.updateStatus('tenant-1', 'ship-1', 'DOCS_RECEIVED');
            expect(db.importShipment.update).toHaveBeenCalledWith({
                where: { id: 'ship-1' },
                data: { status: 'DOCS_RECEIVED' },
            });
        });

        it('refuses moving backwards', async () => {
            await expect(service.updateStatus('tenant-1', 'ship-1', 'LC_ISSUED')).rejects.toThrow(
                /cannot move from SHIPPED to LC_ISSUED/,
            );
        });

        it('refuses setting RECEIVED directly', async () => {
            // That path writes a Purchase and moves stock; a plain status PATCH
            // would leave a shipment claiming goods it never received.
            await expect(service.updateStatus('tenant-1', 'ship-1', 'RECEIVED')).rejects.toThrow(
                /receive action/,
            );
        });
    });

    describe('accept', () => {
        const received = (overrides: Record<string, unknown> = {}) =>
            shipment({ purchase_id: 'purchase-1', status: 'RECEIVED', ...overrides });

        beforeEach(() => {
            db.importShipment.findFirst.mockResolvedValue(received());
            tx.supplier.findFirst.mockResolvedValue({ due_balance: '480000' });
        });

        it('moves the debt from the supplier to the bank', async () => {
            const result = await service.accept('tenant-1', 'user-1', 'ship-1', {});

            expect(result.booked_bdt).toBe(480000);
            expect((postMultiLeg as jest.Mock).mock.calls[0][0]).toMatchObject({
                eventType: 'import_acceptance',
            });
            // The whole point: Purchase Payable is cleared and LC Acceptance
            // Payable is CREDITED, so the account `settle` debits has a balance.
            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs).toEqual([
                expect.objectContaining({
                    accountId: 'acc-payable',
                    debit: 480000,
                    partyType: 'SUPPLIER',
                    partyId: 'sup-1',
                }),
                expect.objectContaining({ accountId: 'acc-lc-payable', credit: 480000 }),
            ]);
        });

        it('brings the supplier due balance down, because the bank has paid them', async () => {
            await service.accept('tenant-1', 'user-1', 'ship-1', {});

            expect(tx.supplierCreditTransaction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        supplier_id: 'sup-1',
                        type: 'PAYMENT',
                        reference_type: 'IMPORT_SHIPMENT',
                    }),
                }),
            );
            expect(tx.supplier.update.mock.calls[0][0].data.due_balance.toString()).toBe('0');
        });

        it('dates the maturity from the tenor', async () => {
            db.importShipment.findFirst.mockResolvedValue(received({ tenor_days: 90 }));

            await service.accept('tenant-1', 'user-1', 'ship-1', { acceptedAt: '2026-01-01T00:00:00.000Z' });

            const written = tx.importShipment.updateMany.mock.calls[0][0].data;
            expect(written.acceptance_due_date.toISOString()).toBe('2026-04-01T00:00:00.000Z');
        });

        it('refuses before receipt, which is where the payable comes from', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ purchase_id: null }));
            await expect(service.accept('tenant-1', 'user-1', 'ship-1', {})).rejects.toThrow(/Receive the shipment/);
        });

        it('refuses a second acceptance', async () => {
            db.importShipment.findFirst.mockResolvedValue(received({ accepted_at: new Date() }));
            await expect(service.accept('tenant-1', 'user-1', 'ship-1', {})).rejects.toThrow(/already been accepted/);
        });

        it('refuses when another request claimed the row first', async () => {
            tx.importShipment.updateMany.mockResolvedValue({ count: 0 });
            await expect(service.accept('tenant-1', 'user-1', 'ship-1', {})).rejects.toThrow(/already been accepted/);
        });
    });

    describe('settle', () => {
        const settled = (overrides: Record<string, unknown> = {}) =>
            shipment({
                purchase_id: 'purchase-1',
                status: 'RECEIVED',
                accepted_at: new Date('2026-01-01'),
                ...overrides,
            });

        beforeEach(() => {
            db.importShipment.findFirst.mockResolvedValue(settled());
            tx.importShipment.findUniqueOrThrow.mockResolvedValue({ id: 'ship-1', status: 'CLOSED' });
        });

        it('books an FX gain when the taka strengthened', async () => {
            // Booked at 120, settled at 118: 4,000 USD costs 8,000 BDT less.
            const result = await service.settle('tenant-1', 'user-1', 'ship-1', {
                fxRateAtSettle: 118,
                paidFromAccountId: 'acc-bank',
            } as any);

            expect(result.fx_gain).toBe(8000);
            expect(result.fx_loss).toBe(0);
            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs).toEqual([
                expect.objectContaining({ accountId: 'acc-lc-payable', debit: 480000 }),
                expect.objectContaining({ accountId: 'acc-bank', credit: 472000 }),
                expect.objectContaining({ accountId: 'acc-fx-gain', credit: 8000 }),
            ]);
        });

        it('books an FX loss when it weakened', async () => {
            const result = await service.settle('tenant-1', 'user-1', 'ship-1', {
                fxRateAtSettle: 123,
                paidFromAccountId: 'acc-bank',
            } as any);

            expect(result.fx_loss).toBe(12000);
            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs.at(-1)).toMatchObject({
                accountId: 'acc-fx-loss',
                debit: 12000,
            });
        });

        it('writes no FX leg when the rate did not move', async () => {
            await service.settle('tenant-1', 'user-1', 'ship-1', {
                fxRateAtSettle: 120,
                paidFromAccountId: 'acc-bank',
            } as any);

            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs).toHaveLength(2);
        });

        it('accepts first when nobody did, so the debit it makes has a credit behind it', async () => {
            db.importShipment.findFirst.mockResolvedValue(settled({ accepted_at: null }));
            tx.supplier.findFirst.mockResolvedValue({ due_balance: '480000' });

            const result = await service.settle('tenant-1', 'user-1', 'ship-1', {
                fxRateAtSettle: 120,
                paidFromAccountId: 'acc-bank',
            } as any);

            const events = (postMultiLeg as jest.Mock).mock.calls.map((call) => call[0].eventType);
            expect(events).toEqual(['import_acceptance', 'import_settlement']);
            expect(result.acceptance_voucher_number).toBe('JV-00001');
            // And the supplier is squared off, not left owing an invoice the
            // bank has already paid.
            expect(tx.supplier.update.mock.calls[0][0].data.due_balance.toString()).toBe('0');
        });

        it('does not accept twice when acceptance was already recorded', async () => {
            await service.settle('tenant-1', 'user-1', 'ship-1', {
                fxRateAtSettle: 120,
                paidFromAccountId: 'acc-bank',
            } as any);

            expect((postMultiLeg as jest.Mock).mock.calls.map((call) => call[0].eventType)).toEqual([
                'import_settlement',
            ]);
            expect(tx.supplierCreditTransaction.create).not.toHaveBeenCalled();
        });

        it('refuses settling before receipt', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ purchase_id: null }));
            await expect(
                service.settle('tenant-1', 'user-1', 'ship-1', { fxRateAtSettle: 120, paidFromAccountId: 'acc-bank' } as any),
            ).rejects.toThrow(/Receive the shipment/);
        });

        it('refuses settling twice', async () => {
            db.importShipment.findFirst.mockResolvedValue(settled({ fx_rate_at_settle: '118.000000' }));
            await expect(
                service.settle('tenant-1', 'user-1', 'ship-1', { fxRateAtSettle: 120, paidFromAccountId: 'acc-bank' } as any),
            ).rejects.toThrow(/already been settled/);
        });

        it('refuses when another request claimed the row first', async () => {
            tx.importShipment.updateMany.mockResolvedValue({ count: 0 });
            await expect(
                service.settle('tenant-1', 'user-1', 'ship-1', { fxRateAtSettle: 120, paidFromAccountId: 'acc-bank' } as any),
            ).rejects.toThrow(/already been settled/);
            expect(postMultiLeg).not.toHaveBeenCalled();
        });
    });
    describe('remove', () => {
        it('refuses deleting a received shipment', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ purchase_id: 'purchase-1' }));
            await expect(service.remove('tenant-1', 'ship-1')).rejects.toThrow(/cannot be deleted/);
        });

        it('refuses deleting one that has costs, since those have posted', async () => {
            db.importShipment.findFirst.mockResolvedValue(
                shipment({ costs: [{ id: 'cost-1', amount_bdt: '100', is_capitalized: true, allocation_basis: 'VALUE', cost_type: 'PORT', description: null }] }),
            );
            await expect(service.remove('tenant-1', 'ship-1')).rejects.toThrow(/Cancel it instead/);
        });

        it('deletes a bare draft', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ status: 'DRAFT', costs: [] }));
            await expect(service.remove('tenant-1', 'ship-1')).resolves.toEqual({ deleted: true });
        });

        it('404s on a shipment from another workspace', async () => {
            db.importShipment.findFirst.mockResolvedValue(null);
            await expect(service.remove('tenant-1', 'ship-1')).rejects.toThrow(NotFoundException);
        });
    });

    describe('payCost — the C&F bill that arrives after the goods', () => {
        const accrued = {
            id: 'cost-1',
            cost_type: 'CF_AGENT',
            description: 'Clearing agent',
            amount_bdt: '50000.00',
            is_capitalized: true,
            voucher_id: 'voucher-accrual',
            paid_from_account_id: null,
            paid_at: null,
        };

        beforeEach(() => {
            db.importShipment.findFirst.mockResolvedValue(
                shipment({ purchase_id: 'purchase-1', status: 'RECEIVED', costs: [accrued] }),
            );
            tx.importCost.update.mockResolvedValue({ ...accrued, payment_voucher_id: 'voucher-1' });
        });

        it('clears the accrual against the account the money left', async () => {
            await service.payCost('tenant-1', 'ship-1', 'cost-1', { paidFromAccountId: 'acc-bank' });

            expect((postMultiLeg as jest.Mock).mock.calls[0][0]).toMatchObject({
                eventType: 'import_cost',
                // Without this the voucher collides with the accrual's own
                // idempotency key and is silently dropped as a replay.
                legKey: 'payment',
            });
            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs).toEqual([
                expect.objectContaining({ accountId: 'acc-accrued', debit: 50000 }),
                expect.objectContaining({ accountId: 'acc-bank', credit: 50000 }),
            ]);
        });

        it('works after receipt, which is the whole reason it exists', async () => {
            await expect(
                service.payCost('tenant-1', 'ship-1', 'cost-1', { paidFromAccountId: 'acc-bank' }),
            ).resolves.toBeDefined();
        });

        it('refuses paying a charge that was already paid', async () => {
            db.importShipment.findFirst.mockResolvedValue(
                shipment({ costs: [{ ...accrued, paid_from_account_id: 'acc-bank' }] }),
            );
            await expect(
                service.payCost('tenant-1', 'ship-1', 'cost-1', { paidFromAccountId: 'acc-bank' }),
            ).rejects.toThrow(/already been paid/);
        });

        it('refuses when another request claimed the row first', async () => {
            tx.importCost.updateMany.mockResolvedValue({ count: 0 });
            await expect(
                service.payCost('tenant-1', 'ship-1', 'cost-1', { paidFromAccountId: 'acc-bank' }),
            ).rejects.toThrow(/already been paid/);
            expect(postMultiLeg).not.toHaveBeenCalled();
        });

        it('404s on a cost that is not on this shipment', async () => {
            await expect(
                service.payCost('tenant-1', 'ship-1', 'nope', { paidFromAccountId: 'acc-bank' }),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('addCost — an accrued charge still reaches the ledger', () => {
        beforeEach(() => {
            db.importShipment.findFirst.mockResolvedValue(shipment());
            tx.importCost.create.mockResolvedValue({ id: 'cost-1' });
            tx.importCost.update.mockResolvedValue({ id: 'cost-1' });
        });

        it('credits Accrued Import Charges when no account is named', async () => {
            await service.addCost('tenant-1', 'user-1', 'ship-1', {
                costType: 'CF_AGENT',
                amount: 50000,
            } as any);

            // Previously this posted nothing at all, so the receipt went on to
            // credit Goods in Transit for a debit that had never been made.
            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs).toEqual([
                expect.objectContaining({ accountId: 'acc-transit', debit: 50000 }),
                expect.objectContaining({ accountId: 'acc-accrued', credit: 50000 }),
            ]);
            expect(tx.importCost.create.mock.calls[0][0].data.paid_at).toBeNull();
        });

        it('posts nothing for a zero charge', async () => {
            await service.addCost('tenant-1', 'user-1', 'ship-1', { costType: 'OTHER', amount: 0 } as any);
            expect(postMultiLeg).not.toHaveBeenCalled();
        });
    });

    describe('updateCost', () => {
        const unposted = {
            id: 'cost-1',
            cost_type: 'FREIGHT',
            description: null,
            currency: 'BDT',
            amount: '1000.00',
            fx_rate: null,
            amount_bdt: '1000.00',
            allocation_basis: 'WEIGHT',
            is_capitalized: true,
            voucher_id: null,
        };

        it('refuses the payment fields instead of dropping them', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ costs: [unposted] }));

            // The DTO inherits these from the create shape, and the service used
            // to accept them and write neither — so a user who thought they had
            // recorded a payment had changed nothing.
            await expect(
                service.updateCost('tenant-1', 'ship-1', 'cost-1', {
                    paidFromAccountId: 'acc-bank',
                } as any),
            ).rejects.toThrow(/Use the pay action/);
        });

        it('refuses editing a charge that has posted', async () => {
            db.importShipment.findFirst.mockResolvedValue(
                shipment({ costs: [{ ...unposted, voucher_id: 'voucher-1' }] }),
            );
            await expect(
                service.updateCost('tenant-1', 'ship-1', 'cost-1', { amount: 2000 } as any),
            ).rejects.toThrow(/already been posted/);
        });

        it('rewrites an unposted charge and re-derives its BDT amount', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ costs: [unposted] }));
            db.importCost.update.mockResolvedValue({ id: 'cost-1' });

            await service.updateCost('tenant-1', 'ship-1', 'cost-1', {
                amount: 200,
                currency: 'USD',
                fxRate: 120,
            } as any);

            expect(db.importCost.update.mock.calls[0][0].data.amount_bdt.toString()).toBe('24000');
        });
    });

    describe('cancel', () => {
        it('writes capitalised charges off Goods in Transit', async () => {
            db.importShipment.findFirst.mockResolvedValue(
                shipment({
                    costs: [
                        { amount_bdt: '30000.00', is_capitalized: true, voucher_id: 'v1' },
                        // Rebatable VAT stays claimable, so it is not written off.
                        { amount_bdt: '9000.00', is_capitalized: false, voucher_id: 'v2' },
                        // Never posted, so there is nothing in transit to reverse.
                        { amount_bdt: '5000.00', is_capitalized: true, voucher_id: null },
                    ],
                }),
            );

            const result = await service.cancel('tenant-1', 'ship-1', { reason: 'Supplier defaulted' });

            expect(result.written_off_bdt).toBe(30000);
            expect((postMultiLeg as jest.Mock).mock.calls[0][0]).toMatchObject({ eventType: 'import_write_off' });
            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs).toEqual([
                expect.objectContaining({ accountId: 'acc-written-off', debit: 30000 }),
                expect.objectContaining({ accountId: 'acc-transit', credit: 30000 }),
            ]);
        });

        it('posts nothing when no capitalised charge ever reached transit', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ costs: [] }));

            const result = await service.cancel('tenant-1', 'ship-1', {});

            expect(result.written_off_bdt).toBe(0);
            expect(postMultiLeg).not.toHaveBeenCalled();
        });

        it('refuses cancelling a received shipment', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ status: 'RECEIVED' }));
            await expect(service.cancel('tenant-1', 'ship-1', {})).rejects.toThrow(/purchase return/);
        });

        it('is reached through the status endpoint, so the ledger entry is not skipped', async () => {
            db.importShipment.findFirst.mockResolvedValue(
                shipment({ costs: [{ amount_bdt: '30000.00', is_capitalized: true, voucher_id: 'v1' }] }),
            );

            await service.updateStatus('tenant-1', 'ship-1', 'CANCELLED');

            expect((postMultiLeg as jest.Mock).mock.calls[0][0]).toMatchObject({ eventType: 'import_write_off' });
        });
    });

    describe('findAll', () => {
        const row = {
            id: 'ship-1',
            currency: 'USD',
            fx_rate_at_open: '120.000000',
            invoice_value_fc: '4000.00',
            _count: { items: 2 },
        };

        beforeEach(() => {
            db.importShipment.findMany.mockResolvedValue([row]);
            db.importShipment.count.mockResolvedValue(1);
        });

        it('returns a page rather than the whole history', async () => {
            const result = await service.findAll('tenant-1', { page: 2, limit: 10 } as any);

            expect(db.importShipment.findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 10 });
            expect(result).toMatchObject({ total: 1, page: 2, limit: 10 });
        });

        it('searches reference, LC, BL, BE and supplier name in the database', async () => {
            await service.findAll('tenant-1', { search: 'IMP-25' } as any);

            const or = db.importShipment.findMany.mock.calls[0][0].where.OR;
            expect(or.map((clause: any) => Object.keys(clause)[0])).toEqual([
                'reference_number',
                'lc_number',
                'bl_number',
                'be_number',
                'supplier',
            ]);
        });

        it('falls back to created_at for a column outside the allowlist', async () => {
            // The direction the caller asked for is still honoured — only the
            // column they invented is replaced, because `orderBy` reaches Prisma
            // directly and an arbitrary name there is an error surface.
            await service.findAll('tenant-1', { sortBy: 'fx_rate_at_open; DROP TABLE', sortDir: 'asc' } as any);
            expect(db.importShipment.findMany.mock.calls[0][0].orderBy).toEqual({ created_at: 'asc' });
        });

        it('aggregates costs in SQL instead of shipping every row', async () => {
            db.importCost.groupBy.mockResolvedValue([{ shipment_id: 'ship-1', _sum: { amount_bdt: '75000.00' } }]);

            const result = await service.findAll('tenant-1', {} as any);

            expect(result.items[0]).toMatchObject({
                costs_to_date_bdt: 75000,
                item_count: 2,
                invoice_value_bdt: 480000,
            });
        });
    });

    describe('lcRegister', () => {
        const register = (overrides: Record<string, unknown> = {}) => ({
            id: 'ship-1',
            reference_number: 'IMP-2526-00001',
            lc_number: 'LC-991',
            lc_type: 'USANCE',
            bank_name: 'City Bank',
            supplier: { name: 'Shenzhen Trading Co' },
            status: 'SHIPPED',
            currency: 'USD',
            invoice_value_fc: '4000.00',
            fx_rate_at_open: '120.000000',
            lc_date: null,
            lc_expiry_date: null,
            latest_shipment_date: null,
            accepted_at: null,
            acceptance_due_date: null,
            costs: [],
            ...overrides,
        });

        it('values a BDT-denominated LC at its face value, not zero', async () => {
            // A local back-to-back LC carries no fx rate, and multiplying by
            // `num(null)` reported every one of them as worth nothing.
            db.importShipment.findMany.mockResolvedValue([
                register({ currency: 'BDT', fx_rate_at_open: null, invoice_value_fc: '480000.00' }),
            ]);

            const [row] = await service.lcRegister('tenant-1');

            expect(row.invoice_value_bdt).toBe(480000);
        });

        it('translates a foreign LC at its opening rate', async () => {
            db.importShipment.findMany.mockResolvedValue([register()]);
            const [row] = await service.lcRegister('tenant-1');
            expect(row.invoice_value_bdt).toBe(480000);
        });

        it('counts days to expiry down through zero rather than clamping', async () => {
            const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
            db.importShipment.findMany.mockResolvedValue([register({ lc_expiry_date: elevenDaysAgo })]);

            const [row] = await service.lcRegister('tenant-1');

            expect(row.days_to_expiry).toBeLessThan(0);
            expect(row.is_expired).toBe(true);
        });

        it('splits recoverable charges out of the running total', async () => {
            db.importShipment.findMany.mockResolvedValue([
                register({
                    costs: [
                        { amount_bdt: '30000.00', is_capitalized: true },
                        { amount_bdt: '9000.00', is_capitalized: false },
                    ],
                }),
            ]);

            const [row] = await service.lcRegister('tenant-1');

            expect(row.costs_to_date_bdt).toBe(39000);
            expect(row.recoverable_to_date_bdt).toBe(9000);
        });

        it('narrows to LCs expiring inside the window when asked', async () => {
            db.importShipment.findMany.mockResolvedValue([]);
            await service.lcRegister('tenant-1', 30);
            expect(db.importShipment.findMany.mock.calls[0][0].where.lc_expiry_date).toBeDefined();
        });
    });

    describe('dutyReport', () => {
        const line = (overrides: Record<string, unknown> = {}) => ({
            cost_type: 'CUSTOMS_DUTY',
            amount_bdt: '120000.00',
            is_capitalized: true,
            paid_at: new Date('2026-02-10'),
            shipment: { reference_number: 'IMP-2526-00001', be_number: 'BE-771', be_date: null },
            ...overrides,
        });

        it('totals by type and separates what comes back', async () => {
            db.importCost.findMany.mockResolvedValue([
                line(),
                line({ cost_type: 'VAT', amount_bdt: '75000.00', is_capitalized: false }),
                line({ cost_type: 'AIT', amount_bdt: '20000.00', is_capitalized: false }),
            ]);

            const report = await service.dutyReport('tenant-1', {});

            expect(report.total_bdt).toBe(215000);
            expect(report.recoverable_bdt).toBe(95000);
            expect(report.totals_by_type).toEqual([
                { cost_type: 'CUSTOMS_DUTY', amount_bdt: 120000 },
                { cost_type: 'VAT', amount_bdt: 75000 },
                { cost_type: 'AIT', amount_bdt: 20000 },
            ]);
        });

        it('reports what was paid in the period, not what was typed in', async () => {
            db.importCost.findMany.mockResolvedValue([]);

            await service.dutyReport('tenant-1', { from: '2026-01-01', to: '2026-03-31' });

            expect(db.importCost.findMany.mock.calls[0][0].where.paid_at).toEqual({
                gte: new Date('2026-01-01'),
                lte: new Date('2026-03-31'),
            });
        });

        it('excludes unpaid assessments by default', async () => {
            db.importCost.findMany.mockResolvedValue([]);
            await service.dutyReport('tenant-1', {});
            expect(db.importCost.findMany.mock.calls[0][0].where.paid_at).toEqual({ not: null });
        });

        it('includes them, dated on entry, when asked', async () => {
            db.importCost.findMany.mockResolvedValue([line({ paid_at: null })]);

            const report = await service.dutyReport('tenant-1', {
                from: '2026-01-01',
                to: '2026-03-31',
                includeUnpaid: true,
            });

            expect(db.importCost.findMany.mock.calls[0][0].where.OR).toHaveLength(2);
            expect(report.unpaid_bdt).toBe(120000);
            expect(report.lines[0].is_paid).toBe(false);
        });
    });

    describe('bankLimitUtilisation', () => {
        it('adds a BDT LC at face value beside a translated foreign one', async () => {
            db.importShipment.findMany.mockResolvedValue([
                { bank_name: 'City Bank', currency: 'USD', invoice_value_fc: '4000.00', fx_rate_at_open: '120.000000', status: 'SHIPPED' },
                { bank_name: 'City Bank', currency: 'BDT', invoice_value_fc: '20000.00', fx_rate_at_open: null, status: 'LC_ISSUED' },
                { bank_name: 'Brac Bank', currency: 'USD', invoice_value_fc: '1000.00', fx_rate_at_open: '120.000000', status: 'SHIPPED' },
            ]);

            const rows = await service.bankLimitUtilisation('tenant-1');

            // Heaviest exposure first: that is the row that refuses the next LC.
            expect(rows).toEqual([
                { bank_name: 'City Bank', open_lcs: 2, outstanding_bdt: 500000 },
                { bank_name: 'Brac Bank', open_lcs: 1, outstanding_bdt: 120000 },
            ]);
        });

        it('ignores drafts, which the bank has never seen', async () => {
            db.importShipment.findMany.mockResolvedValue([]);
            await service.bankLimitUtilisation('tenant-1');
            expect(db.importShipment.findMany.mock.calls[0][0].where.status.notIn).toContain('DRAFT');
        });
    });

    describe('documents', () => {
        it('files a document against the shipment and its uploader', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment());
            db.importDocument.create.mockResolvedValue({ id: 'doc-1' });

            await service.addDocument('tenant-1', 'user-1', 'ship-1', {
                docType: 'BL',
                fileName: 'bl.pdf',
                storageKey: 'imports/ship-1/bl.pdf',
            } as any);

            expect(db.importDocument.create.mock.calls[0][0].data).toMatchObject({
                tenant_id: 'tenant-1',
                shipment_id: 'ship-1',
                doc_type: 'BL',
                uploaded_by: 'user-1',
            });
        });

        it('404s on a document belonging to another shipment', async () => {
            db.importDocument.findFirst.mockResolvedValue(null);
            await expect(service.removeDocument('tenant-1', 'ship-1', 'doc-9')).rejects.toThrow(NotFoundException);
        });
    });
});

