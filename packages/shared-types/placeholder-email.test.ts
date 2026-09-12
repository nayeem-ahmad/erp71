import { displayEmail, isPlaceholderEmail, placeholderEmailFor } from './placeholder-email';

describe('placeholder emails', () => {
    it('mints one address per employee', () => {
        expect(placeholderEmailFor('emp-1')).not.toBe(placeholderEmailFor('emp-2'));
    });

    it('stays inside a domain that can never be registered', () => {
        // RFC 2606 reserves `.invalid` precisely so it cannot resolve. A typo'd
        // real domain here would send a shop's password-reset mail to a stranger.
        expect(placeholderEmailFor('emp-1')).toMatch(/\.invalid$/);
    });

    it('recognises what it mints', () => {
        expect(isPlaceholderEmail(placeholderEmailFor('emp-1'))).toBe(true);
    });

    it('matches regardless of case, since addresses are not case-sensitive', () => {
        expect(isPlaceholderEmail('EMP-1@EMPLOYEE.ERP71.INVALID')).toBe(true);
    });

    it('leaves a real address alone', () => {
        expect(isPlaceholderEmail('rahim@shop.com.bd')).toBe(false);
        expect(isPlaceholderEmail(null)).toBe(false);
        expect(isPlaceholderEmail(undefined)).toBe(false);
        expect(isPlaceholderEmail('')).toBe(false);
    });

    it('does not match an address that merely mentions the domain', () => {
        // Anchored on the `@`, so a lookalike local part is not one of ours.
        expect(isPlaceholderEmail('employee.erp71.invalid@gmail.com')).toBe(false);
    });

    describe('displayEmail', () => {
        it('hides a placeholder so no screen shows a machine address', () => {
            expect(displayEmail(placeholderEmailFor('emp-1'))).toBeNull();
        });

        it('passes a real address through', () => {
            expect(displayEmail('rahim@shop.com.bd')).toBe('rahim@shop.com.bd');
        });

        it('treats a missing address the same as a placeholder', () => {
            expect(displayEmail(null)).toBeNull();
            expect(displayEmail('')).toBeNull();
        });
    });
});
