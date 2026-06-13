import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { NarrateReportDto, DraftMessageDto } from './ai.dto';
import { AI_CREDITS_PER_PLAN, AI_TOKENS_PER_CREDIT, SubscriptionPlanCode } from '@retail-saas/shared-types';

type ModelId = 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' | 'claude-opus-4-8';

const MODEL_RATES: Record<ModelId, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
    'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, cacheRead: 0.10, cacheWrite: 1.25 },
    'claude-sonnet-4-6':        { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
    'claude-opus-4-8':          { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
};

@Injectable()
export class AiService {
    constructor(
        private readonly db: DatabaseService,
        private readonly platformSettings: PlatformSettingsService,
    ) {}

    private async getClient(): Promise<Anthropic> {
        const dbKey = await this.platformSettings.getRawValue('ai', 'api_key');
        const apiKey = dbKey ?? process.env.ANTHROPIC_API_KEY ?? '';
        return new Anthropic({ apiKey });
    }

    async testConnection(): Promise<{ success: boolean; model: string; message: string }> {
        const anthropic = await this.getClient();
        if (!anthropic.apiKey) {
            return { success: false, model: '', message: 'No API key configured.' };
        }
        try {
            const model: ModelId = 'claude-haiku-4-5-20251001';
            const response = await anthropic.messages.create({
                model,
                max_tokens: 16,
                messages: [{ role: 'user', content: 'Reply with just: ok' }],
            });
            const text = response.content.find((b) => b.type === 'text');
            return { success: true, model, message: text?.type === 'text' ? text.text : 'ok' };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, model: '', message: msg };
        }
    }

    async getUsageSummary(tenantId: string) {
        const [subscription, logs] = await Promise.all([
            this.db.tenantSubscription.findUnique({
                where: { tenant_id: tenantId },
                include: { plan: true },
            }),
            this.db.aiUsageLog.findMany({
                where: {
                    tenant_id: tenantId,
                    created_at: { gte: this.currentPeriodStart(tenantId) },
                },
                orderBy: { created_at: 'desc' },
                take: 100,
            }),
        ]);

        const planCode = (subscription?.plan?.code ?? 'FREE') as SubscriptionPlanCode;
        const creditsLimit = AI_CREDITS_PER_PLAN[planCode];
        const [periodStart, periodEnd] = this.getBillingPeriod(subscription);

        const periodLogs = await this.db.aiUsageLog.findMany({
            where: { tenant_id: tenantId, created_at: { gte: periodStart, lte: periodEnd } },
            orderBy: { created_at: 'desc' },
            take: 100,
        });

        const creditsUsed = periodLogs.reduce((sum, log) => sum + log.credits_used, 0);

        return {
            plan: planCode,
            credits_limit: creditsLimit,
            credits_used: Math.round(creditsUsed * 100) / 100,
            credits_remaining: Math.max(0, creditsLimit - creditsUsed),
            period_start: periodStart.toISOString(),
            period_end: periodEnd.toISOString(),
            logs: logs.map((l) => ({
                id: l.id,
                feature: l.feature,
                model: l.model,
                input_tokens: l.input_tokens,
                output_tokens: l.output_tokens,
                credits_used: Math.round(l.credits_used * 100) / 100,
                cost_usd: Math.round(l.cost_usd * 1_000_000) / 1_000_000,
                created_at: l.created_at.toISOString(),
            })),
        };
    }

    async narrateReport(tenantId: string, dto: NarrateReportDto): Promise<{ narration: string }> {
        await this.enforceCredits(tenantId);

        const model: ModelId = 'claude-haiku-4-5-20251001';
        const locale = dto.locale ?? 'en';
        const langInstruction = locale === 'bn'
            ? 'Respond in Bangla (Bengali). Use ৳ for currency.'
            : 'Respond in English. Use ৳ for currency.';

        const systemPrompt = `You are a retail business analyst assistant for Bangladeshi small and medium retailers. ${langInstruction} Be concise (3–5 sentences). Focus on actionable insights.`;

        const userMessage = `Report type: ${dto.reportType}\n\nData:\n${JSON.stringify(dto.reportData, null, 2)}\n\nProvide a brief business narrative summarizing performance, key trends, and one actionable recommendation.`;

        const response = await this.callClaude(tenantId, 'report_narration', model, systemPrompt, userMessage);
        return { narration: response };
    }

    async draftMessage(tenantId: string, dto: DraftMessageDto): Promise<{ draft: string }> {
        await this.enforceCredits(tenantId);

        const model: ModelId = 'claude-haiku-4-5-20251001';
        const locale = dto.locale ?? 'en';
        const langInstruction = locale === 'bn'
            ? 'Write the message in Bangla (Bengali). Keep it natural and warm.'
            : 'Write the message in English. Keep it natural and warm.';

        const systemPrompt = `You are a business communication assistant for Bangladeshi retailers. ${langInstruction} Write a short, professional ${dto.channel} message. Maximum 160 characters for SMS, 300 characters for WhatsApp, no limit for email. Do not include placeholder text — write a complete, ready-to-send message.`;

        const userMessage = `Purpose: ${dto.purpose}\nChannel: ${dto.channel}\nCustomer context: ${JSON.stringify(dto.customerContext)}\n\nWrite the message now.`;

        const response = await this.callClaude(tenantId, 'message_drafter', model, systemPrompt, userMessage);
        return { draft: response };
    }

    private async callClaude(
        tenantId: string,
        feature: string,
        model: ModelId,
        systemPrompt: string,
        userMessage: string,
    ): Promise<string> {
        const anthropic = await this.getClient();
        let response: Awaited<ReturnType<typeof anthropic.messages.create>>;

        try {
            response = await anthropic.messages.create({
                model,
                max_tokens: 512,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }],
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new InternalServerErrorException(`AI service error: ${msg}`);
        }

        const usage = response.usage;
        const rates = MODEL_RATES[model];
        const totalTokens =
            usage.input_tokens +
            usage.output_tokens +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0);

        const costUsd =
            (usage.input_tokens * rates.input +
             usage.output_tokens * rates.output +
             (usage.cache_read_input_tokens ?? 0) * rates.cacheRead +
             (usage.cache_creation_input_tokens ?? 0) * rates.cacheWrite) /
            1_000_000;

        const creditsUsed = totalTokens / AI_TOKENS_PER_CREDIT;

        await this.db.aiUsageLog.create({
            data: {
                tenant_id: tenantId,
                feature,
                model,
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cache_read_tokens: usage.cache_read_input_tokens ?? 0,
                cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
                cost_usd: costUsd,
                credits_used: creditsUsed,
            },
        });

        const textBlock = response.content.find((b) => b.type === 'text');
        return textBlock?.type === 'text' ? textBlock.text : '';
    }

    private async enforceCredits(tenantId: string): Promise<void> {
        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            include: { plan: true },
        });

        const planCode = (subscription?.plan?.code ?? 'FREE') as SubscriptionPlanCode;
        const limit = AI_CREDITS_PER_PLAN[planCode];

        if (limit === 0) {
            throw new ForbiddenException('AI features require a paid plan. Please upgrade to BASIC or higher.');
        }

        const [periodStart, periodEnd] = this.getBillingPeriod(subscription);

        const result = await this.db.aiUsageLog.aggregate({
            where: { tenant_id: tenantId, created_at: { gte: periodStart, lte: periodEnd } },
            _sum: { credits_used: true },
        });

        const used = result._sum.credits_used ?? 0;
        if (used >= limit) {
            throw new ForbiddenException(
                `AI credit limit reached (${limit} credits/month for ${planCode} plan). Upgrade your plan to continue.`,
            );
        }
    }

    private getBillingPeriod(subscription: { current_period_start: Date; current_period_end: Date } | null): [Date, Date] {
        const now = new Date();
        if (subscription) {
            return [subscription.current_period_start, subscription.current_period_end];
        }
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        return [start, end];
    }

    private currentPeriodStart(tenantId: string): Date {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
}
