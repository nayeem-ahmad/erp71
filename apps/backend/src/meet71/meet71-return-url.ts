import { BadRequestException } from '@nestjs/common';

const CALLBACK_PATH = '/api/auth/erp71/callback';
const INVALID = { code: 'MEET71_INVALID_RETURN_URL', message: 'Invalid return_url' } as const;

/**
 * Mint `return_url` must parse as a URL, sit on an origin in
 * `MEET71_RETURN_ORIGINS`, pin the path to `/api/auth/erp71/callback`, and be
 * https (http only for localhost / 127.0.0.1). Origin is compared via the URL
 * parser, not a substring, so `https://meet.erp71.com.evil.com` does not match
 * `https://meet.erp71.com`.
 */
export function assertMeet71ReturnUrl(returnUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(returnUrl);
    } catch {
        throw new BadRequestException(INVALID);
    }

    const allowed = (process.env.MEET71_RETURN_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    if (!allowed.includes(parsed.origin)) {
        throw new BadRequestException(INVALID);
    }
    if (parsed.pathname !== CALLBACK_PATH || parsed.search || parsed.hash) {
        throw new BadRequestException(INVALID);
    }
    if (parsed.protocol === 'https:') return returnUrl;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
        return returnUrl;
    }
    throw new BadRequestException(INVALID);
}
