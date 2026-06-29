import { autoPostFromRules } from '../accounting/posting.utils';
import { LoansService } from './loans.service';

jest.mock('@erp71/database', () => ({
    ...jest.requireActual('@erp71/database'),
    ensureLoanPostingSetup: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
}));

describe('LoansService — automatic journal postings', () => {
    let service: LoansService;
    let db: any;
    let tx: any;

    beforeEach(() => {
        jest.clearAllMocks();

        tx = {
            loan: {
                create: jest.fn(),
                update: jest.fn().mockResolvedValue({}),
            },
            loanPayment: {
                create: jest.fn(),
            },
        };

        db = {
            $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
            loan: {
                findFirst: jest.fn(),
            },
            loanPayment: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
            },
            store: {
                findFirst: jest.fn(),
            },
        };

        (autoPostFromRules as jest.Mock).mockResolvedValue({
            postingStatus: 'posted',
            voucherId: 'voucher-1',
            voucherNumber: 'JV-00001',
        });

        service = new LoansService(db as any);
    });

    it('posts a loan_disbursement voucher when a payable loan is created', async () => {
        tx.loan.create.mockResolvedValue({
            id: 'loan-1',
            counterparty: 'ABC Bank',
            direction: 'PAYABLE',
            principal: 100000,
            reference: 'L-001',
            start_date: new Date('2026-06-01'),
            payments: [],
        });

        const result = await service.createLoan('tenant-1', 'user-1', {
            counterparty: 'ABC Bank',
            direction: 'PAYABLE',
            principal: 100000,
            startDate: '2026-06-01',
        });

        expect(autoPostFromRules).toHaveBeenCalledTimes(1);
        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: 'loan_disbursement',
                conditionKey: 'loan_direction',
                conditionValue: 'PAYABLE',
                sourceModule: 'loans',
                sourceType: 'loan',
                sourceId: 'loan-1',
                amount: 100000,
            }),
        );
        expect(result.posting_status).toBe('posted');
        expect(result.voucher_number).toBe('JV-00001');
    });

    it('posts with RECEIVABLE direction for money lent out', async () => {
        tx.loan.create.mockResolvedValue({
            id: 'loan-2',
            counterparty: 'Supplier X',
            direction: 'RECEIVABLE',
            principal: 5000,
            reference: null,
            start_date: new Date('2026-06-02'),
            payments: [],
        });

        await service.createLoan('tenant-1', 'user-1', {
            counterparty: 'Supplier X',
            direction: 'RECEIVABLE',
            principal: 5000,
            startDate: '2026-06-02',
        });

        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: 'loan_disbursement',
                conditionValue: 'RECEIVABLE',
            }),
        );
    });

    it('posts a loan_repayment voucher when a payment is recorded', async () => {
        db.loan.findFirst
            // assertLoanExists
            .mockResolvedValueOnce({
                id: 'loan-1',
                counterparty: 'ABC Bank',
                direction: 'PAYABLE',
                principal: 100000,
                status: 'ACTIVE',
            })
            // getLoan (final reload)
            .mockResolvedValueOnce({
                id: 'loan-1',
                principal: 100000,
                payments: [{ amount: 25000 }],
            });
        tx.loanPayment.create.mockResolvedValue({
            id: 'payment-1',
            payment_date: new Date('2026-06-10'),
        });

        await service.addPayment('tenant-1', 'user-1', 'loan-1', {
            amount: 25000,
            paymentDate: '2026-06-10',
        });

        expect(autoPostFromRules).toHaveBeenCalledTimes(1);
        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: 'loan_repayment',
                conditionKey: 'loan_direction',
                conditionValue: 'PAYABLE',
                sourceModule: 'loans',
                sourceType: 'loan_payment',
                sourceId: 'payment-1',
                amount: 25000,
            }),
        );
    });

    it('rejects a payment that exceeds the outstanding balance before posting', async () => {
        db.loanPayment.aggregate.mockResolvedValue({ _sum: { amount: 90000 } });
        db.loan.findFirst.mockResolvedValueOnce({
            id: 'loan-1',
            counterparty: 'ABC Bank',
            direction: 'PAYABLE',
            principal: 100000,
            status: 'ACTIVE',
        });

        await expect(
            service.addPayment('tenant-1', 'user-1', 'loan-1', {
                amount: 25000,
                paymentDate: '2026-06-10',
            }),
        ).rejects.toThrow(/exceeds the outstanding balance/);

        expect(autoPostFromRules).not.toHaveBeenCalled();
    });
});
