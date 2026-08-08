import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AssetsModule } from '../assets/assets.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { StorefrontCustomerGuard } from './storefront-customer.guard';
import { ApiKeyStrategy } from './api-key.strategy';
import { ApiKeyGuard } from './api-key.guard';
import { CombinedAuthGuard } from './combined-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { SubscriptionAccessGuard } from './subscription-access.guard';
import { TotpService } from './totp.service';
import { GoogleTokenService } from './google-token.service';

@Module({
    imports: [
        AssetsModule,
        PlatformSettingsModule,
        ReferralsModule,
        SubscriptionPlansModule,
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
        StorefrontCustomerGuard,
        ApiKeyStrategy,
        ApiKeyGuard,
        CombinedAuthGuard,
        PlatformAdminGuard,
        SubscriptionAccessGuard,
        TotpService,
        GoogleTokenService,
    ],
    controllers: [AuthController],
    exports: [
        AuthService,
        JwtModule,
        JwtAuthGuard,
        OptionalJwtAuthGuard,
        StorefrontCustomerGuard,
        ApiKeyGuard,
        CombinedAuthGuard,
        PlatformAdminGuard,
        SubscriptionAccessGuard,
        TotpService,
        GoogleTokenService,
    ],
})
export class AuthModule { }
