import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENCODING = 'base64';

// Format: <iv_b64>.<tag_b64>.<ciphertext_b64>
const SEPARATOR = '.';

export function parseFieldEncryptionKey(raw: string | undefined): Buffer | null {
    if (!raw?.trim()) return null;

    const trimmed = raw.trim();

    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return Buffer.from(trimmed, 'hex');
    }

    try {
        const decoded = Buffer.from(trimmed, 'base64');
        if (decoded.length === 32) {
            return decoded;
        }
    } catch {
        // fall through
    }

    return null;
}

@Injectable()
export class EncryptionService {
    private readonly logger = new Logger(EncryptionService.name);
    private readonly key: Buffer;
    private readonly enabled: boolean;

    constructor() {
        const parsed = parseFieldEncryptionKey(process.env.FIELD_ENCRYPTION_KEY);
        if (parsed) {
            this.key = parsed;
            this.enabled = true;
        } else {
            const message = 'FIELD_ENCRYPTION_KEY not set or invalid — field encryption disabled';
            if (process.env.NODE_ENV === 'production') {
                throw new Error(`${message} (required in production)`);
            }
            this.logger.warn(message);
            this.enabled = false;
            this.key = Buffer.alloc(32); // placeholder, unused when disabled
        }
    }

    encrypt(plaintext: string): string {
        if (!this.enabled) return plaintext;
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [iv.toString(ENCODING), tag.toString(ENCODING), encrypted.toString(ENCODING)].join(SEPARATOR);
    }

    decrypt(ciphertext: string): string {
        if (!this.enabled) return ciphertext;
        const parts = ciphertext.split(SEPARATOR);
        if (parts.length !== 3) return ciphertext; // unencrypted legacy value
        const [ivB64, tagB64, dataB64] = parts;
        const iv = Buffer.from(ivB64, ENCODING);
        const tag = Buffer.from(tagB64, ENCODING);
        const data = Buffer.from(dataB64, ENCODING);
        const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(data).toString('utf8') + decipher.final('utf8');
    }

    isEnabled(): boolean {
        return this.enabled;
    }
}