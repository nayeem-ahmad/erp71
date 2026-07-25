import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { ChatService } from './chat.service';
import { CHAT_TOOLS } from './chat-tools';
import type { TenantContext } from '../database/tenant.decorator';

const OWNER_CTX: TenantContext = { tenantId: 'tenant-1', userId: 'user-1', storeId: 'store-1', userRole: 'OWNER' };
const STAFF_CTX: TenantContext = { tenantId: 'tenant-1', userId: 'user-2', storeId: 'store-1', userRole: 'CASHIER' };

function emptySummary() {
    return {
        totalRevenue: 0, totalReturns: 0, netRevenue: 0, transactionCount: 0,
        avgOrderValue: 0, totalCogs: 0, grossProfit: 0, grossMarginPct: 0,
    };
}

function makeService(overrides: {
    grantedPermissions?: StorePermission[];
    replies?: Array<{ content: string | null; tool_calls?: any[] }>;
    featureEnabled?: boolean;
    planFeatures?: Record<string, boolean | number>;
    webSearchEnabled?: boolean;
} = {}) {
    const granted = new Set<string>(overrides.grantedPermissions ?? []);
    const replies = overrides.replies ?? [{ content: 'ok' }];
    let replyIndex = 0;

    const db: any = {
        userStorePermission: {
            findFirst: jest.fn(({ where }: any) =>
                Promise.resolve(granted.has(where.permission) ? { id: 'grant-1' } : null),
            ),
        },
        aiConversation: {
            create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
            findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
            update: jest.fn(),
            delete: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
        },
        aiMessage: {
            create: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
        },
        aiUsageLog: { count: jest.fn().mockResolvedValue(0) },
        store: { findMany: jest.fn().mockResolvedValue([{ id: 'store-1', name: 'Gulshan' }]) },
        $transaction: jest.fn().mockResolvedValue([
            { id: 'msg-user' },
            { id: 'msg-assistant', created_at: new Date('2026-07-21T10:00:00Z') },
            {},
        ]),
    };

    const ai: any = {
        enforceCredits: jest.fn().mockResolvedValue(undefined),
        getChatModel: jest.fn().mockResolvedValue('anthropic/claude-haiku-4.5'),
        logUsage: jest.fn().mockResolvedValue(2),
        callOpenRouterWithTools: jest.fn().mockImplementation(() => {
            const reply = replies[Math.min(replyIndex, replies.length - 1)];
            replyIndex++;
            return Promise.resolve({
                message: reply,
                usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
            });
        }),
    };

    const platformSettings: any = {
        isFeatureEnabled: jest.fn().mockResolvedValue(overrides.featureEnabled ?? true),
        getRawValue: jest.fn().mockResolvedValue(null),
    };

    const salesReports: any = {
        getSalesSummary: jest.fn().mockResolvedValue({
            summary: {
                totalRevenue: 100, totalReturns: 0, netRevenue: 100, transactionCount: 2,
                avgOrderValue: 50, totalCogs: 40, grossProfit: 60, grossMarginPct: 60,
            },
            rows: [],
        }),
    };

    const planEntitlements: any = {
        getFeaturesForTenant: jest.fn().mockResolvedValue(overrides.planFeatures ?? {}),
    };

    const chatData: any = {
        getDataCoverage: jest.fn().mockResolvedValue({}),
        resolveEntity: jest.fn().mockResolvedValue([]),
    };

    const webSearch: any = {
        isEnabled: jest.fn().mockResolvedValue(overrides.webSearchEnabled ?? false),
        extractUrls: jest.fn().mockReturnValue([]),
        normalizeUrl: jest.fn((url: string) => url),
        search: jest.fn(),
        fetchPage: jest.fn(),
    };

    const service = new ChatService(
        db,
        ai,
        platformSettings,
        planEntitlements,
        salesReports,
        {} as any, // inventoryReports
        {} as any, // purchaseReports
        {} as any, // customers
        {} as any, // suppliers
        {} as any, // expenses
        {} as any, // accounting
        chatData,
        webSearch,
    );

    return { service, db, ai, platformSettings, planEntitlements, salesReports, chatData, webSearch };
}

const FLAGGED_TOOLS = CHAT_TOOLS.filter((tool) => tool.featureFlag);

describe('ChatService.resolveTools', () => {
    it('gives an OWNER every unflagged tool without consulting per-store grants', async () => {
        const { service, db } = makeService();
        const tools = await service.resolveTools(OWNER_CTX);

        // Feature-flagged tools are excluded: an owner's permissions are total, but
        // a capability the platform operator has not switched on is nobody's.
        expect(tools).toHaveLength(CHAT_TOOLS.length - FLAGGED_TOOLS.length);
        expect(db.userStorePermission.findFirst).not.toHaveBeenCalled();
    });

    /**
     * Web access is a platform-operator decision that costs real money per call,
     * so it is gated separately from permissions and subscriptions. Off is the
     * default, and off means absent from the tool list — not refused on call.
     */
    it('withholds the web tools when web search is disabled', async () => {
        const { service } = makeService({ webSearchEnabled: false });

        const names = (await service.resolveTools(OWNER_CTX)).map((t) => t.name);

        expect(names).not.toContain('web_search');
        expect(names).not.toContain('fetch_web_page');
    });

    it('offers the web tools once web search is enabled', async () => {
        const { service } = makeService({ webSearchEnabled: true });

        const names = (await service.resolveTools(OWNER_CTX)).map((t) => t.name);

        expect(names).toContain('web_search');
        expect(names).toContain('fetch_web_page');
    });

    it('treats a failing web-search settings lookup as disabled', async () => {
        const { service, webSearch } = makeService({ webSearchEnabled: true });
        webSearch.isEnabled.mockRejectedValue(new Error('settings unavailable'));

        const names = (await service.resolveTools(OWNER_CTX)).map((t) => t.name);

        expect(names).not.toContain('web_search');
    });

    /**
     * The security-critical case: a tool the caller cannot use must be absent
     * from the list, not merely refused when called — the model should never
     * learn the capability exists.
     */
    it('withholds tools the caller lacks permission for', async () => {
        const { service } = makeService({ grantedPermissions: [StorePermission.VIEW_PRODUCT_CATALOG] });

        const names = (await service.resolveTools(STAFF_CTX)).map((t) => t.name);

        expect(names).toContain('low_stock');
        expect(names).toContain('stock_on_hand');
        // Catalogue-permission tools only — nothing financial or customer-facing.
        expect(names).not.toContain('sales_summary');
        expect(names).not.toContain('receivables_aging');
        expect(names).not.toContain('financial_statement');
        expect(names).not.toContain('customer_lookup');
    });

    it('gives a staff user with no grants no tools at all', async () => {
        const { service } = makeService({ grantedPermissions: [] });
        expect(await service.resolveTools(STAFF_CTX)).toEqual([]);
    });

    /**
     * The module filter is about the tenant's subscription, not the user. An
     * accounting-only tenant has no stock to report on, and handing it inventory
     * tools made the assistant answer stock questions with an empty report
     * rather than saying the business does not track stock here.
     */
    it('withholds retail and inventory tools from an accounting-only tenant', async () => {
        const { service } = makeService({ planFeatures: { accountingOnly: true } });

        const names = (await service.resolveTools(OWNER_CTX)).map((t) => t.name);

        expect(names).not.toContain('low_stock');
        expect(names).not.toContain('stock_on_hand');
        expect(names).not.toContain('sales_summary');
        expect(names).toContain('financial_statement');
        expect(names).toContain('payables_aging');
        // The tools that carry no module tag stay available to everyone.
        expect(names).toContain('resolve_entity');
        expect(names).toContain('list_documents');
    });

    it('falls back to the full tool set when the plan lookup fails', async () => {
        const { service, planEntitlements } = makeService();
        planEntitlements.getFeaturesForTenant.mockRejectedValueOnce(new Error('billing down'));

        const names = (await service.resolveTools(OWNER_CTX)).map((t) => t.name);

        expect(names).toContain('sales_summary');
    });
});

describe('ChatService.chat', () => {
    it('refuses when the platform feature flag is off', async () => {
        const { service } = makeService({ featureEnabled: false });
        await expect(service.chat(OWNER_CTX, 'hello')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('checks the credit ceiling before spending anything', async () => {
        const { service, ai } = makeService();
        ai.enforceCredits.mockRejectedValueOnce(new ForbiddenException('AI credit limit reached'));

        await expect(service.chat(OWNER_CTX, 'hello')).rejects.toBeInstanceOf(ForbiddenException);
        expect(ai.callOpenRouterWithTools).not.toHaveBeenCalled();
    });

    it('refuses once the per-day turn cap is hit', async () => {
        const { service, db } = makeService();
        db.aiUsageLog.count.mockResolvedValueOnce(500);

        await expect(service.chat(OWNER_CTX, 'hello')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers directly when the model calls no tools', async () => {
        const { service, ai } = makeService({ replies: [{ content: 'Sales were ৳100.' }] });

        const result = await service.chat(OWNER_CTX, 'how much did we sell?');

        expect(result.content).toBe('Sales were ৳100.');
        expect(result.toolCalls).toEqual([]);
        expect(ai.callOpenRouterWithTools).toHaveBeenCalledTimes(1);
    });

    it('runs a requested tool and feeds the result back for a second round-trip', async () => {
        const { service, ai, salesReports } = makeService({
            replies: [
                {
                    content: '',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'sales_summary', arguments: '{"from":"2026-06-01","to":"2026-06-30"}' },
                        },
                    ],
                },
                { content: 'You sold ৳100 in June.' },
            ],
        });

        const result = await service.chat(OWNER_CTX, 'june sales?');

        expect(salesReports.getSalesSummary).toHaveBeenCalledWith('tenant-1', {
            from: '2026-06-01',
            to: '2026-06-30',
            storeId: undefined,
        });
        expect(result.content).toBe('You sold ৳100 in June.');
        expect(result.toolCalls[0]).toMatchObject({ name: 'sales_summary' });
        // Second call carries the assistant tool_calls turn plus the tool result.
        const secondCallMessages = ai.callOpenRouterWithTools.mock.calls[1][1];
        expect(secondCallMessages.some((msg: any) => msg.role === 'tool')).toBe(true);
    });

    it('bills every model round-trip, not just the final one', async () => {
        const { service, ai } = makeService({
            replies: [
                {
                    content: '',
                    tool_calls: [
                        { id: 'c1', type: 'function', function: { name: 'sales_summary', arguments: '{"from":"a","to":"b"}' } },
                    ],
                },
                { content: 'done' },
            ],
        });

        const result = await service.chat(OWNER_CTX, 'june sales?');

        expect(ai.logUsage).toHaveBeenCalledTimes(2);
        expect(result.creditsUsed).toBe(4);
    });

    it('hands a failing tool back to the model as an error instead of failing the turn', async () => {
        const { service, salesReports } = makeService({
            replies: [
                {
                    content: '',
                    tool_calls: [
                        { id: 'c1', type: 'function', function: { name: 'sales_summary', arguments: '{"from":"a","to":"b"}' } },
                    ],
                },
                { content: 'Sorry, I could not read that report.' },
            ],
        });
        salesReports.getSalesSummary.mockRejectedValueOnce(new Error('db exploded'));

        const result = await service.chat(OWNER_CTX, 'june sales?');

        expect(result.content).toBe('Sorry, I could not read that report.');
        expect(result.toolCalls[0].error).toBe('db exploded');
    });

    it('records an unknown tool name without throwing', async () => {
        const { service } = makeService({
            replies: [
                {
                    content: '',
                    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'drop_table', arguments: '{}' } }],
                },
                { content: 'I cannot do that.' },
            ],
        });

        const result = await service.chat(OWNER_CTX, 'delete everything');

        expect(result.toolCalls[0].error).toBe('unknown tool');
    });

    it('stops at the round-trip cap and says so rather than looping forever', async () => {
        const { service, ai } = makeService({
            replies: [
                {
                    content: '',
                    tool_calls: [
                        { id: 'c1', type: 'function', function: { name: 'sales_summary', arguments: '{"from":"a","to":"b"}' } },
                    ],
                },
            ],
        });

        const result = await service.chat(OWNER_CTX, 'endless question');

        expect(ai.callOpenRouterWithTools).toHaveBeenCalledTimes(8);
        expect(result.truncated).toBe(true);
        expect(result.content).toMatch(/more lookups than I am allowed/);
        // The final round-trip withholds the tool list to force a text answer.
        expect(ai.callOpenRouterWithTools.mock.calls[7][2]).toEqual([]);
    });

    /**
     * Tools in one turn are independent read-only lookups, so they run
     * concurrently. The guarantee that matters is ordering: results must be
     * appended in the model's call order regardless of which resolved first,
     * or the stored trace no longer lines up with what was asked.
     */
    it('runs a turn\'s tool calls concurrently and keeps them in call order', async () => {
        const { service, salesReports } = makeService({
            replies: [
                {
                    content: '',
                    tool_calls: [
                        { id: 'c1', type: 'function', function: { name: 'sales_summary', arguments: '{"from":"2026-06-01","to":"2026-06-30"}' } },
                        { id: 'c2', type: 'function', function: { name: 'sales_summary', arguments: '{"from":"2026-05-01","to":"2026-05-31"}' } },
                    ],
                },
                { content: 'Compared.' },
            ],
        });

        let firstResolved: (value: unknown) => void = () => {};
        const gate = new Promise((resolve) => {
            firstResolved = resolve;
        });
        // The first call finishes only after the second one has started, which
        // cannot happen if the loop awaits them one at a time.
        salesReports.getSalesSummary
            .mockImplementationOnce(() => gate.then(() => ({ summary: emptySummary(), rows: [] })))
            .mockImplementationOnce(() => {
                firstResolved(null);
                return Promise.resolve({ summary: emptySummary(), rows: [] });
            });

        const result = await service.chat(OWNER_CTX, 'compare may and june');

        expect(result.toolCalls.map((c) => c.args.from)).toEqual(['2026-06-01', '2026-05-01']);
    });

    it('never replays tool results into a later question in the same thread', async () => {
        const { service, db, ai } = makeService();
        db.aiMessage.findMany.mockResolvedValueOnce([
            { role: 'assistant', content: 'Earlier answer' },
            { role: 'user', content: 'Earlier question' },
        ]);

        await service.chat(OWNER_CTX, 'follow-up', 'conv-1');

        const sentMessages = ai.callOpenRouterWithTools.mock.calls[0][1];
        expect(sentMessages.every((msg: any) => msg.role !== 'tool')).toBe(true);
        expect(db.aiMessage.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ select: { role: true, content: true } }),
        );
    });

    it('puts today\'s date and the branch list in the system prompt', async () => {
        const { service, ai } = makeService();

        await service.chat(OWNER_CTX, 'anything');

        const systemPrompt = ai.callOpenRouterWithTools.mock.calls[0][1][0].content;
        expect(systemPrompt).toMatch(/Today is \d{4}-\d{2}-\d{2}/);
        expect(systemPrompt).toContain('Gulshan (id: store-1)');
        expect(systemPrompt).toContain('Never state a number that did not come from a tool result');
    });
});
