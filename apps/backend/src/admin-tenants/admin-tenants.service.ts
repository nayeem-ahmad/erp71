import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BillingService } from '../billing/billing.service';
import { DatabaseService } from '../database/database.service';
import {
    ListAdminTenantsQueryDto,
    ListAdminUsersQueryDto,
    SuspendTenantDto,
    UpdateAdminTenantSubscriptionDto,
} from './admin-tenants.dto';

@Injectable()
export class AdminTenantsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly billingService: BillingService,
        private readonly jwtService: JwtService,
    ) {}

    async listTenants(query: ListAdminTenantsQueryDto) {
        const tenants = await this.db.tenant.findMany({
            include: {
                owner: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
                stores: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                users: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                            },
                        },
                    },
                },
                subscription: {
                    include: { plan: true },
                },
            },
            orderBy: { created_at: 'desc' },
        });

        return tenants
            .filter((tenant) => {
                const normalizedSearch = query.search?.trim().toLowerCase();
                const matchesSearch = !normalizedSearch || [
                    tenant.name,
                    tenant.owner?.email,
                    tenant.owner?.name,
                ].some((value) => value?.toLowerCase().includes(normalizedSearch));
                const matchesPlan = !query.planCode || tenant.subscription?.plan?.code === query.planCode;
                const matchesStatus = !query.status || tenant.subscription?.status === query.status;

                return matchesSearch && matchesPlan && matchesStatus;
            })
            .map((tenant) => this.mapTenant(tenant));
    }

    async getTenant(tenantId: string) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            include: {
                owner: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
                stores: {
                    select: {
                        id: true,
                        name: true,
                        address: true,
                        created_at: true,
                    },
                    orderBy: { created_at: 'asc' },
                },
                users: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                            },
                        },
                    },
                },
                subscription: {
                    include: { plan: true },
                },
            },
        });

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        return this.mapTenant(tenant);
    }

    async updateSubscription(tenantId: string, dto: UpdateAdminTenantSubscriptionDto) {
        const existing = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            include: { plan: true },
        });

        if (!existing && !dto.planCode) {
            throw new NotFoundException('A plan code is required when creating a subscription.');
        }

        const result = await this.billingService.applySubscriptionChange({
            tenantId,
            planCode: dto.planCode ?? existing!.plan.code,
            billingCycle: dto.billingCycle,
            status: dto.status ?? existing?.status ?? 'ACTIVE',
            periodStart: existing?.current_period_start,
            periodEnd: existing?.current_period_end,
            cancelAtPeriodEnd: dto.cancelAtPeriodEnd ?? existing?.cancel_at_period_end ?? false,
            providerName: existing?.provider_name ?? 'manual',
            providerCustomerRef: existing?.provider_customer_ref ?? `tenant_${tenantId}`,
            providerSubscriptionRef: existing?.provider_subscription_ref ?? `admin_${tenantId}_${Date.now()}`,
        });

        return result;
    }

    async suspendTenant(tenantId: string, dto: SuspendTenantDto) {
        const existing = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
        });

        if (!existing) {
            throw new NotFoundException('Tenant or subscription not found');
        }

        await this.db.tenantSubscription.update({
            where: { tenant_id: tenantId },
            data: { status: 'CANCELLED' },
        });

        return { success: true, reason: dto.reason ?? null };
    }

    async impersonateTenant(tenantId: string, adminUserId: string) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            include: {
                owner: {
                    select: { id: true, email: true, token_version: true },
                },
            },
        });

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        const payload = {
            sub: tenant.owner.id,
            email: tenant.owner.email,
            tv: tenant.owner.token_version,
            impersonated_by: adminUserId,
            impersonated_tenant: tenantId,
        };

        const token = this.jwtService.sign(payload, { expiresIn: '1h' });

        return {
            access_token: token,
            expires_in: 3600,
            impersonated_user: { id: tenant.owner.id, email: tenant.owner.email },
            tenant: { id: tenant.id, name: tenant.name },
        };
    }

    async getMetrics() {
        const [totalTenants, totalUsers, subscriptionCounts, newTenantsThisMonth] =
            await Promise.all([
                this.db.tenant.count(),
                this.db.user.count(),
                this.db.tenantSubscription.groupBy({
                    by: ['status'],
                    _count: { status: true },
                }),
                this.db.tenant.count({
                    where: {
                        created_at: { gte: new Date(new Date().setDate(1)) },
                    },
                }),
            ]);

        const byStatus = Object.fromEntries(
            subscriptionCounts.map((row) => [row.status, row._count.status]),
        );

        return {
            total_tenants: totalTenants,
            total_users: totalUsers,
            new_tenants_this_month: newTenantsThisMonth,
            subscriptions: {
                active: byStatus['ACTIVE'] ?? 0,
                trialing: byStatus['TRIALING'] ?? 0,
                past_due: byStatus['PAST_DUE'] ?? 0,
                cancelled: byStatus['CANCELLED'] ?? 0,
            },
        };
    }

    async listUsers(query: ListAdminUsersQueryDto) {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, Math.max(1, query.limit ?? 20));
        const skip = (page - 1) * limit;

        const where = query.search
            ? {
                  OR: [
                      { email: { contains: query.search, mode: 'insensitive' as const } },
                      { name: { contains: query.search, mode: 'insensitive' as const } },
                  ],
              }
            : {};

        const [users, total] = await Promise.all([
            this.db.user.findMany({
                where,
                select: {
                    id: true,
                    email: true,
                    name: true,
                    is_platform_admin: true,
                    email_verified_at: true,
                    created_at: true,
                    _count: { select: { tenantMembers: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.user.count({ where }),
        ]);

        return {
            data: users.map((u) => ({
                id: u.id,
                email: u.email,
                name: u.name,
                is_platform_admin: (u as any).is_platform_admin,
                email_verified: !!u.email_verified_at,
                tenant_count: (u as any)._count.tenantMembers,
                created_at: u.created_at,
            })),
            total,
            page,
            limit,
        };
    }

    async promoteUser(userId: string) {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        await this.db.user.update({
            where: { id: userId },
            data: { is_platform_admin: true },
        });

        return { success: true, userId, is_platform_admin: true };
    }

    async demoteUser(userId: string) {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        await this.db.user.update({
            where: { id: userId },
            data: { is_platform_admin: false },
        });

        return { success: true, userId, is_platform_admin: false };
    }

    private mapTenant(tenant: any) {
        return {
            id: tenant.id,
            name: tenant.name,
            created_at: tenant.created_at,
            owner: tenant.owner
                ? {
                      id: tenant.owner.id,
                      email: tenant.owner.email,
                      name: tenant.owner.name,
                  }
                : null,
            stores: tenant.stores.map((store: any) => ({
                id: store.id,
                name: store.name,
                address: store.address ?? null,
                created_at: store.created_at,
            })),
            users: tenant.users.map((membership: any) => ({
                id: membership.user.id,
                email: membership.user.email,
                name: membership.user.name,
                role: membership.role,
                joined_at: membership.created_at,
            })),
            store_count: tenant.stores.length,
            user_count: tenant.users.length,
            subscription: tenant.subscription
                ? {
                      status: tenant.subscription.status,
                      current_period_start: tenant.subscription.current_period_start,
                      current_period_end: tenant.subscription.current_period_end,
                      cancel_at_period_end: tenant.subscription.cancel_at_period_end,
                      provider_name: tenant.subscription.provider_name,
                      plan: {
                          code: tenant.subscription.plan.code,
                          name: tenant.subscription.plan.name,
                          description: tenant.subscription.plan.description,
                          monthly_price: Number(tenant.subscription.plan.monthly_price),
                          yearly_price: tenant.subscription.plan.yearly_price === null
                              ? null
                              : Number(tenant.subscription.plan.yearly_price),
                      },
                  }
                : null,
        };
    }
}