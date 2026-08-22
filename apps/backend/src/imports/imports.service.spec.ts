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
            importShipment: { create: jest.fn(), update: jest.fn() },
            importShipmentItem: { deleteMany: jest.fn(), update: jest.fn() },
            importCost: { create: jest.fn(), update: jest.fn() },
            purchase: { create: jest.fn().mockResolvedValue({ id: 'purchase-1', purchase_number: 'PUR-IMP-2526-00001' }) },
            purchaseItem: { create: jest.fn() },
            supplier: { findFirst: jest.fn().mockResolvedValue({ due_balance: '0' }), update: jest.fn() },
            supplierCreditTransaction: { create: jest.fn() },
        };

        db = {
            $transaction: jest.fn(async (cb: any) => cb(tx)),
            store: { findFirst: jest.fn() },
            supplier: { findFirst: jest.fn() },
            importShipment: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
            importCost: { findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
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

        it('records an accrued charge without posting it', async () => {
            // A C&F bill that has arrived but not been paid still has to reach
            // the landed cost; there is simply nowhere honest to credit it yet.
            await service.addCost('tenant-1', 'user-1', 'ship-1', {
                costType: 'CF_AGENT',
                amount: 5000,
            } as any);

            expect(tx.importCost.create).toHaveBeenCalled();
            expect(postMultiLeg).not.toHaveBeenCalled();
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

    describe('settle', () => {
        const settled = (overrides: Record<string, unknown> = {}) =>
            shipment({ purchase_id: 'purchase-1', status: 'RECEIVED', ...overrides });

        beforeEach(() => {
            db.importShipment.findFirst.mockResolvedValue(settled());
            tx.importShipment.update.mockResolvedValue({ id: 'ship-1', status: 'CLOSED' });
        });

        it('books an FX gain when the taka strengthened', async () => {
            // Booked at 120, settled at 118: 4,000 USD costs 8,000 BDT less.
            const result = await service.settle('tenant-1', 'ship-1', {
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
            const result = await service.settle('tenant-1', 'ship-1', {
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
            await service.settle('tenant-1', 'ship-1', {
                fxRateAtSettle: 120,
                paidFromAccountId: 'acc-bank',
            } as any);

            expect((postMultiLeg as jest.Mock).mock.calls[0][0].legs).toHaveLength(2);
        });

        it('refuses settling before receipt', async () => {
            db.importShipment.findFirst.mockResolvedValue(shipment({ purchase_id: null }));
            await expect(
                service.settle('tenant-1', 'ship-1', { fxRateAtSettle: 120, paidFromAccountId: 'acc-bank' } as any),
            ).rejects.toThrow(/Receive the shipment/);
        });

        it('refuses settling twice', async () => {
            db.importShipment.findFirst.mockResolvedValue(settled({ fx_rate_at_settle: '118.000000' }));
            await expect(
                service.settle('tenant-1', 'ship-1', { fxRateAtSettle: 120, paidFromAccountId: 'acc-bank' } as any),
            ).rejects.toThrow(/already been settled/);
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
});
