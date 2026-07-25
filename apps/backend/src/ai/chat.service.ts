import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AI_TOKENS_PER_CREDIT, StorePermission, hasPlanEntitlement, type AiChatToolCall } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { hasStorePermission } from '../auth/permission.util';
import { TenantContext } from '../database/tenant.decorator';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { AccountingService } from '../accounting/accounting.service';
import { CustomersService } from '../customers/customers.service';
import { ExpensesService } from '../expenses/expenses.service';
import { InventoryReportsService } from '../inventory-reports/inventory-reports.service';
import { PurchaseReportsService } from '../purchase-reports/purchase-reports.service';
import { SalesReportsService } from '../sales-reports/sales-reports.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { AiService, type ChatCompletionMessage } from './ai.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { ChatDataService } from './chat-data.service';
import { WebSearchService } from './web-search.service';
import {
    CHAT_TOOLS,
    CHAT_TOOLS_BY_NAME,
    toOpenRouterTools,
    type ChatTool,
    type ChatToolContext,
    type ChatToolDeps,
    type ChatToolFeatureFlag,
    type ChatToolModule,
} from './chat-tools';

/**
 * Model round-trips per question.
 *
 * Three is the common case now that entity resolution is a first-class step
 * (resolve the name, run the report, answer). Comparison and drill-down
 * questions legitimately need more, and the old cap of 5 turned them into
 * "that needed more lookups than I'm allowed" rather than an answer. The cap
 * still exists so a model that keeps re-querying cannot bill the tenant
 * indefinitely for one message; tools within a single turn now run in
 * parallel, so raising it costs round-trips, not wall-clock per lookup.
 */
const MAX_TURNS = 8;
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
        private readonly planEntitlements: PlanEntitlementsService,
        private readonly salesReports: SalesReportsService,
        private readonly inventoryReports: InventoryReportsService,
        private readonly purchaseReports: PurchaseReportsService,
        private readonly customers: CustomersService,
        private readonly suppliers: SuppliersService,
        private readonly expenses: ExpensesService,
        private readonly accounting: AccountingService,
        private readonly chatData: ChatDataService,
        private readonly webSearch: WebSearchService,
        private readonly anomalyDetection: AnomalyDetectionService,
    ) {}

    private get deps(): ChatToolDeps {
        return {
            salesReports: this.salesReports,
            inventoryReports: this.inventoryReports,
            purchaseReports: this.purchaseReports,
            customers: this.customers,
            suppliers: this.suppliers,
            expenses: this.expenses,
            accounting: this.accounting,
            data: this.chatData,
            web: this.webSearch,
            anomalies: this.anomalyDetection,
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
     *
     * Three filters apply, and they differ in kind. Permission filtering is about
     * *this user*; module filtering is about *this tenant's subscription*; feature
     * flags are about what the *platform operator* has switched on. An
     * accounting-only tenant used to be handed inventory tools it could never
     * populate, so the assistant answered stock questions with an empty report
     * instead of saying the business does not track stock here.
     */
    async resolveTools(ctx: TenantContext): Promise<ChatTool[]> {
        const [modules, flags] = await Promise.all([
            this.resolveModules(ctx.tenantId),
            this.resolveFeatureFlags(),
        ]);
        const allowed: ChatTool[] = [];
        for (const tool of CHAT_TOOLS) {
            if (tool.modules && !tool.modules.some((module) => modules.has(module))) continue;
            if (tool.featureFlag && !flags.has(tool.featureFlag)) continue;
            if (await hasStorePermission(this.db, ctx, tool.permission)) {
                allowed.push(tool);
            }
        }
        return allowed;
    }

    /** Platform-level capabilities that cost money per call, hence opt-in. */
    private async resolveFeatureFlags(): Promise<Set<ChatToolFeatureFlag>> {
        const flags = new Set<ChatToolFeatureFlag>();
        if (await this.webSearch.isEnabled().catch(() => false)) flags.add('webSearch');
        return flags;
    }

    /** The product areas this tenant's plan actually covers. */
    private async resolveModules(tenantId: string): Promise<Set<ChatToolModule>> {
        const features = await this.planEntitlements.getFeaturesForTenant(tenantId).catch(() => ({}) as Record<string, boolean | number>);
        const modules = new Set<ChatToolModule>(['accounting']);

        // Accounting-only is the one plan that genuinely has no retail side.
        // Every other plan sells things, so retail and inventory are the default.
        if (!hasPlanEntitlement(features, 'accountingOnly')) {
            modules.add('retail');
            modules.add('inventory');
            modules.add('crm');
            modules.add('hr');
        }
        if (hasPlanEntitlement(features, 'premiumManufacturing')) modules.add('manufacturing');

        return modules;
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

        const [tools, history, stores, hasConsolidatedAccess] = await Promise.all([
            this.resolveTools(ctx),
            this.loadHistory(conversation.id),
            this.db.store.findMany({
                where: { tenant_id: ctx.tenantId },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            }),
            hasStorePermission(this.db, ctx, StorePermission.VIEW_CONSOLIDATED_REPORTS),
        ]);

        // Seeded with any link the user typed: asking the assistant to read a URL
        // you pasted is a legitimate request, and it is the one case where a
        // fetchable URL does not have to come from a search result first.
        const fetchableUrls = new Set(this.webSearch.extractUrls(message));
        const toolCredits = { total: 0 };

        const toolContext: ChatToolContext = {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            userRole: ctx.userRole,
            storeId: ctx.storeId,
            stores,
            hasConsolidatedAccess,
            fetchableUrls,
            toolCredits,
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

            // Tools in one turn are independent lookups against a read-only
            // database, so running them sequentially only added latency: a
            // question needing four reports took four round-trips of waiting.
            // Results are appended in the model's original call order regardless
            // of which finished first — the protocol pairs them by id, but an
            // unstable order makes the stored trace impossible to read back.
            const executed = await Promise.all(
                reply.tool_calls.map((call) =>
                    this.executeTool(toolContext, call.function.name, call.function.arguments),
                ),
            );

            reply.tool_calls.forEach((call, index) => {
                const { result, trace } = executed[index];
                toolCalls.push(trace);
                messages.push({ role: 'tool', tool_call_id: call.id, content: result });
            });
        }

        // Tools that make their own model calls (web_search) bill outside the loop.
        creditsUsed += toolCredits.total;

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
            // Web tools return the pages they read as `sources`. Those URLs are the
            // only grounds a web-derived claim has, so they belong in the trace the
            // UI shows — an internal figure links to its report, and an external one
            // has to link to the page it came from.
            const urls: string[] | undefined = Array.isArray((output as any)?.sources)
                ? (output as any).sources
                      .map((s: any) => (typeof s?.url === 'string' ? s.url : null))
                      .filter(Boolean)
                      .slice(0, 8)
                : undefined;
            // A policy refusal is a legitimate outcome, not a crash — but it produced
            // no data, so the trace marks it and the UI leaves it out of Sources.
            const refusedReason = (output as any)?.refused === true ? String((output as any).reason ?? 'refused') : undefined;

            let serialized = JSON.stringify(output);
            if (serialized.length > MAX_TOOL_RESULT_CHARS) {
                serialized = `${serialized.slice(0, MAX_TOOL_RESULT_CHARS)}… [result truncated]`;
            }
            return {
                result: serialized,
                trace: {
                    name,
                    args,
                    rowCount,
                    ...(urls?.length ? { urls } : {}),
                    ms: Date.now() - startedAt,
                    ...(refusedReason ? { error: refusedReason } : {}),
                },
            };
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
        const hasWeb = tools.some((tool) => tool.featureFlag === 'webSearch');
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
            '- If a tool result says it was truncated, say so — e.g. "the top 20 of 143". If it reports hasMore, you can request the next page with the offset parameter.',
            '- Never invent an id. When a question names a specific product, customer, supplier, warehouse or account, call resolve_entity first and use the id it returns. Branch ids are listed below and need no lookup.',
            '- You are read-only. You cannot create, edit or delete anything. If asked to, explain that and point to the right page.',
            '',
            'CHOOSING TOOLS:',
            '- For anything spanning more than one period, use the trend tools or the compareTo parameter. Do not call the same summary tool twice for two date ranges and subtract them yourself.',
            '- compareTo: "previous_period" is the equally long block of days ending the day before the range, which may straddle two calendar months. Every result echoes the exact window it used — quote that window rather than calling it "last month".',
            '- For "why did X change", use top_movers. It compares two periods and returns what moved, in both directions.',
            '- For a slice of sales, use sales_breakdown with the right groupBy rather than looking for a dedicated tool.',
            '- Sales reports come from invoices; accounting statements come from posted vouchers. They can legitimately differ. Say which source a figure came from when both could apply.',
            '- Before reporting a zero or an empty list as an answer, consider calling describe_capabilities — a period with no data and a business that never recorded that data need different answers.',
            '- "Is anything wrong", "check for mistakes", "any unusual transactions", "is anyone stealing" — use transaction_anomalies. Do not try to spot outliers yourself by listing documents and eyeballing the amounts; you cannot see line items, and the tool has already done the comparison against this business\'s own history.',
            '',
            'REPORTING ANOMALIES:',
            '- A flag is a statistical difference from this business\'s own past, not a finding. Say what was observed, what it was compared against, and how many past transactions that comparison came from.',
            '- Rank by the taka at stake and lead with those. A ৳40 discrepancy and a ৳40,000 one are not the same message.',
            '- Offer the ordinary explanation first: most flags are data-entry slips, then genuine one-off deals, then real errors. Suggest what to check, and let the user judge.',
            '- Never accuse anyone. `enteredBy` is who keyed the record, which is not who caused the problem. Do not name a person as responsible for a flag, and do not describe anything as theft or fraud — say what the numbers show and stop there.',
            '- A scan with no flags is a real answer. Say the period came back clean rather than implying the check failed.',
            '',
            ...(hasWeb
                ? [
                      'THE WEB (web_search, fetch_web_page):',
                      '- The default is NO. This business\'s own sales, stock, customers, dues, expenses and accounts are in the report tools above and are not on the public web. Never search the web for them.',
                      '- Search the web only for facts that exist outside this business: market or wholesale prices, VAT/NBR rules and other Bangladesh regulations, brand or product specifications, supplier and competitor background, exchange rates, industry benchmarks, current events.',
                      '- The common good case is a comparison: get the internal figure from a report tool, get the external figure from the web, and say which is which. Never present a web figure as this business\'s own number, or the reverse.',
                      '- Write the query the way you would type it into a search engine. Never put "my" or "our" in it — the web does not know this shop.',
                      '- Attribute every web-derived claim to its source in your answer, with the date the source gives. Web results can be stale, wrong or contradictory; internal report figures are authoritative and web figures are not.',
                      '- Use fetch_web_page only to follow up a search hit whose summary was not specific enough, or to read a link the user pasted. Do not fetch more than two pages for one question.',
                      '- If the search returns nothing useful, say so. Do not fall back on your own knowledge of prices or regulations — it is out of date.',
                      '',
                  ]
                : []),
            `Today is ${today} (timezone ${TENANT_TIMEZONE}). Resolve relative dates like "last month" or "this week" against that date, and pass explicit YYYY-MM-DD ranges to tools.`,
            '',
            'Branches in this business:',
            branchList,
            '',
            'FORMATTING:',
            '- Your reply is rendered as markdown in a narrow side panel about 380px wide. Bold, italics, bullet lists, tables, links and inline code all render; raw HTML and images do not.',
            ...(hasWeb
                ? [
                      '- Cite a web source as a short inline markdown link on the domain name — "wholesale rice is ৳72/kg ([tbsnews.net](https://…))" — not as a bare URL and not as a numbered footnote list. The panel is too narrow for either.',
                  ]
                : []),
            '- Money is Bangladeshi Taka. Write amounts as ৳1,234.56. Never use $ or any other currency symbol.',
            '- Be brief. Lead with the number the user asked for, then at most two lines of relevant context.',
            '- Bold the figure the user asked for so it is findable at a glance. Do not bold whole sentences.',
            '- Use a compact markdown table only when listing more than three rows. Keep it to three columns with short headers — anything wider has to be scrolled sideways in the panel.',
            '- Do not use a heading unless the answer has two or more distinct sections, and then use "###". A short answer needs no heading at all.',
            `- ${languageRule}`,
            '',
            tools.length
                ? `You have ${tools.length} tool(s) available. The user's permissions and this business's subscription determine this list — if a tool is absent, that data is not available to this user, so do not mention that it exists.`
                : 'You currently have no data tools available, because this user lacks the permissions for them. Tell the user their account does not have access to business reports and suggest contacting the business owner.',
        ].join('\n');
    }
}
