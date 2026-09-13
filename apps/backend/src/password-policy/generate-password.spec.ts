import { DEFAULT_PASSWORD_POLICY, evaluatePassword, type PasswordPolicy } from '@erp71/shared-types';
import { generatePassword } from './generate-password';

/**
 * The generator's one job is that `assertValid` never refuses what it produced.
 * A password that fails the workspace's own policy would be minted, shown to HR,
 * written to the `User` row as a hash, and then rejected the moment the employee
 * tried to change it — so these run every policy shape rather than the default.
 */
describe('generatePassword', () => {
    const strict: PasswordPolicy = {
        min_length: 20,
        require_uppercase: true,
        require_lowercase: true,
        require_number: true,
        require_symbol: true,
        block_common: true,
    };

    const lax: PasswordPolicy = {
        min_length: 8,
        require_uppercase: false,
        require_lowercase: false,
        require_number: false,
        require_symbol: false,
        block_common: false,
    };

    it('satisfies the default policy', () => {
        for (let i = 0; i < 50; i += 1) {
            expect(evaluatePassword(generatePassword(), DEFAULT_PASSWORD_POLICY).valid).toBe(true);
        }
    });

    it('satisfies a policy demanding every character class', () => {
        for (let i = 0; i < 50; i += 1) {
            expect(evaluatePassword(generatePassword(strict), strict).failed).toEqual([]);
        }
    });

    it('honours a minimum longer than its own floor', () => {
        expect(generatePassword(strict)).toHaveLength(20);
    });

    it('never goes near the policy floor when the workspace asks for little', () => {
        // A random string nobody memorises has no reason to be eight characters
        // just because a password a person chose may be.
        expect(generatePassword(lax).length).toBeGreaterThanOrEqual(12);
    });

    it('treats a null policy as the default rather than as no rules', () => {
        expect(evaluatePassword(generatePassword(null), DEFAULT_PASSWORD_POLICY).valid).toBe(true);
    });

    it('leaves out the glyph pairs that cannot be told apart when read aloud', () => {
        // These passwords are dictated across a shop counter, so `0`/`O` and
        // `1`/`l`/`I` cost more than the entropy they add.
        const sample = Array.from({ length: 200 }, () => generatePassword(strict)).join('');
        expect(sample).not.toMatch(/[0O1lI5S]/);
    });

    it('does not put the guaranteed characters in fixed positions', () => {
        // Composed as [lower, upper, digit, symbol, ...fill] and then shuffled.
        // Without the shuffle every password would start with a lowercase letter
        // and the first four positions would leak the policy.
        const firsts = new Set(
            Array.from({ length: 100 }, () => generatePassword(strict)[0]),
        );
        expect(firsts.size).toBeGreaterThan(4);
    });

    it('produces a different password every time', () => {
        const drawn = new Set(Array.from({ length: 100 }, () => generatePassword()));
        expect(drawn.size).toBe(100);
    });
});
