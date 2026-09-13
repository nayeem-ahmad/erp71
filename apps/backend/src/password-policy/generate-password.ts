import { randomInt } from 'node:crypto';
import {
    DEFAULT_PASSWORD_POLICY,
    evaluatePassword,
    normalizePasswordPolicy,
    type PasswordPolicy,
} from '@erp71/shared-types';

/**
 * The alphabet a generated password is drawn from.
 *
 * Ambiguous glyphs are left out on purpose — `0`/`O`, `1`/`l`/`I`, `5`/`S`.
 * These passwords are not pasted from a manager: HR reads one off a screen and
 * says it to a shop assistant, or sends it by SMS to a phone whose font renders
 * a capital i and a lowercase L identically. A character that has to be
 * disambiguated out loud costs more than the fraction of a bit it adds.
 */
const LOWERCASE = 'abcdefghjkmnpqrtuvwxyz';
const UPPERCASE = 'ABCDEFGHJKLMNPQRTUVWXYZ';
const NUMBERS = '2346789';
/** No quotes, backslashes or spaces: these travel through SMS and shell copy-paste. */
const SYMBOLS = '!@#$%&*?-+=';

/**
 * The shortest generated password, regardless of how lax the workspace policy
 * is. The policy floor is 8, which is a reasonable minimum for something a
 * person chose and remembers; this is a random string nobody has to memorise
 * for more than one sign-in, so there is no reason to stay near the floor.
 */
const GENERATED_MIN_LENGTH = 12;

function pick(alphabet: string): string {
    return alphabet[randomInt(alphabet.length)];
}

/** Fisher-Yates with a CSPRNG, so the guaranteed characters are not positional. */
function shuffle(chars: string[]): string[] {
    for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars;
}

/**
 * A random password that satisfies `policy`.
 *
 * Every workspace may set its own rules, so a fixed recipe would generate
 * passwords its own `assertValid` then rejects — the caller would mint a login
 * nobody can use. This composes the answer from the policy instead: one
 * character from each required class, the rest from the union, shuffled.
 *
 * The result is checked against `evaluatePassword` before it is returned rather
 * than trusted, which catches the one case construction cannot rule out: the
 * `block_common` list is a word list, and while a 12-character random string
 * landing on it is vanishingly unlikely, "vanishingly unlikely" is not a thing
 * to hand an unusable credential over. A rejected draw is simply redrawn.
 */
export function generatePassword(
    policy: Partial<PasswordPolicy> | null | undefined = DEFAULT_PASSWORD_POLICY,
): string {
    const resolved = normalizePasswordPolicy(policy);
    const length = Math.max(resolved.min_length, GENERATED_MIN_LENGTH);

    // Lower and upper case are always in the pool even when neither is required:
    // a password of digits alone is weaker than the policy's author meant to
    // allow, and mixing them costs nothing.
    const pool = [
        LOWERCASE,
        UPPERCASE,
        NUMBERS,
        resolved.require_symbol ? SYMBOLS : '',
    ].join('');

    const required: string[] = [LOWERCASE, UPPERCASE, NUMBERS]
        .map((alphabet) => pick(alphabet));
    if (resolved.require_symbol) required.push(pick(SYMBOLS));

    for (let attempt = 0; attempt < 100; attempt += 1) {
        const chars = [...required];
        while (chars.length < length) chars.push(pick(pool));
        const candidate = shuffle(chars).join('');
        if (evaluatePassword(candidate, resolved).valid) return candidate;
    }

    // Unreachable in practice — 100 consecutive draws would all have to hit the
    // common-password list. Throwing beats returning something `assertValid`
    // will refuse a moment later with a message about the workspace's rules.
    throw new Error('Could not generate a password satisfying the workspace policy.');
}
