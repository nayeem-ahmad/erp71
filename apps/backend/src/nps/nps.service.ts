import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { netPromoterScore } from '../kpis/kpi-math';

/** How long after answering (or closing) the owner question it is asked again. */
export const PLATFORM_ASK_EVERY_DAYS = 90;
/** A workspace this new has not used ERP71 long enough to have an opinion. */
export const PLATFORM_ASK_AFTER_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Net Promoter Score: collecting the answers and adding them up.
 *
 * Two surveys share one table. A shop's customers rate the shop through the
 * link on their receipt (`audience: 'tenant'`); shop owners rate ERP71 in the
 * app (`audience: 'platform'`).
 */
@Injectable()
export class NpsService {
    constructor(private readonly db: DatabaseService) {}

    // ── The receipt survey (public) ──────────────────────────────────────────

    /** What the public survey page shows: whose shop, and whether it was already answered. */
    async getPublicSurvey(code: string) {
        const invite = await this.findInvite(code);
        const tenant = await this.db.tenant.findUnique({
            where: { id: invite.tenant_id },
            select: { name: true, brand_logo_url: true },
        });
        return {
            shopName: tenant?.name ?? '',
            logoUrl: tenant?.brand_logo_url ?? null,
            answered: invite.responded_at !== null,
        };
    }

    async submitPublic(code: string, score: number, comment?: string) {
        const invite = await this.findInvite(code);
        // Claim the invite first, so two submissions racing cannot both count.
        const claimed = await this.db.npsInvite.updateMany({
            where: { id: invite.id, responded_at: null },
            data: { responded_at: new Date() },
        });
        if (claimed.count === 0) throw new BadRequestException('This survey has already been answered.');

        await this.db.npsResponse.create({
            data: {
                audience: 'tenant',
                tenant_id: invite.tenant_id,
                store_id: invite.store_id,
                customer_id: invite.customer_id,
                invite_id: invite.id,
                score,
                comment: comment?.trim() || null,
            },
        });
        return { ok: true };
    }

    private async findInvite(code: string) {
        const invite = /^[A-Za-z0-9]{6,16}$/.test(code)
            ? await this.db.npsInvite.findUnique({ where: { code } })
            : null;
        if (!invite) throw new NotFoundException('This survey link is not valid.');
        return invite;
    }

    // ── The owner question (in the app) ──────────────────────────────────────

    /**
     * Whether to ask this member how likely they are to recommend ERP71: only
     * owners, only once the workspace is a fortnight old, and not again for
     * 90 days after they answered or closed it.
     */
    async shouldAskOwner(user: { userId: string; tenantId: string; role?: string }, now = new Date()) {
        if (user.role !== 'OWNER') return { ask: false };
        const [tenant, recent] = await Promise.all([
            this.db.tenant.findUnique({
                where: { id: user.tenantId },
                select: { created_at: true, platform_workspace_key: true },
            }),
            this.db.npsResponse.findFirst({
                where: {
                    user_id: user.userId,
                    audience: 'platform',
                    created_at: { gte: new Date(now.getTime() - PLATFORM_ASK_EVERY_DAYS * DAY_MS) },
                },
                select: { id: true },
            }),
        ]);
        if (!tenant || tenant.platform_workspace_key) return { ask: false };
        const oldEnough = now.getTime() - tenant.created_at.getTime() >= PLATFORM_ASK_AFTER_DAYS * DAY_MS;
        return { ask: oldEnough && !recent };
    }

    async submitOwner(
        user: { userId: string; tenantId: string; role?: string },
        input: { score?: number; comment?: string; dismissed?: boolean },
    ) {
        if (user.role !== 'OWNER') throw new BadRequestException('Only the workspace owner is asked this.');
        await this.db.npsResponse.create({
            data: {
                audience: 'platform',
                tenant_id: user.tenantId,
                user_id: user.userId,
                score: input.dismissed ? null : input.score ?? null,
                comment: input.dismissed ? null : input.comment?.trim() || null,
                dismissed: Boolean(input.dismissed),
            },
        });
        return { ok: true };
    }

    // ── Adding up ────────────────────────────────────────────────────────────

    /** NPS over answers given in a window, for one shop (optionally one branch) or for the platform. */
    score(scope: NpsScope, window: { fromDate: Date; toDate: Date }) {
        return loadNps(this.db, scope, window);
    }
}

export type NpsScope = { audience: 'tenant'; tenantId: string; storeId?: string } | { audience: 'platform' };

/**
 * NPS over the scores given in a window. A function over the database, so the
 * KPI services can read it without another injected dependency. Dismissed
 * owner questions have no score and are left out.
 */
export async function loadNps(db: DatabaseService, scope: NpsScope, window: { fromDate: Date; toDate: Date }) {
    const rows = await db.npsResponse.findMany({
        where: {
            audience: scope.audience,
            score: { not: null },
            created_at: { gte: window.fromDate, lte: window.toDate },
            ...(scope.audience === 'tenant'
                ? { tenant_id: scope.tenantId, ...(scope.storeId ? { store_id: scope.storeId } : {}) }
                : {}),
        },
        select: { score: true },
    });
    return netPromoterScore(rows.map((r) => r.score as number));
}
