import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MushakService } from './mushak.service';

const TENANT = {
    name: 'Karim Traders',
    brand_business_name: null,
    vat_registration_no: '000123456-0101',
    business_tin: '123456789012',
    business_type: 'GROCERY',
    default_vat_rate: 15,
    mushak_enabled: true,
    mushak_issue_address: '12 Motijheel, Dhaka',
    mushak_officer_name: 'Karim Uddin',
    mushak_officer_designation: 'Proprietor',
    mushak_economic_activity: 'Retail trade',
};

/** A sale whose lines carry the snapshot taken when it was posted. */
function postedSale(overrides: any = {}) {
    return {
        id: 'sale-1',
        serial_number: 'SL-1',
        reference_number: '2609-001',
        status: 'COMPLETED',
        total_amount: 1380,
        vat_amount: 180,
        sd_amount: 0,
        sale_date: new Date('2026-09-10T04:00:00.000Z'),
        created_at: new Date('2026-09-10T04:00:00.000Z'),
        mushak_destination: null,
        mushak_vehicle_no: null,
        store: { name: 'Motijheel', address: '12 Motijheel' },
        customer: {
            name: 'Rahim Stores',
            bin: '000999888-0202',
            nid: null,
            address: 'Gulshan',
            phone: '01700000000',
        },
        items: [
            {
                quantity: 2,
                price_at_sale: 575,
                vat_rate: 15,
                sd_rate: 0,
                vat_amount: 150,
                sd_amount: 0,
                product: { name: 'Rice 5kg', sku: 'R5', unit_type: 'kg_g', vat_rate: 15, sd_rate: null },
            },
            {
                quantity: 1,
                price_at_sale: 230,
                vat_rate: 15,
                sd_rate: 0,
                vat_amount: 30,
                sd_amount: 0,
                product: { name: 'Oil 1L', sku: 'O1', unit_type: 'none', vat_rate: 15, sd_rate: null },
            },
        ],
        ...overrides,
    };
}

describe('MushakService', () => {
    let service: MushakService;
    let db: any;

    beforeEach(async () => {
        db = {
            tenant: { findUnique: jest.fn().mockResolvedValue(TENANT) },
            sale: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
            salesReturn: { findFirst: jest.fn() },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [MushakService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(MushakService);
    });

    describe('getFormCatalogue', () => {
        it('lists every 6.x form and says which ones this build produces', async () => {
            const catalogue = await service.getFormCatalogue('t1');

            expect(catalogue.enabled).toBe(true);
            expect(catalogue.forms).toHaveLength(11);
            expect(catalogue.forms.filter((f) => f.supported).map((f) => f.code))
                .toEqual(['6.2', '6.3', '6.7', '6.10']);
        });

        it('reports a half-configured issuer rather than hiding it', async () => {
            db.tenant.findUnique.mockResolvedValue({ ...TENANT, mushak_officer_name: null });
            const catalogue = await service.getFormCatalogue('t1');
            expect(catalogue.issuer.readiness).toEqual({
                ready: false,
                missing: ['mushak_officer_name'],
            });
        });
    });

    describe('6.3 tax invoice', () => {
        it('lays a posted sale out in gazetted column order from the stored snapshot', async () => {
            db.sale.findFirst.mockResolvedValue(postedSale());

            const doc = await service.getTaxInvoice('t1', 'sale-1');

            expect(doc.form).toBe('6.3');
            expect(doc.estimated).toBe(false);
            expect(doc.lines).toHaveLength(2);
            expect(doc.lines[0]).toMatchObject({
                serial: 1,
                description: 'Rice 5kg',
                unitBn: 'কেজি',
                quantity: 2,
                unitValue: 500,
                totalValue: 1000,
                vatRate: 15,
                vatAmount: 150,
                inclusiveTotal: 1150,
            });
            expect(doc.totals).toEqual({
                totalValue: 1200,
                sdAmount: 0,
                vatAmount: 180,
                inclusiveTotal: 1380,
            });
        });

        it('foots to the amount actually billed when the sale was discounted', async () => {
            // The lines list 1380; the customer paid 1000. A tax invoice that
            // declared the undiscounted value would hand NBR output VAT the
            // business never collected, and would not add up to its own total.
            db.sale.findFirst.mockResolvedValue(postedSale({ total_amount: 1000 }));

            const doc = await service.getTaxInvoice('t1', 'sale-1');

            expect(doc.totals.inclusiveTotal).toBe(1000);
            expect(doc.totals.totalValue + doc.totals.vatAmount + doc.totals.sdAmount).toBe(1000);
            expect(doc.totals.vatAmount).toBeLessThan(180);
            expect(
                doc.lines.reduce((sum, line) => sum + line.inclusiveTotal, 0),
            ).toBe(1000);
        });

        it('carries the issuer and buyer blocks rule 40 requires', async () => {
            db.sale.findFirst.mockResolvedValue(postedSale());

            const doc = await service.getTaxInvoice('t1', 'sale-1');

            expect(doc.issuer).toMatchObject({
                name: 'Karim Traders',
                bin: '000123456-0101',
                address: '12 Motijheel, Dhaka',
                officerName: 'Karim Uddin',
                officerDesignation: 'Proprietor',
            });
            expect(doc.issuer.readiness.ready).toBe(true);
            expect(doc.buyer).toMatchObject({ name: 'Rahim Stores', bin: '000999888-0202' });
        });

        it('falls back to the customer address for the destination box', async () => {
            db.sale.findFirst.mockResolvedValue(postedSale());
            const doc = await service.getTaxInvoice('t1', 'sale-1');
            expect(doc.invoice.destination).toBe('Gulshan');
        });

        it('prefers a destination and vehicle captured on the sale', async () => {
            db.sale.findFirst.mockResolvedValue(
                postedSale({ mushak_destination: 'Chattogram depot', mushak_vehicle_no: 'Truck DM-11-2345' }),
            );
            const doc = await service.getTaxInvoice('t1', 'sale-1');
            expect(doc.invoice).toMatchObject({
                destination: 'Chattogram depot',
                vehicleNo: 'Truck DM-11-2345',
            });
        });

        it('shows a walk-in buyer rather than an empty block', async () => {
            db.sale.findFirst.mockResolvedValue(postedSale({ customer: null }));
            const doc = await service.getTaxInvoice('t1', 'sale-1');
            expect(doc.buyer).toEqual({
                name: 'Walk-in customer', bin: null, nid: null, address: null, phone: null,
            });
        });

        it('refuses to issue against a draft, which has supplied nothing', async () => {
            db.sale.findFirst.mockResolvedValue(postedSale({ status: 'DRAFT' }));
            await expect(service.getTaxInvoice('t1', 'sale-1')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('still prints a cancelled sale, flagged, so the reversal has a paper trail', async () => {
            db.sale.findFirst.mockResolvedValue(postedSale({ status: 'CANCELLED' }));
            const doc = await service.getTaxInvoice('t1', 'sale-1');
            expect(doc.invoice.cancelled).toBe(true);
        });

        it('reconstructs a pre-snapshot sale from the catalogue and says so', async () => {
            db.sale.findFirst.mockResolvedValue(
                postedSale({
                    items: [
                        {
                            quantity: 1,
                            price_at_sale: 1150,
                            vat_rate: null,
                            sd_rate: null,
                            vat_amount: 0,
                            sd_amount: 0,
                            product: { name: 'Legacy', sku: null, unit_type: 'none', vat_rate: 15, sd_rate: null },
                        },
                    ],
                    total_amount: 1150,
                }),
            );

            const doc = await service.getTaxInvoice('t1', 'sale-1');

            expect(doc.estimated).toBe(true);
            expect(doc.lines[0]).toMatchObject({ totalValue: 1000, vatAmount: 150 });
        });

        it('applies supplementary duty ahead of VAT when the product carries one', async () => {
            db.sale.findFirst.mockResolvedValue(
                postedSale({
                    items: [{
                        quantity: 1,
                        price_at_sale: 1265,
                        vat_rate: 15,
                        sd_rate: 10,
                        vat_amount: 165,
                        sd_amount: 100,
                        product: { name: 'Soft drink', sku: 'SD1', unit_type: 'none', vat_rate: 15, sd_rate: 10 },
                    }],
                    total_amount: 1265,
                }),
            );

            const doc = await service.getTaxInvoice('t1', 'sale-1');
            expect(doc.lines[0]).toMatchObject({
                totalValue: 1000, sdRate: 10, sdAmount: 100, vatRate: 15, vatAmount: 165,
            });
        });

        it('404s on a sale from another workspace', async () => {
            db.sale.findFirst.mockResolvedValue(null);
            await expect(service.getTaxInvoice('t1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('6.2 sales book', () => {
        it('books a discounted invoice at what was billed', async () => {
            db.sale.findMany.mockResolvedValue([postedSale({ total_amount: 1000 })]);

            const book = await service.getSalesBook('t1', {}, 'Asia/Dhaka');

            expect(book.rows[0].inclusiveTotal).toBe(1000);
            expect(book.totals.inclusiveTotal).toBe(1000);
        });

        it('lists one row per invoice with its VAT position', async () => {
            db.sale.findMany.mockResolvedValue([postedSale()]);

            const book = await service.getSalesBook('t1', { from: '2026-09-01', to: '2026-09-30' }, 'Asia/Dhaka');

            expect(book.form).toBe('6.2');
            expect(book.rows).toHaveLength(1);
            expect(book.rows[0]).toMatchObject({
                invoiceNumber: '2609-001',
                quantity: 3,
                totalValue: 1200,
                vatAmount: 180,
                inclusiveTotal: 1380,
            });
            expect(book.totals).toEqual({
                invoices: 1, totalValue: 1200, sdAmount: 0, vatAmount: 180, inclusiveTotal: 1380,
            });
        });

        it('leaves drafts and cancelled sales out of the book NBR inspects', async () => {
            await service.getSalesBook('t1', {}, 'Asia/Dhaka');
            expect(db.sale.findMany.mock.calls[0][0].where.status).toEqual({
                notIn: ['DRAFT', 'CANCELLED'],
            });
        });

        it('describes a long invoice without listing every line in the column', async () => {
            db.sale.findMany.mockResolvedValue([
                postedSale({
                    items: [1, 2, 3, 4].map((n) => ({
                        quantity: 1,
                        price_at_sale: 115,
                        vat_rate: 15,
                        sd_rate: 0,
                        vat_amount: 15,
                        sd_amount: 0,
                        product: { name: `Item ${n}`, sku: null, unit_type: 'none', vat_rate: 15, sd_rate: null },
                    })),
                    total_amount: 460,
                }),
            ]);

            const book = await service.getSalesBook('t1', {}, 'Asia/Dhaka');
            expect(book.rows[0].description).toBe('Item 1, Item 2 +2 more');
        });

        it('keeps zero-rated supplies in the book by default', async () => {
            db.sale.findMany.mockResolvedValue([
                postedSale({
                    items: [{
                        quantity: 1, price_at_sale: 100, vat_rate: 0, sd_rate: 0, vat_amount: 0, sd_amount: 0,
                        product: { name: 'Exempt', sku: null, unit_type: 'none', vat_rate: 0, sd_rate: null },
                    }],
                    total_amount: 100,
                }),
            ]);

            const all = await service.getSalesBook('t1', {}, 'Asia/Dhaka');
            const taxable = await service.getSalesBook('t1', { taxableOnly: 'true' }, 'Asia/Dhaka');

            expect(all.rows).toHaveLength(1);
            expect(taxable.rows).toHaveLength(0);
        });

        it('scopes to a branch when one is named', async () => {
            await service.getSalesBook('t1', { storeId: 'store-9' }, 'Asia/Dhaka');
            expect(db.sale.findMany.mock.calls[0][0].where.store_id).toBe('store-9');
        });

        it('reads the period in the workspace timezone', async () => {
            await service.getSalesBook('t1', { from: '2026-09-01', to: '2026-09-01' }, 'Asia/Dhaka');
            const { sale_date } = db.sale.findMany.mock.calls[0][0].where;
            // Dhaka is UTC+6, so a Dhaka day starts at 18:00 the day before UTC.
            expect(sale_date.gte.toISOString()).toBe('2026-08-31T18:00:00.000Z');
            expect(sale_date.lte.toISOString()).toBe('2026-09-01T17:59:59.999Z');
        });
    });

    describe('6.7 credit note', () => {
        const returnRow = (overrides: any = {}) => ({
            id: 'ret-1',
            return_number: 'RET-1',
            created_at: new Date('2026-09-12T04:00:00.000Z'),
            reason: 'Damaged in transit',
            store: { name: 'Motijheel' },
            sale: {
                id: 'sale-1',
                reference_number: '2609-001',
                serial_number: 'SL-1',
                sale_date: new Date('2026-09-10T04:00:00.000Z'),
                created_at: new Date('2026-09-10T04:00:00.000Z'),
                customer: { name: 'Rahim Stores', bin: '000999888-0202', nid: null, address: 'Gulshan', phone: null },
            },
            items: [{
                quantity: 1,
                refund_amount: 575,
                product: { name: 'Rice 5kg', sku: 'R5', unit_type: 'kg_g', vat_rate: 15, sd_rate: null },
                sale_item: { vat_rate: 15, sd_rate: 0 },
            }],
            ...overrides,
        });

        it('unwinds the supply at the rate the original invoice carried', async () => {
            db.salesReturn.findFirst.mockResolvedValue(returnRow());

            const note = await service.getCreditNote('t1', 'ret-1');

            expect(note.form).toBe('6.7');
            expect(note.against).toMatchObject({ saleId: 'sale-1', number: '2609-001' });
            expect(note.note.reason).toBe('Damaged in transit');
            expect(note.lines[0]).toMatchObject({ totalValue: 500, vatAmount: 75, inclusiveTotal: 575 });
            expect(note.estimated).toBe(false);
        });

        it('refuses a return with no invoice to reduce', async () => {
            db.salesReturn.findFirst.mockResolvedValue(returnRow({ sale: null }));
            await expect(service.getCreditNote('t1', 'ret-1')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('flags a note built from a pre-snapshot sale line', async () => {
            db.salesReturn.findFirst.mockResolvedValue(
                returnRow({
                    items: [{
                        quantity: 1,
                        refund_amount: 575,
                        product: { name: 'Rice 5kg', sku: 'R5', unit_type: 'kg_g', vat_rate: 15, sd_rate: null },
                        sale_item: { vat_rate: null, sd_rate: null },
                    }],
                }),
            );

            const note = await service.getCreditNote('t1', 'ret-1');
            expect(note.estimated).toBe(true);
            expect(note.lines[0].vatAmount).toBe(75);
        });

        it('404s on a return from another workspace', async () => {
            db.salesReturn.findFirst.mockResolvedValue(null);
            await expect(service.getCreditNote('t1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('6.10 large supply statement', () => {
        const bigSale = (overrides: any = {}) =>
            postedSale({
                total_amount: 250000,
                items: [{
                    quantity: 1, price_at_sale: 250000, vat_rate: 15, sd_rate: 0,
                    vat_amount: 32608.7, sd_amount: 0,
                    product: { name: 'Generator', sku: 'G1', unit_type: 'none', vat_rate: 15, sd_rate: null },
                }],
                ...overrides,
            });

        it('lists a large supply to an unregistered buyer', async () => {
            db.sale.findMany.mockResolvedValue([
                bigSale({ customer: { name: 'Walk-in Ltd', bin: null, nid: '1234567890', address: 'Dhaka', phone: null } }),
            ]);

            const statement = await service.getLargeSupplyStatement('t1', {}, 'Asia/Dhaka');

            expect(statement.form).toBe('6.10');
            expect(statement.threshold).toBe(200000);
            expect(statement.rows).toHaveLength(1);
            expect(statement.rows[0].buyer.nid).toBe('1234567890');
        });

        it('excludes a registered buyer, who accounts for the supply themselves', async () => {
            db.sale.findMany.mockResolvedValue([bigSale()]);
            const statement = await service.getLargeSupplyStatement('t1', {}, 'Asia/Dhaka');
            expect(statement.rows).toHaveLength(0);
        });

        it('excludes a supply below the threshold', async () => {
            db.sale.findMany.mockResolvedValue([
                postedSale({ customer: { name: 'Walk-in', bin: null, nid: null, address: null, phone: null } }),
            ]);
            const statement = await service.getLargeSupplyStatement('t1', {}, 'Asia/Dhaka');
            expect(statement.rows).toHaveLength(0);
        });

        it('counts a walk-in with no customer record as unregistered', async () => {
            db.sale.findMany.mockResolvedValue([bigSale({ customer: null })]);
            const statement = await service.getLargeSupplyStatement('t1', {}, 'Asia/Dhaka');
            expect(statement.rows).toHaveLength(1);
        });
    });
});
