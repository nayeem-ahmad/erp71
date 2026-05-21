import { BadRequestException, Injectable, UnauthorizedException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { bootstrapDefaultAccountingForTenant } from '@retail-saas/database';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { SignupDto, LoginDto } from './auth.dto';
import { isPlatformAdminEmail } from './platform-admin.util';
import { ROLE_DEFAULT_PERMISSIONS, UserRole } from '@retail-saas/shared-types';

@Injectable()
export class AuthService {
    constructor(
        private db: DatabaseService,
        private jwtService: JwtService,
        private email: EmailService,
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
        return this.generateAuthResponse(user.id);
    }

    async login(dto: LoginDto) {
        const user = await this.db.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        return this.generateAuthResponse(user.id);
    }

    async logout(userId: string): Promise<void> {
        // Increment token_version to invalidate all existing JWTs for this user
        await this.db.user.update({
            where: { id: userId },
            data: { token_version: { increment: 1 } },
        });
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
            where: { email: 'demo@retailsaas.app' },
        });

        if (!user) {
            throw new ServiceUnavailableException('Demo account not available');
        }

        return this.generateAuthResponse(user.id);
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

        const payload = { sub: user.id, email: user.email, tv: user.token_version };
        const isPlatformAdmin = isPlatformAdminEmail(user.email);
        return {
            access_token: this.jwtService.sign(payload),
            is_platform_admin: isPlatformAdmin,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                is_platform_admin: isPlatformAdmin,
                email_verified: !!user.email_verified_at,
            },
            tenants: user.tenantMembers.map((membership) =>
                this.mapTenantMembership(membership, user.storeAccess),
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

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            is_platform_admin: isPlatformAdminEmail(user.email),
            email_verified: !!user.email_verified_at,
            tenants: user.tenantMembers.map((membership) =>
                this.mapTenantMembership(membership, user.storeAccess),
            ),
        };
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

    async setupTenant(userId: string, dto: { tenantName: string; storeName: string; address?: string; planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM' }) {
        return this.db.$transaction(async (tx) =>
            this.provisionTenant(tx, userId, {
                tenantName: dto.tenantName,
                storeName: dto.storeName,
                address: dto.address,
                planCode: dto.planCode,
            }),
        );
    }

    private async provisionTenant(
        tx: any,
        userId: string,
        dto: { tenantName: string; storeName: string; address?: string; planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM' },
    ) {
        const planCode = dto.planCode ?? 'FREE';
        const plan = await tx.subscriptionPlan.findUnique({
            where: { code: planCode },
        });

        if (!plan || !plan.is_active) {
            throw new BadRequestException('Selected subscription plan is not available.');
        }

        const tenant = await tx.tenant.create({
            data: {
                name: dto.tenantName,
                owner_id: userId,
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
