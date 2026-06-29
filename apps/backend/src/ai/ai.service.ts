import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { NarrateReportDto, DraftMessageDto } from './ai.dto';
import { AI_CREDITS_PER_PLAN, AI_TOKENS_PER_CREDIT, SubscriptionPlanCode } from '@retail-saas/shared-types';

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

/** Legacy Anthropic direct model IDs stored before OpenRouter migration */
const MODEL_ALIASES: Record<string, string> = {
    'claude-haiku-4-5-20251001': DEFAULT_MODEL,
    'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',
    'claude-opus-4-8': 'anthropic/claude-opus-4.5',
};

/** Fallback $/M token rates when OpenRouter does not return usage.cost */
const MODEL_RATES: Record<string, { input: number; output: number }> = {
    [DEFAULT_MODEL]: { input: 1.0, output: 5.0 },
    'anthropic/claude-sonnet-4.6': { input: 3.0, output: 15.0 },
    'anthropic/claude-opus-4.5': { input: 5.0, output: 25.0 },
    'google/gemini-2.5-flash': { input: 0.15, output: 0.6 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
};

type OpenRouterUsage = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
};

type OpenRouterChatResponse = {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: OpenRouterUsage;
    error?: { message?: string };
};

@Injectable()
export class AiService {
    constructor(
        private readonly db: DatabaseService,
        private readonly platformSettings: PlatformSettingsService,
    ) {}

    private normalizeModel(model: string): string {
        return MODEL_ALIASES[model] ?? model;
    }

    private async getApiKey(): Promise<string> {
        const dbKey = await this.platformSettings.getRawValue('ai', 'api_key');
        return dbKey ?? process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
    }

    private async getDefaultModel(): Promise<string> {
        const dbModel = await this.platformSettings.getRawValue('ai', 'default_model');
        const model = dbModel ?? process.env.OPENROUTER_DEFAULT_MODEL ?? DEFAULT_MODEL;
        return this.normalizeModel(model);
    }

    async testConnection(): Promise<{ success: boolean; model: string; message: string }> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            return { success: false, model: '', message: 'No API key configured.' };
        }
        try {
            const model = await this.getDefaultModel();
            const { text } = await this.callOpenRouter(apiKey, model, 'You are a test assistant.', 'Reply with just: ok', 16);
            return { success: true, model, message: text || 'ok' };
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

        const model = await this.getDefaultModel();
        const locale = dto.locale ?? 'en';
        const langInstruction = locale === 'bn'
            ? 'Respond in Bangla (Bengali). Use ৳ for currency.'
            : 'Respond in English. Use ৳ for currency.';

        const systemPrompt = `You are a retail business analyst assistant for Bangladeshi small and medium retailers. ${langInstruction} Be concise (3–5 sentences). Focus on actionable insights.`;

        const userMessage = `Report type: ${dto.reportType}\n\nData:\n${JSON.stringify(dto.reportData, null, 2)}\n\nProvide a brief business narrative summarizing performance, key trends, and one actionable recommendation.`;

        const response = await this.complete(tenantId, 'report_narration', model, systemPrompt, userMessage);
        return { narration: response };
    }

    async draftMessage(tenantId: string, dto: DraftMessageDto): Promise<{ draft: string }> {
        await this.enforceCredits(tenantId);

        const model = await this.getDefaultModel();
        const locale = dto.locale ?? 'en';
        const langInstruction = locale === 'bn'
            ? 'Write the message in Bangla (Bengali). Keep it natural and warm.'
            : 'Write the message in English. Keep it natural and warm.';

        const systemPrompt = `You are a business communication assistant for Bangladeshi retailers. ${langInstruction} Write a short, professional ${dto.channel} message. Maximum 160 characters for SMS, 300 characters for WhatsApp, no limit for email. Do not include placeholder text — write a complete, ready-to-send message.`;

        const userMessage = `Purpose: ${dto.purpose}\nChannel: ${dto.channel}\nCustomer context: ${JSON.stringify(dto.customerContext)}\n\nWrite the message now.`;

        const response = await this.complete(tenantId, 'message_drafter', model, systemPrompt, userMessage);
        return { draft: response };
    }

    private async complete(
        tenantId: string,
        feature: string,
        model: string,
        systemPrompt: string,
        userMessage: string,
    ): Promise<string> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new InternalServerErrorException('AI service is not configured. Set an OpenRouter API key.');
        }

        const normalizedModel = this.normalizeModel(model);
        const { text, usage } = await this.callOpenRouter(apiKey, normalizedModel, systemPrompt, userMessage, 512);

        const inputTokens = usage.prompt_tokens;
        const outputTokens = usage.completion_tokens;
        const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? 0;
        const cacheWrite = usage.prompt_tokens_details?.cache_write_tokens ?? 0;
        const totalTokens = usage.total_tokens || inputTokens + outputTokens + cacheRead + cacheWrite;

        const costUsd = usage.cost ?? this.estimateCost(normalizedModel, inputTokens, outputTokens);
        const creditsUsed = totalTokens / AI_TOKENS_PER_CREDIT;

        await this.db.aiUsageLog.create({
            data: {
                tenant_id: tenantId,
                feature,
                model: normalizedModel,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_read_tokens: cacheRead,
                cache_creation_tokens: cacheWrite,
                cost_usd: costUsd,
                credits_used: creditsUsed,
            },
        });

        return text;
    }

    private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
        const rates = MODEL_RATES[model] ?? MODEL_RATES[DEFAULT_MODEL];
        return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
    }

    private async callOpenRouter(
        apiKey: string,
        model: string,
        systemPrompt: string,
        userMessage: string,
        maxTokens: number,
    ): Promise<{ text: string; usage: OpenRouterUsage }> {
        const referer = process.env.FRONTEND_URL ?? 'https://retailsaas.app';
        const title = process.env.OPENROUTER_APP_NAME ?? 'RetailSaaS';

        let response: Response;
        try {
            response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': referer,
                    'X-OpenRouter-Title': title,
                },
                body: JSON.stringify({
                    model,
                    max_tokens: maxTokens,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage },
                    ],
                }),
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new InternalServerErrorException(`AI service error: ${msg}`);
        }

        const body = (await response.json()) as OpenRouterChatResponse;
        if (!response.ok) {
            const msg = body.error?.message ?? `OpenRouter request failed (${response.status})`;
            throw new InternalServerErrorException(`AI service error: ${msg}`);
        }

        const text = body.choices?.[0]?.message?.content?.trim() ?? '';
        const usage = body.usage ?? {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };

        return { text, usage };
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