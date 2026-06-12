import * as crypto from 'crypto';
import { parseFieldEncryptionKey } from './encryption.service';

describe('parseFieldEncryptionKey', () => {
    it('accepts 64-char hex keys', () => {
        const hex = crypto.randomBytes(32).toString('hex');
        const parsed = parseFieldEncryptionKey(hex);
        expect(parsed).not.toBeNull();
        expect(parsed?.length).toBe(32);
    });

    it('accepts base64-encoded 32-byte keys', () => {
        const b64 = crypto.randomBytes(32).toString('base64');
        const parsed = parseFieldEncryptionKey(b64);
        expect(parsed).not.toBeNull();
        expect(parsed?.length).toBe(32);
    });

    it('rejects invalid keys', () => {
        expect(parseFieldEncryptionKey(undefined)).toBeNull();
        expect(parseFieldEncryptionKey('')).toBeNull();
        expect(parseFieldEncryptionKey('too-short')).toBeNull();
        expect(parseFieldEncryptionKey('z'.repeat(64))).toBeNull();
    });
});