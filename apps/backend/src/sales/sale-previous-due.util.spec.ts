import { resolveSalePreviousDue, type SaleLedgerPosition } from './sale-previous-due.util';

describe('resolveSalePreviousDue', () => {
    let db: any;

    const postedAt = new Date('2026-09-01T10:00:00Z');
    const sale = (overrides: Partial<SaleLedgerPosition> = {}): SaleLedgerPosition => ({
        id: 'sale-1',
        status: 'COMPLETED',
        customer_id: 'cust-1',
        created_at: postedAt,
        ...overrides,
    });

    /** A ledger row as `findMany` selects it; amounts arrive as Decimals. */
    const row = (id: string, type: string, amount: number, createdAt = postedAt) => ({
        id,
        type,
        amount: { toString: () => String(amount), valueOf: () => String(amount) },
        created_at: createdAt,
    });

    /** One `groupBy` bucket: the summed amount of every later row of a type. */
    const later = (type: string, amount: number) => ({ type, _sum: { amount } });

    beforeEach(() => {
        db = {
            customerCreditTransaction: {
                findMany: jest.fn().mockResolvedValue([]),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };
    });

    it('has nothing to say about a walk-in sale', async () => {
        await expect(resolveSalePreviousDue(db, 'tenant-1', sale({ customer_id: null }), 0)).resolves.toBeNull();
        expect(db.customerCreditTransaction.findMany).not.toHaveBeenCalled();
    });

    it('has nothing to say about a cancelled sale, whose due was already taken back', async () => {
        await expect(resolveSalePreviousDue(db, 'tenant-1', sale({ status: 'CANCELLED' }), 500)).resolves.toBeNull();
        expect(db.customerCreditTransaction.findMany).not.toHaveBeenCalled();
    });

    it('gives a draft today\'s balance, since it has posted nothing yet', async () => {
        await expect(resolveSalePreviousDue(db, 'tenant-1', sale({ status: 'DRAFT' }), 750)).resolves.toBe(750);
        expect(db.customerCreditTransaction.findMany).not.toHaveBeenCalled();
    });

    it('takes a just-posted credit sale\'s own due back off the live balance', async () => {
        db.customerCreditTransaction.findMany.mockResolvedValue([row('ct-1', 'CREDIT_SALE', 400)]);

        // Owed 1,000, bought on credit leaving 400 unpaid: 1,400 now.
        await expect(resolveSalePreviousDue(db, 'tenant-1', sale(), 1400)).resolves.toBe(1000);

        expect(db.customerCreditTransaction.findMany).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
                customer_id: 'cust-1',
                reference_type: 'SALE',
                reference_id: 'sale-1',
            },
            select: { id: true, type: true, amount: true, created_at: true },
        });
    });

    it('prints the same figure on a reprint after later payments and sales', async () => {
        db.customerCreditTransaction.findMany.mockResolvedValue([row('ct-1', 'CREDIT_SALE', 400)]);
        // Since the sale: paid 900 off, bought 250 more on credit, had a 50
        // return adjusted off — 1,400 - 900 + 250 - 50 = 700 owed today.
        db.customerCreditTransaction.groupBy.mockResolvedValue([
            later('PAYMENT', 900),
            later('CREDIT_SALE', 250),
            later('ADJUSTMENT', -50),
        ]);

        await expect(resolveSalePreviousDue(db, 'tenant-1', sale(), 700)).resolves.toBe(1000);
    });

    it('counts a later write-off as settling due and a payout as raising it', async () => {
        db.customerCreditTransaction.groupBy.mockResolvedValue([
            later('WRITE_OFF', 200),
            later('PAYOUT', 80),
        ]);

        // A paid sale: 1,000 before it, then 200 forgiven and 80 paid out.
        await expect(resolveSalePreviousDue(db, 'tenant-1', sale(), 880)).resolves.toBe(1000);
    });

    it('places a paid sale at its own creation time, having no ledger row of its own', async () => {
        await resolveSalePreviousDue(db, 'tenant-1', sale(), 1000);

        expect(db.customerCreditTransaction.groupBy).toHaveBeenCalledWith({
            by: ['type'],
            where: {
                tenant_id: 'tenant-1',
                customer_id: 'cust-1',
                created_at: { gt: postedAt },
                id: { notIn: [] },
            },
            _sum: { amount: true },
        });
    });

    it('places a finalised draft where it was posted, not where it was parked', async () => {
        const finalisedAt = new Date('2026-09-03T15:30:00Z');
        db.customerCreditTransaction.findMany.mockResolvedValue([
            row('ct-9', 'CREDIT_SALE', 300, finalisedAt),
        ]);

        await resolveSalePreviousDue(db, 'tenant-1', sale({ created_at: postedAt }), 1300);

        // A payment taken while the draft sat parked happened *before* the sale
        // was posted, so it must stay in the previous due, not be undone.
        expect(db.customerCreditTransaction.groupBy).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    created_at: { gt: finalisedAt },
                    id: { notIn: ['ct-9'] },
                }),
            }),
        );
    });

    it('reports an advance as a negative previous due', async () => {
        // Overpaid by 300 before a fully paid sale.
        await expect(resolveSalePreviousDue(db, 'tenant-1', sale(), -300)).resolves.toBe(-300);
    });

    it('keeps the figure to the paisa', async () => {
        // 0.1 + 0.2 is 0.30000000000000004 in floating point.
        db.customerCreditTransaction.groupBy.mockResolvedValue([later('PAYMENT', 0.2)]);

        await expect(resolveSalePreviousDue(db, 'tenant-1', sale(), 0.1)).resolves.toBe(0.3);
    });
});
