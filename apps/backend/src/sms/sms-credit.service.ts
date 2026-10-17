import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { CHANNEL_BALANCE_COLUMN, MESSAGING_CHANNELS, type MessagingChannel } from './messaging-channel';

/**
 * Number of characters a single SMS segment can hold. Messages containing
 * non-GSM (e.g. Bangla/Unicode) characters are billed at the shorter
 * Unicode segment length, matching how Bangladeshi SMS gateways charge.
 */
const GSM_SINGLE_SEGMENT = 160;
const GSM_MULTI_SEGMENT = 153;
const UNICODE_SINGLE_SEGMENT = 70;
const UNICODE_MULTI_SEGMENT = 67;

// GSM 03.38 basic + extension character set. Anything outside this is Unicode.
const GSM_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENSION = '^{}\\[~]|€';

type Db = DatabaseService | Prisma.TransactionClient;

export type MessagingBalances = Record<MessagingChannel, number>;

/**
 * The prepaid messaging balances — SMS, WhatsApp and email — and their ledger.
 *
 * Named for SMS because it predates the other two channels. It only moves
 * balances: spending them (`consume`, called by every metered send) and adding
 * to them (`grantCredits`, called only by platform-admin paths — an approved
 * top-up or an admin sale). Nothing a tenant calls grants credits; see
 * CreditTopupService for how a tenant asks for them.
 */
@Injectable()
export class SmsCreditService {
    private readonly logger = new Logger(SmsCreditService.name);

    constructor(private readonly db: DatabaseService) {}

    /** True when every character is part of the GSM 03.38 charset. */
    private isGsmEncodable(message: string): boolean {
        for (const char of message) {
            if (!GSM_BASIC.includes(char) && !GSM_EXTENSION.includes(char)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Number of SMS segments (credits) a message consumes. Long messages are
     * split into concatenated segments, each of which costs one credit.
     */
    countSegments(message: string): number {
        const text = message ?? '';
        if (text.length === 0) return 1;

        const isGsm = this.isGsmEncodable(text);
        // Extension characters take two GSM septets each.
        const length = isGsm
            ? [...text].reduce((sum, char) => sum + (GSM_EXTENSION.includes(char) ? 2 : 1), 0)
            : [...text].length;

        const single = isGsm ? GSM_SINGLE_SEGMENT : UNICODE_SINGLE_SEGMENT;
        const multi = isGsm ? GSM_MULTI_SEGMENT : UNICODE_MULTI_SEGMENT;

        return length <= single ? 1 : Math.ceil(length / multi);
    }

    /** Credits a single send consumes: segments × number of recipients. */
    creditsForSend(message: string, recipientCount: number): number {
        return this.countSegments(message) * Math.max(recipientCount, 1);
    }

    /**
     * Atomically consume credits for a send on one channel (SMS unless
     * `meta.channel` says otherwise). Returns whether the send is allowed (i.e.
     * the tenant had enough balance). When allowed, the balance is decremented
     * and a USAGE ledger entry is written.
     */
    async consume(
        tenantId: string,
        credits: number,
        meta: { channel?: MessagingChannel; recipient?: string; description?: string } = {},
    ): Promise<{ allowed: boolean; balance: number }> {
        const channel = meta.channel ?? 'SMS';
        const column = CHANNEL_BALANCE_COLUMN[channel];

        if (credits <= 0) {
            return { allowed: true, balance: await this.getBalance(tenantId, channel) };
        }

        // Conditional decrement: only succeeds when the balance is sufficient.
        const updated = await this.db.tenant.updateMany({
            where: { id: tenantId, [column]: { gte: credits } },
            data: { [column]: { decrement: credits } },
        });

        const balance = await this.getBalance(tenantId, channel);

        if (updated.count === 0) {
            this.logger.warn(
                `Insufficient ${channel} credits for tenant ${tenantId} (needed ${credits}, have ${balance}).`,
            );
            return { allowed: false, balance };
        }

        await this.db.smsTransaction.create({
            data: {
                tenant_id: tenantId,
                channel,
                type: 'USAGE',
                credits: -credits,
                balance_after: balance,
                recipient: meta.recipient ?? null,
                description: meta.description ?? null,
            },
        });

        return { allowed: true, balance };
    }

    async getBalance(tenantId: string, channel: MessagingChannel): Promise<number> {
        const balances = await this.getBalances(tenantId);
        return balances[channel];
    }

    async getBalances(tenantId: string): Promise<MessagingBalances> {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { sms_credits: true, whatsapp_credits: true, email_credits: true },
        });
        return {
            SMS: tenant?.sms_credits ?? 0,
            WHATSAPP: tenant?.whatsapp_credits ?? 0,
            EMAIL: tenant?.email_credits ?? 0,
        };
    }

    /** Platform admin grants prepaid credits outside a top-up request (sale or adjustment). */
    async adminGrantCredits(
        tenantId: string,
        credits: number,
        meta: { channel?: MessagingChannel; description?: string; recordedBy?: string },
    ) {
        return this.grantCredits(tenantId, meta.channel ?? 'SMS', credits, {
            type: 'ADJUSTMENT',
            description: meta.description ?? 'Admin credit grant',
            reference: meta.recordedBy ? `admin:${meta.recordedBy}` : 'admin',
        });
    }

    /**
     * Add credits to one balance and record a ledger entry. Platform-admin paths
     * only. Pass `db` to run inside a caller's transaction, so the grant and
     * whatever authorised it commit or fail together.
     */
    async grantCredits(
        tenantId: string,
        channel: MessagingChannel,
        credits: number,
        meta: { type: string; reference?: string; description?: string; recipient?: string },
        db: Db = this.db,
    ): Promise<{ balance: number; transactionId: string }> {
        const column = CHANNEL_BALANCE_COLUMN[channel];
        const tenant = await db.tenant.update({
            where: { id: tenantId },
            data: { [column]: { increment: credits } },
            select: { [column]: true } as Record<typeof column, true>,
        });
        const balance = Number((tenant as Record<string, unknown>)[column] ?? 0);

        const transaction = await db.smsTransaction.create({
            data: {
                tenant_id: tenantId,
                channel,
                type: meta.type,
                credits,
                balance_after: balance,
                description: meta.description ?? null,
                reference: meta.reference ?? null,
                recipient: meta.recipient ?? null,
            },
        });

        return { balance, transactionId: transaction.id };
    }

    /** Every package a tenant can buy right now, every channel. */
    async listActivePackages() {
        const packages = await this.db.smsPackage.findMany({
            where: { is_active: true, channel: { in: [...MESSAGING_CHANNELS] } },
            orderBy: [{ sort_order: 'asc' }, { price: 'asc' }],
        });
        return packages.map((pkg) => this.mapPackage(pkg));
    }

    async getActivePackage(packageId: string) {
        const pkg = await this.db.smsPackage.findUnique({ where: { id: packageId } });
        if (!pkg || !pkg.is_active) {
            throw new BadRequestException('Selected credit package is not available.');
        }
        return pkg;
    }

    async listTransactions(tenantId: string, take = 30) {
        const transactions = await this.db.smsTransaction.findMany({
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
            take,
        });
        return transactions.map((tx) => this.mapTransaction(tx));
    }

    mapPackage(pkg: {
        id: string;
        channel: string;
        name: string;
        credits: number;
        price: unknown;
        currency: string;
        is_active?: boolean;
        sort_order?: number;
    }) {
        return {
            id: pkg.id,
            channel: pkg.channel,
            name: pkg.name,
            credits: pkg.credits,
            price: Number(pkg.price),
            currency: pkg.currency,
            is_active: pkg.is_active ?? true,
            sort_order: pkg.sort_order ?? 0,
        };
    }

    private mapTransaction(tx: {
        id: string;
        channel: string;
        type: string;
        credits: number;
        balance_after: number;
        description: string | null;
        recipient: string | null;
        reference: string | null;
        created_at: Date;
    }) {
        return {
            id: tx.id,
            channel: tx.channel,
            type: tx.type,
            credits: tx.credits,
            balance_after: tx.balance_after,
            description: tx.description,
            recipient: tx.recipient,
            reference: tx.reference,
            created_at: tx.created_at,
        };
    }
}
