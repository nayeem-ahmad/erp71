import { smsDestination } from './sms-destination';

describe('smsDestination', () => {
    it('accepts a Bangladesh mobile in the shapes a shop types', () => {
        expect(smsDestination('01712345678')).toBe('+8801712345678');
        expect(smsDestination('1712345678')).toBe('+8801712345678');
        expect(smsDestination('+8801712345678')).toBe('+8801712345678');
        expect(smsDestination('8801712345678')).toBe('+8801712345678');
        expect(smsDestination('  +880 1712-345678 ')).toBe('+8801712345678');
        expect(smsDestination('01811000000')).toBe('+8801811000000');
        expect(smsDestination('01911000000')).toBe('+8801911000000');
    });

    it('accepts a foreign mobile already written in E.164', () => {
        expect(smsDestination('+919812345678')).toBe('+919812345678');
    });

    it('rejects a blank, a landline, a short string, and a dead prefix', () => {
        expect(smsDestination(null)).toBeNull();
        expect(smsDestination('')).toBeNull();
        expect(smsDestination('   ')).toBeNull();
        expect(smsDestination('n/a')).toBeNull();
        expect(smsDestination('12345')).toBeNull();
        expect(smsDestination('0212345678')).toBeNull();
        expect(smsDestination('01123456789')).toBeNull();
        expect(smsDestination('01234567890')).toBeNull();
    });
});
