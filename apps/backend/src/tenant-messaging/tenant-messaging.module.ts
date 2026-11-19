import { Global, Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { TenantMessagingIdentityController } from './tenant-messaging-identity.controller';
import { TenantMessagingIdentityService } from './tenant-messaging-identity.service';
import { TenantSmtpController } from './tenant-smtp.controller';
import { TenantSmtpService } from './tenant-smtp.service';

/**
 * Global because the mailer and the WhatsApp sender both need it, and both are
 * themselves global services injected all over the app.
 */
@Global()
@Module({
    controllers: [TenantMessagingIdentityController, TenantSmtpController],
    providers: [TenantMessagingIdentityService, TenantSmtpService, PlatformAdminGuard],
    exports: [TenantMessagingIdentityService, TenantSmtpService],
})
export class TenantMessagingModule {}
