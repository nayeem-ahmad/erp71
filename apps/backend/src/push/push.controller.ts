import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PushService } from './push.service';
import { RegisterDeviceDto, UnregisterDeviceDto } from './push.dto';

/**
 * The phone's push registration. Per person, not per workspace: one phone
 * signed in to one account gets that person's notifications from every shop
 * they belong to, each carrying its workspace so a tap opens the right one.
 */
@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
    constructor(private readonly push: PushService) {}

    @Get('config')
    config() {
        return this.push.clientConfig();
    }

    /** Called on every launch with the current token, so it also keeps it fresh. */
    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @HttpCode(HttpStatus.NO_CONTENT)
    @Post('devices')
    async register(@Request() req, @Body() dto: RegisterDeviceDto) {
        await this.push.register(req.user.userId, {
            token: dto.token,
            platform: dto.platform,
            appVersion: dto.app_version,
            refreshToken: dto.refresh_token,
        });
    }

    /** Sent by the app before it signs out, so the phone goes quiet at once. */
    @HttpCode(HttpStatus.NO_CONTENT)
    @Post('devices/unregister')
    async unregister(@Request() req, @Body() dto: UnregisterDeviceDto) {
        await this.push.unregister(req.user.userId, dto.token);
    }
}
