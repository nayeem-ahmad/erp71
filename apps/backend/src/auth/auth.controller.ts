import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto, CreateStoreDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

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
        });
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    async getMe(@Request() req) {
        return this.authService.getMe(req.user.userId);
    }
}
