import { revenueByConvertedLead, ConvertedLeadRef } from './converted-revenue.util';

describe('revenueByConvertedLead', () => {
    let mockFindMany: jest.Mock;
    let db: { sale: { findMany: jest.Mock } };

    beforeEach(() => {
        mockFindMany = jest.fn();
        db = { sale: { findMany: mockFindMany } };
    });

    it('counts only completed sales on or after the conversion date', async () => {
        const leads: ConvertedLeadRef[] = [
            { id: 'L1', converted_customer_id: 'C1', closed_at: new Date('2026-10-01T00:00:00Z') },
        ];
        mockFindMany.mockResolvedValue([
            { customer_id: 'C1', sale_date: new Date('2026-09-30T23:59:59Z'), total_amount: 500 },
            { customer_id: 'C1', sale_date: new Date('2026-10-02T10:00:00Z'), total_amount: 1200 },
        ]);

        const result = await revenueByConvertedLead(db as any, 'tenant-1', leads);

        expect(mockFindMany).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
                status: 'COMPLETED',
                customer_id: { in: ['C1'] },
            },
            select: {
                customer_id: true,
                sale_date: true,
                total_amount: true,
            },
        });
        expect(result.get('L1')).toEqual({ orders: 1, revenue: 1200 });
    });

    it('gives a customer shared by two converted leads to the earliest conversion only', async () => {
        const leads: ConvertedLeadRef[] = [
            { id: 'L1', converted_customer_id: 'C1', closed_at: new Date('2026-10-01T00:00:00Z') },
            { id: 'L2', converted_customer_id: 'C1', closed_at: new Date('2026-10-05T00:00:00Z') },
        ];
        mockFindMany.mockResolvedValue([
            { customer_id: 'C1', sale_date: new Date('2026-10-06T12:00:00Z'), total_amount: 900 },
        ]);

        const result = await revenueByConvertedLead(db as any, 'tenant-1', leads);

        expect(result.get('L1')).toEqual({ orders: 1, revenue: 900 });
        expect(result.has('L2')).toBe(false);
    });

    it('returns an empty map without querying when no lead has a customer', async () => {
        const leads: ConvertedLeadRef[] = [
            { id: 'L1', converted_customer_id: null, closed_at: new Date() },
        ];

        const result = await revenueByConvertedLead(db as any, 'tenant-1', leads);

        expect(result.size).toBe(0);
        expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('limits sales to the window when one is given', async () => {
        const fromDate = new Date('2026-10-01T00:00:00Z');
        const toDate = new Date('2026-10-31T23:59:59Z');
        const leads: ConvertedLeadRef[] = [
            { id: 'L1', converted_customer_id: 'C1', closed_at: new Date('2026-09-15T00:00:00Z') },
        ];
        mockFindMany.mockResolvedValue([
            { customer_id: 'C1', sale_date: new Date('2026-10-10T12:00:00Z'), total_amount: 1500 },
        ]);

        const result = await revenueByConvertedLead(db as any, 'tenant-1', leads, { fromDate, toDate });

        expect(mockFindMany).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
                status: 'COMPLETED',
                customer_id: { in: ['C1'] },
                sale_date: { gte: fromDate, lte: toDate },
            },
            select: {
                customer_id: true,
                sale_date: true,
                total_amount: true,
            },
        });
        expect(result.get('L1')).toEqual({ orders: 1, revenue: 1500 });
    });
});
