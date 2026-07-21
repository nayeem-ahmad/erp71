import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AI_TOKENS_PER_CREDIT, type AiChatToolCall } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { hasStorePermission } from '../auth/permission.util';
import { TenantContext } from '../database/tenant.decorator';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CustomersService } from '../customers/customers.service';
import { ExpensesService } from '../expenses/expenses.service';
import { InventoryReportsService } from '../inventory-reports/inventory-reports.service';
import { PurchaseReportsService } from '../purchase-reports/purchase-reports.service';
import { SalesReportsService } from '../sales-reports/sales-reports.service';
import { AiService, type ChatCompletionMessage } from './ai.service';
import { CHAT_TOOLS, CHAT_TOOLS_BY_NAME, toOpenRouterTools, type ChatTool, type ChatToolContext, type ChatToolDeps } from './chat-tools';

/**
 * Model round-trips per question. Two is the common case (call tools, then
 * answer); the cap exists so a model that keeps re-querying cannot bill the
 * tenant indefinitely for one message.
 */
const MAX_TURNS = 5;
/** Prior messages replayed into a new turn. Tool results are never replayed. */
const MAX_HISTORY_MESSAGES = 10;
/** Hard ceiling on a serialized tool result, as a backstop to the per-tool row caps. */
const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_TITLE_LENGTH = 80;
/** Bangladesh has a single timezone; there is no per-tenant timezone column yet. */
const TENANT_TIMEZONE = 'Asia/Dhaka';

export interface ChatTurnResult {
    conversationId: string;
    messageId: string;
    content: string;
    toolCalls: AiChatToolCall[];
    creditsUsed: number;
    truncated: boolean;
    createdAt: Date;
}

@Injectable()
export class ChatService {
    private readonly logger = new Logger(ChatService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly ai: AiService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly salesReports: SalesReportsService,
        private readonly inventoryReports: InventoryReportsService,
        private readonly purchaseReports: PurchaseReportsService,
        private readonly customers: CustomersService,
        private readonly expenses: ExpensesService,
    ) {}

    private get deps(): ChatToolDeps {
        return {
            salesReports: this.salesReports,
            inventoryReports: this.inventoryReports,
            purchaseReports: this.purchaseReports,
            customers: this.customers,
            expenses: this.expenses,
        };
    }

    async assertEnabled(): Promise<void> {
        if (!(await this.platformSettings.isFeatureEnabled('aiChat'))) {
            throw new ServiceUnavailableException('The AI assistant is not available.');
        }
    }

    /**
     * Tools this caller may use. Filtering happens before the tool list is sent,
     * so an unauthorized tool is not merely refused at call time — the model
     * never learns it exists and cannot mention it.
     */
    async resolveTools(ctx: TenantContext): Promise<ChatTool[]> {
        const allowed: ChatTool[] = [];
        for (const tool of CHAT_TOOLS) {
            if (await hasStorePermission(this.db, ctx, tool.permission)) {
                allowed.push(tool);
            }
        }
        return allowed;
    }

    // ── Conversations ────────────────────────────────────────────────────────

    async listConversations(tenantId: string, userId: string) {
        const rows = await this.db.aiConversation.findMany({
            where: { tenant_id: tenantId, user_id: userId },
            orderBy: { updated_at: 'desc' },
            take: 30,
            include: { _count: { select: { messages: true } } },
        });
        return rows.map((c) => ({
            id: c.id,
            title: c.title,
            created_at: c.created_at.toISOString(),
            updated_at: c.updated_at.toISOString(),
            message_count: c._count.messages,
        }));
    }

    async getConversation(tenantId: string, userId: string, id: string) {
        const conversation = await this.db.aiConversation.findFirst({
            where: { id, tenant_id: tenantId, user_id: userId },
            include: {
                messages: { orderBy: { created_at: 'asc' } },
                _count: { select: { messages: true } },
            },
        });
        if (!conversation) throw new NotFoundException('Conversation not found');
        return {
            id: conversation.id,
            title: conversation.title,
            created_at: conversation.created_at.toISOString(),
            updated_at: conversation.updated_at.toISOString(),
            message_count: conversation._count.messages,
            messages: conversation.messages.map((m) => ({
                id: m.id,
                role: m.role as 'user' | 'assistant',
                content: m.content,
                tool_calls: (m.tool_calls_json as unknown as AiChatToolCall[]) ?? undefined,
                credits_used: m.credits_used,
                created_at: m.created_at.toISOString(),
            })),
        };
    }

    async deleteConversation(tenantId: string, userId: string, id: string): Promise<{ deleted: boolean }> {
        const existing = await this.db.aiConversation.findFirst({
            where: { id, tenant_id: tenantId, user_id: userId },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('Conversation not found');
        await this.db.aiConversation.delete({ where: { id } });
        return { deleted: true };
    }

    // ── The turn ─────────────────────────────────────────────────────────────

    async chat(ctx: TenantContext, message: string, conversationId?: string, locale?: string): Promise<ChatTurnResult> {
        await this.assertEnabled();
        await this.ai.enforceCredits(ctx.tenantId);
        await this.enforceDailyTurnCap(ctx.tenantId);

        const conversation = conversationId
            ? await this.loadOwnedConversation(ctx, conversationId)
            : await this.db.aiConversation.create({
                  data: {
                      tenant_id: ctx.tenantId,
                      user_id: ctx.userId,
                      title: message.slice(0, MAX_TITLE_LENGTH),
                  },
              });

        const [tools, history, stores] = await Promise.all([
            this.resolveTools(ctx),
            this.loadHistory(conversation.id),
            this.db.store.findMany({
                where: { tenant_id: ctx.tenantId },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
        ]);

        const toolContext: ChatToolContext = {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            userRole: ctx.userRole,
            storeId: ctx.storeId,
            stores,
        };

        const messages: ChatCompletionMessage[] = [
            { role: 'system', content: this.buildSystemPrompt(tools, stores, locale) },
            ...history,
            { role: 'user', content: message },
        ];

        const model = await this.ai.getChatModel();
        const wireTools = toOpenRouterTools(tools);
        const toolCalls: AiChatToolCall[] = [];
        let creditsUsed = 0;
        let answer = '';
        let truncated = true;

        for (let turn = 0; turn < MAX_TURNS; turn++) {
            // On the last allowed turn we withhold the tools, which forces a
            // text answer from whatever the model already has instead of the
            // whole question failing after a run of lookups.
            const isFinalTurn = turn === MAX_TURNS - 1;
            const { message: reply, usage } = await this.ai.callOpenRouterWithTools(
                model,
                messages,
                isFinalTurn ? [] : wireTools,
            );
            creditsUsed += await this.ai.logUsage(ctx.tenantId, 'data_chat', model, usage);

            if (!reply.tool_calls?.length || isFinalTurn) {
                answer = reply.content ?? '';
                truncated = Boolean(reply.tool_calls?.length) && isFinalTurn;
                break;
            }

            messages.push({ role: 'assistant', content: reply.content ?? '', tool_calls: reply.tool_calls });

            for (const call of reply.tool_calls) {
                const { result, trace } = await this.executeTool(toolContext, call.function.name, call.function.arguments);
                toolCalls.push(trace);
                messages.push({ role: 'tool', tool_call_id: call.id, content: result });
            }
        }

        if (!answer.trim()) {
            answer = truncated
                ? 'That question needed more lookups than I am allowed per message. Try asking about one thing at a time — for example a single date range or a single product.'
                : 'I could not produce an answer for that. Please rephrase the question.';
        }

        const [, assistantMessage] = await this.db.$transaction([
            this.db.aiMessage.create({
                data: { conversation_id: conversation.id, role: 'user', content: message },
            }),
            this.db.aiMessage.create({
                data: {
                    conversation_id: conversation.id,
                    role: 'assistant',
                    content: answer,
                    tool_calls_json: toolCalls.length ? (toolCalls as unknown as object) : undefined,
                    credits_used: creditsUsed,
                },
            }),
            this.db.aiConversation.update({
                where: { id: conversation.id },
                data: { updated_at: new Date() },
            }),
        ]);

        return {
            conversationId: conversation.id,
            messageId: assistantMessage.id,
            content: answer,
            toolCalls,
            creditsUsed,
            truncated,
            createdAt: assistantMessage.created_at,
        };
    }

    private async loadOwnedConversation(ctx: TenantContext, id: string) {
        const conversation = await this.db.aiConversation.findFirst({
            where: { id, tenant_id: ctx.tenantId, user_id: ctx.userId },
        });
        if (!conversation) throw new NotFoundException('Conversation not found');
        return conversation;
    }

    /**
     * Replays user/assistant turns only. Tool result messages are intentionally
     * dropped: replaying them would re-bill every prior lookup as input tokens
     * on every subsequent question in the thread.
     */
    private async loadHistory(conversationId: string): Promise<ChatCompletionMessage[]> {
        const rows = await this.db.aiMessage.findMany({
            where: { conversation_id: conversationId },
            orderBy: { created_at: 'desc' },
            take: MAX_HISTORY_MESSAGES,
            select: { role: true, content: true },
        });
        return rows
            .reverse()
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    private async executeTool(
        ctx: ChatToolContext,
        name: string,
        rawArgs: string,
    ): Promise<{ result: string; trace: AiChatToolCall }> {
        const startedAt = Date.now();
        let args: Record<string, unknown> = {};
        try {
            args = rawArgs ? JSON.parse(rawArgs) : {};
        } catch {
            return {
                result: JSON.stringify({ error: 'Tool arguments were not valid JSON. Retry with valid JSON.' }),
                trace: { name, args: {}, ms: Date.now() - startedAt, error: 'invalid arguments' },
            };
        }

        const tool = CHAT_TOOLS_BY_NAME[name];
        if (!tool) {
            return {
                result: JSON.stringify({ error: `Unknown tool "${name}".` }),
                trace: { name, args, ms: Date.now() - startedAt, error: 'unknown tool' },
            };
        }

        try {
            const output = await tool.handler(ctx, args, this.deps);
            const rowCount = Array.isArray((output as any)?.rows) ? (output as any).rows.length : undefined;
            let serialized = JSON.stringify(output);
            if (serialized.length > MAX_TOOL_RESULT_CHARS) {
                serialized = `${serialized.slice(0, MAX_TOOL_RESULT_CHARS)}… [result truncated]`;
            }
            return { result: serialized, trace: { name, args, rowCount, ms: Date.now() - startedAt } };
        } catch (err: unknown) {
            // A failed lookup must not fail the whole turn — hand the model a
            // readable error so it can apologise or try a different tool.
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Chat tool "${name}" failed for tenant ${ctx.tenantId}: ${msg}`);
            return {
                result: JSON.stringify({ error: `Could not run ${name}: ${msg}` }),
                trace: { name, args, ms: Date.now() - startedAt, error: msg },
            };
        }
    }

    /**
     * Bounds a runaway client (or a user hammering the box) independently of the
     * monthly credit ceiling, which a single bad day could otherwise exhaust.
     */
    private async enforceDailyTurnCap(tenantId: string): Promise<void> {
        const raw = await this.platformSettings.getRawValue('ai', 'chat_daily_turn_cap');
        const cap = Number(raw ?? 200);
        if (!Number.isFinite(cap) || cap <= 0) return;

        const since = new Date();
        since.setHours(0, 0, 0, 0);
        const used = await this.db.aiUsageLog.count({
            where: { tenant_id: tenantId, feature: 'data_chat', created_at: { gte: since } },
        });
        if (used >= cap) {
            throw new ForbiddenException(
                `The AI assistant has hit its daily limit for this business (${cap} lookups). It resets tomorrow.`,
            );
        }
    }

    private buildSystemPrompt(tools: ChatTool[], stores: Array<{ id: string; name: string }>, locale?: string): string {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: TENANT_TIMEZONE });
        const branchList = stores.length
            ? stores.map((s) => `- ${s.name} (id: ${s.id})`).join('\n')
            : '- (this business has no branches configured)';
        const languageRule =
            locale === 'bn'
                ? 'Reply in Bangla (Bengali).'
                : 'Reply in the language the user wrote in — English or Bangla.';

        return [
            'You are the ERP71 business assistant for a small or medium retailer in Bangladesh.',
            'You answer questions about this business\'s own data by calling the tools available to you.',
            '',
            'GROUNDING RULES — these override everything else:',
            '- Never state a number that did not come from a tool result in this conversation. Do not estimate, extrapolate, or recall figures from earlier context that you did not look up.',
            '- If no available tool can answer the question, say plainly what you cannot see and suggest which report page to open. Do not guess.',
            '- If a tool result says it was truncated, say so — e.g. "the top 20 of 143".',
            '- You are read-only. You cannot create, edit or delete anything. If asked to, explain that and point to the right page.',
            '',
            `Today is ${today} (timezone ${TENANT_TIMEZONE}). Resolve relative dates like "last month" or "this week" against that date, and pass explicit YYYY-MM-DD ranges to tools.`,
            '',
            'Branches in this business:',
            branchList,
            '',
            'FORMATTING:',
            '- Money is Bangladeshi Taka. Write amounts as ৳1,234.56. Never use $ or any other currency symbol.',
            '- Be brief. Lead with the number the user asked for, then at most two lines of relevant context.',
            '- Use a compact markdown table only when listing more than three rows.',
            `- ${languageRule}`,
            '',
            tools.length
                ? `You have ${tools.length} tool(s) available. The user's permissions determine this list — if a tool is absent, that user is not allowed to see that data, so do not mention that it exists.`
                : 'You currently have no data tools available, because this user lacks the permissions for them. Tell the user their account does not have access to business reports and suggest contacting the business owner.',
        ].join('\n');
    }
}
