import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { buildClickContext, ClickInput } from './click-context';
import { isSafeTarget } from './is-safe-target';
import { generateShortCode } from './short-link-code';
import { ShortLinkEntity } from '@prisma/client';

export type ShortLinkView = {
    id: string;
    code: string;
    target_url: string;
    label: string | null;
    click_count: number;
    last_click_at: Date | null;
    created_at: Date;
    revoked_at: Date | null;
};

/**
 * Derived from the Prisma enum rather than restated as a union: this type was
 * hand-written and had already fallen a value behind the schema, which failed
 * as a type error at the call site rather than as anything a reader would spot
 * here. Adding a ShortLinkEntity value now widens this automatically.
 */
type EntityType = ShortLinkEntity;

/**
 * What the redirect handler observed about the visitor. Every field is optional:
 * the click is recorded with whatever survived, never withheld for want of a
 * header.
 */
export type ClickMeta = ClickInput;

const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class ShortLinksService {
    private readonly logger = new Logger(ShortLinksService.name);

    constructor(private readonly db: DatabaseService) {}

    async createManual(
        tenantId: string | null,
        userId: string,
        dto: { target_url: string; label?: string },
    ): Promise<ShortLinkView> {
        const checked = isSafeTarget(dto.target_url);
        if (checked.ok === false) throw new BadRequestException(checked.reason);

        return this.insertWithCode({
            tenant_id: tenantId,
            target_url: checked.url,
            label: dto.label ?? null,
            kind: 'MANUAL',
            created_by: userId,
        });
    }

    async createForEntity(input: {
        tenantId: string;
        userId: string;
        entityType: EntityType;
        entityId: string;
        targetUrl: string;
    }): Promise<ShortLinkView> {
        const checked = isSafeTarget(input.targetUrl);
        if (checked.ok === false) throw new BadRequestException(checked.reason);

        // Idempotent: reopening the share modal must not mint a second code for
        // the same quotation, or every reopen would leave another live link.
        const existing = await this.db.shortLink.findFirst({
            where: {
                tenant_id: input.tenantId,
                entity_type: input.entityType,
                entity_id: input.entityId,
                target_url: checked.url,
                revoked_at: null,
            },
        });
        if (existing) return this.toView(existing);

        return this.insertWithCode({
            tenant_id: input.tenantId,
            target_url: checked.url,
            label: null,
            kind: 'ENTITY',
            entity_type: input.entityType,
            entity_id: input.entityId,
            created_by: input.userId,
        });
    }

    async resolve(
        code: string,
        countClick: boolean,
        meta: ClickMeta = {},
    ): Promise<{ target_url: string; kind: 'internal' | 'external' }> {
        const link = await this.db.shortLink.findUnique({ where: { code } });
        if (!link || link.revoked_at) throw new NotFoundException('Link not found');

        // Re-validate on read. A row written before a rule tightened must not keep
        // redirecting simply because it is already stored.
        const checked = isSafeTarget(link.target_url);
        if (!checked.ok) throw new NotFoundException('Link not found');

        if (countClick) await this.recordClick(link, meta);

        return { target_url: checked.url, kind: checked.kind };
    }

    /**
     * Bump the counter and store the click's full context.
     *
     * Two writes rather than one because they answer different questions:
     * `click_count` is what the shortener list renders on every row and must stay
     * cheap to read, while `ShortLinkClick` is the per-click detail that a report
     * groups by. Keeping the counter denormalised means the list never has to
     * COUNT(*) over a table that grows without bound.
     *
     * The whole thing is swallowed on failure, on purpose. Someone is mid-redirect
     * waiting on this; a tracking write that fails — a full disk, a lock, a schema
     * not yet pushed — must cost us a row of analytics, never their destination.
     * It is logged rather than silently dropped so a persistent failure is still
     * discoverable.
     */
    private async recordClick(link: { id: string; tenant_id: string | null; code: string }, meta: ClickMeta) {
        try {
            const context = buildClickContext(meta);
            await Promise.all([
                this.db.shortLink.update({
                    where: { id: link.id },
                    data: { click_count: { increment: 1 }, last_click_at: new Date() },
                }),
                this.db.shortLinkClick.create({
                    data: {
                        short_link_id: link.id,
                        // Denormalised off the link, not taken from the request:
                        // the caller here is an anonymous visitor with no tenant.
                        tenant_id: link.tenant_id,
                        code: link.code,
                        ...context,
                    },
                }),
            ]);
        } catch (error) {
            this.logger.warn(
                `Could not record click for short link ${link.code}: ${(error as Error)?.message ?? error}`,
            );
        }
    }

    /**
     * Lists one owner's links. `null` means the platform, not "everyone".
     *
     * `where: {}` here used to mean no filter at all, which made the
     * platform-admin page a viewer for every tenant's links — including the
     * auto-created `/q/<share_token>` targets behind customer quotations, the
     * exact data the sanitized public DTO exists to gate. It also drowned the
     * platform's own campaign links: `take: 200` ordered by newest first fills
     * up with tenant quotation shares within a few hundred shares.
     *
     * A null `tenant_id` is the data model's marker for a platform-owned link,
     * so that is what the platform lists.
     */
    async list(tenantId: string | null): Promise<ShortLinkView[]> {
        const rows = await this.db.shortLink.findMany({
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
            take: 200,
        });
        return rows.map((row) => this.toView(row));
    }

    async revoke(id: string, tenantId: string | null): Promise<void> {
        const result = await this.db.shortLink.updateMany({
            where: tenantId ? { id, tenant_id: tenantId } : { id },
            data: { revoked_at: new Date() },
        });
        // updateMany rather than update so a wrong-tenant id is a 404 rather than
        // a successful write against someone else's row.
        if (result.count === 0) throw new NotFoundException('Link not found');
    }

    private async insertWithCode(data: Record<string, unknown>): Promise<ShortLinkView> {
        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
            try {
                const created = await this.db.shortLink.create({
                    data: { ...data, code: generateShortCode() } as any,
                });
                return this.toView(created);
            } catch (error: any) {
                if (error?.code !== 'P2002') throw error;
            }
        }
        throw new InternalServerErrorException('Could not allocate a short code, please try again.');
    }

    private toView(row: any): ShortLinkView {
        return {
            id: row.id,
            code: row.code,
            target_url: row.target_url,
            label: row.label,
            click_count: row.click_count,
            last_click_at: row.last_click_at,
            created_at: row.created_at,
            revoked_at: row.revoked_at,
        };
    }
}
