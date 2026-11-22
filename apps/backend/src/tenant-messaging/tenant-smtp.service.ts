import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { DatabaseService } from '../database/database.service';
import { encryptValue, decryptValue } from '../platform-settings/crypto.util';
import { CircuitBreaker, CircuitOpenError } from '../system-health/resilience/circuit-breaker';
import { resolvePublicHost } from '../common/public-address.util';
import { formatEmailAddress } from '../email/address.util';
import { SECRET_MASK } from './tenant-messaging-identity.service';
import { SMTP_PORTS, SMTP_SECURITY, type SmtpSecurity, UpdateTenantSmtpServerDto } from './tenant-smtp.dto';

/** A shop's mail server, decrypted and ready to connect to. */
export interface TenantSmtpConfig {
    host: string;
    port: number;
    security: SmtpSecurity;
    username: string;
    password: string;
    fromEmail: string;
    fromName: string | null;
    replyTo: string | null;
}

export interface OutgoingMessage {
    to: string;
    subject: string;
    html: string;
}

/** Thrown with a message written for the shop owner, not for a log file. */
export class TenantSmtpError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TenantSmtpError';
    }
}

type SmtpRow = {
    enabled: boolean;
    host: string | null;
    port: number;
    security: string;
    username: string | null;
    password: string | null;
    from_email: string | null;
    from_name: string | null;
    reply_to: string | null;
    verified_at: Date | null;
    last_error: string | null;
    last_error_at: Date | null;
    updated_at: Date;
};

/** Fields whose change means the last successful test no longer proves anything. */
const CONNECTION_FIELDS = ['host', 'port', 'security', 'username', 'password', 'from_email'] as const;

const SEND_TIMEOUT_MS = 35_000;
/** Consecutive failures before a shop's server is skipped without trying. */
const FAILURE_THRESHOLD = 3;
/** How long a failing server is skipped before the next real attempt. */
const COOLDOWN_MS = 5 * 60_000;

/**
 * A shop's own outgoing mail server.
 *
 * Kept apart from the platform transport on purpose. The platform provider is
 * one account the team controls; these are hundreds of servers the team does
 * not, so three things differ:
 *
 *  - **The address is checked before connecting.** The host is typed by a
 *    tenant, so it is resolved and refused if it points anywhere private — the
 *    database and the API share a Docker network with this process. The
 *    connection then goes to the address that was checked, with the name kept
 *    for TLS, so DNS cannot answer differently the second time.
 *  - **Failures are per shop.** Each server has its own fail-fast breaker, kept
 *    here rather than in the shared registry so one shop's wrong password never
 *    shows as a platform outage on the health dashboard.
 *  - **Failures are reported to the shop.** The last error is stored and shown
 *    on its settings page; the shop is the only party who can fix it.
 */
@Injectable()
export class TenantSmtpService {
    private readonly logger = new Logger(TenantSmtpService.name);
    private readonly cache = new Map<string, { row: SmtpRow | null; expiresAt: number }>();
    private readonly breakers = new Map<string, CircuitBreaker>();
    private readonly TTL_MS = 60_000;

    constructor(private readonly db: DatabaseService) {}

    private async getRow(tenantId: string): Promise<SmtpRow | null> {
        const cached = this.cache.get(tenantId);
        if (cached && cached.expiresAt > Date.now()) return cached.row;
        const row = (await this.db.tenantSmtpServer.findUnique({
            where: { tenant_id: tenantId },
        })) as SmtpRow | null;
        this.cache.set(tenantId, { row, expiresAt: Date.now() + this.TTL_MS });
        return row;
    }

    private invalidate(tenantId: string): void {
        this.cache.delete(tenantId);
    }

    private breakerFor(tenantId: string): CircuitBreaker {
        let breaker = this.breakers.get(tenantId);
        if (!breaker) {
            breaker = new CircuitBreaker(`tenant-smtp:${tenantId}`, {
                failureThreshold: FAILURE_THRESHOLD,
                resetTimeoutMs: COOLDOWN_MS,
                timeoutMs: SEND_TIMEOUT_MS,
            });
            this.breakers.set(tenantId, breaker);
        }
        return breaker;
    }

    private toConfig(row: SmtpRow | null): TenantSmtpConfig | null {
        if (!row) return null;
        const host = row.host?.trim();
        const username = row.username?.trim();
        const password = row.password ? decryptValue(row.password) : '';
        const fromEmail = row.from_email?.trim();
        if (!host || !username || !password || !fromEmail) return null;
        return {
            host,
            port: row.port,
            security: row.security === 'ssl' ? 'ssl' : 'starttls',
            username,
            password,
            fromEmail,
            fromName: row.from_name?.trim() || null,
            replyTo: row.reply_to?.trim() || null,
        };
    }

    /**
     * The shop's own server when it is switched on, or null for the platform
     * provider. Enabled-but-incomplete (e.g. the encryption key changed and the
     * password no longer decrypts) is logged and treated as off.
     */
    async resolve(tenantId?: string | null): Promise<TenantSmtpConfig | null> {
        if (!tenantId) return null;
        const row = await this.getRow(tenantId);
        if (!row?.enabled) return null;
        const config = this.toConfig(row);
        if (!config) {
            this.logger.warn(`Tenant ${tenantId} has its own mail server enabled but incomplete — using the platform provider.`);
        }
        return config;
    }

    /** The settings page view, with the password masked. */
    async getForTenant(tenantId: string) {
        const row = await this.db.tenantSmtpServer.findUnique({ where: { tenant_id: tenantId } });
        return {
            enabled: row?.enabled ?? false,
            host: row?.host ?? '',
            port: row?.port ?? 587,
            security: (row?.security ?? 'starttls') as SmtpSecurity,
            username: row?.username ?? '',
            password: row?.password ? SECRET_MASK : '',
            from_email: row?.from_email ?? '',
            from_name: row?.from_name ?? '',
            reply_to: row?.reply_to ?? '',
            verified_at: row?.verified_at ?? null,
            last_error: row?.last_error ?? null,
            last_error_at: row?.last_error_at ?? null,
            updated_at: row?.updated_at ?? null,
        };
    }

    async update(tenantId: string, dto: UpdateTenantSmtpServerDto, updatedBy?: string) {
        const existing = await this.db.tenantSmtpServer.findUnique({ where: { tenant_id: tenantId } });

        // The mask is what GET hands back, so it means "unchanged", not a password.
        const passwordInput = dto.password === SECRET_MASK ? undefined : dto.password;
        const password =
            passwordInput === undefined
                ? (existing?.password ?? null)
                : passwordInput === ''
                  ? null
                  : encryptValue(passwordInput);

        const next = {
            host: pick(dto.host, existing?.host)?.toLowerCase() ?? null,
            port: dto.port ?? existing?.port ?? 587,
            security: dto.security ?? existing?.security ?? 'starttls',
            username: pick(dto.username, existing?.username),
            password,
            from_email: pick(dto.from_email, existing?.from_email)?.toLowerCase() ?? null,
            from_name: pick(dto.from_name, existing?.from_name),
            reply_to: pick(dto.reply_to, existing?.reply_to),
        };

        if (!SMTP_PORTS.includes(next.port)) {
            throw new BadRequestException(`Port must be one of ${SMTP_PORTS.join(', ')}.`);
        }
        if (!SMTP_SECURITY.includes(next.security as SmtpSecurity)) {
            throw new BadRequestException('Security must be STARTTLS or SSL/TLS.');
        }

        const connectionChanged =
            !existing || CONNECTION_FIELDS.some((field) => (existing as any)[field] !== (next as any)[field]);
        const verifiedAt = connectionChanged ? null : (existing?.verified_at ?? null);

        const enabled = dto.enabled ?? existing?.enabled ?? false;
        if (enabled) {
            const missing = [
                !next.host && 'server',
                !next.username && 'username',
                !next.password && 'password',
                !next.from_email && 'from-address',
            ].filter(Boolean);
            if (missing.length) {
                throw new BadRequestException(`Fill in the ${missing.join(', ')} before switching this on.`);
            }
            if (!verifiedAt) {
                // Switching on a server that has never delivered would silently
                // swallow every receipt until somebody noticed. Make them prove
                // it first; saving with the switch off is always allowed.
                throw new BadRequestException(
                    connectionChanged && existing?.verified_at
                        ? 'The connection settings changed. Save, then send a test email before switching this back on.'
                        : 'Send a test email successfully before switching this on.',
                );
            }
        }

        const data = {
            ...next,
            enabled,
            verified_at: verifiedAt,
            // A fresh configuration starts with a clean slate.
            ...(connectionChanged ? { last_error: null, last_error_at: null } : {}),
            updated_by: updatedBy ?? null,
        };

        await this.db.tenantSmtpServer.upsert({
            where: { tenant_id: tenantId },
            create: { tenant_id: tenantId, ...data },
            update: data,
        });
        this.invalidate(tenantId);
        if (connectionChanged) this.breakers.delete(tenantId);
        return this.getForTenant(tenantId);
    }

    /** Removes the server entirely; the shop's mail goes back to the platform. */
    async remove(tenantId: string) {
        await this.db.tenantSmtpServer.deleteMany({ where: { tenant_id: tenantId } });
        this.invalidate(tenantId);
        this.breakers.delete(tenantId);
        return this.getForTenant(tenantId);
    }

    /**
     * Sends a test message through the *saved* settings, switched on or not —
     * that is how a shop gets to switch it on. Success marks the settings
     * verified; failure is stored and thrown as a 400 the page can show.
     */
    async sendTest(tenantId: string, to: string) {
        const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        const shopName = tenant?.name ?? 'Your shop';
        const row = (await this.db.tenantSmtpServer.findUnique({ where: { tenant_id: tenantId } })) as SmtpRow | null;
        const config = this.toConfig(row);
        if (!config) {
            throw new BadRequestException('Save the server, username, password and from-address first.');
        }

        try {
            // Not through the breaker: a person is waiting on this one and
            // should see the server's real answer, not "skipped".
            await this.transmit(config, {
                to,
                subject: `${shopName}: test email`,
                html: `<p>This is a test from ERP71. Your shop's mail server <strong>${escapeHtml(config.host)}</strong> is working, and mail will be sent as <strong>${escapeHtml(config.fromEmail)}</strong>.</p>`,
            });
        } catch (err) {
            const message = describeSmtpError(err);
            await this.recordFailure(tenantId, message);
            throw new BadRequestException(message);
        }

        await this.db.tenantSmtpServer.update({
            where: { tenant_id: tenantId },
            data: { verified_at: new Date(), last_error: null, last_error_at: null },
        });
        this.invalidate(tenantId);
        this.breakers.delete(tenantId);
        return this.getForTenant(tenantId);
    }

    /**
     * Delivers one of the shop's messages through its own server. Throws a
     * `TenantSmtpError` with a readable reason; the caller decides whether that
     * surfaces. Never falls back to the platform: the mail would arrive from a
     * different address than the shop chose, and the shop would never learn
     * its own server was broken.
     */
    async deliver(tenantId: string, config: TenantSmtpConfig, message: OutgoingMessage): Promise<void> {
        try {
            await this.breakerFor(tenantId).execute(() => this.transmit(config, message));
        } catch (err) {
            if (err instanceof CircuitOpenError) {
                throw new TenantSmtpError(
                    'Skipped: your mail server failed several times in a row. It will be tried again in a few minutes.',
                );
            }
            const reason = describeSmtpError(err);
            await this.recordFailure(tenantId, reason);
            throw new TenantSmtpError(reason);
        }
        await this.clearFailure(tenantId);
    }

    private async transmit(config: TenantSmtpConfig, message: OutgoingMessage): Promise<void> {
        const resolution = await resolvePublicHost(config.host);
        if (!resolution.ok) {
            if (resolution.reason === 'private') {
                this.logger.warn(`Refused tenant SMTP host ${config.host} → ${resolution.address}`);
                throw new TenantSmtpError(
                    `"${config.host}" points to a private network address. Use your mail provider's public server name.`,
                );
            }
            throw new TenantSmtpError(`Could not find the server "${config.host}". Check the spelling.`);
        }

        const transporter = nodemailer.createTransport({
            // Connect to the address that passed the check, not the name.
            host: resolution.addresses[0],
            port: config.port,
            secure: config.security === 'ssl',
            requireTLS: config.security === 'starttls',
            auth: { user: config.username, pass: config.password },
            tls: { servername: config.host, minVersion: 'TLSv1.2' },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 30_000,
        });
        try {
            await transporter.sendMail({
                from: formatEmailAddress(config.fromEmail, config.fromName),
                ...(config.replyTo ? { replyTo: config.replyTo } : {}),
                to: message.to,
                subject: message.subject,
                html: message.html,
            });
        } finally {
            transporter.close();
        }
    }

    private async recordFailure(tenantId: string, message: string): Promise<void> {
        try {
            await this.db.tenantSmtpServer.updateMany({
                where: { tenant_id: tenantId },
                data: { last_error: message.slice(0, 500), last_error_at: new Date() },
            });
            this.invalidate(tenantId);
        } catch (err) {
            this.logger.error(`Could not record SMTP failure for tenant ${tenantId}: ${err}`);
        }
    }

    /** Clears a stored error after a delivery works — only writes when one is set. */
    private async clearFailure(tenantId: string): Promise<void> {
        const row = await this.getRow(tenantId);
        if (!row?.last_error) return;
        try {
            await this.db.tenantSmtpServer.updateMany({
                where: { tenant_id: tenantId },
                data: { last_error: null, last_error_at: null },
            });
            this.invalidate(tenantId);
        } catch (err) {
            this.logger.error(`Could not clear SMTP failure for tenant ${tenantId}: ${err}`);
        }
    }
}

/**
 * Turns a nodemailer error into a sentence a shop owner can act on. The
 * server's own reply is appended because "535 5.7.8 Application-specific
 * password required" says more than any generic text could.
 */
export function describeSmtpError(err: unknown): string {
    if (err instanceof TenantSmtpError) return err.message;
    const e = (err ?? {}) as { code?: string; message?: string; response?: string };
    const reply = (e.response ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const withReply = (text: string) => (reply ? `${text} The server said: "${reply}"` : text);
    const msg = String(e.message ?? err ?? '');

    switch (e.code) {
        case 'EAUTH':
            return withReply('The server rejected the username or password. Some providers (Gmail, Outlook) need an app password instead of your normal one.');
        case 'EENVELOPE':
            return withReply('The server refused the sender or recipient address. Check that the from-address belongs to this account.');
        case 'ETLS':
            return withReply('A secure connection could not be set up. Try the other security option, or check the port.');
        case 'EDNS':
            return 'Could not find the server. Check the spelling.';
        case 'ETIMEDOUT':
        case 'ECONNECTION':
        case 'ESOCKET':
            if (/certificate|self[- ]signed|altnames|CERT_/i.test(msg)) {
                return 'The server’s security certificate does not match its name. Use the exact server name your mail provider gives.';
            }
            if (/wrong version number|ssl3_get_record|packet length/i.test(msg)) {
                return 'The security option does not match the port. Use SSL/TLS with port 465, or STARTTLS with port 587.';
            }
            return 'Could not connect to the server. Check the server name and port — some networks block port 25.';
        case 'EMESSAGE':
            return withReply('The server refused the message.');
    }
    if (/timed out/i.test(msg)) {
        return 'The server took too long to answer. Check the server name and port.';
    }
    return withReply(`Sending failed: ${msg.slice(0, 200)}`);
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Omitted keeps the stored value; an empty string clears it. */
function pick(next: string | undefined, current: string | null | undefined): string | null {
    if (next === undefined) return current ?? null;
    const trimmed = next.trim();
    return trimmed === '' ? null : trimmed;
}
