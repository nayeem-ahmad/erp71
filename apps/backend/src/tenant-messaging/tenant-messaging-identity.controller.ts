import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { EmailService } from '../email/email.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { TenantMessagingIdentityService } from './tenant-messaging-identity.service';
import {
    TestTenantMessagingIdentityDto,
    UpdateTenantMessagingIdentityDto,
} from './tenant-messaging-identity.dto';

/**
 * Platform-admin only, deliberately: the from-address has to be verified at the
 * email provider and the phone number id has to belong to an onboarded WABA, so
 * a tenant-facing version of this screen would let any workspace send as any
 * address the provider happens to accept.
 */
@Controller('admin/tenants/:tenantId/messaging-identity')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class TenantMessagingIdentityController {
    constructor(
        private readonly service: TenantMessagingIdentityService,
        private readonly email: EmailService,
        private readonly whatsapp: WhatsAppService,
    ) {}

    @Get()
    get(@Param('tenantId') tenantId: string) {
        return this.service.getForAdmin(tenantId);
    }

    @Patch()
    update(
        @Param('tenantId') tenantId: string,
        @Body() dto: UpdateTenantMessagingIdentityDto,
        @Request() req: any,
    ) {
        return this.service.update(tenantId, dto, req.user?.userId);
    }

    /**
     * Sends through whatever sender this tenant would use *right now*, so the
     * result reflects the saved state rather than the unsaved form — save first,
     * then test. The response names the sender that was used so an operator can
     * tell a working tenant identity from a silent fallback to the platform.
     */
    @Post('test-email')
    async testEmail(
        @Param('tenantId') tenantId: string,
        @Body() dto: TestTenantMessagingIdentityDto,
    ) {
        await this.email.sendTestEmail(dto.to, { tenantId });
        const identity = await this.service.resolveEmailIdentity(tenantId);
        return {
            sender: identity ? 'tenant' : 'platform',
            from: identity?.from ?? null,
        };
    }

    @Post('test-whatsapp')
    async testWhatsApp(
        @Param('tenantId') tenantId: string,
        @Body() dto: TestTenantMessagingIdentityDto,
    ) {
        await this.whatsapp.sendTestMessage(dto.to, { tenantId });
        const identity = await this.service.resolveWhatsAppIdentity(tenantId);
        return {
            sender: identity ? 'tenant' : 'platform',
            phone_number_id: identity?.phoneNumberId ?? null,
        };
    }
}
