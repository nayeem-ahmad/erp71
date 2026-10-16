import { printCustomerPaymentReceipt, type CustomerPaymentReceiptData } from './customer-payment-receipt';

const labels: CustomerPaymentReceiptData['labels'] = {
    moneyReceipt: 'Money Receipt',
    paymentVoucher: 'Payment Voucher',
    serial: 'Serial',
    date: 'Date',
    customer: 'Customer',
    amount: 'Amount',
    discount: 'Discount',
    balanceAfter: 'Balance after',
    notes: 'Notes',
    recordedBy: 'Recorded by',
    voucher: 'Voucher',
    receiveTitle: 'Payment received',
    payTitle: 'Payment made',
    footer: 'Thank you',
};

/** Prints the receipt into a fake window and returns the HTML it wrote. */
function printed(data: Partial<CustomerPaymentReceiptData>): string {
    const write = jest.fn();
    jest.spyOn(window, 'open').mockReturnValue({
        document: { write, close: jest.fn() },
        print: jest.fn(),
        addEventListener: jest.fn(),
        focus: jest.fn(),
    } as unknown as Window);

    printCustomerPaymentReceipt({
        businessName: 'Babu Bazar',
        paymentNumber: 'CPY-00005',
        date: '19 Mar 2026, 4:00 PM',
        direction: 'receive',
        customerName: 'Alice Corp',
        amount: 1000,
        labels,
        ...data,
    });

    return write.mock.calls.map(([html]) => html).join('');
}

describe('printCustomerPaymentReceipt', () => {
    afterEach(() => jest.restoreAllMocks());

    it('fills the letterhead\'s branch lines from the payment\'s store', () => {
        const html = printed({
            storeName: 'Press Club',
            storeAddress: '12 Topkhana Road, Dhaka',
            headerConfig: { lines: [{ text: '{{store_name}} — {{address}}', fontSizePt: 9 }] },
        });

        expect(html).toContain('Press Club — 12 Topkhana Road, Dhaka');
    });

    it('fills the number, date and entered-by tokens without repeating them in the title block', () => {
        const html = printed({
            recordedBy: 'Rahim',
            headerConfig: { lines: [{ text: 'Receipt {{doc_number}} on {{date}} by {{entry_by}}', fontSizePt: 9 }] },
        });

        expect(html).toContain('Receipt CPY-00005 on 19 Mar 2026, 4:00 PM by Rahim');
        expect(html).not.toContain('# CPY-00005');
    });
});
