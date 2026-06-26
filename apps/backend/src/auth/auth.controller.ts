import { Controller, Post, Patch, Body, UseGuards, Request, Get, Query, HttpCode, HttpStatus, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto, CreateStoreDto, UpdateProfileDto, ChangePasswordDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TotpService } from './totp.service';

@Controller('auth')
export class AuthController {
    constructor(
        private authService: AuthService,
        private totpService: TotpService,
    ) { }

    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    @Post('signup')
    async signup(@Body() dto: SignupDto) {
        return this.authService.signup(dto);
    }

    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @Post('login')
    async login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @Post('logout')
    async logout(@Request() req) {
        await this.authService.logout(req.user.userId);
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
        await this.authService.changePassword(req.user.userId, dto);
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
    async totpVerify(@Body() body: { userId: string; code: string }) {
        await this.totpService.verifyTotpForLogin(body.userId, body.code);
        return this.authService.completeTwoFactorLogin(body.userId);
    }
}
