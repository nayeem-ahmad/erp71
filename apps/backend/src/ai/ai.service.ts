import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ProductsService } from '../products/products.service';
import { NarrateReportDto, DraftMessageDto, ParseVoiceEntryDto, VoiceEntryType } from './ai.dto';
import { AI_CREDITS_PER_PLAN, AI_TOKENS_PER_CREDIT, SubscriptionPlanCode } from '@erp71/shared-types';

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
const WHISPER_MODEL = 'openai/whisper-large-v3';
const MAX_AUDIO_BASE64_LENGTH = 4 * 1024 * 1024;

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

type ParsedVoiceSaleItem = {
    productName: string;
    quantity: number;
};

type ParsedVoiceSale = {
    items: ParsedVoiceSaleItem[];
    note?: string;
};

@Injectable()
export class AiService {
    constructor(
        private readonly db: DatabaseService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly productsService: ProductsService,
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

    async parseVoiceEntry(tenantId: string, dto: ParseVoiceEntryDto) {
        const entryType: VoiceEntryType = dto.entryType ?? 'sale';
        await this.enforceCredits(tenantId);

        let transcript = dto.transcript?.trim() ?? '';
        if (!transcript && dto.audioBase64) {
            transcript = await this.transcribeAudio(
                tenantId,
                dto.audioBase64,
                dto.audioFormat ?? 'webm',
                dto.locale,
                entryType,
            );
        }
        if (!transcript) {
            throw new BadRequestException('Provide a transcript or audio recording.');
        }

        const model = await this.getDefaultModel();
        const locale = dto.locale ?? 'en';
        const systemPrompt = this.buildVoiceEntryPrompt(entryType, locale);
        const userMessage = `Transcript:\n${transcript}`;

        const raw = await this.complete(
            tenantId,
            `voice_${entryType}_parser`,
            model,
            systemPrompt,
            userMessage,
            1024,
        );
        const parsed = this.extractJson<ParsedVoiceSale>(raw);
        const parsedItems = Array.isArray(parsed.items) ? parsed.items : [];

        const items: Array<{
            matched: boolean;
            productName: string;
            quantity: number;
            product?: {
                id: string;
                name: string;
                price: number;
                group?: { name: string };
                subgroup?: { name: string };
            };
        }> = [];
        const unmatched: string[] = [];

        for (const entry of parsedItems) {
            const productName = String(entry.productName ?? '').trim();
            const quantity = Number(entry.quantity);
            if (!productName || !Number.isFinite(quantity) || quantity <= 0) {
                continue;
            }

            const matches = await this.productsService.searchByQuantitySold(tenantId, productName, 5);
            const best = this.pickBestProductMatch(productName, matches);

            if (best) {
                items.push({
                    matched: true,
                    productName,
                    quantity,
                    product: {
                        id: best.id,
                        name: best.name,
                        price: Number(best.price),
                        group: best.group ? { name: best.group.name } : undefined,
                        subgroup: best.subgroup ? { name: best.subgroup.name } : undefined,
                    },
                });
            } else {
                items.push({ matched: false, productName, quantity });
                unmatched.push(productName);
            }
        }

        return {
            transcript,
            entryType,
            items,
            unmatched,
            note: typeof parsed.note === 'string' ? parsed.note.trim() || undefined : undefined,
        };
    }

    async parseVoiceSale(tenantId: string, dto: ParseVoiceEntryDto) {
        return this.parseVoiceEntry(tenantId, { ...dto, entryType: dto.entryType ?? 'sale' });
    }

    private buildVoiceEntryPrompt(entryType: VoiceEntryType, locale: string): string {
        const langHint = locale === 'bn'
            ? 'The transcript may be in Bangla (Bengali) or English. Product names may be in either language.'
            : 'The transcript may be in English or Bangla (Bengali). Product names may be in either language.';

        const contextHints: Record<VoiceEntryType, string> = {
            sale: 'Extract products being sold to a customer.',
            purchase: 'Extract products being purchased from a supplier.',
            sales_order: 'Extract products for a customer sales order.',
            sales_quote: 'Extract products for a sales quotation.',
            purchase_order: 'Extract products for a purchase order to a supplier.',
            purchase_quote: 'Extract products for a purchase quotation.',
            sales_return: 'Extract products and quantities being returned by a customer. Ignore receipt numbers.',
            purchase_return: 'Extract products and quantities being returned to a supplier. Ignore purchase numbers.',
        };

        return `You are a retail assistant for Bangladeshi grocery and retail shops. ${langHint}
${contextHints[entryType]}
Respond with ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "items": [{ "productName": "string", "quantity": number }],
  "note": "optional note string or omit"
}

Rules:
- quantity must be a positive number (default 1 if not stated)
- productName should be the product as spoken (e.g. "চাল", "rice", "সয়াবিন তেল")
- ignore payment method, greetings, receipt numbers, and filler words
- if nothing can be parsed, return {"items": []}`;
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

    private async transcribeAudio(
        tenantId: string,
        audioBase64: string,
        format: string,
        locale?: string,
        entryType: VoiceEntryType = 'sale',
    ): Promise<string> {
        if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
            throw new BadRequestException('Audio recording is too long. Keep it under 30 seconds.');
        }

        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new InternalServerErrorException('AI service is not configured. Set an OpenRouter API key.');
        }

        const referer = process.env.FRONTEND_URL ?? 'https://erp71.com';
        const title = process.env.OPENROUTER_APP_NAME ?? 'ERP71';

        const body: Record<string, unknown> = {
            model: WHISPER_MODEL,
            input_audio: { data: audioBase64, format },
        };
        if (locale === 'bn') body.language = 'bn';
        else if (locale === 'en') body.language = 'en';

        let response: Response;
        try {
            response = await fetch(`${OPENROUTER_BASE_URL}/audio/transcriptions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': referer,
                    'X-OpenRouter-Title': title,
                },
                body: JSON.stringify(body),
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new InternalServerErrorException(`Transcription error: ${msg}`);
        }

        const result = (await response.json()) as {
            text?: string;
            error?: { message?: string };
            usage?: {
                seconds?: number;
                total_tokens?: number;
                input_tokens?: number;
                output_tokens?: number;
                cost?: number;
            };
        };

        if (!response.ok) {
            const msg = result.error?.message ?? `Transcription failed (${response.status})`;
            throw new InternalServerErrorException(msg);
        }

        const text = result.text?.trim() ?? '';
        if (!text) {
            throw new BadRequestException('Could not transcribe audio. Please speak clearly and try again.');
        }

        const usage = result.usage ?? {};
        const totalTokens = usage.total_tokens ?? 0;
        const creditsUsed = totalTokens > 0
            ? totalTokens / AI_TOKENS_PER_CREDIT
            : Math.max((usage.seconds ?? 5) / 60, 0.05);

        await this.db.aiUsageLog.create({
            data: {
                tenant_id: tenantId,
                feature: `voice_${entryType}_transcription`,
                model: WHISPER_MODEL,
                input_tokens: usage.input_tokens ?? 0,
                output_tokens: usage.output_tokens ?? 0,
                cost_usd: usage.cost ?? 0,
                credits_used: creditsUsed,
            },
        });

        return text;
    }

    private extractJson<T>(raw: string): T {
        const trimmed = raw.trim();
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const candidate = (fenced?.[1] ?? trimmed).trim();
        try {
            return JSON.parse(candidate) as T;
        } catch {
            throw new InternalServerErrorException('AI returned an invalid response. Please try again.');
        }
    }

    private pickBestProductMatch(
        query: string,
        products: Array<{
            id: string;
            name: string;
            price: unknown;
            group?: { name: string } | null;
            subgroup?: { name: string } | null;
        }>,
    ) {
        if (products.length === 0) return null;

        const normalizedQuery = query.toLowerCase().trim();
        const exact = products.find((p) => p.name.toLowerCase() === normalizedQuery);
        if (exact) return exact;

        const contains = products.find((p) => {
            const name = p.name.toLowerCase();
            return name.includes(normalizedQuery) || normalizedQuery.includes(name);
        });
        return contains ?? products[0];
    }

    private async complete(
        tenantId: string,
        feature: string,
        model: string,
        systemPrompt: string,
        userMessage: string,
        maxTokens = 512,
    ): Promise<string> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new InternalServerErrorException('AI service is not configured. Set an OpenRouter API key.');
        }

        const normalizedModel = this.normalizeModel(model);
        const { text, usage } = await this.callOpenRouter(apiKey, normalizedModel, systemPrompt, userMessage, maxTokens);

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
        const referer = process.env.FRONTEND_URL ?? 'https://erp71.com';
        const title = process.env.OPENROUTER_APP_NAME ?? 'ERP71';

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