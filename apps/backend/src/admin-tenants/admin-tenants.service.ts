import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BillingService } from '../billing/billing.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { bootstrapDefaultAccountingForTenant, seedBusinessTypeTemplate } from '@erp71/database';
import {
    DEFAULT_MOBILE_COUNTRY_CODE,
    ROLE_DEFAULT_PERMISSIONS,
    UserRole,
    normalizeMobileToE164,
} from '@erp71/shared-types';
import { PasswordResetService } from '../password-reset/password-reset.service';
import { getPlatformAdminEmails, isPlatformAdminEmail } from '../auth/platform-admin.util';
import { seedDefaultTenantRoles } from '@erp71/database';
import {
    ListAdminTenantsQueryDto,
    ListAdminUsersQueryDto,
    SuspendTenantDto,
    DeleteTenantDto,
    UpdateAdminTenantSubscriptionDto,
    UpdateAdminTenantLocalizationDto,
    CreateAdminTenantDto,
    RecordTenantPaymentDto,
    RecordTenantRefundDto,
    CreatePlatformAdminUserDto,
    UpdatePlatformAdminUserDto,
    AdminResetPlatformUserPasswordDto,
} from './admin-tenants.dto';

const ACTIVE_TENANT_FILTER = { deleted_at: null } as const;

@Injectable()
export class AdminTenantsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly billingService: BillingService,
        private readonly jwtService: JwtService,
        private readonly auditService: AuditService,
        private readonly emailService: EmailService,
        private readonly passwordResetService: PasswordResetService,
    ) {}

    private resolveMobileFields(
        mobile?: string,
        mobileCountryCode?: string,
        options?: { required?: boolean },
    ): { mobile: string | null; mobile_country_code: string } {
        const countryCode = mobileCountryCode?.trim() || DEFAULT_MOBILE_COUNTRY_CODE;
        if (!mobile?.trim()) {
            if (options?.required) {
                throw new BadRequestException('A valid mobile number is required.');
            }
            return { mobile: null, mobile_country_code: countryCode };
        }

        const normalized = normalizeMobileToE164(countryCode, mobile);
        if (!normalized) {
            throw new BadRequestException('Please enter a valid mobile number including country code.');
        }

        return { mobile: normalized, mobile_country_code: countryCode };
    }

    /** DB flag or PLATFORM_ADMIN_EMAILS whitelist (bootstrap / legacy admins). */
    private isEffectivePlatformAdmin(user: { is_platform_admin?: boolean | null; email?: string | null }) {
        return user.is_platform_admin === true || isPlatformAdminEmail(user.email);
    }

    private buildPlatformAdminWhere() {
        const whitelistEmails = getPlatformAdminEmails();
        return {
            OR: [
                { is_platform_admin: true },
                ...whitelistEmails.map((email) => ({
                    email: { equals: email, mode: 'insensitive' as const },
                })),
            ],
        };
    }

    async listTenants(query: ListAdminTenantsQueryDto) {
        const tenants = await this.db.tenant.findMany({
            where: ACTIVE_TENANT_FILTER,
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
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
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
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
            select: { id: true },
        });
        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

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

    async updateLocalization(
        tenantId: string,
        dto: UpdateAdminTenantLocalizationDto,
        adminUserId: string,
    ) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
        });
        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        const nextEnabled = dto.localization_enabled ?? tenant.localization_enabled;
        const nextSecondary = dto.secondary_locale !== undefined
            ? dto.secondary_locale
            : tenant.secondary_locale;

        if (nextEnabled && !nextSecondary) {
            throw new BadRequestException('A secondary language is required when localization is enabled.');
        }

        const updated = await this.db.tenant.update({
            where: { id: tenantId },
            data: {
                localization_enabled: nextEnabled,
                secondary_locale: nextEnabled ? nextSecondary : null,
                ...(nextEnabled ? {} : { default_locale: 'en' }),
            },
            select: {
                id: true,
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
            },
        });

        await this.auditService.log(
            'tenant.localization.update',
            'Tenant',
            { userId: adminUserId },
            tenantId,
            {
                localization_enabled: updated.localization_enabled,
                secondary_locale: updated.secondary_locale,
            },
        );

        return updated;
    }

    async suspendTenant(tenantId: string, dto: SuspendTenantDto, adminUserId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
            select: { id: true },
        });
        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

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

        await this.auditService.log('tenant.suspend', 'Tenant', { userId: adminUserId }, tenantId, {
            reason: dto.reason ?? null,
        });

        return { success: true, reason: dto.reason ?? null };
    }

    async impersonateTenant(tenantId: string, adminUserId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
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

        await this.auditService.log('tenant.impersonate', 'Tenant', { userId: adminUserId }, tenantId, {
            impersonated_user_id: tenant.owner.id,
            impersonated_user_email: tenant.owner.email,
        });

        return {
            access_token: token,
            expires_in: 3600,
            impersonated_user: { id: tenant.owner.id, email: tenant.owner.email },
            tenant: { id: tenant.id, name: tenant.name },
        };
    }

    async deleteTenant(tenantId: string, dto: DeleteTenantDto, adminUserId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
            select: { id: true, name: true, storefront_slug: true },
        });

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        const deletedAt = new Date();

        await this.db.$transaction(async (tx: any) => {
            await tx.tenant.update({
                where: { id: tenantId },
                data: {
                    deleted_at: deletedAt,
                    storefront_slug: null,
                    storefront_enabled: false,
                },
            });

            const subscription = await tx.tenantSubscription.findUnique({
                where: { tenant_id: tenantId },
            });

            if (subscription && subscription.status !== 'CANCELLED') {
                await tx.tenantSubscription.update({
                    where: { tenant_id: tenantId },
                    data: { status: 'CANCELLED' },
                });
            }
        });

        await this.auditService.log('tenant.delete', 'Tenant', { userId: adminUserId }, tenantId, {
            reason: dto.reason ?? null,
            tenant_name: tenant.name,
            previous_storefront_slug: tenant.storefront_slug,
        });

        return { success: true, deleted_at: deletedAt };
    }

    async lookupUserByEmail(email: string) {
        const user = await this.db.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true },
        });
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async createTenant(dto: CreateAdminTenantDto, adminUserId: string) {
        let ownerId: string;
        let ownerEmail: string;
        let ownerName: string | null;
        let sendPasswordResetAfterTx: (() => void) | null = null;

        if (dto.ownerMode === 'new') {
            // Check uniqueness before the transaction (read-only, no rollback needed)
            const existing = await this.db.user.findUnique({ where: { email: dto.ownerEmail! } });
            if (existing) throw new ConflictException('Email is already registered');

            ownerEmail = dto.ownerEmail!;
            ownerName = dto.ownerName ?? null;
        } else {
            const user = await this.db.user.findUnique({ where: { id: dto.ownerUserId! } });
            if (!user) throw new NotFoundException('User not found');
            ownerId = user.id;
            ownerEmail = user.email;
            ownerName = (user as any).name ?? null;
        }

        const plan = await this.db.subscriptionPlan.findUnique({ where: { code: dto.planCode } });
        if (!plan?.is_active) throw new BadRequestException('Selected subscription plan is not available.');

        const { tenant } = await this.db.$transaction(async (tx: any) => {
            if (dto.ownerMode === 'new') {
                // Create the user inside the transaction so it rolls back on any failure.
                // passwordHash is non-nullable, so store a hash of a random throwaway
                // value — the owner sets their real password via the reset email below.
                const throwawayPasswordHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
                const newUser = await tx.user.create({
                    data: { email: ownerEmail, name: ownerName ?? null, passwordHash: throwawayPasswordHash },
                });
                ownerId = newUser.id;

                // Create a password-reset token so the user can set their own password
                const rawToken = crypto.randomBytes(32).toString('hex');
                const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
                const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
                await tx.passwordResetToken.create({
                    data: { user_id: ownerId, token_hash: tokenHash, expires_at: expiresAt },
                });

                // Capture the email send for after the transaction commits
                sendPasswordResetAfterTx = () => {
                    this.emailService.sendPasswordReset(ownerEmail, rawToken).catch((err: any) => {
                        console.warn(`[AdminTenantsService] Password reset email failed for ${ownerEmail}:`, err?.message);
                    });
                };
            }

            const tenant = await tx.tenant.create({
                data: {
                    name: dto.tenantName,
                    owner_id: ownerId,
                    ...(dto.businessType ? { business_type: dto.businessType } : {}),
                },
            });

            await seedDefaultTenantRoles(tx, tenant.id);

            await tx.tenantUser.create({
                data: { tenant_id: tenant.id, user_id: ownerId, role: 'OWNER' },
            });

            const store = await tx.store.create({
                data: { tenant_id: tenant.id, name: dto.storeName, address: dto.address ?? null },
            });

            await tx.tenantSubscription.create({
                data: {
                    tenant_id: tenant.id,
                    plan_id: plan.id,
                    status: 'PAST_DUE',
                    current_period_start: new Date(),
                    current_period_end: new Date(),
                    provider_name: 'manual',
                },
            });

            await tx.userStoreAccess.create({
                data: {
                    user_id: ownerId,
                    store_id: store.id,
                    tenant_id: tenant.id,
                    access_level: 'MULTI_STORE_CAPABLE',
                },
            });

            const ownerPermissions = ROLE_DEFAULT_PERMISSIONS[UserRole.OWNER];
            await tx.userStorePermission.createMany({
                data: ownerPermissions.map((permission: string) => ({
                    user_id: ownerId,
                    store_id: store.id,
                    tenant_id: tenant.id,
                    permission,
                    granted_by: ownerId,
                })),
                skipDuplicates: true,
            });

            await bootstrapDefaultAccountingForTenant(tx, tenant.id);

            return { tenant, store };
        });

        // Fire-and-forget: send password-set email to newly created owner
        sendPasswordResetAfterTx?.();

        if (dto.businessType) {
            seedBusinessTypeTemplate(this.db, tenant.id, dto.businessType).catch((err: any) =>
                console.error(`[AdminTenantsService] Failed to seed business type template:`, err),
            );
        }

        await this.auditService.log('tenant.admin_create', 'Tenant', { userId: adminUserId }, tenant.id, {
            owner_email: ownerEmail,
            owner_mode: dto.ownerMode,
        });

        return this.getTenant(tenant.id);
    }

    async getMetrics() {
        const monthStart = (() => {
            const d = new Date();
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
            return d;
        })();

        const [totalTenants, totalUsers, subscriptionCounts, newTenantsThisMonth] =
            await Promise.all([
                this.db.tenant.count({ where: ACTIVE_TENANT_FILTER }),
                this.db.user.count(),
                this.db.tenantSubscription.groupBy({
                    by: ['status'],
                    where: { tenant: ACTIVE_TENANT_FILTER },
                    _count: { status: true },
                }),
                this.db.tenant.count({
                    where: {
                        ...ACTIVE_TENANT_FILTER,
                        created_at: { gte: monthStart },
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

        const adminFilter = this.buildPlatformAdminWhere();
        const where: any = query.search
            ? {
                AND: [
                    adminFilter,
                    {
                        OR: [
                            { email: { contains: query.search, mode: 'insensitive' as const } },
                            { name: { contains: query.search, mode: 'insensitive' as const } },
                            { mobile: { contains: query.search, mode: 'insensitive' as const } },
                        ],
                    },
                ],
            }
            : adminFilter;

        const [users, total] = await Promise.all([
            this.db.user.findMany({
                where,
                select: {
                    id: true,
                    email: true,
                    name: true,
                    mobile: true,
                    mobile_country_code: true,
                    is_platform_admin: true,
                    email_verified_at: true,
                    created_at: true,
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
                mobile: u.mobile,
                mobile_country_code: u.mobile_country_code,
                is_platform_admin: this.isEffectivePlatformAdmin(u),
                email_verified: !!u.email_verified_at,
                created_at: u.created_at,
            })),
            total,
            page,
            limit,
        };
    }

    async promoteUser(userId: string, adminUserId: string) {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        await this.db.user.update({
            where: { id: userId },
            data: { is_platform_admin: true },
        });

        await this.auditService.log('user.promote', 'User', { userId: adminUserId }, userId, {
            target_email: user.email,
        });

        return { success: true, userId, is_platform_admin: true };
    }

    async demoteUser(userId: string, adminUserId: string) {
        if (userId === adminUserId) {
            throw new BadRequestException('You cannot revoke your own platform admin access');
        }

        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        if (!(user as any).is_platform_admin) {
            return { success: true, userId, is_platform_admin: false };
        }

        const remainingAdmins = await this.db.user.count({
            where: { is_platform_admin: true, id: { not: userId } },
        });
        if (remainingAdmins === 0) {
            throw new BadRequestException(
                'Cannot revoke the last platform admin — promote another user first',
            );
        }

        await this.db.user.update({
            where: { id: userId },
            data: { is_platform_admin: false },
        });

        await this.auditService.log('user.demote', 'User', { userId: adminUserId }, userId, {
            target_email: user.email,
        });

        return { success: true, userId, is_platform_admin: false };
    }

    async createPlatformAdminUser(dto: CreatePlatformAdminUserDto, adminUserId: string) {
        const existing = await this.db.user.findUnique({ where: { email: dto.email } });
        if (existing) {
            throw new ConflictException('Email already exists');
        }

        const mobileFields = this.resolveMobileFields(dto.mobile, dto.mobile_country_code);
        if (mobileFields.mobile) {
            const mobileTaken = await this.db.user.findFirst({ where: { mobile: mobileFields.mobile } });
            if (mobileTaken) throw new ConflictException('Mobile number already in use');
        }

        const passwordHash = await bcrypt.hash(dto.password, 10);
        const user = await this.db.user.create({
            data: {
                email: dto.email,
                passwordHash,
                name: dto.name?.trim() || null,
                is_platform_admin: true,
                mobile: mobileFields.mobile,
                mobile_country_code: mobileFields.mobile_country_code,
            },
            select: {
                id: true,
                email: true,
                name: true,
                mobile: true,
                mobile_country_code: true,
                is_platform_admin: true,
                email_verified_at: true,
                created_at: true,
            },
        });

        await this.auditService.log('user.platform.create', 'User', { userId: adminUserId }, user.id, {
            email: user.email,
        });

        return {
            ...user,
            email_verified: !!user.email_verified_at,
        };
    }

    async updatePlatformAdminUser(userId: string, dto: UpdatePlatformAdminUserDto, adminUserId: string) {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user || !this.isEffectivePlatformAdmin(user)) {
            throw new NotFoundException('Platform admin user not found');
        }

        const data: Record<string, unknown> = {};
        if (dto.name !== undefined) data.name = dto.name?.trim() || null;
        if (dto.email !== undefined && dto.email !== user.email) {
            const taken = await this.db.user.findUnique({ where: { email: dto.email } });
            if (taken) throw new ConflictException('Email already exists');
            data.email = dto.email;
        }
        if (dto.mobile !== undefined || dto.mobile_country_code !== undefined) {
            if (!dto.mobile?.trim()) {
                data.mobile = null;
                if (dto.mobile_country_code !== undefined) {
                    data.mobile_country_code = dto.mobile_country_code || DEFAULT_MOBILE_COUNTRY_CODE;
                }
            } else {
                const mobileFields = this.resolveMobileFields(
                    dto.mobile,
                    dto.mobile_country_code ?? user.mobile_country_code,
                );
                const mobileTaken = await this.db.user.findFirst({
                    where: { mobile: mobileFields.mobile, id: { not: userId } },
                });
                if (mobileTaken) throw new ConflictException('Mobile number already in use');
                data.mobile = mobileFields.mobile;
                data.mobile_country_code = mobileFields.mobile_country_code;
            }
        }

        const updated = await this.db.user.update({
            where: { id: userId },
            data,
            select: {
                id: true,
                email: true,
                name: true,
                mobile: true,
                mobile_country_code: true,
                is_platform_admin: true,
                email_verified_at: true,
                created_at: true,
            },
        });

        await this.auditService.log('user.platform.update', 'User', { userId: adminUserId }, userId, {
            email: updated.email,
        });

        return {
            ...updated,
            email_verified: !!updated.email_verified_at,
        };
    }

    async deletePlatformAdminUser(userId: string, adminUserId: string) {
        if (userId === adminUserId) {
            throw new BadRequestException('You cannot delete your own account');
        }

        const user = await this.db.user.findUnique({
            where: { id: userId },
            include: {
                _count: {
                    select: {
                        tenantsOwned: { where: ACTIVE_TENANT_FILTER },
                        tenantMembers: { where: { tenant: ACTIVE_TENANT_FILTER } },
                    },
                },
            },
        });
        if (!user || !this.isEffectivePlatformAdmin(user)) {
            throw new NotFoundException('Platform admin user not found');
        }

        const remainingAdmins = await this.db.user.count({
            where: { AND: [this.buildPlatformAdminWhere(), { id: { not: userId } }] },
        });
        if (remainingAdmins === 0) {
            throw new BadRequestException('Cannot delete the last platform admin');
        }

        if (user._count.tenantsOwned > 0 || user._count.tenantMembers > 0) {
            throw new BadRequestException(
                'Cannot delete a user who belongs to tenant workspaces. Remove tenant access first.',
            );
        }

        await this.db.user.delete({ where: { id: userId } });
        await this.auditService.log('user.platform.delete', 'User', { userId: adminUserId }, userId, {
            email: user.email,
        });

        return { success: true, userId };
    }

    async resetPlatformAdminUserPassword(
        userId: string,
        dto: AdminResetPlatformUserPasswordDto,
        adminUserId: string,
    ) {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user || !this.isEffectivePlatformAdmin(user)) {
            throw new NotFoundException('Platform admin user not found');
        }

        const passwordHash = await bcrypt.hash(dto.newPassword, 10);
        await this.db.user.update({
            where: { id: userId },
            data: { passwordHash, token_version: { increment: 1 } },
        });

        await this.auditService.log('user.platform.reset_password', 'User', { userId: adminUserId }, userId, {
            email: user.email,
        });

        return { success: true };
    }

    async sendPlatformAdminUserResetEmail(userId: string, adminUserId: string) {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user || !this.isEffectivePlatformAdmin(user)) {
            throw new NotFoundException('Platform admin user not found');
        }

        await this.passwordResetService.requestReset(user.email);
        await this.auditService.log('user.platform.reset_email', 'User', { userId: adminUserId }, userId, {
            email: user.email,
        });

        return { success: true };
    }

    async listTenantLedger(query: { tenantId?: string }) {
        const events = await this.db.billingEvent.findMany({
            where: {
                ...(query.tenantId ? { tenant_id: query.tenantId } : {}),
                tenant: ACTIVE_TENANT_FILTER,
            },
            orderBy: { created_at: 'desc' },
            include: {
                tenant: { select: { id: true, name: true } },
            },
        });

        return events.map((e) => ({
            id: e.id,
            tenant_id: e.tenant_id,
            tenant_name: e.tenant.name,
            event_type: e.event_type,
            status: e.status,
            provider_name: e.provider_name,
            amount: e.amount !== null ? Number(e.amount) : null,
            currency: e.currency,
            reference_id: e.reference_id,
            payload: e.payload,
            created_at: e.created_at,
        }));
    }

    async getTenantLedger(tenantId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
            select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        return this.listTenantLedger({ tenantId });
    }

    async recordPayment(tenantId: string, dto: RecordTenantPaymentDto, adminUserId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
            select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const externalEventId = `manual_payment_${crypto.randomBytes(16).toString('hex')}`;

        const event = await this.db.billingEvent.create({
            data: {
                tenant_id: tenantId,
                provider_name: 'manual',
                external_event_id: externalEventId,
                event_type: 'manual_payment',
                status: 'succeeded',
                amount: dto.amount,
                currency: 'BDT',
                payload: {
                    recorded_by: adminUserId,
                    notes: dto.notes ?? null,
                    method: dto.method ?? null,
                },
            },
        });

        // Activate a PAST_DUE subscription upon payment
        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
        });
        if (subscription?.status === 'PAST_DUE') {
            await this.db.tenantSubscription.update({
                where: { tenant_id: tenantId },
                data: { status: 'ACTIVE' },
            });
        }

        await this.auditService.log('tenant.payment.record', 'Tenant', { userId: adminUserId }, tenantId, {
            amount: dto.amount,
            method: dto.method ?? null,
            event_id: event.id,
        });

        return {
            id: event.id,
            event_type: event.event_type,
            status: event.status,
            amount: Number(event.amount),
            currency: event.currency,
            created_at: event.created_at,
        };
    }

    async recordRefund(tenantId: string, dto: RecordTenantRefundDto, adminUserId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, ...ACTIVE_TENANT_FILTER },
            select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const externalEventId = `manual_refund_${crypto.randomBytes(16).toString('hex')}`;

        const event = await this.db.billingEvent.create({
            data: {
                tenant_id: tenantId,
                provider_name: 'manual',
                external_event_id: externalEventId,
                event_type: 'manual_refund',
                status: 'succeeded',
                amount: dto.amount,
                currency: 'BDT',
                payload: {
                    recorded_by: adminUserId,
                    notes: dto.notes ?? null,
                },
            },
        });

        await this.auditService.log('tenant.refund.record', 'Tenant', { userId: adminUserId }, tenantId, {
            amount: dto.amount,
            event_id: event.id,
        });

        return {
            id: event.id,
            event_type: event.event_type,
            status: event.status,
            amount: Number(event.amount),
            currency: event.currency,
            created_at: event.created_at,
        };
    }

    private mapTenant(tenant: any) {
        return {
            id: tenant.id,
            name: tenant.name,
            created_at: tenant.created_at,
            default_locale: tenant.default_locale,
            localization_enabled: tenant.localization_enabled,
            secondary_locale: tenant.secondary_locale,
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
