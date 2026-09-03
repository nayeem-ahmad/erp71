import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PasswordResetService } from './password-reset.service';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

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

class ResendInviteDto {
    /** The expired link's own token — it is the only proof the caller was invited. */
    @IsString()
    @MaxLength(256)
    token: string;
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

    /**
     * Lets the reset page render the truth on load rather than after a failed
     * submit. Throttled because it is an oracle for token guesses — not a
     * practical attack against 100 bits, but there is no reason to serve it fast.
     */
    @Throttle({ default: { ttl: 60_000, limit: 20 } })
    @Get('reset-token/:token')
    async inspectToken(@Param('token') token: string) {
        return this.service.inspectToken(token);
    }

    /**
     * Recover an expired partner invite without an admin. The replacement always
     * goes to the address on the referee record, never to anything supplied here.
     */
    @Throttle({ default: { ttl: 60_000, limit: 3 } })
    @Post('invite/resend')
    async resendInvite(@Body() dto: ResendInviteDto) {
        return this.service.resendRefereeInvite(dto.token);
    }
}
