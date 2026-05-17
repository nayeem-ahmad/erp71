import { BadRequestException, Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
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
    private static readonly MAX_FAILED_ATTEMPTS = 5;
    private static readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

    private static readonly RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

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

        // Fire-and-forget — don't block signup on email delivery
        this.email.sendWelcome(user.email, user.name ?? user.email).catch(() => null);

        return this.generateAuthResponse(user.id);
    }

    async login(dto: LoginDto) {
        const user = await this.db.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (user.locked_until && user.locked_until > new Date()) {
            const retryAfterSec = Math.ceil((user.locked_until.getTime() - Date.now()) / 1000);
            throw new UnauthorizedException(
                `Account locked due to too many failed attempts. Try again in ${retryAfterSec} seconds.`,
            );
        }

        const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

        if (!isPasswordValid) {
            const attempts = user.failed_login_attempts + 1;
            const locked = attempts >= AuthService.MAX_FAILED_ATTEMPTS;
            await this.db.user.update({
                where: { id: user.id },
                data: {
                    failed_login_attempts: attempts,
                    locked_until: locked
                        ? new Date(Date.now() + AuthService.LOCKOUT_DURATION_MS)
                        : undefined,
                },
            });
            throw new UnauthorizedException('Invalid credentials');
        }

        return this.generateAuthResponse(user.id, true);
    }

    async logout(rawToken: string) {
        if (!rawToken) return { success: true };
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        await this.db.refreshToken.deleteMany({ where: { token_hash: tokenHash } });
        return { success: true };
    }

    async forgotPassword(email: string) {
        const user = await this.db.user.findUnique({ where: { email } });
        // Always return success to avoid email enumeration
        if (!user) return { success: true };

        // Invalidate any previous reset tokens for this user
        await this.db.passwordResetToken.deleteMany({ where: { user_id: user.id } });

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        await this.db.passwordResetToken.create({
            data: {
                user_id: user.id,
                token_hash: tokenHash,
                expires_at: new Date(Date.now() + AuthService.RESET_TOKEN_TTL_MS),
            },
        });

        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
        const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
        await this.email.sendPasswordReset(user.email, resetUrl);

        return { success: true };
    }

    async resetPassword(rawToken: string, newPassword: string) {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const stored = await this.db.passwordResetToken.findUnique({ where: { token_hash: tokenHash } });

        if (!stored || stored.expires_at < new Date()) {
            if (stored) await this.db.passwordResetToken.delete({ where: { id: stored.id } });
            throw new BadRequestException('Invalid or expired reset token');
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        await this.db.$transaction([
            this.db.user.update({
                where: { id: stored.user_id },
                data: { passwordHash },
            }),
            // Invalidate all refresh tokens on password change
            this.db.refreshToken.deleteMany({ where: { user_id: stored.user_id } }),
            this.db.passwordResetToken.delete({ where: { id: stored.id } }),
        ]);

        return { success: true };
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

    private static readonly REFRESH_TOKEN_TTL_DAYS = 7;

    private async issueRefreshToken(userId: string): Promise<string> {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(
            Date.now() + AuthService.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        );
        await this.db.refreshToken.create({
            data: { user_id: userId, token_hash: tokenHash, expires_at: expiresAt },
        });
        return rawToken;
    }

    async refreshTokens(rawToken: string) {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const stored = await this.db.refreshToken.findUnique({ where: { token_hash: tokenHash } });

        if (!stored || stored.expires_at < new Date()) {
            if (stored) {
                await this.db.refreshToken.delete({ where: { id: stored.id } });
            }
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        // Rotate: delete the consumed token before issuing a new pair
        await this.db.refreshToken.delete({ where: { id: stored.id } });
        return this.generateAuthResponse(stored.user_id, true);
    }

    private async generateAuthResponse(userId: string, withRefreshToken = false) {
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

        const payload = { sub: user.id, email: user.email };
        const isPlatformAdmin = isPlatformAdminEmail(user.email);
        const refreshToken = withRefreshToken ? await this.issueRefreshToken(userId) : undefined;
        return {
            access_token: this.jwtService.sign(payload, { expiresIn: '15m' }),
            ...(refreshToken && { refresh_token: refreshToken }),
            is_platform_admin: isPlatformAdmin,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                is_platform_admin: isPlatformAdmin,
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
