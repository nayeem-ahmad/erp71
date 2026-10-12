import { BadRequestException } from '@nestjs/common';
import { checkedSalesRepId, listSalesReps, salesRepForSale } from './sales-rep.util';

function db() {
    return {
        employee: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        customer: { findFirst: jest.fn() },
    };
}

describe('listSalesReps', () => {
    it('lists only current employees of this tenant, by name, without pay or anything else', async () => {
        const client = db();
        await listSalesReps(client as any, 't1');

        expect(client.employee.findMany).toHaveBeenCalledWith({
            where: { tenant_id: 't1', deleted_at: null, status: { in: ['ACTIVE', 'PROBATION'] } },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
    });
});

describe('checkedSalesRepId', () => {
    it('leaves an unmentioned rep alone and clears an empty one', async () => {
        const client = db();
        await expect(checkedSalesRepId(client as any, 't1', undefined)).resolves.toBeUndefined();
        await expect(checkedSalesRepId(client as any, 't1', null)).resolves.toBeNull();
        await expect(checkedSalesRepId(client as any, 't1', '')).resolves.toBeNull();
        expect(client.employee.findFirst).not.toHaveBeenCalled();
    });

    it('accepts an employee of this tenant', async () => {
        const client = db();
        client.employee.findFirst.mockResolvedValue({ id: 'emp-1' });

        await expect(checkedSalesRepId(client as any, 't1', 'emp-1')).resolves.toBe('emp-1');
        expect(client.employee.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'emp-1', tenant_id: 't1', deleted_at: null } }),
        );
    });

    it('refuses an id that is not an employee here — another workspace’s, say', async () => {
        const client = db();
        client.employee.findFirst.mockResolvedValue(null);

        await expect(checkedSalesRepId(client as any, 't1', 'emp-elsewhere')).rejects.toThrow(BadRequestException);
    });
});

describe('salesRepForSale', () => {
    it('credits the sale to the customer’s own rep when the screen names none', async () => {
        const client = db();
        client.customer.findFirst.mockResolvedValue({ sales_rep_id: 'emp-rafiq' });

        await expect(salesRepForSale(client as any, 't1', undefined, 'cust-1')).resolves.toBe('emp-rafiq');
        expect(client.customer.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'cust-1', tenant_id: 't1' } }),
        );
    });

    it('takes the rep the screen chose over the customer’s', async () => {
        const client = db();
        client.employee.findFirst.mockResolvedValue({ id: 'emp-other' });

        await expect(salesRepForSale(client as any, 't1', 'emp-other', 'cust-1')).resolves.toBe('emp-other');
        expect(client.customer.findFirst).not.toHaveBeenCalled();
    });

    it('records none when told so, and for a walk-in', async () => {
        const client = db();
        await expect(salesRepForSale(client as any, 't1', null, 'cust-1')).resolves.toBeNull();
        await expect(salesRepForSale(client as any, 't1', undefined, undefined)).resolves.toBeNull();
    });
});
