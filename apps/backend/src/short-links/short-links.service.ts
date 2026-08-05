import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { isSafeTarget } from './is-safe-target';
import { generateShortCode } from './short-link-code';

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

type EntityType = 'QUOTATION' | 'STOREFRONT_PRODUCT';

const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class ShortLinksService {
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

    async resolve(code: string, countClick: boolean): Promise<{ target_url: string; kind: 'internal' | 'external' }> {
        const link = await this.db.shortLink.findUnique({ where: { code } });
        if (!link || link.revoked_at) throw new NotFoundException('Link not found');

        // Re-validate on read. A row written before a rule tightened must not keep
        // redirecting simply because it is already stored.
        const checked = isSafeTarget(link.target_url);
        if (!checked.ok) throw new NotFoundException('Link not found');

        if (countClick) {
            await this.db.shortLink.update({
                where: { id: link.id },
                data: { click_count: { increment: 1 }, last_click_at: new Date() },
            });
        }

        return { target_url: checked.url, kind: checked.kind };
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
