import { printVoucher } from './voucher-printer';

describe('printVoucher', () => {
    it('writes voucher HTML to a new window without noopener (which blocks document.write)', () => {
        const write = jest.fn();
        const close = jest.fn();
        const print = jest.fn();
        const onloadSetter = jest.fn();

        const mockWindow = {
            document: { write, close },
            print,
            set onload(handler: () => void) {
                onloadSetter();
                handler();
            },
        };

        const open = jest.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

        printVoucher({
            businessName: 'Demo Store',
            voucherNumber: 'CP-00001',
            voucherType: 'cash_payment',
            date: '21 Mar 2026',
            totalAmount: 500,
            lines: [
                {
                    accountName: 'Cash',
                    accountCode: '1000',
                    debit: 500,
                    credit: 0,
                },
                {
                    accountName: 'Office Supplies',
                    debit: 0,
                    credit: 500,
                },
            ],
            labels: {
                title: 'Payment Voucher',
                voucherNumber: 'Voucher No.',
                date: 'Date',
                type: 'Type',
                reference: 'Reference',
                narration: 'Narration',
                account: 'Account',
                debit: 'Debit',
                credit: 'Credit',
                total: 'Total',
                footer: 'Computer-generated voucher',
            },
        });

        expect(open).toHaveBeenCalledWith('', '_blank', 'width=950,height=850');
        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0][0]).toContain('CP-00001');
        expect(write.mock.calls[0][0]).toContain('Demo Store');
        expect(write.mock.calls[0][0]).toContain('Office Supplies');
        expect(close).toHaveBeenCalledTimes(1);
        expect(print).toHaveBeenCalledTimes(1);

        open.mockRestore();
    });
});