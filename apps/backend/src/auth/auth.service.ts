import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { TotpService } from './totp.service';
import { DatabaseService } from '../database/database.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { bootstrapDefaultAccountingForTenant, seedBusinessTypeTemplate } from '@retail-saas/database';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { SignupDto, LoginDto, UpdateProfileDto, ChangePasswordDto } from './auth.dto';
import { isPlatformAdminEmail } from './platform-admin.util';
import { DEMO_ACCOUNT_EMAIL } from '@retail-saas/database';
import { ROLE_DEFAULT_PERMISSIONS, UserRole } from '@retail-saas/shared-types';

type TenantProvisionDto = {
    tenantName: string;
    storeName: string;
    address?: string;
    planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
    businessType?: string;
};

@Injectable()
export class AuthService {
    constructor(
        private readonly db: DatabaseService,
        private readonly jwtService: JwtService,
        private readonly email: EmailService,
        private readonly audit: AuditService,
        private readonly totp: TotpService,
    ) { }

    async signup(dto: SignupDto) {
        const existingUser = await this.db.user.findUnique({
            where: { email: dto.email },
        });

        if (existingUser) {
            throw new ConflictException('Email already exists');
        }

        const passwordHash = await bcrypt.hash(dto.password, 10);

        const user = await this.db.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: {
                    email: dto.email,
                    passwordHash,
                    name: dto.name,
                },
            });

            if (dto.tenantName?.trim() && dto.storeName?.trim()) {
                await this.provisionTenant(tx, createdUser.id, {
                    tenantName: dto.tenantName,
                    storeName: dto.storeName,
                    address: dto.address,
                    planCode: dto.planCode,
                });
            }

            return createdUser;
        });

        this.email.sendWelcome(user.email, user.name ?? user.email).catch((err) => {
            console.warn(`[AuthService] Welcome email failed for ${user.email}:`, err?.message);
        });
        // Fire-and-forget: send email verification
        this.sendVerificationEmail(user.id).catch((err) => {
            console.warn(`[AuthService] Verification email failed for ${user.email}:`, err?.message);
        });
        this.audit.log('USER_SIGNUP', 'User', { userId: user.id }, user.id, { email: user.email }).catch(() => {});
        const auth = await this.generateAuthResponse(user.id);
        return {
            ...auth,
            requires_email_verification: !user.email_verified_at,
        };
    }

    async completeTwoFactorLogin(userId: string) {
        return this.generateAuthResponse(userId);
    }

    async login(dto: LoginDto) {
        const user = await this.db.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (!user.passwordHash) {
            throw new UnauthorizedException('Invalid credentials');
        }

        let isPasswordValid = false;
        try {
            isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
        } catch (error: any) {
            console.warn(`[AuthService] Password verification failed for ${dto.email}:`, error?.message);
            throw new UnauthorizedException('Invalid credentials');
        }

        if (!isPasswordValid) {
            this.audit.log('LOGIN_FAILED', 'User', { userId: user.id }, user.id, { email: dto.email }).catch(() => {});
            throw new UnauthorizedException('Invalid credentials');
        }

        const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
        const isExempt = isPlatformAdminEmail(user.email);
        if (requireEmailVerification && !user.email_verified_at && !isExempt) {
            throw new ForbiddenException({
                code: 'EMAIL_NOT_VERIFIED',
                message: 'Please verify your email before signing in.',
            });
        }

        if (this.totp.isEnabled((user as any).totp_secret)) {
            return {
                requires_2fa: true,
                user_id: user.id,
            };
        }

        this.audit.log('USER_LOGIN', 'User', { userId: user.id }, user.id).catch(() => {});
        return this.generateAuthResponse(user.id);
    }

    async logout(userId: string): Promise<void> {
        // Increment token_version to invalidate all existing JWTs for this user
        await this.db.user.update({
            where: { id: userId },
            data: { token_version: { increment: 1 } },
        });
        this.audit.log('USER_LOGOUT', 'User', { userId }, userId).catch(() => {});
    }

    async sendVerificationEmail(userId: string): Promise<void> {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user) throw new UnauthorizedException('User not found');
        if (user.email_verified_at) throw new BadRequestException('Email already verified');

        await this.db.emailVerificationToken.deleteMany({ where: { user_id: userId } });

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await this.db.emailVerificationToken.create({
            data: { user_id: userId, token_hash: tokenHash, expires_at: expiresAt },
        });

        this.email.sendEmailVerification(user.email, rawToken).catch((err) => {
            console.warn(`[AuthService] Verification email failed for ${user.email}:`, err?.message);
        });
    }

    async verifyEmail(rawToken: string): Promise<void> {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const record = await this.db.emailVerificationToken.findUnique({ where: { token_hash: tokenHash } });

        if (!record || record.expires_at < new Date()) {
            throw new BadRequestException('Invalid or expired verification token');
        }

        await this.db.$transaction([
            this.db.user.update({
                where: { id: record.user_id },
                data: { email_verified_at: new Date() },
            }),
            this.db.emailVerificationToken.deleteMany({ where: { user_id: record.user_id } }),
        ]);
    }

    async demoLogin() {
        const user = await this.db.user.findUnique({
            where: { email: DEMO_ACCOUNT_EMAIL },
        });

        if (!user) {
            throw new ServiceUnavailableException('Demo account not available. Run npm run seed:demo on the backend.');
        }

        const auth = await this.generateAuthResponse(user.id);
        return { ...auth, is_demo: true };
    }

    private isDemoAccount(email: string) {
        return email === DEMO_ACCOUNT_EMAIL;
    }

    async getPlans() {
        const plans = await this.db.subscriptionPlan.findMany({
            where: { is_active: true },
            orderBy: { monthly_price: 'asc' },
        });

        return plans.map((plan) => ({
            code: plan.code,
            name: plan.name,
            description: plan.description,
            monthly_price: Number(plan.monthly_price),
            yearly_price: plan.yearly_price === null ? null : Number(plan.yearly_price),
            features_json: plan.features_json,
        }));
    }

    private async generateAuthResponse(userId: string) {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            include: {
                tenantMembers: {
                    include: {
                        tenant: {
                            include: {
                                subscription: {
                                    include: { plan: true },
                                },
                            },
                        },
                    },
                },
                storeAccess: {
                    include: { store: true },
                },
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const tenantMembers = (user.tenantMembers ?? []).filter((membership) => membership?.tenant);
        const storeAccess = user.storeAccess ?? [];

        const isPlatformAdmin = (user as any).is_platform_admin === true || isPlatformAdminEmail(user.email);
        const payload = { sub: user.id, email: user.email, tv: user.token_version };
        return {
            access_token: this.jwtService.sign(payload),
            is_platform_admin: isPlatformAdmin,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                preferred_locale: user.preferred_locale,
                is_platform_admin: isPlatformAdmin,
                email_verified: !!user.email_verified_at,
            },
            tenants: tenantMembers.map((membership) =>
                this.mapTenantMembership(membership, storeAccess),
            ),
        };
    }

    async getMe(userId: string) {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            include: {
                tenantMembers: {
                    include: {
                        tenant: {
                            include: {
                                subscription: {
                                    include: { plan: true },
                                },
                            },
                        },
                    },
                },
                storeAccess: {
                    include: { store: true },
                },
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const tenantMembers = (user.tenantMembers ?? []).filter((membership) => membership?.tenant);
        const storeAccess = user.storeAccess ?? [];

        const totpSecret = (user as any).totp_secret as string | null | undefined;
        const twoFactorEnabled = !!totpSecret && !totpSecret.startsWith('pending:');

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            preferred_locale: user.preferred_locale,
            is_platform_admin: (user as any).is_platform_admin === true || isPlatformAdminEmail(user.email),
            is_demo: this.isDemoAccount(user.email),
            email_verified: !!user.email_verified_at,
            two_factor_enabled: twoFactorEnabled,
            tenants: tenantMembers.map((membership) =>
                this.mapTenantMembership(membership, storeAccess),
            ),
        };
    }

    async updateProfile(userId: string, dto: UpdateProfileDto) {
        const data: { name?: string; preferred_locale?: string } = {};
        if (dto.name !== undefined) data.name = dto.name.trim();
        if (dto.preferred_locale !== undefined) data.preferred_locale = dto.preferred_locale;

        const user = await this.db.user.update({
            where: { id: userId },
            data,
            select: { id: true, email: true, name: true, preferred_locale: true },
        });

        return { id: user.id, email: user.email, name: user.name, preferred_locale: user.preferred_locale };
    }

    async changePassword(userId: string, dto: ChangePasswordDto) {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            select: { passwordHash: true },
        });

        if (!user) throw new UnauthorizedException('User not found');

        const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
        if (!valid) throw new BadRequestException('Current password is incorrect');

        if (dto.currentPassword === dto.newPassword) {
            throw new BadRequestException('New password must differ from your current password');
        }

        if (dto.newPassword.length < 8) {
            throw new BadRequestException('New password must be at least 8 characters');
        }

        const newHash = await bcrypt.hash(dto.newPassword, 10);
        await this.db.user.update({
            where: { id: userId },
            data: { passwordHash: newHash, token_version: { increment: 1 } },
        });
        this.audit.log('PASSWORD_CHANGED', 'User', { userId }, userId).catch(() => {});
    }

    async setupStore(userId: string, dto: { name: string; address?: string; planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM' }) {
        return this.db.$transaction(async (tx) =>
            this.provisionTenant(tx, userId, {
                tenantName: dto.name,
                storeName: dto.name,
                address: dto.address,
                planCode: dto.planCode ?? 'FREE',
            }),
        );
    }

    async setupTenant(userId: string, dto: { tenantName: string; storeName: string; address?: string; planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM'; businessType?: string }) {
        const result = await this.db.$transaction(async (tx) =>
            this.provisionTenant(tx, userId, {
                tenantName: dto.tenantName,
                storeName: dto.storeName,
                address: dto.address,
                planCode: dto.planCode,
                businessType: dto.businessType,
            }),
        );

        if (dto.businessType) {
            seedBusinessTypeTemplate(this.db, result.tenant.id, dto.businessType).catch((err) =>
                console.error(`Failed to seed product template for ${dto.businessType}:`, err),
            );
        }

        return result;
    }

    private async provisionTenant(
        tx: any,
        userId: string,
        dto: TenantProvisionDto,
    ) {
        const planCode = dto.planCode ?? 'FREE';
        const plan = await tx.subscriptionPlan.findUnique({
            where: { code: planCode },
        });

        if (!plan?.is_active) {
            throw new BadRequestException('Selected subscription plan is not available.');
        }

        const tenant = await tx.tenant.create({
            data: {
                name: dto.tenantName,
                owner_id: userId,
                ...(dto.businessType ? { business_type: dto.businessType } : {}),
            },
        });

        await tx.tenantUser.create({
            data: {
                tenant_id: tenant.id,
                user_id: userId,
                role: 'OWNER',
            },
        });

        const store = await tx.store.create({
            data: {
                tenant_id: tenant.id,
                name: dto.storeName,
                address: dto.address,
            },
        });

        await tx.tenantSubscription.create({
            data: {
                tenant_id: tenant.id,
                plan_id: plan.id,
                status: 'TRIALING',
                current_period_start: new Date(),
                current_period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                provider_name: 'manual',
            },
        });

        // Seed UserStoreAccess: OWNER can access all stores (MULTI_STORE_CAPABLE)
        await tx.userStoreAccess.create({
            data: {
                user_id: userId,
                store_id: store.id,
                tenant_id: tenant.id,
                access_level: 'MULTI_STORE_CAPABLE',
            },
        });

        // Seed all StorePermissions for OWNER
        const ownerPermissions = ROLE_DEFAULT_PERMISSIONS[UserRole.OWNER];
        await tx.userStorePermission.createMany({
            data: ownerPermissions.map((permission) => ({
                user_id: userId,
                store_id: store.id,
                tenant_id: tenant.id,
                permission,
                granted_by: userId,
            })),
            skipDuplicates: true,
        });

        await bootstrapDefaultAccountingForTenant(tx, tenant.id);

        return { tenant, store };
    }

    private mapTenantMembership(membership: any, allStoreAccess: any[] = []) {
        const subscription = membership.tenant.subscription;
        const plan = subscription?.plan;
        // Only return stores the user has explicit UserStoreAccess for in this tenant
        const accessibleStores = allStoreAccess
            .filter((a) => a.tenant_id === membership.tenant_id)
            .map((a) => a.store);

        return {
            id: membership.tenant.id,
            name: membership.tenant.name,
            default_locale: membership.tenant.default_locale,
            role: membership.role,
            stores: accessibleStores,
            subscription: subscription
                ? {
                      status: subscription.status,
                      current_period_start: subscription.current_period_start,
                      current_period_end: subscription.current_period_end,
                      cancel_at_period_end: subscription.cancel_at_period_end,
                      is_premium: plan?.code === 'PREMIUM',
                      is_paid_plan: plan?.code !== 'FREE',
                      plan: plan
                          ? {
                                code: plan.code,
                                name: plan.name,
                                description: plan.description,
                                monthly_price: Number(plan.monthly_price),
                                yearly_price: plan.yearly_price === null ? null : Number(plan.yearly_price),
                                features_json: plan.features_json,
                            }
                          : null,
                  }
                : null,
        };
    }
}
