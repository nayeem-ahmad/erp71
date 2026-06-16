import { reversePostedVoucher } from './posting.utils';

function makeTx(overrides: any = {}) {
    return {
        postingEvent: {
            findUnique: jest.fn(),
            delete: jest.fn().mockResolvedValue({}),
        },
        voucher: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async ({ data }: any) => ({
                id: 'rev-voucher',
                voucher_number: data.voucher_number,
                ...data,
            })),
        },
        voucherSequence: {
            upsert: jest.fn().mockResolvedValue({ next_number: 1 }),
            update: jest.fn().mockResolvedValue({}),
        },
        ...overrides,
    };
}

describe('reversePostedVoucher', () => {
    const postedEvent = {
        id: 'evt-1',
        status: 'posted',
        voucher: {
            id: 'orig-voucher',
            voucher_number: 'CP-00001',
            source_module: 'salary',
            source_type: 'salary_payment',
            reference_number: '2026-06',
            details: [
                { account_id: 'salary-exp', debit_amount: 5000, credit_amount: 0 },
                { account_id: 'cash', debit_amount: 0, credit_amount: 5000 },
            ],
        },
    };

    it('returns reversed:false when the source has no posted voucher', async () => {
        const tx = makeTx();
        tx.postingEvent.findUnique.mockResolvedValue(null);

        const result = await reversePostedVoucher({
            tx: tx as any,
            tenantId: 't1',
            eventType: 'salary_payment',
            sourceId: 'p1',
        });

        expect(result.reversed).toBe(false);
        expect(tx.voucher.create).not.toHaveBeenCalled();
    });

    it('creates a reversing voucher with swapped debit/credit amounts', async () => {
        const tx = makeTx();
        tx.postingEvent.findUnique.mockResolvedValue(postedEvent);

        const result = await reversePostedVoucher({
            tx: tx as any,
            tenantId: 't1',
            eventType: 'salary_payment',
            sourceId: 'p1',
        });

        expect(result.reversed).toBe(true);
        const created = tx.voucher.create.mock.calls[0][0].data;
        expect(created.source_type).toBe('salary_payment_reversal');
        expect(created.idempotency_key).toBe('t1:reversal:orig-voucher');
        expect(created.details.create).toEqual([
            { account_id: 'salary-exp', debit_amount: 0, credit_amount: 5000 },
            { account_id: 'cash', debit_amount: 5000, credit_amount: 0 },
        ]);
    });

    it('is idempotent — returns the existing reversal without creating a new one', async () => {
        const tx = makeTx();
        tx.postingEvent.findUnique.mockResolvedValue(postedEvent);
        tx.voucher.findFirst.mockResolvedValue({ id: 'existing-rev', voucher_number: 'JV-00009' });

        const result = await reversePostedVoucher({
            tx: tx as any,
            tenantId: 't1',
            eventType: 'salary_payment',
            sourceId: 'p1',
        });

        expect(result).toEqual({ reversed: true, voucherId: 'existing-rev', voucherNumber: 'JV-00009' });
        expect(tx.voucher.create).not.toHaveBeenCalled();
    });

    it('clears the posting event when resetEvent is set (for edits)', async () => {
        const tx = makeTx();
        tx.postingEvent.findUnique.mockResolvedValue(postedEvent);

        await reversePostedVoucher({
            tx: tx as any,
            tenantId: 't1',
            eventType: 'salary_payment',
            sourceId: 'p1',
            resetEvent: true,
        });

        expect(tx.postingEvent.delete).toHaveBeenCalledWith({ where: { id: 'evt-1' } });
    });
});
