import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LENGTH = 7;

/**
 * 62^7 ≈ 3.5 trillion codes. Random rather than sequential so a code carries no
 * information about how many links exist or what was created next to it.
 */
export function generateShortCode(): string {
    let out = '';
    for (let i = 0; i < LENGTH; i += 1) {
        out += ALPHABET[randomInt(ALPHABET.length)];
    }
    return out;
}
