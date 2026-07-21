import { Body, Controller, Delete, Get, Param, Post, Request, ServiceUnavailableException, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { AiService } from './ai.service';
import { ChatService } from './chat.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ChatDto, NarrateReportDto, DraftMessageDto, ParseVoiceEntryDto, ParseVoiceSaleDto } from './ai.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
    constructor(
        private readonly aiService: AiService,
        private readonly chatService: ChatService,
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

    // ── Data chatbot ─────────────────────────────────────────────────────────

    /**
     * One question against the tenant's own data. Throttled per user on top of
     * the credit ceiling and the per-day turn cap: a single turn can cost several
     * model round-trips, so a hot loop here is expensive, not just noisy.
     */
    @Post('chat')
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    async chat(@Tenant() tenant: TenantContext, @Body() dto: ChatDto) {
        const result = await this.chatService.chat(tenant, dto.message, dto.conversationId, dto.locale);
        return {
            conversation_id: result.conversationId,
            credits_used: result.creditsUsed,
            truncated: result.truncated,
            message: {
                id: result.messageId,
                role: 'assistant' as const,
                content: result.content,
                tool_calls: result.toolCalls,
                credits_used: result.creditsUsed,
                created_at: result.createdAt.toISOString(),
            },
        };
    }

    /** Names of the tools this caller may use — drives the UI's empty state. */
    @Get('chat/tools')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    async chatTools(@Tenant() tenant: TenantContext) {
        await this.chatService.assertEnabled();
        const tools = await this.chatService.resolveTools(tenant);
        return { tools: tools.map((t) => t.name) };
    }

    @Get('chat/conversations')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    listConversations(@Tenant() tenant: TenantContext) {
        return this.chatService.listConversations(tenant.tenantId, tenant.userId);
    }

    @Get('chat/conversations/:id')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    getConversation(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.chatService.getConversation(tenant.tenantId, tenant.userId, id);
    }

    @Delete('chat/conversations/:id')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(TenantInterceptor)
    deleteConversation(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.chatService.deleteConversation(tenant.tenantId, tenant.userId, id);
    }
}
