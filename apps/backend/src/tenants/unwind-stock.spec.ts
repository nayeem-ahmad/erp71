import { deleteMovementsAndUnwindStock } from './unwind-stock';

function makeTx(sums: Array<{ product_id: string; warehouse_id: string; _sum: { quantity_delta: number | null } }>) {
    return {
        inventoryMovement: {
            groupBy: jest.fn(async () => sums),
            deleteMany: jest.fn(async () => ({ count: 3 })),
        },
        productStock: { updateMany: jest.fn(async () => ({ count: 1 })) },
        productCost: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
}

describe('deleteMovementsAndUnwindStock', () => {
    it('takes back out of stock and the cost pool what the deleted movements put in', async () => {
        const tx = makeTx([
            { product_id: 'p1', warehouse_id: 'w1', _sum: { quantity_delta: 60 } },
            { product_id: 'p1', warehouse_id: 'w2', _sum: { quantity_delta: -5 } },
            { product_id: 'p2', warehouse_id: 'w1', _sum: { quantity_delta: -8 } },
        ]);
        const where = { tenant_id: 't1', warehouse_id: { in: ['w1', 'w2'] } };

        await deleteMovementsAndUnwindStock(tx as any, 't1', where);

        expect(tx.inventoryMovement.groupBy).toHaveBeenCalledWith({
            by: ['product_id', 'warehouse_id'],
            where,
            _sum: { quantity_delta: true },
        });
        expect(tx.productStock.updateMany.mock.calls.map((c: any) => c[0])).toEqual([
            { where: { tenant_id: 't1', product_id: 'p1', warehouse_id: 'w1' }, data: { quantity: { decrement: 60 } } },
            { where: { tenant_id: 't1', product_id: 'p1', warehouse_id: 'w2' }, data: { quantity: { decrement: -5 } } },
            { where: { tenant_id: 't1', product_id: 'p2', warehouse_id: 'w1' }, data: { quantity: { decrement: -8 } } },
        ]);
        // The pool is per product, so its count comes back by the product's net.
        expect(tx.productCost.updateMany.mock.calls.map((c: any) => c[0])).toEqual([
            { where: { tenant_id: 't1', product_id: 'p1' }, data: { qty_on_hand: { decrement: 55 } } },
            { where: { tenant_id: 't1', product_id: 'p2' }, data: { qty_on_hand: { decrement: -8 } } },
        ]);
        expect(tx.inventoryMovement.deleteMany).toHaveBeenCalledWith({ where });
    });

    it('touches no totals for movements that net to nothing', async () => {
        const tx = makeTx([{ product_id: 'p1', warehouse_id: 'w1', _sum: { quantity_delta: 0 } }]);

        await deleteMovementsAndUnwindStock(tx as any, 't1', { tenant_id: 't1' });

        expect(tx.productStock.updateMany).not.toHaveBeenCalled();
        expect(tx.productCost.updateMany).not.toHaveBeenCalled();
        expect(tx.inventoryMovement.deleteMany).toHaveBeenCalledWith({ where: { tenant_id: 't1' } });
    });
});
