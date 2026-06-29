import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as qrcode from 'qrcode';
import { DatabaseService } from '../database/database.service';

const APP_NAME = 'ERP71';
const DIGITS = 6;
const PERIOD = 30;
const WINDOW = 1; // allow 1 step drift on each side

// RFC 4648 base32 alphabet
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str: string): Buffer {
    const s = str.toUpperCase().replace(/=+$/, '');
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const char of s) {
        const idx = BASE32_ALPHABET.indexOf(char);
        if (idx === -1) throw new Error(`Invalid base32 char: ${char}`);
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function generateSecret(): string {
    return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBase32: string, counter: number): string {
    const key = base32Decode(secretBase32);
    const buf = Buffer.alloc(8);
    const high = Math.floor(counter / 0x100000000);
    const low = counter >>> 0;
    buf.writeUInt32BE(high, 0);
    buf.writeUInt32BE(low, 4);
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[19] & 0xf;
    const code =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    return String(code % Math.pow(10, DIGITS)).padStart(DIGITS, '0');
}

function totpGenerate(secretBase32: string, time = Date.now()): string {
    return hotp(secretBase32, Math.floor(time / 1000 / PERIOD));
}

function totpVerify(token: string, secretBase32: string, time = Date.now()): boolean {
    const counter = Math.floor(time / 1000 / PERIOD);
    for (let i = -WINDOW; i <= WINDOW; i++) {
        if (hotp(secretBase32, counter + i) === token) return true;
    }
    return false;
}

function buildOtpAuthUri(secret: string, email: string, issuer: string): string {
    const label = encodeURIComponent(`${issuer}:${email}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

@Injectable()
export class TotpService {
    constructor(private db: DatabaseService) {}

    async setupTotp(userId: string, email: string): Promise<{ secret: string; qrCodeDataUrl: string; otpAuthUrl: string }> {
        const secret = generateSecret();
        const otpAuthUrl = buildOtpAuthUri(secret, email, APP_NAME);
        const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);

        // Store with "pending:" prefix — only confirmed on enable
        await this.db.user.update({
            where: { id: userId },
            data: { totp_secret: `pending:${secret}` },
        });

        return { secret, qrCodeDataUrl, otpAuthUrl };
    }

    async enableTotp(userId: string, code: string): Promise<void> {
        const user = await this.db.user.findUnique({ where: { id: userId }, select: { totp_secret: true } });
        if (!user) throw new UnauthorizedException('User not found');

        const raw = user.totp_secret;
        if (!raw?.startsWith('pending:')) throw new BadRequestException('Run 2FA setup first');

        const secret = raw.slice('pending:'.length);
        if (!totpVerify(code, secret)) {
            throw new BadRequestException('Invalid TOTP code');
        }

        await this.db.user.update({ where: { id: userId }, data: { totp_secret: secret } });
    }

    async disableTotp(userId: string, code: string): Promise<void> {
        const user = await this.db.user.findUnique({ where: { id: userId }, select: { totp_secret: true } });
        if (!user?.totp_secret || user.totp_secret.startsWith('pending:')) {
            throw new BadRequestException('2FA is not enabled');
        }

        if (!totpVerify(code, user.totp_secret)) {
            throw new BadRequestException('Invalid TOTP code');
        }

        await this.db.user.update({ where: { id: userId }, data: { totp_secret: null } });
    }

    async verifyTotpForLogin(userId: string, code: string): Promise<{ verified: boolean }> {
        const user = await this.db.user.findUnique({ where: { id: userId }, select: { totp_secret: true } });
        if (!user?.totp_secret || user.totp_secret.startsWith('pending:')) {
            throw new BadRequestException('2FA not configured for this user');
        }

        if (!totpVerify(code, user.totp_secret)) {
            throw new UnauthorizedException('Invalid TOTP code');
        }

        return { verified: true };
    }

    isEnabled(totpSecret: string | null | undefined): boolean {
        return !!totpSecret && !totpSecret.startsWith('pending:');
    }
}
