import { Global, Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { TenantMessagingIdentityController } from './tenant-messaging-identity.controller';
import { TenantMessagingIdentityService } from './tenant-messaging-identity.service';

/**
 * Global because the mailer and the WhatsApp sender both need it, and both are
 * themselves global services injected all over the app.
 */
@Global()
@Module({
    controllers: [TenantMessagingIdentityController],
    providers: [TenantMessagingIdentityService, PlatformAdminGuard],
    exports: [TenantMessagingIdentityService],
})
export class TenantMessagingModule {}
