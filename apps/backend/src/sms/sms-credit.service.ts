import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { hasStorePermission } from '../auth/permission.util';
import { TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { ConfirmSmsCreditsPurchaseDto, PurchaseSmsCreditsDto } from './sms-credit.dto';

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

@Injectable()
export class SmsCreditService {
    private readonly logger = new Logger(SmsCreditService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
    ) {}

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
     * Atomically consume credits for an SMS send. Returns whether the send is
     * allowed (i.e. the tenant had enough balance). When allowed, the balance
     * is decremented and a USAGE ledger entry is written.
     */
    async consume(
        tenantId: string,
        credits: number,
        meta: { recipient?: string; description?: string } = {},
    ): Promise<{ allowed: boolean; balance: number }> {
        if (credits <= 0) {
            const tenant = await this.db.tenant.findUnique({
                where: { id: tenantId },
                select: { sms_credits: true },
            });
            return { allowed: true, balance: tenant?.sms_credits ?? 0 };
        }

        // Conditional decrement: only succeeds when the balance is sufficient.
        const updated = await this.db.tenant.updateMany({
            where: { id: tenantId, sms_credits: { gte: credits } },
            data: { sms_credits: { decrement: credits } },
        });

        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { sms_credits: true },
        });
        const balance = tenant?.sms_credits ?? 0;

        if (updated.count === 0) {
            this.logger.warn(
                `Insufficient SMS credits for tenant ${tenantId} (needed ${credits}, have ${balance}).`,
            );
            return { allowed: false, balance };
        }

        await this.db.smsTransaction.create({
            data: {
                tenant_id: tenantId,
                type: 'USAGE',
                credits: -credits,
                balance_after: balance,
                recipient: meta.recipient ?? null,
                description: meta.description ?? null,
            },
        });

        return { allowed: true, balance };
    }

    /** Balance, available top-up packages, and recent ledger entries. */
    async getSummary(ctx: TenantContext) {
        const membership = await this.requireTenantMembership(ctx.userId, ctx.tenantId);
        const [tenant, packages, transactions] = await Promise.all([
            this.db.tenant.findUnique({
                where: { id: ctx.tenantId },
                select: { id: true, name: true, sms_credits: true, sms_enabled: true },
            }),
            this.db.smsPackage.findMany({
                where: { is_active: true },
                orderBy: [{ sort_order: 'asc' }, { price: 'asc' }],
            }),
            this.db.smsTransaction.findMany({
                where: { tenant_id: ctx.tenantId },
                orderBy: { created_at: 'desc' },
                take: 20,
            }),
        ]);

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        return {
            tenant: { id: tenant.id, name: tenant.name },
            role: membership.role,
            can_manage_billing: await this.canManageBilling(ctx),
            sms_enabled: tenant.sms_enabled,
            balance: tenant.sms_credits,
            low_balance: tenant.sms_credits < 20,
            packages: packages.map((pkg) => this.mapPackage(pkg)),
            transactions: transactions.map((tx) => this.mapTransaction(tx)),
        };
    }

    /**
     * Start a top-up purchase. In manual mode the credits are granted only
     * after `confirmPurchase`; the response tells the frontend to confirm.
     */
    async createPurchase(ctx: TenantContext, dto: PurchaseSmsCreditsDto) {
        await this.requireTenantMembership(ctx.userId, ctx.tenantId);
        await this.assertBillingAccess(ctx);

        const pkg = await this.getActivePackage(dto.packageId);
        const reference = `sms_${ctx.tenantId.slice(0, 8)}_${Date.now()}`;

        await this.recordBillingEvent({
            tenantId: ctx.tenantId,
            externalEventId: reference,
            eventType: 'SMS_TOPUP_CREATED',
            status: 'PENDING',
            referenceId: reference,
            amount: Number(pkg.price),
            currency: pkg.currency,
            payload: { packageId: pkg.id, credits: pkg.credits },
        });

        return {
            reference,
            requires_confirmation: true,
            package: this.mapPackage(pkg),
            amount: Number(pkg.price),
            currency: pkg.currency,
        };
    }

    /** Grant the purchased credits and write the PURCHASE ledger entry. */
    async confirmPurchase(ctx: TenantContext, dto: ConfirmSmsCreditsPurchaseDto) {
        await this.requireTenantMembership(ctx.userId, ctx.tenantId);
        await this.assertBillingAccess(ctx);

        const pkg = await this.getActivePackage(dto.packageId);
        const reference = dto.reference || `sms_${ctx.tenantId}_${Date.now()}`;

        const result = await this.grantCredits(ctx.tenantId, pkg.credits, {
            type: 'PURCHASE',
            reference,
            description: `Purchased ${pkg.name} (${pkg.credits} SMS credits)`,
        });

        await this.recordBillingEvent({
            tenantId: ctx.tenantId,
            externalEventId: `${reference}:confirmed`,
            eventType: 'SMS_TOPUP_CONFIRMED',
            status: 'COMPLETED',
            referenceId: reference,
            amount: Number(pkg.price),
            currency: pkg.currency,
            payload: { packageId: pkg.id, credits: pkg.credits },
        });

        this.audit
            .log('SMS_CREDITS_PURCHASED', 'SmsTransaction', { userId: ctx.userId, tenantId: ctx.tenantId }, result.transactionId, {
                packageId: pkg.id,
                credits: pkg.credits,
                amount: Number(pkg.price),
                currency: pkg.currency,
                reference,
            })
            .catch(() => {});

        return {
            purchased: true,
            credits_added: pkg.credits,
            balance: result.balance,
            reference,
        };
    }

    /** Platform admin grants prepaid SMS credits (sale or adjustment). */
    async adminGrantCredits(
        tenantId: string,
        credits: number,
        meta: { description?: string; recordedBy?: string },
    ) {
        return this.grantCredits(tenantId, credits, {
            type: 'ADJUSTMENT',
            description: meta.description ?? 'Admin SMS credit grant',
            reference: meta.recordedBy ? `admin:${meta.recordedBy}` : 'admin',
        });
    }

    /** Add credits to the balance and record a ledger entry. */
    private async grantCredits(
        tenantId: string,
        credits: number,
        meta: { type: string; reference?: string; description?: string; recipient?: string },
    ): Promise<{ balance: number; transactionId: string }> {
        const tenant = await this.db.tenant.update({
            where: { id: tenantId },
            data: { sms_credits: { increment: credits } },
            select: { sms_credits: true },
        });

        const transaction = await this.db.smsTransaction.create({
            data: {
                tenant_id: tenantId,
                type: meta.type,
                credits,
                balance_after: tenant.sms_credits,
                description: meta.description ?? null,
                reference: meta.reference ?? null,
                recipient: meta.recipient ?? null,
            },
        });

        return { balance: tenant.sms_credits, transactionId: transaction.id };
    }

    private async getActivePackage(packageId: string) {
        const pkg = await this.db.smsPackage.findUnique({ where: { id: packageId } });
        if (!pkg || !pkg.is_active) {
            throw new BadRequestException('Selected SMS package is not available.');
        }
        return pkg;
    }

    private async recordBillingEvent(input: {
        tenantId: string;
        externalEventId: string;
        eventType: string;
        status: string;
        referenceId?: string;
        amount?: number;
        currency?: string;
        payload: unknown;
    }) {
        return this.db.billingEvent.upsert({
            where: {
                provider_name_external_event_id: {
                    provider_name: 'sms-credits',
                    external_event_id: input.externalEventId,
                },
            },
            update: {
                status: input.status,
                event_type: input.eventType,
                reference_id: input.referenceId,
                amount: input.amount,
                currency: input.currency,
                payload: input.payload as any,
            },
            create: {
                tenant_id: input.tenantId,
                provider_name: 'sms-credits',
                external_event_id: input.externalEventId,
                event_type: input.eventType,
                status: input.status,
                reference_id: input.referenceId,
                amount: input.amount,
                currency: input.currency,
                payload: input.payload as any,
            },
        });
    }

    private mapPackage(pkg: {
        id: string;
        name: string;
        credits: number;
        price: unknown;
        currency: string;
    }) {
        return {
            id: pkg.id,
            name: pkg.name,
            credits: pkg.credits,
            price: Number(pkg.price),
            currency: pkg.currency,
        };
    }

    private mapTransaction(tx: {
        id: string;
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
            type: tx.type,
            credits: tx.credits,
            balance_after: tx.balance_after,
            description: tx.description,
            recipient: tx.recipient,
            reference: tx.reference,
            created_at: tx.created_at,
        };
    }

    private async requireTenantMembership(userId: string, tenantId: string) {
        const membership = await this.db.tenantUser.findUnique({
            where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } },
        });

        if (!membership) {
            throw new UnauthorizedException('Invalid tenant context');
        }

        return membership;
    }

    private async canManageBilling(ctx: TenantContext): Promise<boolean> {
        return hasStorePermission(this.db, ctx, StorePermission.MANAGE_USERS);
    }

    private async assertBillingAccess(ctx: TenantContext): Promise<void> {
        if (!(await this.canManageBilling(ctx))) {
            throw new ForbiddenException('You do not have permission to purchase SMS credits.');
        }
    }
}
