import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { StorePermission, UserRole, resolveBaseUserRole } from '@erp71/shared-types';
import { TenantContext } from '../database/tenant.decorator';
import { syncMemberPermissionsFromRole } from './role-sync.util';
import { CreateTenantRoleDto, UpdateTenantRoleDto } from './team.dto';

const VALID_PERMISSIONS = new Set<string>(Object.values(StorePermission));

@Injectable()
export class TeamService {
    constructor(
        private db: DatabaseService,
        private audit: AuditService,
        private invitations: InvitationsService,
    ) {}

    /* ----------------------------- Authorization ----------------------------- */

    /**
     * OWNER may always manage. Other roles need the given permission granted on the
     * branch they are currently operating from (the x-store-id context).
     *
     * Note: enforcement lives here rather than in StorePermissionGuard because the
     * tenant/store context is resolved by TenantInterceptor, which (being an
     * interceptor) runs after guards — so a guard cannot see request.storeId/userRole.
     */
    private async assertPermission(ctx: TenantContext, permission: StorePermission): Promise<void> {
        if (ctx.userRole === UserRole.OWNER) return;

        if (!ctx.storeId) {
            throw new ForbiddenException('Select a branch before managing team members.');
        }

        const grant = await this.db.userStorePermission.findFirst({
            where: { user_id: ctx.userId, store_id: ctx.storeId, permission: permission as any },
            select: { id: true },
        });

        if (!grant) {
            throw new ForbiddenException(`You do not have permission to ${permission}.`);
        }
    }

    private async getMembership(tenantId: string, userId: string) {
        const membership = await this.db.tenantUser.findUnique({
            where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } },
            include: { tenantRole: { include: { permissions: { select: { permission: true } } } } },
        });
        if (!membership) throw new NotFoundException('User is not a member of this organization.');
        return membership;
    }

    private async countOwners(tenantId: string): Promise<number> {
        return this.db.tenantUser.count({ where: { tenant_id: tenantId, role: UserRole.OWNER } });
    }

    private auditCtx(ctx: TenantContext) {
        return { userId: ctx.userId, tenantId: ctx.tenantId };
    }

    private assertOwner(ctx: TenantContext): void {
        if (ctx.userRole !== UserRole.OWNER) {
            throw new ForbiddenException('Only the organization owner can manage roles.');
        }
    }

    private normalizeRoleName(name: string): string {
        const trimmed = name.trim();
        if (!trimmed) {
            throw new BadRequestException('Role name is required.');
        }
        return trimmed;
    }

    private async validateRoleName(tenantId: string, name: string, excludeId?: string): Promise<string> {
        const normalized = this.normalizeRoleName(name);
        if (normalized.toLowerCase() === 'owner') {
            throw new BadRequestException('Cannot use the name "Owner".');
        }

        const existing = await this.db.tenantRole.findMany({
            where: {
                tenant_id: tenantId,
                ...(excludeId ? { id: { not: excludeId } } : {}),
            },
            select: { name: true },
        });
        const lower = normalized.toLowerCase();
        if (existing.some((role) => role.name.toLowerCase() === lower)) {
            throw new BadRequestException('A role with this name already exists.');
        }

        return normalized;
    }

    private filterPermissions(permissions: StorePermission[]): StorePermission[] {
        return Array.from(new Set(permissions)).filter((p) => VALID_PERMISSIONS.has(p));
    }

    private async getTenantRole(tenantId: string, roleId: string) {
        const role = await this.db.tenantRole.findFirst({
            where: { id: roleId, tenant_id: tenantId },
            include: { permissions: { select: { permission: true } } },
        });
        if (!role) throw new NotFoundException('Role not found.');
        return role;
    }

    /* -------------------------------- Reads ---------------------------------- */

    async listMembers(ctx: TenantContext, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);

        const where = { tenant_id: ctx.tenantId };
        const pageNum = Math.max(1, page ?? 1);
        const limitNum = Math.min(100, Math.max(1, limit ?? 100));
        const skip = (pageNum - 1) * limitNum;

        const [members, total, accessRows, permCounts] = await Promise.all([
            this.db.tenantUser.findMany({
                where,
                include: {
                    user: { select: { id: true, email: true, name: true } },
                    tenantRole: { select: { id: true, name: true } },
                },
                orderBy: { user: { email: 'asc' } },
                skip,
                take: limitNum,
            }),
            this.db.tenantUser.count({ where }),
            this.db.userStoreAccess.findMany({
                where: { tenant_id: ctx.tenantId },
                include: { store: { select: { id: true, name: true } } },
            }),
            this.db.userStorePermission.groupBy({
                by: ['user_id', 'store_id'],
                where: { tenant_id: ctx.tenantId },
                _count: { _all: true },
            }),
        ]);

        const permCountMap = new Map<string, number>();
        for (const row of permCounts) {
            permCountMap.set(`${row.user_id}:${row.store_id}`, row._count._all);
        }

        const items = members.map((member) => ({
            userId: member.user_id,
            email: member.user.email,
            name: member.user.name,
            isOwner: member.role === UserRole.OWNER,
            roleName: member.role === UserRole.OWNER ? 'Owner' : member.tenantRole?.name,
            tenantRoleId: member.tenant_role_id,
            isSelf: member.user_id === ctx.userId,
            stores: accessRows
                .filter((a) => a.user_id === member.user_id)
                .map((a) => ({
                    storeId: a.store_id,
                    storeName: a.store.name,
                    accessLevel: a.access_level,
                    permissionCount: permCountMap.get(`${a.user_id}:${a.store_id}`) ?? 0,
                })),
        }));

        return paginate(items, total, pageNum, limitNum);
    }

    async listRoles(ctx: TenantContext) {
        this.assertOwner(ctx);

        const roles = await this.db.tenantRole.findMany({
            where: { tenant_id: ctx.tenantId },
            include: {
                permissions: { select: { permission: true } },
                _count: { select: { members: true } },
            },
            orderBy: { name: 'asc' },
        });

        return roles.map((role) => ({
            id: role.id,
            name: role.name,
            description: role.description,
            is_system: role.is_system,
            permissions: role.permissions.map((p) => p.permission),
            member_count: role._count.members,
        }));
    }

    /** All branches in the tenant — used to render the access/permission matrix. */
    async listStores(ctx: TenantContext) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const stores = await this.db.store.findMany({
            where: { tenant_id: ctx.tenantId },
            select: { id: true, name: true },
            orderBy: { created_at: 'asc' },
        });
        return stores.map((s) => ({ storeId: s.id, storeName: s.name }));
    }

    async getMember(ctx: TenantContext, userId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const membership = await this.getMembership(ctx.tenantId, userId);

        const [user, stores, access, perms] = await Promise.all([
            this.db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } }),
            this.db.store.findMany({
                where: { tenant_id: ctx.tenantId },
                select: { id: true, name: true },
                orderBy: { created_at: 'asc' },
            }),
            this.db.userStoreAccess.findMany({ where: { tenant_id: ctx.tenantId, user_id: userId } }),
            this.db.userStorePermission.findMany({
                where: { tenant_id: ctx.tenantId, user_id: userId },
                select: { store_id: true, permission: true },
            }),
        ]);

        const accessMap = new Map(access.map((a) => [a.store_id, a.access_level]));
        const permsByStore = new Map<string, string[]>();
        for (const p of perms) {
            const list = permsByStore.get(p.store_id) ?? [];
            list.push(p.permission);
            permsByStore.set(p.store_id, list);
        }

        return {
            userId,
            email: user?.email,
            name: user?.name,
            isOwner: membership.role === UserRole.OWNER,
            roleName: membership.role === UserRole.OWNER ? 'Owner' : membership.tenantRole?.name,
            tenantRoleId: membership.tenant_role_id,
            isSelf: userId === ctx.userId,
            stores: stores.map((s) => ({
                storeId: s.id,
                storeName: s.name,
                hasAccess: accessMap.has(s.id),
                accessLevel: accessMap.get(s.id) ?? 'STORE_ONLY',
                permissions: permsByStore.get(s.id) ?? [],
            })),
        };
    }

    /* ------------------------------- Mutations ------------------------------- */

    async createRole(ctx: TenantContext, dto: CreateTenantRoleDto) {
        this.assertOwner(ctx);

        const name = await this.validateRoleName(ctx.tenantId, dto.name);
        const permissions = this.filterPermissions(dto.permissions);
        if (permissions.length === 0) {
            throw new BadRequestException('At least one valid permission is required.');
        }

        const role = await this.db.$transaction(async (tx) => {
            const created = await tx.tenantRole.create({
                data: {
                    tenant_id: ctx.tenantId,
                    name,
                    description: dto.description?.trim() || null,
                    is_system: false,
                },
            });
            await tx.tenantRolePermission.createMany({
                data: permissions.map((permission) => ({
                    tenant_role_id: created.id,
                    permission: permission as any,
                })),
            });
            return created;
        });

        await this.audit.log('team.role_created', 'TenantRole', this.auditCtx(ctx), role.id, {
            name,
            permissions,
        });
        return { message: 'Role created.', roleId: role.id };
    }

    async updateRoleTemplate(ctx: TenantContext, roleId: string, dto: UpdateTenantRoleDto) {
        this.assertOwner(ctx);

        const existing = await this.getTenantRole(ctx.tenantId, roleId);
        const currentPermissions = existing.permissions.map((p) => p.permission).sort();

        let name = existing.name;
        if (dto.name !== undefined) {
            name = await this.validateRoleName(ctx.tenantId, dto.name, roleId);
        }

        const nextPermissions =
            dto.permissions !== undefined ? this.filterPermissions(dto.permissions).sort() : null;
        if (nextPermissions !== null && nextPermissions.length === 0) {
            throw new BadRequestException('At least one valid permission is required.');
        }

        const permissionsChanged =
            nextPermissions !== null &&
            (nextPermissions.length !== currentPermissions.length ||
                nextPermissions.some((p, i) => p !== currentPermissions[i]));

        let syncedCount = 0;

        await this.db.$transaction(async (tx) => {
            await tx.tenantRole.update({
                where: { id: roleId },
                data: {
                    ...(dto.name !== undefined ? { name } : {}),
                    ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
                },
            });

            if (permissionsChanged && nextPermissions) {
                await tx.tenantRolePermission.deleteMany({ where: { tenant_role_id: roleId } });
                await tx.tenantRolePermission.createMany({
                    data: nextPermissions.map((permission) => ({
                        tenant_role_id: roleId,
                        permission: permission as any,
                    })),
                });

                const members = await tx.tenantUser.findMany({
                    where: { tenant_id: ctx.tenantId, tenant_role_id: roleId },
                    select: { user_id: true },
                });
                const userIds = members.map((m) => m.user_id);
                syncedCount = await syncMemberPermissionsFromRole(tx, {
                    tenantId: ctx.tenantId,
                    userIds,
                    tenantRoleId: roleId,
                    grantedBy: ctx.userId,
                });
            }
        });

        await this.audit.log('team.role_updated', 'TenantRole', this.auditCtx(ctx), roleId, {
            name: dto.name !== undefined ? name : undefined,
            description: dto.description,
            permissions: nextPermissions ?? undefined,
        });
        if (permissionsChanged) {
            await this.audit.log('team.role_permissions_synced', 'TenantRole', this.auditCtx(ctx), roleId, {
                syncedCount,
            });
        }

        return { message: 'Role updated.' };
    }

    async deleteRole(ctx: TenantContext, roleId: string) {
        this.assertOwner(ctx);

        const role = await this.getTenantRole(ctx.tenantId, roleId);
        const memberCount = await this.db.tenantUser.count({
            where: { tenant_id: ctx.tenantId, tenant_role_id: roleId },
        });
        if (memberCount > 0) {
            throw new BadRequestException('Cannot delete a role that still has members assigned.');
        }

        await this.db.tenantRole.delete({ where: { id: role.id } });
        await this.audit.log('team.role_deleted', 'TenantRole', this.auditCtx(ctx), roleId, { name: role.name });
        return { message: 'Role deleted.' };
    }

    async updateRole(ctx: TenantContext, userId: string, tenantRoleId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const membership = await this.getMembership(ctx.tenantId, userId);

        if (userId === ctx.userId) {
            throw new BadRequestException('You cannot change your own role.');
        }
        if (membership.role === UserRole.OWNER) {
            throw new BadRequestException('Cannot change the role of an owner.');
        }

        const role = await this.getTenantRole(ctx.tenantId, tenantRoleId);

        await this.db.$transaction(async (tx) => {
            await tx.tenantUser.update({
                where: { tenant_id_user_id: { tenant_id: ctx.tenantId, user_id: userId } },
                // Keep the coarse role enum in lockstep with the assigned TenantRole —
                // it drives the session's displayed role, the OWNER/MANAGER authorization
                // gates, and the platform-admin Edit Tenant view, all of which read the enum.
                data: { tenant_role_id: tenantRoleId, role: resolveBaseUserRole(role.name) },
            });

            await syncMemberPermissionsFromRole(tx, {
                tenantId: ctx.tenantId,
                userIds: [userId],
                tenantRoleId,
                grantedBy: ctx.userId,
            });
        });

        await this.audit.log('team.role_updated', 'TenantUser', this.auditCtx(ctx), userId, { tenantRoleId });
        return { message: 'Role updated.' };
    }

    async grantStoreAccess(
        ctx: TenantContext,
        userId: string,
        storeId: string,
        accessLevel: 'STORE_ONLY' | 'MULTI_STORE_CAPABLE',
        seedDefaults: boolean,
    ) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USER_STORE_ACCESS);
        const membership = await this.getMembership(ctx.tenantId, userId);

        const store = await this.db.store.findFirst({
            where: { id: storeId, tenant_id: ctx.tenantId },
            select: { id: true },
        });
        if (!store) throw new NotFoundException('Branch not found in this organization.');

        const existing = await this.db.userStoreAccess.findUnique({
            where: { user_id_store_id: { user_id: userId, store_id: storeId } },
            select: { id: true },
        });

        await this.db.$transaction(async (tx) => {
            await tx.userStoreAccess.upsert({
                where: { user_id_store_id: { user_id: userId, store_id: storeId } },
                update: { access_level: accessLevel },
                create: { user_id: userId, store_id: storeId, tenant_id: ctx.tenantId, access_level: accessLevel },
            });

            if (!existing && seedDefaults && membership.role !== UserRole.OWNER) {
                const rolePermissions = membership.tenantRole?.permissions ?? [];
                const defaults = rolePermissions
                    .map((p) => p.permission)
                    .filter((p) => VALID_PERMISSIONS.has(p));
                if (defaults.length > 0) {
                    await tx.userStorePermission.createMany({
                        data: defaults.map((permission) => ({
                            user_id: userId,
                            store_id: storeId,
                            tenant_id: ctx.tenantId,
                            permission: permission as any,
                            granted_by: ctx.userId,
                        })),
                        skipDuplicates: true,
                    });
                }
            }
        });

        await this.audit.log('team.store_access_granted', 'UserStoreAccess', this.auditCtx(ctx), userId, {
            storeId,
            accessLevel,
        });
        return { message: 'Branch access updated.' };
    }

    async revokeStoreAccess(ctx: TenantContext, userId: string, storeId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USER_STORE_ACCESS);
        await this.getMembership(ctx.tenantId, userId);

        await this.db.$transaction([
            this.db.userStorePermission.deleteMany({
                where: { tenant_id: ctx.tenantId, user_id: userId, store_id: storeId },
            }),
            this.db.userStoreAccess.deleteMany({
                where: { tenant_id: ctx.tenantId, user_id: userId, store_id: storeId },
            }),
        ]);

        await this.audit.log('team.store_access_revoked', 'UserStoreAccess', this.auditCtx(ctx), userId, { storeId });
        return { message: 'Branch access revoked.' };
    }

    async setStorePermissions(ctx: TenantContext, userId: string, storeId: string, permissions: StorePermission[]) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        await this.getMembership(ctx.tenantId, userId);

        const access = await this.db.userStoreAccess.findUnique({
            where: { user_id_store_id: { user_id: userId, store_id: storeId } },
            select: { id: true, tenant_id: true },
        });
        if (!access || access.tenant_id !== ctx.tenantId) {
            throw new BadRequestException('Grant branch access before assigning permissions.');
        }

        const unique = Array.from(new Set(permissions)).filter((p) => VALID_PERMISSIONS.has(p));

        await this.db.$transaction(async (tx) => {
            await tx.userStorePermission.deleteMany({
                where: { tenant_id: ctx.tenantId, user_id: userId, store_id: storeId },
            });
            if (unique.length > 0) {
                await tx.userStorePermission.createMany({
                    data: unique.map((permission) => ({
                        user_id: userId,
                        store_id: storeId,
                        tenant_id: ctx.tenantId,
                        permission: permission as any,
                        granted_by: ctx.userId,
                    })),
                    skipDuplicates: true,
                });
            }
        });

        await this.audit.log('team.permissions_updated', 'UserStorePermission', this.auditCtx(ctx), userId, {
            storeId,
            permissions: unique,
        });
        return { message: 'Permissions updated.' };
    }

    async removeMember(ctx: TenantContext, userId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const membership = await this.getMembership(ctx.tenantId, userId);

        if (userId === ctx.userId) {
            throw new BadRequestException('You cannot remove yourself.');
        }
        if (membership.role === UserRole.OWNER) {
            if (ctx.userRole !== UserRole.OWNER) {
                throw new ForbiddenException('Only an owner can remove another owner.');
            }
            if ((await this.countOwners(ctx.tenantId)) <= 1) {
                throw new BadRequestException('Cannot remove the last owner.');
            }
        }

        await this.db.$transaction([
            this.db.userStorePermission.deleteMany({ where: { tenant_id: ctx.tenantId, user_id: userId } }),
            this.db.userStoreAccess.deleteMany({ where: { tenant_id: ctx.tenantId, user_id: userId } }),
            this.db.tenantUser.delete({
                where: { tenant_id_user_id: { tenant_id: ctx.tenantId, user_id: userId } },
            }),
        ]);

        await this.audit.log('team.member_removed', 'TenantUser', this.auditCtx(ctx), userId, {});
        return { message: 'Member removed.' };
    }

    /* ------------------------------ Invitations ------------------------------ */

    async listInvitations(ctx: TenantContext) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const invites = await this.db.userInvitation.findMany({
            where: { tenant_id: ctx.tenantId, accepted_at: null, expires_at: { gt: new Date() } },
            orderBy: { created_at: 'desc' },
            include: { tenantRole: { select: { id: true, name: true } } },
        });
        return invites.map((i) => ({
            id: i.id,
            email: i.email,
            roleName: i.tenantRole.name,
            tenantRoleId: i.tenant_role_id,
            invitedAt: i.created_at,
            expiresAt: i.expires_at,
        }));
    }

    async invite(ctx: TenantContext, email: string, tenantRoleId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        await this.invitations.invite(ctx.tenantId, ctx.userId, ctx.userRole ?? '', email, tenantRoleId);
        await this.audit.log('team.invitation_sent', 'UserInvitation', this.auditCtx(ctx), undefined, {
            email,
            tenantRoleId,
        });
        return { message: 'Invitation sent.' };
    }

    async revokeInvitation(ctx: TenantContext, invitationId: string) {
        await this.assertPermission(ctx, StorePermission.MANAGE_USERS);
        const result = await this.db.userInvitation.deleteMany({
            where: { id: invitationId, tenant_id: ctx.tenantId, accepted_at: null },
        });
        if (result.count === 0) throw new NotFoundException('Invitation not found.');
        await this.audit.log('team.invitation_revoked', 'UserInvitation', this.auditCtx(ctx), invitationId, {});
        return { message: 'Invitation revoked.' };
    }
}
