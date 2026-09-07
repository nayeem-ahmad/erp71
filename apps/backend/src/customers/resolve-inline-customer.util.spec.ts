import { BadRequestException } from '@nestjs/common';
import { resolveInlineCustomer } from './resolve-inline-customer.util';

function makeTx() {
    return {
        customer: {
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'cust-new' }),
            update: jest.fn().mockResolvedValue({}),
        },
    };
}

describe('resolveInlineCustomer', () => {
    it('creates a customer with the next generated code', async () => {
        const tx = makeTx();
        tx.customer.findFirst.mockResolvedValue({ customer_code: 'CUST-00007' });

        const id = await resolveInlineCustomer(tx, 'tenant-1', {
            name: '  Rahim Uddin  ',
            phone: ' 01711111111 ',
        });

        expect(id).toBe('cust-new');
        expect(tx.customer.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenant_id: 'tenant-1',
                customer_code: 'CUST-00008',
                name: 'Rahim Uddin',
                phone: '01711111111',
            }),
            select: { id: true },
        });
    });

    it('starts the series at CUST-00001 for a tenant with no generated codes', async () => {
        const tx = makeTx();

        await resolveInlineCustomer(tx, 'tenant-1', { name: 'First Customer' });

        expect(tx.customer.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ customer_code: 'CUST-00001' }),
            select: { id: true },
        });
    });

    it('reuses the existing customer when the phone already belongs to one', async () => {
        const tx = makeTx();
        tx.customer.findUnique.mockResolvedValue({ id: 'cust-7', deleted_at: null });

        const id = await resolveInlineCustomer(tx, 'tenant-1', {
            name: 'Rahim',
            phone: '01711111111',
        });

        expect(id).toBe('cust-7');
        expect(tx.customer.create).not.toHaveBeenCalled();
    });

    it('revives a soft-deleted customer holding that phone rather than colliding', async () => {
        const tx = makeTx();
        tx.customer.findUnique.mockResolvedValue({ id: 'cust-9', deleted_at: new Date() });

        const id = await resolveInlineCustomer(tx, 'tenant-1', {
            name: 'Karim',
            phone: '01722222222',
        });

        expect(id).toBe('cust-9');
        expect(tx.customer.update).toHaveBeenCalledWith({
            where: { id: 'cust-9' },
            data: expect.objectContaining({ deleted_at: null, name: 'Karim' }),
        });
        expect(tx.customer.create).not.toHaveBeenCalled();
    });

    it('creates separate customers for the same name when no phone is given', async () => {
        const tx = makeTx();

        await resolveInlineCustomer(tx, 'tenant-1', { name: 'Rahim' });
        await resolveInlineCustomer(tx, 'tenant-1', { name: 'Rahim' });

        // Names are not unique for customers, so neither call may dedupe.
        expect(tx.customer.findUnique).not.toHaveBeenCalled();
        expect(tx.customer.create).toHaveBeenCalledTimes(2);
    });

    it('retries past a concurrent customer-code collision', async () => {
        const tx = makeTx();
        const conflict = Object.assign(new Error('unique'), {
            code: 'P2002',
            meta: { target: ['customer_code'] },
        });
        tx.customer.create
            .mockRejectedValueOnce(conflict)
            .mockResolvedValueOnce({ id: 'cust-after-retry' });

        const id = await resolveInlineCustomer(tx, 'tenant-1', { name: 'Rahim' });

        expect(id).toBe('cust-after-retry');
        expect(tx.customer.create).toHaveBeenCalledTimes(2);
    });

    it('rethrows a non-code unique violation instead of retrying', async () => {
        const tx = makeTx();
        const phoneConflict = Object.assign(new Error('unique'), {
            code: 'P2002',
            meta: { target: ['phone'] },
        });
        tx.customer.create.mockRejectedValue(phoneConflict);

        await expect(
            resolveInlineCustomer(tx, 'tenant-1', { name: 'Rahim' }),
        ).rejects.toBe(phoneConflict);
        expect(tx.customer.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a draft with no usable name', async () => {
        const tx = makeTx();

        await expect(
            resolveInlineCustomer(tx, 'tenant-1', { name: '   ' }),
        ).rejects.toThrow(BadRequestException);
        expect(tx.customer.create).not.toHaveBeenCalled();
    });
});
