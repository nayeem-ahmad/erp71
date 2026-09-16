import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { StorePermission, UserRole } from '@erp71/shared-types';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant.decorator';
import { CreateStoreDto } from './create-store.dto';

const VALID_PERMISSIONS = new Set<string>(Object.values(StorePermission));

@Injectable()
export class StoresService {
    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
    ) {}

    async create(
        ctx: TenantContext,
        dto: CreateStoreDto,
    ): Promise<{ id: string; name: string; address: string | null }> {
        const name = requireStoreName(dto.name);
        const address = dto.address?.trim() || null;

        await this.assertNameAvailable(ctx.tenantId, name);

        const store = await this.createStoreRow(ctx, name, address);

        await this.audit.log(
            'store.created',
            'Store',
            { userId: ctx.userId, tenantId: ctx.tenantId },
            store.id,
            { name: store.name },
        );

        return store;
    }

    private async createStoreRow(ctx: TenantContext, name: string, address: string | null) {
        try {
            return await this.db.$transaction(async (tx) => {
                const created = await tx.store.create({
                    data: { tenant_id: ctx.tenantId, name, address },
                    select: { id: true, name: true, address: true },
                });

                // `/auth/me` builds its branch list purely from UserStoreAccess rows, so a
                // branch with no grants is invisible to everyone — including whoever just
                // created it. Owners get the same MULTI_STORE_CAPABLE row signup hands out.
                const owners = await tx.tenantUser.findMany({
                    where: { tenant_id: ctx.tenantId, role: UserRole.OWNER },
                    select: { user_id: true },
                });
                const grantees = new Set(owners.map((o) => o.user_id));
                grantees.add(ctx.userId);

                await tx.userStoreAccess.createMany({
                    data: [...grantees].map((userId) => ({
                        user_id: userId,
                        store_id: created.id,
                        tenant_id: ctx.tenantId,
                        access_level: 'MULTI_STORE_CAPABLE',
                    })),
                    skipDuplicates: true,
                });

                // An OWNER bypasses StorePermissionGuard, so permission rows for one are
                // redundant — team.service skips them for the same reason. A non-owner
                // creator needs their role's defaults here or the branch is read-only to
                // the person who just made it.
                const creator = await tx.tenantUser.findUnique({
                    where: { tenant_id_user_id: { tenant_id: ctx.tenantId, user_id: ctx.userId } },
                    include: { tenantRole: { include: { permissions: true } } },
                });

                if (creator && creator.role !== UserRole.OWNER) {
                    const defaults = (creator.tenantRole?.permissions ?? [])
                        .map((p) => p.permission as string)
                        .filter((p) => VALID_PERMISSIONS.has(p));
                    if (defaults.length > 0) {
                        await tx.userStorePermission.createMany({
                            data: defaults.map((permission) => ({
                                user_id: ctx.userId,
                                store_id: created.id,
                                tenant_id: ctx.tenantId,
                                permission: permission as any,
                                granted_by: ctx.userId,
                            })),
                            skipDuplicates: true,
                        });
                    }
                }

                return created;
            });
        } catch (error) {
            throw asStoreWriteError(error);
        }
    }

    async rename(tenantId: string, storeId: string, name: string): Promise<{ id: string; name: string }> {
        const store = await this.db.store.findFirst({ where: { id: storeId, tenant_id: tenantId } });
        if (!store) {
            throw new NotFoundException('Store not found');
        }

        // This path had neither check until now: a branch could be renamed to
        // blank, or onto the name of another branch, and the branch switcher —
        // which shows the name and nothing else — had no way to tell them apart.
        const next = requireStoreName(name);
        if (next !== store.name) {
            await this.assertNameAvailable(tenantId, next, storeId);
        }

        try {
            return await this.db.store.update({
                where: { id: storeId },
                data: { name: next },
                select: { id: true, name: true },
            });
        } catch (error) {
            throw asStoreWriteError(error);
        }
    }

    /**
     * A tenant may not hold two branches of the same name. Matched
     * case-insensitively, because "Gulshan" and "gulshan" are the same place to
     * anyone reading the branch switcher, even though the unique index behind
     * this — Postgres compares text bytewise — would let both through.
     */
    private async assertNameAvailable(tenantId: string, name: string, excludeId?: string) {
        const duplicate = await this.db.store.findFirst({
            where: {
                tenant_id: tenantId,
                name: { equals: name, mode: 'insensitive' },
                ...(excludeId ? { NOT: { id: excludeId } } : {}),
            },
            select: { id: true },
        });
        if (duplicate) {
            throw new ConflictException('A store with that name already exists.');
        }
    }
}

/**
 * The service's own last word on "a branch must have a name". The DTOs already
 * reject a blank one, but they only guard the HTTP edge, and a nameless branch
 * is a blank row in the branch switcher, in every store picker and in the Branch
 * column of the warehouses list.
 */
function requireStoreName(name: unknown): string {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
        throw new BadRequestException('Store name is required.');
    }
    return trimmed;
}

/**
 * The duplicate check above reads before it writes, so two requests racing on
 * the same name can both pass it; the unique index is what actually stops the
 * second one. This turns the Prisma error it raises into the sentence the caller
 * would have got had it lost the race by a moment more.
 */
function asStoreWriteError(error: any): any {
    if (error?.code !== 'P2002') return error;
    return new ConflictException('A store with that name already exists.');
}
