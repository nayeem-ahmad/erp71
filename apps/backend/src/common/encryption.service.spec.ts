import * as crypto from 'crypto';
import { parseFieldEncryptionKey, resolveFieldEncryptionKey } from './encryption.service';

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

    it('derives a key from passphrase-style secrets', () => {
        const parsed = parseFieldEncryptionKey('render-generated-secret-value');
        expect(parsed).not.toBeNull();
        expect(parsed?.length).toBe(32);
    });

    it('rejects invalid keys', () => {
        expect(parseFieldEncryptionKey(undefined)).toBeNull();
        expect(parseFieldEncryptionKey('')).toBeNull();
        expect(parseFieldEncryptionKey('short')).toBeNull();
        expect(parseFieldEncryptionKey('tiny')).toBeNull();
    });
});

describe('resolveFieldEncryptionKey', () => {
    it('prefers FIELD_ENCRYPTION_KEY over JWT_SECRET', () => {
        const env = {
            FIELD_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
            JWT_SECRET: 'jwt-secret-value',
        };
        const resolved = resolveFieldEncryptionKey(env);
        expect(resolved.source).toBe('FIELD_ENCRYPTION_KEY');
    });

    it('falls back to JWT_SECRET when FIELD_ENCRYPTION_KEY is missing', () => {
        const env = { JWT_SECRET: 'jwt-secret-value' };
        const resolved = resolveFieldEncryptionKey(env);
        expect(resolved.source).toBe('JWT_SECRET');
        expect(resolved.key?.length).toBe(32);
    });

    it('returns null when no secrets are configured', () => {
        expect(resolveFieldEncryptionKey({})).toEqual({ key: null, source: null });
    });
});