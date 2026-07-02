import { Body, Controller, Get, Post, Request, ServiceUnavailableException, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { AiService } from './ai.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { NarrateReportDto, DraftMessageDto, ParseVoiceEntryDto, ParseVoiceSaleDto } from './ai.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
    constructor(
        private readonly aiService: AiService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly planEntitlements: PlanEntitlementsService,
    ) {}

    private async assertVoiceEnabled(tenantId: string) {
        if (!await this.platformSettings.isFeatureEnabled('voice')) {
            throw new ServiceUnavailableException('Voice features are not available');
        }
        await this.planEntitlements.assertEntitlement(tenantId, 'premiumVoice');
    }

    @Get('usage')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    getUsage(@Tenant() tenant: TenantContext) {
        return this.aiService.getUsageSummary(tenant.tenantId);
    }

    @Post('narrate-report')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    narrateReport(@Tenant() tenant: TenantContext, @Body() dto: NarrateReportDto) {
        return this.aiService.narrateReport(tenant.tenantId, dto);
    }

    @Post('draft-message')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    draftMessage(@Tenant() tenant: TenantContext, @Body() dto: DraftMessageDto) {
        return this.aiService.draftMessage(tenant.tenantId, dto);
    }

    @Post('parse-voice-entry')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    async parseVoiceEntry(@Tenant() tenant: TenantContext, @Body() dto: ParseVoiceEntryDto) {
        await this.assertVoiceEnabled(tenant.tenantId);
        return this.aiService.parseVoiceEntry(tenant.tenantId, dto);
    }

    @Post('parse-voice-sale')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    async parseVoiceSale(@Tenant() tenant: TenantContext, @Body() dto: ParseVoiceSaleDto) {
        await this.assertVoiceEnabled(tenant.tenantId);
        return this.aiService.parseVoiceSale(tenant.tenantId, dto);
    }
}
