import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AssetsModule } from '../assets/assets.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { ApiKeyStrategy } from './api-key.strategy';
import { ApiKeyGuard } from './api-key.guard';
import { CombinedAuthGuard } from './combined-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { SubscriptionAccessGuard } from './subscription-access.guard';
import { TotpService } from './totp.service';

@Module({
    imports: [
        AssetsModule,
        PassportModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'fallback-secret-for-dev-only',
            signOptions: { expiresIn: '1d' },
        }),
    ],
    providers: [
        AuthService,
        JwtStrategy,
        JwtAuthGuard,
        OptionalJwtAuthGuard,
        ApiKeyStrategy,
        ApiKeyGuard,
        CombinedAuthGuard,
        PlatformAdminGuard,
        SubscriptionAccessGuard,
        TotpService,
    ],
    controllers: [AuthController],
    exports: [
        AuthService,
        JwtModule,
        JwtAuthGuard,
        OptionalJwtAuthGuard,
        ApiKeyGuard,
        CombinedAuthGuard,
        PlatformAdminGuard,
        SubscriptionAccessGuard,
        TotpService,
    ],
})
export class AuthModule { }
