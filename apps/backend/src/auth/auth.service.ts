import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { TotpService } from './totp.service';
import { DatabaseService } from '../database/database.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { AuditRequestMeta } from '../audit/audit-route.util';
import { AssetsService } from '../assets/assets.service';
import { bootstrapDefaultAccountingForTenant, seedBusinessTypeTemplate, seedDefaultLeadTaxonomy, seedDefaultPaymentMethods, seedDefaultTenantRoles } from '@erp71/database';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { SignupDto, LoginDto, UpdateProfileDto, ChangePasswordDto, GoogleSignInDto, MobileSignInDto } from './auth.dto';
import { GoogleProfile, GoogleTokenService } from './google-token.service';
import { FirebasePhoneProfile, FirebaseTokenService } from './firebase-token.service';
import { isPlatformAdminEmail } from './platform-admin.util';
import { RefreshTokenService } from './refresh-token.service';
import { accessTokenTtl, accessTokenTtlSeconds } from './access-token-ttl';
import { AUTH_SCOPE_APP } from './token-scope';
import { DEMO_ACCOUNT_EMAIL } from '@erp71/database';
import {
    DEFAULT_PLATFORM_FEATURES,
    ROLE_DEFAULT_PERMISSIONS,
    StorePermission,
    UserRole,
    isComingSoonSubscriptionPlan,
    isSelfServeSubscriptionPlan,
    DEFAULT_MOBILE_COUNTRY_CODE,
    countryCodeFromE164,
    normalizeMobileToE164,
    resolveTenantFeatures,
} from '@erp71/shared-types';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ReferralsService } from '../referrals/referrals.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';


type TenantProvisionDto = {
    tenantName: string;
    storeName: string;
    address?: string;
    planCode?: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    businessType?: string;
    referralCode?: string;
};

@Injectable()
export class AuthService {
    constructor(
        private readonly db: DatabaseService,
        private readonly jwtService: JwtService,
        private readonly email: EmailService,
        private readonly audit: AuditService,
        private readonly totp: TotpService,
        private readonly assets: AssetsService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly referrals: ReferralsService,
        private readonly planEntitlements: PlanEntitlementsService,
        private readonly google: GoogleTokenService,
        private readonly firebase: FirebaseTokenService,
        private readonly refreshTokens: RefreshTokenService,
    ) { }

    async signup(dto: SignupDto, meta: AuditRequestMeta = {}) {
        const existingUser = await this.db.user.findUnique({
            where: { email: dto.email },
        });

        if (existingUser) {
            throw new ConflictException('Email already exists');
        }

        let normalizedMobile: string | null = null;
        let mobileCountryCode: string | null = null;
        if (dto.mobile?.trim()) {
            mobileCountryCode = dto.mobile_country_code?.trim() || DEFAULT_MOBILE_COUNTRY_CODE;
            normalizedMobile = normalizeMobileToE164(mobileCountryCode, dto.mobile);
            if (!normalizedMobile) {
                throw new BadRequestException('Please enter a valid mobile number including country code.');
            }
            // Duplicate mobiles are allowed (one person may own multiple businesses) — no uniqueness check.
        }

        const passwordHash = await bcrypt.hash(dto.password, 10);
        const displayName = dto.name?.trim() || dto.email.split('@')[0];
        const defaultPlan = dto.planCode ?? (await this.getSignupDefaults()).defaultPlanCode;

        const user = await this.db.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: {
                    email: dto.email,
                    passwordHash,
                    name: displayName,
                    mobile: normalizedMobile,
                    mobile_country_code: mobileCountryCode ?? DEFAULT_MOBILE_COUNTRY_CODE,
                },
            });

            if (dto.tenantName?.trim()) {
                await this.provisionTenant(tx, createdUser.id, {
                    tenantName: dto.tenantName,
                    storeName: dto.storeName?.trim() || 'Main Store',
                    address: dto.address,
                    planCode: defaultPlan,
                    referralCode: dto.referralCode,
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
        this.audit
            .logForUserTenants('USER_SIGNUP', 'User', { userId: user.id, ...meta }, user.id, {
                email: user.email,
            })
            .catch(() => {});
        const auth = await this.generateAuthResponse(user.id, meta);
        return {
            ...auth,
            requires_email_verification: !user.email_verified_at,
        };
    }

    async completeTwoFactorLogin(userId: string, meta: AuditRequestMeta = {}) {
        // `login()` returns early for 2FA users, so this is the only place a
        // second-factor sign-in can be recorded.
        this.audit
            .logForUserTenants('USER_LOGIN', 'User', { userId, ...meta }, userId, { two_factor: true })
            .catch(() => {});
        return this.generateAuthResponse(userId, meta);
    }

    async login(dto: LoginDto, meta: AuditRequestMeta = {}) {
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
            this.audit
                .logForUserTenants('LOGIN_FAILED', 'User', { userId: user.id, ...meta }, user.id, {
                    email: dto.email,
                })
                .catch(() => {});
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

        this.audit
            .logForUserTenants('USER_LOGIN', 'User', { userId: user.id, ...meta }, user.id)
            .catch(() => {});
        return this.generateAuthResponse(user.id, meta);
    }

    /**
     * Sign in — or sign up — with a Google ID token from Google Identity Services.
     *
     * The three cases, in the order they are tried:
     *  1. We already know this Google account (`google_id`) → sign in.
     *  2. An ERP71 account exists under the same address → link Google to it, so
     *     someone who signed up with a password can switch to the Google button
     *     without ending up with a second, empty workspace. Safe only because
     *     `verifyIdToken` rejects tokens whose email Google has not verified.
     *  3. Nobody matches → create the account. It has no password: they either
     *     keep using Google or claim one through "forgot password".
     */
    async googleSignIn(dto: GoogleSignInDto, meta: AuditRequestMeta = {}) {
        const profile = await this.google.verifyIdToken(dto.credential);

        const existing =
            (await this.db.user.findUnique({ where: { google_id: profile.googleId } })) ??
            (await this.db.user.findUnique({ where: { email: profile.email } }));

        if (existing) {
            return this.completeGoogleLoginForExistingUser(existing, profile, meta);
        }

        return this.createUserFromGoogle(profile, dto, meta);
    }

    private async completeGoogleLoginForExistingUser(
        user: {
            id: string;
            email: string;
            name: string | null;
            google_id: string | null;
            avatar_url: string | null;
            email_verified_at: Date | null;
            totp_secret: string | null;
        },
        profile: GoogleProfile,
        meta: AuditRequestMeta,
    ) {
        if (user.google_id && user.google_id !== profile.googleId) {
            // The address moved between Google accounts. Trusting the new one would
            // hand this workspace to whoever now owns the address at Google.
            throw new UnauthorizedException('This email is already linked to a different Google account.');
        }

        const patch: Record<string, unknown> = {};
        if (!user.google_id) patch.google_id = profile.googleId;
        // Google verified the address for us, so a pending verification is settled.
        if (!user.email_verified_at) patch.email_verified_at = new Date();
        if (!user.name && profile.name) patch.name = profile.name;
        if (!user.avatar_url && profile.picture) patch.avatar_url = profile.picture;
        if (Object.keys(patch).length > 0) {
            await this.db.user.update({ where: { id: user.id }, data: patch });
        }

        if (this.totp.isEnabled(user.totp_secret)) {
            // Google proves who they are, not that they hold the second factor.
            return { requires_2fa: true, user_id: user.id };
        }

        this.audit
            .logForUserTenants('USER_LOGIN', 'User', { userId: user.id, ...meta }, user.id, { provider: 'google' })
            .catch(() => {});

        return { ...(await this.generateAuthResponse(user.id, meta)), is_new_user: false };
    }

    private async createUserFromGoogle(profile: GoogleProfile, dto: GoogleSignInDto, meta: AuditRequestMeta) {
        let normalizedMobile: string | null = null;
        let mobileCountryCode: string | null = null;
        if (dto.mobile?.trim()) {
            mobileCountryCode = dto.mobile_country_code?.trim() || DEFAULT_MOBILE_COUNTRY_CODE;
            normalizedMobile = normalizeMobileToE164(mobileCountryCode, dto.mobile);
            if (!normalizedMobile) {
                throw new BadRequestException('Please enter a valid mobile number including country code.');
            }
        }

        const wantsWorkspace = !!dto.tenantName?.trim();
        const defaultPlan = dto.planCode ?? (await this.getSignupDefaults()).defaultPlanCode;

        const user = await this.db.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: {
                    email: profile.email,
                    // No password: this identity lives in Google until they set one.
                    passwordHash: null,
                    google_id: profile.googleId,
                    name: profile.name ?? profile.email.split('@')[0],
                    avatar_url: profile.picture,
                    email_verified_at: new Date(),
                    mobile: normalizedMobile,
                    mobile_country_code: mobileCountryCode ?? DEFAULT_MOBILE_COUNTRY_CODE,
                },
            });

            if (wantsWorkspace) {
                await this.provisionTenant(tx, createdUser.id, {
                    tenantName: dto.tenantName!.trim(),
                    storeName: dto.storeName?.trim() || 'Main Store',
                    address: dto.address,
                    planCode: defaultPlan,
                    referralCode: dto.referralCode,
                });
            }

            return createdUser;
        });

        this.email.sendWelcome(user.email, user.name ?? user.email).catch((err) => {
            console.warn(`[AuthService] Welcome email failed for ${user.email}:`, err?.message);
        });
        this.audit
            .logForUserTenants('USER_SIGNUP', 'User', { userId: user.id, ...meta }, user.id, {
                email: user.email,
                provider: 'google',
            })
            .catch(() => {});

        return {
            ...(await this.generateAuthResponse(user.id, meta)),
            is_new_user: true,
            // Tells the login page to hand them to the onboarding wizard rather
            // than a dashboard with no workspace behind it.
            requires_workspace: !wantsWorkspace,
        };
    }

    /**
     * Sign in — or sign up — with a Firebase phone identity, after the browser
     * has already put an SMS one-time code in front of the user.
     *
     * The cases, in the order they are tried:
     *  1. We already know this Firebase uid → sign in.
     *  2. Exactly one account carries this number → adopt the Firebase identity
     *     onto it, so someone who signed up with a password can start using the
     *     SMS code without ending up with a second, empty workspace.
     *  3. Several accounts carry it → refuse. Mobile numbers were never unique
     *     here (one person, several businesses), so there is no honest way to
     *     pick one; those users sign in with their email and password.
     *  4. Nobody matches → create the account, once the caller supplies an email
     *     address. Until then the answer is `requires_signup`, and nothing is
     *     written.
     */
    async mobileSignIn(dto: MobileSignInDto, meta: AuditRequestMeta = {}) {
        const profile = await this.firebase.verifyPhoneIdToken(dto.idToken);

        const linked = await this.db.user.findUnique({ where: { firebase_uid: profile.firebaseUid } });
        if (linked) {
            return this.completeMobileLoginForExistingUser(linked, profile, meta);
        }

        // `take: 2` is all the ambiguity check needs, and it keeps the query cheap
        // for a number that somehow sits on dozens of rows.
        const byNumber = await this.db.user.findMany({
            where: { mobile: profile.phoneNumber },
            orderBy: { created_at: 'asc' },
            take: 2,
        });
        if (byNumber.length > 1) {
            throw new ConflictException(
                'This mobile number is linked to more than one account. Please sign in with your email and password.',
            );
        }
        if (byNumber.length === 1) {
            return this.completeMobileLoginForExistingUser(byNumber[0], profile, meta);
        }

        return this.createUserFromMobile(profile, dto, meta);
    }

    private async completeMobileLoginForExistingUser(
        user: {
            id: string;
            firebase_uid: string | null;
            mobile: string | null;
            mobile_verified_at: Date | null;
            totp_secret: string | null;
        },
        profile: FirebasePhoneProfile,
        meta: AuditRequestMeta,
    ) {
        const patch: Record<string, unknown> = {};
        if (!user.firebase_uid) patch.firebase_uid = profile.firebaseUid;
        // Firebase is the authority on which number this identity holds now, so a
        // number changed there (new SIM, ported line) follows through to here.
        if (user.mobile !== profile.phoneNumber) {
            patch.mobile = profile.phoneNumber;
            patch.mobile_country_code = countryCodeFromE164(profile.phoneNumber) ?? DEFAULT_MOBILE_COUNTRY_CODE;
        }
        if (!user.mobile_verified_at || patch.mobile) patch.mobile_verified_at = new Date();
        if (Object.keys(patch).length > 0) {
            await this.db.user.update({ where: { id: user.id }, data: patch });
        }

        if (this.totp.isEnabled(user.totp_secret)) {
            // The SMS code proves the number, not that they hold the second factor.
            return { requires_2fa: true, user_id: user.id };
        }

        this.audit
            .logForUserTenants('USER_LOGIN', 'User', { userId: user.id, ...meta }, user.id, { provider: 'mobile' })
            .catch(() => {});

        return { ...(await this.generateAuthResponse(user.id, meta)), is_new_user: false };
    }

    private async createUserFromMobile(
        profile: FirebasePhoneProfile,
        dto: MobileSignInDto,
        meta: AuditRequestMeta,
    ) {
        const email = dto.email?.trim().toLowerCase();
        if (!email) {
            // Nothing is written yet: the caller now collects an email address and
            // posts the same Firebase token back with it.
            return { requires_signup: true, mobile: profile.phoneNumber };
        }

        // Deliberately not a link: the SMS code proved the number, and nothing at
        // all about this address. Attaching it to an existing account would let
        // anyone with a phone claim any account whose email they can guess.
        if (await this.db.user.findUnique({ where: { email } })) {
            throw new ConflictException(
                'An account with this email already exists. Sign in with it, then add your mobile number.',
            );
        }

        const wantsWorkspace = !!dto.tenantName?.trim();
        const defaultPlan = dto.planCode ?? (await this.getSignupDefaults()).defaultPlanCode;

        const user = await this.db.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: {
                    email,
                    // No password: this identity lives in Firebase until they set one
                    // through "forgot password".
                    passwordHash: null,
                    firebase_uid: profile.firebaseUid,
                    name: dto.name?.trim() || email.split('@')[0],
                    mobile: profile.phoneNumber,
                    mobile_country_code: countryCodeFromE164(profile.phoneNumber) ?? DEFAULT_MOBILE_COUNTRY_CODE,
                    mobile_verified_at: new Date(),
                },
            });

            if (wantsWorkspace) {
                await this.provisionTenant(tx, createdUser.id, {
                    tenantName: dto.tenantName!.trim(),
                    storeName: dto.storeName?.trim() || 'Main Store',
                    address: dto.address,
                    planCode: defaultPlan,
                    referralCode: dto.referralCode,
                });
            }

            return createdUser;
        });

        this.email.sendWelcome(user.email, user.name ?? user.email).catch((err) => {
            console.warn(`[AuthService] Welcome email failed for ${user.email}:`, err?.message);
        });
        // The number is verified; the address they just typed is not.
        this.sendVerificationEmail(user.id).catch((err) => {
            console.warn(`[AuthService] Verification email failed for ${user.email}:`, err?.message);
        });
        this.audit
            .logForUserTenants('USER_SIGNUP', 'User', { userId: user.id, ...meta }, user.id, {
                email: user.email,
                provider: 'mobile',
            })
            .catch(() => {});

        return {
            ...(await this.generateAuthResponse(user.id, meta)),
            is_new_user: true,
            // Tells the page to hand them to the onboarding wizard rather than a
            // dashboard with no workspace behind it.
            requires_workspace: !wantsWorkspace,
        };
    }

    async logout(userId: string, meta: AuditRequestMeta = {}): Promise<void> {
        // Increment token_version to invalidate all existing app JWTs for this user.
        // `storefront_token_version` is deliberately untouched: signing out of the
        // workspace should not also sign the same person out of the shops they buy from.
        await this.db.user.update({
            where: { id: userId },
            data: { token_version: { increment: 1 } },
        });
        // The access JWT dies with the `tv` bump above, but a refresh token is
        // checked against its own row — without this it would happily mint a
        // brand-new session seconds after the user signed out.
        await this.refreshTokens.revokeAllForUser(userId);
        this.audit
            .logForUserTenants('USER_LOGOUT', 'User', { userId, ...meta }, userId)
            .catch(() => {});
    }

    /**
     * Exchange a refresh token for a new access token (and its successor).
     *
     * Deliberately does not re-run `generateAuthResponse`: that would issue a
     * *second* refresh token for the same session, and the tenant/user payload
     * is not what the caller is asking for here. `GET /auth/me` remains the one
     * place the session profile is loaded.
     */
    async refreshSession(rawToken: string, meta: AuditRequestMeta = {}) {
        const rotated = await this.refreshTokens.rotate(rawToken, meta);

        const user = await this.db.user.findUnique({
            where: { id: rotated.userId },
            select: { id: true, email: true, token_version: true },
        });
        if (!user) throw new UnauthorizedException('User not found');

        const payload = { sub: user.id, email: user.email, tv: user.token_version, scope: AUTH_SCOPE_APP };
        return {
            access_token: this.jwtService.sign(payload, { expiresIn: accessTokenTtl() }),
            refresh_token: rotated.token,
            expires_in: accessTokenTtlSeconds(),
        };
    }

    /** Sign one session out without touching the user's other devices. */
    async revokeRefreshToken(rawToken: string | undefined | null): Promise<void> {
        await this.refreshTokens.revoke(rawToken);
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

        try {
            await this.email.sendEmailVerification(user.email, rawToken, { throwOnError: true });
        } catch (err) {
            const detail = err instanceof Error ? err.message : 'Failed to send verification email';
            throw new ServiceUnavailableException(detail);
        }
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

    async validateReferralCode(code: string) {
        const referee = await this.db.referee.findFirst({
            where: { referral_code: code.trim().toUpperCase(), is_active: true, deleted_at: null },
            select: { referral_code: true, signup_discount: true, name: true },
        });
        if (!referee) {
            return { valid: false };
        }
        return {
            valid: true,
            referral_code: referee.referral_code,
            discount_pct: Number(referee.signup_discount),
            referee_name: referee.name,
        };
    }

    async getPlans() {
        const plans = await this.db.subscriptionPlan.findMany({
            where: {
                is_active: true,
                code: { not: 'FREE' },
                monthly_price: { gt: 0 },
            },
            orderBy: { monthly_price: 'asc' },
        });

        return plans
            .filter((plan) => isSelfServeSubscriptionPlan(plan.code, Number(plan.monthly_price)))
            .map((plan) => ({
                code: plan.code,
                name: plan.name,
                description: plan.description,
                monthly_price: Number(plan.monthly_price),
                yearly_price: plan.yearly_price === null ? null : Number(plan.yearly_price),
                features_json: plan.features_json,
                marketing_features: Array.isArray(plan.marketing_features_json)
                    ? plan.marketing_features_json.filter((item): item is string => typeof item === 'string')
                    : [],
            }));
    }

    async getSignupDefaults(): Promise<{ defaultPlanCode: 'BASIC' | 'ACCOUNTING' | 'STANDARD' }> {
        const configured = await this.platformSettings.getRawValue('general', 'default_signup_plan');
        const code = configured && isSelfServeSubscriptionPlan(configured as any) ? configured : 'STANDARD';
        return { defaultPlanCode: code as 'BASIC' | 'ACCOUNTING' | 'STANDARD' };
    }

    private async generateAuthResponse(userId: string, meta: AuditRequestMeta = {}) {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            include: {
                tenantMembers: {
                    where: { tenant: { deleted_at: null } },
                    include: {
                        tenant: {
                            include: {
                                subscription: {
                                    include: { plan: true },
                                },
                            },
                        },
                        tenantRole: { select: { id: true, name: true } },
                    },
                },
                storeAccess: {
                    include: { store: true },
                },
                storePermissions: {
                    select: { tenant_id: true, store_id: true, permission: true },
                },
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const tenantMembers = (user.tenantMembers ?? []).filter((membership) => membership?.tenant);
        const storeAccess = user.storeAccess ?? [];
        const storePermissions = user.storePermissions ?? [];

        const isPlatformAdmin = (user as any).is_platform_admin === true || isPlatformAdminEmail(user.email);
        const payload = { sub: user.id, email: user.email, tv: user.token_version, scope: AUTH_SCOPE_APP };
        const refresh = await this.refreshTokens.issue(user.id, meta);
        return {
            access_token: this.jwtService.sign(payload, { expiresIn: accessTokenTtl() }),
            refresh_token: refresh.token,
            /// Seconds the access token is good for, so the frontend can renew
            /// ahead of expiry rather than waiting for a request to 401.
            expires_in: accessTokenTtlSeconds(),
            is_platform_admin: isPlatformAdmin,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                preferred_locale: user.preferred_locale,
                is_platform_admin: isPlatformAdmin,
                email_verified: !!user.email_verified_at,
            },
            tenants: await Promise.all(
                tenantMembers.map((membership) =>
                    this.mapTenantMembership(membership, storeAccess, user.id, storePermissions),
                ),
            ),
        };
    }

    async getMe(userId: string) {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            include: {
                tenantMembers: {
                    where: { tenant: { deleted_at: null } },
                    include: {
                        tenant: {
                            include: {
                                subscription: {
                                    include: { plan: true },
                                },
                            },
                        },
                        tenantRole: { select: { id: true, name: true } },
                    },
                },
                storeAccess: {
                    include: { store: true },
                },
                storePermissions: {
                    select: { tenant_id: true, store_id: true, permission: true },
                },
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const tenantMembers = (user.tenantMembers ?? []).filter((membership) => membership?.tenant);
        const storeAccess = user.storeAccess ?? [];
        const storePermissions = user.storePermissions ?? [];

        const totpSecret = (user as any).totp_secret as string | null | undefined;
        const twoFactorEnabled = !!totpSecret && !totpSecret.startsWith('pending:');

        const platformFeatures = await this.platformSettings.getPlatformFeatures().catch(() => DEFAULT_PLATFORM_FEATURES);
        const referee = await this.referrals.resolveActiveRefereeForUser(userId, user.email);

        // The employee self-service portal. Unlike a referee, an employee is a
        // real tenant member, so this does not add a *new* identity — it tells
        // the client that one of their tenants can also be entered as "me the
        // employee" rather than as staff.
        const employee = await this.db.employee.findFirst({
            where: { user_id: userId, portal_access: true, status: 'ACTIVE', deleted_at: null },
            select: { id: true, tenant_id: true, employee_code: true, name: true },
        });

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            preferred_locale: user.preferred_locale,
            is_platform_admin: (user as any).is_platform_admin === true || isPlatformAdminEmail(user.email),
            is_demo: this.isDemoAccount(user.email),
            email_verified: !!user.email_verified_at,
            two_factor_enabled: twoFactorEnabled,
            // Lets the security page hide "change password" for a Google-only
            // account, which has no current password to confirm.
            has_password: !!user.passwordHash,
            google_connected: !!(user as any).google_id,
            // Same idea for mobile sign-in: an account with a Firebase identity
            // can get back in with an SMS code even with no password set.
            mobile_connected: !!(user as any).firebase_uid,
            mobile_verified: !!(user as any).mobile_verified_at,
            avatar_url: (user as any).avatar_url || null,
            platform_features: platformFeatures,
            referee: referee
                ? {
                    id: referee.id,
                    name: referee.name,
                    email: referee.email,
                    referral_code: referee.referral_code,
                    signup_discount: Number(referee.signup_discount),
                    commission_rate: Number(referee.commission_rate),
                    is_active: referee.is_active,
                    has_login: !!referee.user_id,
                }
                : null,
            employee: employee
                ? {
                    id: employee.id,
                    tenant_id: employee.tenant_id,
                    employee_code: employee.employee_code,
                    name: employee.name,
                }
                : null,
            tenants: await Promise.all(
                tenantMembers.map((membership) =>
                    this.mapTenantMembership(membership, storeAccess, user.id, storePermissions),
                ),
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

    async updateAvatar(userId: string, file: Express.Multer.File) {
        if (!file.mimetype?.startsWith('image/')) {
            throw new BadRequestException('Avatar must be an image file');
        }

        let avatarUrl: string;
        try {
            avatarUrl = await this.assets.uploadFile(file, `avatars/${userId}`);
        } catch {
            throw new ServiceUnavailableException(
                'Avatar upload is not available. Configure Cloudinary or try again later.',
            );
        }

        const user = await this.db.user.update({
            where: { id: userId },
            data: { avatar_url: avatarUrl },
            select: { id: true, avatar_url: true },
        });

        return { avatarUrl: user.avatar_url };
    }

    async changePassword(userId: string, dto: ChangePasswordDto, meta: AuditRequestMeta = {}) {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            select: { passwordHash: true },
        });

        if (!user) throw new UnauthorizedException('User not found');
        if (!user.passwordHash) {
            // A Google-only account has no current password to check against.
            // "Forgot password" is the supported way to set the first one.
            throw new BadRequestException(
                'This account signs in with Google. Use "Forgot password" to set a password first.',
            );
        }

        const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
        if (!valid) throw new BadRequestException('Current password is incorrect');

        if (dto.currentPassword === dto.newPassword) {
            throw new BadRequestException('New password must differ from your current password');
        }

        if (dto.newPassword.length < 8) {
            throw new BadRequestException('New password must be at least 8 characters');
        }

        const newHash = await bcrypt.hash(dto.newPassword, 10);
        // A password change revokes every session on every surface — the storefront
        // and careers logins accept the same password, so leaving those tokens
        // alive would defeat it.
        await this.db.user.update({
            where: { id: userId },
            data: {
                passwordHash: newHash,
                token_version: { increment: 1 },
                storefront_token_version: { increment: 1 },
                applicant_token_version: { increment: 1 },
            },
        });
        await this.refreshTokens.revokeAllForUser(userId);
        this.audit
            .logForUserTenants('PASSWORD_CHANGED', 'User', { userId, ...meta }, userId)
            .catch(() => {});
    }

    async setupStore(userId: string, dto: { name: string; address?: string; planCode?: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM' }) {
        return this.db.$transaction(async (tx) =>
            this.provisionTenant(tx, userId, {
                tenantName: dto.name,
                storeName: dto.name,
                address: dto.address,
                planCode: dto.planCode ?? 'BASIC',
            }),
        );
    }

    async setupTenant(userId: string, dto: { tenantName: string; storeName: string; address?: string; planCode?: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM'; businessType?: string }) {
        // The onboarding wizard doesn't ask for a plan, so fall back to the same
        // platform default the signup form uses rather than `provisionTenant`'s
        // hard-coded BASIC.
        const planCode = dto.planCode ?? (await this.getSignupDefaults()).defaultPlanCode;
        const result = await this.db.$transaction(async (tx) =>
            this.provisionTenant(tx, userId, {
                tenantName: dto.tenantName,
                storeName: dto.storeName,
                address: dto.address,
                planCode,
                businessType: dto.businessType,
            }),
        );

        if (dto.businessType) {
            // Deliberately not awaited: signup should not block on a bulk import.
            // Must be try/catch, not .catch() — a synchronous throw never reaches
            // a promise handler, which 500'd signup after the tenant had committed.
            try {
                void seedBusinessTypeTemplate(this.db, result.tenant.id, dto.businessType).catch((err) =>
                    console.error(`Failed to seed product template for ${dto.businessType}:`, err),
                );
            } catch (err) {
                console.error(`Failed to start product template seed for ${dto.businessType}:`, err);
            }
        }

        return result;
    }

    private async provisionTenant(
        tx: any,
        userId: string,
        dto: TenantProvisionDto,
    ) {
        const planCode = dto.planCode ?? 'BASIC';
        if (planCode === 'FREE') {
            throw new BadRequestException('The free plan is not available for new signups.');
        }
        if (isComingSoonSubscriptionPlan(planCode)) {
            throw new BadRequestException('The Premium plan is coming soon and is not available for self-serve signup.');
        }
        if (!isSelfServeSubscriptionPlan(planCode)) {
            throw new BadRequestException('Selected subscription plan is not available.');
        }

        const plan = await tx.subscriptionPlan.findUnique({
            where: { code: planCode },
        });

        if (!plan?.is_active || Number(plan.monthly_price) <= 0) {
            throw new BadRequestException('Selected subscription plan is not available.');
        }

        const tenant = await tx.tenant.create({
            data: {
                name: dto.tenantName,
                owner_id: userId,
                ...(dto.businessType ? { business_type: dto.businessType } : {}),
            },
        });

        await seedDefaultTenantRoles(tx, tenant.id);
        await seedDefaultPaymentMethods(tx, tenant.id);
        await seedDefaultLeadTaxonomy(tx, tenant.id);

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
                status: 'PAST_DUE',
                current_period_start: new Date(),
                current_period_end: new Date(),
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

        if (dto.referralCode?.trim()) {
            const referee = await tx.referee.findFirst({
                where: { referral_code: dto.referralCode.trim().toUpperCase(), is_active: true, deleted_at: null },
            });
            if (referee) {
                // A partner using their own code would collect commission on their own
                // subscription and take the signup discount on top of it. Checked both by
                // account link and by email, because a referee created but not yet linked
                // to a User has no user_id to match on.
                const signingUp = await tx.user.findUnique({
                    where: { id: userId },
                    select: { email: true },
                });
                const isSelfReferral =
                    referee.user_id === userId ||
                    referee.email.toLowerCase() === (signingUp?.email ?? '').toLowerCase();

                if (isSelfReferral) {
                    throw new BadRequestException(
                        'You cannot use your own referral code. Remove it to continue.',
                    );
                }

                await tx.referralSignup.create({
                    data: {
                        referee_id: referee.id,
                        tenant_id: tenant.id,
                        discount_pct: referee.signup_discount,
                        commission_pct: referee.commission_rate,
                        status: 'PENDING',
                    },
                });
            }
        }

        return { tenant, store };
    }

    /**
     * Mark the store-setup wizard as finished or skipped for a workspace.
     *
     * The flag lives on the tenant, not the browser: once anyone (in practice the
     * owner) dismisses setup, no member is prompted again on any device. Idempotent —
     * re-dismissing keeps the original timestamp.
     */
    async dismissOnboarding(userId: string, tenantId?: string) {
        const membership = tenantId
            ? await this.db.tenantUser.findFirst({
                where: { user_id: userId, tenant_id: tenantId, tenant: { deleted_at: null } },
                select: { tenant_id: true },
            })
            : await this.db.tenantUser.findFirst({
                where: { user_id: userId, tenant: { deleted_at: null } },
                select: { tenant_id: true },
            });

        if (!membership) {
            // No workspace yet (e.g. signup abandoned before provisioning) — nothing
            // to persist, but the caller shouldn't fail because of it.
            return { onboarding_dismissed: false };
        }

        await this.db.tenant.updateMany({
            where: { id: membership.tenant_id, onboarding_dismissed_at: null },
            data: { onboarding_dismissed_at: new Date() },
        });

        return { onboarding_dismissed: true };
    }

    private async mapTenantMembership(
        membership: any,
        allStoreAccess: any[] = [],
        userId: string,
        allStorePermissions: any[] = [],
    ) {
        const subscription = membership.tenant.subscription;
        const plan = subscription?.plan;
        // Only return stores the user has explicit UserStoreAccess for in this tenant
        const accessibleStores = allStoreAccess
            .filter((a) => a.tenant_id === membership.tenant_id)
            .map((a) => a.store);

        // Merge in any active add-on entitlements so the frontend's plan-gating
        // (Sidebar, layout) reflects purchased add-ons without a separate fetch.
        const mergedFeatures = subscription
            ? await this.planEntitlements.getFeaturesForTenant(membership.tenant_id)
            : undefined;

        // Platform switches with this tenant's own ON/OFF overrides applied, so the
        // shell gates on what a super-admin set for *this* workspace.
        const platformFeatures = await this.platformSettings
            .getPlatformFeatures()
            .then((features) => resolveTenantFeatures(features, membership.tenant.feature_overrides))
            .catch(() => DEFAULT_PLATFORM_FEATURES);

        return {
            id: membership.tenant.id,
            name: membership.tenant.name,
            platform_features: platformFeatures,
            default_locale: membership.tenant.default_locale,
            onboarding_dismissed: !!membership.tenant.onboarding_dismissed_at,
            localization_enabled: membership.tenant.localization_enabled,
            secondary_locale: membership.tenant.secondary_locale,
            // Feeds `resolveDashboardVariant` on the client, so the dashboard picks
            // its variant from this response rather than a second round-trip.
            dashboard_preference: membership.tenant.dashboard_preference ?? 'AUTO',
            role: membership.role,
            tenant_role:
                membership.role === 'OWNER'
                    ? null
                    : membership.tenantRole
                      ? { id: membership.tenantRole.id, name: membership.tenantRole.name }
                      : null,
            permissions: await this.resolveTenantPermissions(
                userId,
                membership.tenant_id,
                membership.role,
                allStoreAccess,
                allStorePermissions,
            ),
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
                                features_json: mergedFeatures ?? plan.features_json,
                            }
                          : null,
                  }
                : null,
        };
    }

    private async resolveTenantPermissions(
        userId: string,
        tenantId: string,
        role: string,
        allStoreAccess: any[],
        allStorePermissions: any[] = [],
    ): Promise<StorePermission[]> {
        if (role === 'OWNER') {
            return Object.values(StorePermission);
        }

        const accessibleStoreIds = new Set(
            allStoreAccess
                .filter((access) => access.tenant_id === tenantId)
                .map((access) => access.store_id),
        );

        const permissions = new Set<StorePermission>();
        for (const grant of allStorePermissions) {
            if (grant.tenant_id === tenantId && accessibleStoreIds.has(grant.store_id)) {
                permissions.add(grant.permission);
            }
        }

        return [...permissions];
    }
}
