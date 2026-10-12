import { Prisma } from '@prisma/client';
import { SNAPSHOT_LOADERS } from './record-history.snapshots';

const D = (value: string) => new Prisma.Decimal(value);

function saleRow() {
    return {
        id: 's1',
        tenant_id: 't1',
        store_id: 'store-1',
        customer_id: 'c1',
        warehouse_id: null,
        sales_rep_id: null,
        serial_number: 'INV-0001',
        total_amount: D('720'),
        status: 'COMPLETED',
        created_by: 'u1',
        cancelled_by: null,
        sale_date: new Date('2026-10-12T04:00:00.000Z'),
        customer: { name: 'Rahim', customer_code: 'CUST-00001' },
        store: { name: 'Main Branch' },
        warehouse: null,
        salesRep: null,
        items: [
            { id: 'i1', product_id: 'p1', quantity: 2, price_at_sale: D('200'), product: { name: 'Oil 1L', sku: 'OIL1' }, warehouse: null },
            { id: 'i2', product_id: 'p1', quantity: 1, price_at_sale: D('190'), product: { name: 'Oil 1L', sku: 'OIL1' }, warehouse: null },
        ],
        payments: [{ payment_method: 'CASH', amount: D('590'), account: { name: 'Cash in hand' } }],
    };
}

describe('SNAPSHOT_LOADERS.SALE', () => {
    it('names its references, drops the ids they replace, and keys its lines', async () => {
        const db: any = {
            sale: { findUnique: jest.fn().mockResolvedValue(saleRow()) },
            user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Nayeem', email: 'n@example.com' }]) },
        };

        const snap = await SNAPSHOT_LOADERS.SALE(db, 's1');

        expect(snap?.tenantId).toBe('t1');
        expect(snap?.label).toBe('INV-0001');
        const data = snap!.data as Record<string, any>;
        expect(data).toMatchObject({
            customer: 'Rahim (CUST-00001)',
            branch: 'Main Branch',
            total_amount: 720,
            created_by: 'Nayeem',
            cancelled_by: null,
            sale_date: '2026-10-12T04:00:00.000Z',
        });
        for (const key of ['tenant_id', 'customer_id', 'store_id', 'warehouse_id', 'sales_rep_id']) {
            expect(data).not.toHaveProperty(key);
        }
        // Two lines of one product stay two lines.
        expect(data.items.map((line: any) => [line._key, line._label, line.quantity])).toEqual([
            ['p1', 'Oil 1L', 2],
            ['p1 #2', 'Oil 1L #2', 1],
        ]);
        expect(data.items[0]).not.toHaveProperty('id');
        expect(data.payments[0]).toMatchObject({ _label: 'CASH', amount: 590, account: 'Cash in hand' });
    });

    it('returns null for a record that does not exist', async () => {
        const db: any = { sale: { findUnique: jest.fn().mockResolvedValue(null) } };
        await expect(SNAPSHOT_LOADERS.SALE(db, 'gone')).resolves.toBeNull();
    });
});
