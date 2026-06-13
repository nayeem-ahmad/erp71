import { SmsService } from './sms.service';

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
        service = new SmsService(platformSettings, smsCredits);
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
});
