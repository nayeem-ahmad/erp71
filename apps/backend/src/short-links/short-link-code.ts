import { randomInt } from 'node:crypto';

/**
 * Lowercase letters and digits, minus the characters that look like each other:
 * `0`/`o` and `1`/`l`/`i`.
 *
 * These links are printed on quotations and read aloud over the phone, so a code
 * that survives being retyped off paper is worth more than the extra keyspace
 * the full 36-character set would buy. Dropping five characters costs about 60%
 * of the space and still leaves far more codes than will ever be minted.
 */
export const SHORT_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export const SHORT_CODE_LENGTH = 6;

/**
 * 31^6 ≈ 887 million codes. Random rather than sequential so a code carries no
 * information about how many links exist or what was created next to it.
 *
 * Codes minted before 2026-08-05 are 7 characters of mixed-case base62. Both
 * forms coexist permanently: resolution is an exact lookup on the stored code,
 * so nothing derives meaning from a code's shape and no backfill is needed.
 */
export function generateShortCode(): string {
    let out = '';
    for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) {
        out += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
    }
    return out;
}
