import {
    ConflictException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';

export type Meet71CallMode = 'voice' | 'video';

export type Meet71PresenceSnapshot = {
    online: string[];
};

export type Meet71StartCallResult = {
    call: unknown;
    callerUrl: string;
    roomUrl: string;
};

const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Outbound client from ERP71 → Meet71 over the shared Docker network.
 *
 * Uses `MEET71_INTERNAL_URL` (e.g. `http://meet71-app-1:3000`) and the same
 * `MEET71_ERP71_SECRET` Meet71 expects on `X-Meet71-Service-Key`. Without
 * INTERNAL_URL, presence and startCall throw 503 so the dialer can fall back
 * to the public `/call?to=` deep link.
 */
@Injectable()
export class Meet71ClientService {
    private readonly logger = new Logger(Meet71ClientService.name);

    isConfigured(): boolean {
        return Boolean(this.baseUrl() && this.serviceKey());
    }

    async getPresence(actorEmail?: string | null): Promise<Meet71PresenceSnapshot> {
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'X-Meet71-Service-Key': this.requireServiceKey(),
        };
        const actor = actorEmail?.trim().toLowerCase();
        if (actor) headers['X-Meet71-Actor-Email'] = actor;

        const body = await this.requestJson('GET', '/api/internal/presence', { headers });
        return { online: normalizeOnlineEmails(body) };
    }

    async startCall(input: {
        to: string;
        mode?: Meet71CallMode;
        fromName?: string | null;
        fromEmail?: string | null;
    }): Promise<Meet71StartCallResult> {
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Meet71-Service-Key': this.requireServiceKey(),
        };
        const fromEmail = input.fromEmail?.trim().toLowerCase();
        if (fromEmail) headers['X-Meet71-Actor-Email'] = fromEmail;

        const payload: Record<string, string> = {
            to: input.to.trim().toLowerCase(),
        };
        if (input.mode) payload.mode = input.mode;
        const fromName = input.fromName?.trim();
        if (fromName) payload.fromName = fromName;

        const body = await this.requestJson('POST', '/api/internal/calls', {
            headers,
            body: JSON.stringify(payload),
        });

        const callerUrl = readString(body, 'callerUrl');
        const roomUrl = readString(body, 'roomUrl');
        if (!callerUrl) {
            throw new ServiceUnavailableException({
                code: 'MEET71_UNAVAILABLE',
                message: 'Meet71 did not return a caller URL.',
            });
        }

        return {
            call: readField(body, 'call') ?? null,
            callerUrl,
            roomUrl: roomUrl ?? callerUrl,
        };
    }

    private baseUrl(): string {
        return (process.env.MEET71_INTERNAL_URL ?? '').trim().replace(/\/+$/, '');
    }

    private serviceKey(): string {
        return (process.env.MEET71_ERP71_SECRET ?? '').trim();
    }

    private requireBaseUrl(): string {
        const base = this.baseUrl();
        if (!base) {
            throw new ServiceUnavailableException({
                code: 'MEET71_UNAVAILABLE',
                message: 'Meet71 internal URL is not configured.',
            });
        }
        return base;
    }

    private requireServiceKey(): string {
        this.requireBaseUrl();
        const key = this.serviceKey();
        if (!key) {
            throw new ServiceUnavailableException({
                code: 'MEET71_UNAVAILABLE',
                message: 'Meet71 service key is not configured.',
            });
        }
        return key;
    }

    private async requestJson(
        method: 'GET' | 'POST',
        path: string,
        options: { headers: Record<string, string>; body?: string },
    ): Promise<unknown> {
        const url = `${this.requireBaseUrl()}${path}`;
        let response: Response;
        try {
            response = await fetch(url, {
                method,
                headers: options.headers,
                body: options.body,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Meet71 ${method} ${path} unreachable: ${message}`);
            throw new ServiceUnavailableException({
                code: 'MEET71_UNAVAILABLE',
                message: 'Meet71 is unreachable.',
            });
        }

        const text = await response.text();
        let parsed: unknown = null;
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = null;
            }
        }

        if (!response.ok) {
            const code = readNestedCode(parsed) ?? 'MEET71_UNAVAILABLE';
            const message =
                readNestedMessage(parsed) ??
                `Meet71 ${method} ${path} returned ${response.status}`;
            this.logger.warn(`Meet71 ${method} ${path} → ${response.status}: ${message}`);
            // Preserve 409 so the dialer can fall back to the public deep link.
            if (response.status === 409) {
                throw new ConflictException({ code, message });
            }
            throw new ServiceUnavailableException({
                code: response.status === 503 ? 'MEET71_UNAVAILABLE' : code,
                message,
            });
        }

        return unwrapData(parsed);
    }
}

function unwrapData(body: unknown): unknown {
    if (typeof body !== 'object' || body === null) return body;
    const record = body as Record<string, unknown>;
    return record.data !== undefined ? record.data : body;
}

function readField(body: unknown, key: string): unknown {
    if (typeof body !== 'object' || body === null) return undefined;
    return (body as Record<string, unknown>)[key];
}

function readString(body: unknown, key: string): string | null {
    const value = readField(body, key);
    return typeof value === 'string' && value ? value : null;
}

function readNestedCode(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) return undefined;
    const record = body as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code;
    const nested = record.error;
    if (typeof nested === 'object' && nested !== null) {
        const code = (nested as Record<string, unknown>).code;
        if (typeof code === 'string') return code;
    }
    return undefined;
}

function readNestedMessage(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null) return undefined;
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    const nested = record.error;
    if (typeof nested === 'object' && nested !== null) {
        const message = (nested as Record<string, unknown>).message;
        if (typeof message === 'string') return message;
    }
    return undefined;
}

function normalizeOnlineEmails(body: unknown): string[] {
    if (typeof body !== 'object' || body === null) return [];
    const record = body as Record<string, unknown>;

    const candidates = [record.online, record.emails, record.presence];
    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        const emails: string[] = [];
        for (const entry of candidate) {
            if (typeof entry === 'string' && entry.trim()) {
                emails.push(entry.trim().toLowerCase());
                continue;
            }
            if (typeof entry === 'object' && entry !== null) {
                const email = (entry as Record<string, unknown>).email;
                if (typeof email === 'string' && email.trim()) {
                    emails.push(email.trim().toLowerCase());
                }
            }
        }
        return [...new Set(emails)];
    }
    return [];
}
