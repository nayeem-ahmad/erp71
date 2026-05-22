import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PasswordResetService } from './password-reset.service';
import { IsEmail, IsString, MinLength } from 'class-validator';

class RequestResetDto {
    @IsEmail()
    email: string;
}

class ResetPasswordDto {
    @IsString()
    token: string;

    @IsString()
    @MinLength(8)
    newPassword: string;
}

@Controller('auth')
export class PasswordResetController {
    constructor(private service: PasswordResetService) {}

    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    @Post('forgot-password')
    async forgotPassword(@Body() dto: RequestResetDto) {
        await this.service.requestReset(dto.email);
        return { message: 'If that email exists, a reset link has been sent.' };
    }

    @Post('reset-password')
    async resetPassword(@Body() dto: ResetPasswordDto) {
        await this.service.resetPassword(dto.token, dto.newPassword);
        return { message: 'Password updated successfully.' };
    }
}
