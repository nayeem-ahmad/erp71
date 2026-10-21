import { SmsService, creditSaleMessage, customerPaymentMessage } from './sms.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';

describe('SmsService credit deduction', () => {
    const platformSettings = { getRawValue: jest.fn().mockResolvedValue(null) } as any;
    const smsCredits = {
        creditsForSend: jest.fn(),
        consume: jest.fn(),
    } as any;

    let service: SmsService;

    beforeEach(() => {
        jest.resetAllMocks();
        platformSettings.getRawValue.mockResolvedValue(null);
        delete process.env.SMS_API_KEY;
        service = new SmsService(platformSettings, smsCredits, new CircuitBreakerRegistry());
    });

    it('does not touch credits when no tenant is provided', async () => {
        const result = await service.sendSms('01700000000', 'hello');

        expect(result.sent).toBe(true);
        expect(smsCredits.consume).not.toHaveBeenCalled();
    });

    it('consumes credits for the message segments × recipients before sending', async () => {
        smsCredits.creditsForSend.mockReturnValue(2);
        smsCredits.consume.mockResolvedValue({ allowed: true, balance: 98 });

        const result = await service.sendSms(['01700000000', '01800000000'], 'hello', {
            tenantId: 'tenant-1',
            purpose: 'Sale receipt',
        });

        expect(result.sent).toBe(true);
        expect(smsCredits.creditsForSend).toHaveBeenCalledWith('hello', 2);
        expect(smsCredits.consume).toHaveBeenCalledWith('tenant-1', 2, expect.objectContaining({
            description: 'Sale receipt',
        }));
    });

    it('skips sending when the tenant is out of credits', async () => {
        smsCredits.creditsForSend.mockReturnValue(5);
        smsCredits.consume.mockResolvedValue({ allowed: false, balance: 0 });
        const fetchMock = jest.fn();
        (global as any).fetch = fetchMock;

        const result = await service.sendSms('01700000000', 'hello', { tenantId: 'tenant-1' });

        expect(result).toEqual({ sent: false, reason: 'INSUFFICIENT_SMS_CREDITS' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not spend a credit when the number is not a mobile', async () => {
        const result = await service.sendSaleReceipt('0212345678', 'Karim', 100, 'SL-1', 'tenant-1');

        expect(result).toEqual({ sent: false, reason: 'INVALID_MOBILE' });
        expect(smsCredits.consume).not.toHaveBeenCalled();
    });

    it('bills a credit sale notice against the tenant', async () => {
        smsCredits.creditsForSend.mockReturnValue(1);
        smsCredits.consume.mockResolvedValue({ allowed: true, balance: 9 });

        const result = await service.sendCreditSaleNotice({
            phone: '01712345678',
            customerName: 'Karim',
            shopName: 'Rahim Store',
            serialNumber: 'SL-1',
            totalAmount: 1000,
            paidAmount: 600,
            dueAmount: 400,
            balanceAfter: 1400,
            tenantId: 'tenant-1',
        });

        expect(result.sent).toBe(true);
        expect(smsCredits.consume).toHaveBeenCalledWith('tenant-1', 1, expect.objectContaining({
            description: 'Credit sale',
            recipient: '8801712345678',
        }));
    });

    it('bills a customer payment notice against the tenant', async () => {
        smsCredits.creditsForSend.mockReturnValue(1);
        smsCredits.consume.mockResolvedValue({ allowed: true, balance: 8 });

        const result = await service.sendCustomerPaymentNotice({
            phone: '+8801811000000',
            customerName: 'Karim',
            shopName: 'Rahim Store',
            amount: 250,
            paymentNumber: 'CPY-00003',
            balanceAfter: 750,
            tenantId: 'tenant-1',
        });

        expect(result.sent).toBe(true);
        expect(smsCredits.consume).toHaveBeenCalledWith('tenant-1', 1, expect.objectContaining({
            description: 'Customer payment',
        }));
    });
});

describe('credit and payment SMS copy', () => {
    it('names the bill, what was paid, what is still due, and the balance', () => {
        expect(creditSaleMessage({
            customerName: 'Karim',
            shopName: 'Rahim Store',
            serialNumber: 'SL-1',
            totalAmount: 1000,
            paidAmount: 600,
            dueAmount: 400,
            balanceAfter: 1400,
        })).toBe(
            'Dear Karim, invoice SL-1: total BDT 1000.00, paid BDT 600.00, due BDT 400.00. '
            + 'Balance due BDT 1400.00. - Rahim Store',
        );
    });

    it('calls a negative balance an advance', () => {
        expect(customerPaymentMessage({
            customerName: 'Karim',
            shopName: 'Rahim Store',
            amount: 650,
            paymentNumber: 'CPY-00001',
            balanceAfter: -250,
            invoiceSerial: 'SL-9',
            invoiceTotal: 850,
        })).toBe(
            'Dear Karim, invoice SL-9: total BDT 850.00. Payment of BDT 650.00 received (CPY-00001). '
            + 'Advance BDT 250.00. - Rahim Store',
        );
    });

    it('omits the invoice when the payment was taken on its own', () => {
        expect(customerPaymentMessage({
            customerName: 'Karim',
            shopName: 'Rahim Store',
            amount: 250,
            paymentNumber: 'CPY-00003',
            balanceAfter: 0,
        })).toBe(
            'Dear Karim, Payment of BDT 250.00 received (CPY-00003). Balance due BDT 0.00. - Rahim Store',
        );
    });
});
