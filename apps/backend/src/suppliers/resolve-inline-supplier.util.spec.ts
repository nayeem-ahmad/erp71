import { BadRequestException } from '@nestjs/common';
import { resolveInlineSupplier } from './resolve-inline-supplier.util';

function makeTx() {
    return {
        supplier: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'sup-new' }),
            update: jest.fn().mockResolvedValue({}),
        },
    };
}

describe('resolveInlineSupplier', () => {
    it('creates a supplier from the draft, trimmed', async () => {
        const tx = makeTx();

        const id = await resolveInlineSupplier(tx, 'tenant-1', {
            name: '  Fresh Farms  ',
            phone: ' 01700000000 ',
        }, 'store-1');

        expect(id).toBe('sup-new');
        expect(tx.supplier.create).toHaveBeenCalledWith({
            data: {
                tenant_id: 'tenant-1',
                name: 'Fresh Farms',
                // A new supplier belongs to the document's branch.
                store_id: 'store-1',
                phone: '01700000000',
                email: undefined,
                address: undefined,
            },
            select: { id: true },
        });
    });

    it('reuses the live supplier already holding that name', async () => {
        const tx = makeTx();
        tx.supplier.findUnique.mockResolvedValue({ id: 'sup-7', deleted_at: null });

        const id = await resolveInlineSupplier(tx, 'tenant-1', { name: 'Fresh Farms' }, 'store-1');

        expect(id).toBe('sup-7');
        expect(tx.supplier.create).not.toHaveBeenCalled();
        expect(tx.supplier.update).not.toHaveBeenCalled();
    });

    it('revives a soft-deleted supplier holding that name rather than binding the bill to a tombstone', async () => {
        const tx = makeTx();
        tx.supplier.findUnique.mockResolvedValue({ id: 'sup-9', deleted_at: new Date() });

        const id = await resolveInlineSupplier(tx, 'tenant-1', {
            name: 'Fresh Farms',
            phone: '01700000000',
        }, 'store-1');

        expect(id).toBe('sup-9');
        expect(tx.supplier.update).toHaveBeenCalledWith({
            where: { id: 'sup-9' },
            data: expect.objectContaining({ deleted_at: null, phone: '01700000000' }),
        });
        expect(tx.supplier.create).not.toHaveBeenCalled();
    });

    it('does not overwrite a revived supplier’s details with blanks', async () => {
        const tx = makeTx();
        tx.supplier.findUnique.mockResolvedValue({ id: 'sup-9', deleted_at: new Date() });

        await resolveInlineSupplier(tx, 'tenant-1', { name: 'Fresh Farms', phone: '  ', email: '' }, 'store-1');

        expect(tx.supplier.update).toHaveBeenCalledWith({
            where: { id: 'sup-9' },
            data: { deleted_at: null, phone: undefined, email: undefined, address: undefined },
        });
    });

    it('rejects a draft with no usable name', async () => {
        const tx = makeTx();

        await expect(
            resolveInlineSupplier(tx, 'tenant-1', { name: '   ' }, 'store-1'),
        ).rejects.toThrow(BadRequestException);
        expect(tx.supplier.findUnique).not.toHaveBeenCalled();
        expect(tx.supplier.create).not.toHaveBeenCalled();
    });
});
