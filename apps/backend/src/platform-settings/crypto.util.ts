import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
    const hex = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
        // Dev-only fallback — replace with SETTINGS_ENCRYPTION_KEY in production
        return Buffer.alloc(32, 0);
    }
    return Buffer.from(hex, 'hex');
}

export function encryptValue(plaintext: string): string {
    const key = getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('hex');
}

export function decryptValue(ciphertext: string): string {
    try {
        const key = getKey();
        const buf = Buffer.from(ciphertext, 'hex');
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const data = buf.subarray(28);
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
        return '';
    }
}
