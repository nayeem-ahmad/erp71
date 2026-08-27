import { Controller, Post, Patch, Body, UseGuards, Request, Get, Query, Param, HttpCode, HttpStatus, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto, CreateStoreDto, UpdateProfileDto, ChangePasswordDto, GoogleSignInDto, MobileSignInDto, RefreshTokenDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleTokenService } from './google-token.service';
import { FirebaseTokenService } from './firebase-token.service';
import { TotpService } from './totp.service';
import { extractRequestMeta } from '../audit/audit-route.util';

@Controller('auth')
export class AuthController {
    constructor(
        private authService: AuthService,
        private totpService: TotpService,
        private googleTokenService: GoogleTokenService,
        private firebaseTokenService: FirebaseTokenService,
    ) { }

    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    @Post('signup')
    async signup(@Body() dto: SignupDto, @Request() req) {
        return this.authService.signup(dto, extractRequestMeta(req));
    }

    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post('login')
    async login(@Body() dto: LoginDto, @Request() req) {
        return this.authService.login(dto, extractRequestMeta(req));
    }

    /**
     * Read at runtime by the login and signup pages, because the frontend's
     * build-time `NEXT_PUBLIC_*` variables are baked into the image — configuring
     * Google would otherwise mean rebuilding the frontend, not just restarting it.
     */
    @Get('google/config')
    googleConfig() {
        return {
            enabled: this.googleTokenService.isEnabled(),
            client_id: this.googleTokenService.getPrimaryClientId(),
        };
    }

    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post('google')
    async googleSignIn(@Body() dto: GoogleSignInDto, @Request() req) {
        return this.authService.googleSignIn(dto, extractRequestMeta(req));
    }

    /**
     * Firebase's web config, read at runtime for the same reason as Google's:
     * `NEXT_PUBLIC_*` values are baked into the frontend image, so turning
     * mobile sign-in on would otherwise mean a rebuild rather than a restart.
     * Every value here is a public client identifier, not a secret.
     */
    @Get('firebase/config')
    firebaseConfig() {
        return {
            enabled: this.firebaseTokenService.isEnabled(),
            ...(this.firebaseTokenService.getWebConfig() ?? {}),
        };
    }

    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post('mobile')
    async mobileSignIn(@Body() dto: MobileSignInDto, @Request() req) {
        return this.authService.mobileSignIn(dto, extractRequestMeta(req));
    }

    /**
     * Renew an expired access token.
     *
     * Unauthenticated on purpose: the caller reaches here precisely because its
     * access token is no longer accepted, so `JwtAuthGuard` would reject every
     * legitimate request. The refresh token in the body is the credential.
     */
    @Throttle({ default: { ttl: 60_000, limit: 30 } })
    @HttpCode(HttpStatus.OK)
    @Post('refresh')
    async refresh(@Body() dto: RefreshTokenDto, @Request() req) {
        return this.authService.refreshSession(dto.refresh_token, extractRequestMeta(req));
    }

    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @Post('logout')
    async logout(@Request() req) {
        await this.authService.logout(req.user.userId, extractRequestMeta(req));
    }

    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post('demo')
    async demoLogin() {
        return this.authService.demoLogin();
    }

    @Get('plans')
    async getPlans() {
        return this.authService.getPlans();
    }

    @Get('signup-defaults')
    async getSignupDefaults() {
        return this.authService.getSignupDefaults();
    }

    @Get('referral-code/:code')
    async validateReferralCode(@Param('code') code: string) {
        return this.authService.validateReferralCode(code);
    }

    @UseGuards(JwtAuthGuard)
    @Post('setup-store')
    async setupStore(@Request() req, @Body() dto: CreateStoreDto) {
        return this.authService.setupStore(req.user.userId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Post('setup-tenant')
    async setupTenant(@Request() req, @Body() dto: CreateStoreDto) {
        return this.authService.setupTenant(req.user.userId, {
            tenantName: dto.tenantName || dto.name,
            storeName: dto.name,
            address: dto.address,
            planCode: dto.planCode,
            businessType: dto.businessType,
        });
    }

    @UseGuards(JwtAuthGuard)
    @Post('onboarding/dismiss')
    async dismissOnboarding(@Request() req) {
        const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string | undefined);
        return this.authService.dismissOnboarding(req.user.userId, tenantId);
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    async getMe(@Request() req) {
        return this.authService.getMe(req.user.userId);
    }

    @UseGuards(JwtAuthGuard)
    @Patch('me')
    async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
        return this.authService.updateProfile(req.user.userId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    @Post('change-password')
    async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
        await this.authService.changePassword(req.user.userId, dto, extractRequestMeta(req));
        return { message: 'Password changed successfully' };
    }

    // #67 Email verification
    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Get('verify-email')
    async verifyEmail(@Query('token') token: string) {
        await this.authService.verifyEmail(token);
        return { message: 'Email verified successfully' };
    }

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { ttl: 60_000, limit: 3 } })
    @Post('resend-verification')
    async resendVerification(@Request() req) {
        await this.authService.sendVerificationEmail(req.user.userId);
        return { message: 'Verification email sent' };
    }

    // #69 TOTP 2FA
    @UseGuards(JwtAuthGuard)
    @Post('2fa/setup')
    async totpSetup(@Request() req) {
        return this.totpService.setupTotp(req.user.userId, req.user.email);
    }

    @UseGuards(JwtAuthGuard)
    @Post('2fa/enable')
    async totpEnable(@Request() req, @Body() body: { code: string }) {
        await this.totpService.enableTotp(req.user.userId, body.code);
        return { message: '2FA enabled successfully' };
    }

    @UseGuards(JwtAuthGuard)
    @Post('2fa/disable')
    async totpDisable(@Request() req, @Body() body: { code: string }) {
        await this.totpService.disableTotp(req.user.userId, body.code);
        return { message: '2FA disabled successfully' };
    }

    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('avatar'))
    @Patch('me/avatar')
    async updateAvatar(@Request() req, @UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No avatar file provided');
        }
        return this.authService.updateAvatar(req.user.userId, file);
    }

    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post('2fa/verify')
    async totpVerify(@Body() body: { userId: string; code: string }, @Request() req) {
        await this.totpService.verifyTotpForLogin(body.userId, body.code);
        return this.authService.completeTwoFactorLogin(body.userId, extractRequestMeta(req));
    }
}
