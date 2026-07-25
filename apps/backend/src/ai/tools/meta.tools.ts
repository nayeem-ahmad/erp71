import { StorePermission } from '@erp71/shared-types';
import { DATE_RANGE_PROPS, money, page, PAGING_PROPS, resolveStoreId, STORE_PROP, type ChatTool } from './types';

const ENTITY_TYPES = [
    'product',
    'customer',
    'supplier',
    'branch',
    'warehouse',
    'category',
    'brand',
    'employee',
    'account',
] as const;

const DOCUMENT_TYPES = [
    'sale',
    'sales_return',
    'purchase',
    'purchase_return',
    'sales_order',
    'purchase_order',
    'quotation',
    'expense',
    'voucher',
] as const;

export const META_TOOLS: ChatTool[] = [
    {
        name: 'resolve_entity',
        // Deliberately the weakest permission in the system: this returns names
        // and ids the caller can already see in the product picker, and gating it
        // higher would leave lower-privileged users unable to filter the tools
        // they *are* allowed to run.
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        description:
            'Turn a name the user typed into the id other tools need. Search products, customers, suppliers, branches, ' +
            'warehouses, categories, brands, employees or ledger accounts. ' +
            'Call this FIRST whenever a question names something specific and you need to filter by it — ' +
            'never guess or invent an id.',
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ENTITY_TYPES, description: 'What kind of thing to look for.' },
                query: { type: 'string', description: 'The name, code or phone number the user mentioned.' },
            },
            required: ['type', 'query'],
        },
        handler: async (ctx, args, deps) => {
            const matches = await deps.data.resolveEntity(ctx.tenantId, args.type, String(args.query ?? ''), 10);
            if (matches.length === 0) {
                return {
                    matchCount: 0,
                    rows: [],
                    note: `Nothing of type "${args.type}" matched "${args.query}". Do not guess an id — tell the user it was not found.`,
                };
            }
            return {
                matchCount: matches.length,
                // Ambiguity is the model's to resolve with the user, not to
                // silently pick a winner for.
                ...(matches.length > 1 ? { note: 'More than one match — confirm which one the user meant if it changes the answer.' } : {}),
                rows: matches.map((m) => ({ id: m.id, name: m.label, detail: m.detail ?? null })),
            };
        },
    },

    {
        name: 'list_documents',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        description:
            'Individual documents rather than totals: invoices, sales returns, purchases, purchase returns, sales ' +
            'orders, purchase orders, quotations, expenses or vouchers. Each row has its number, date, party, amount ' +
            'and outstanding balance. Use to drill into an aggregate ("which invoices make up that due balance"), ' +
            'to look up one document by number, or for "show me the last N ...".',
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: DOCUMENT_TYPES, description: 'Which kind of document to list.' },
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                ...PAGING_PROPS,
                search: {
                    type: 'string',
                    description: 'Match a document number, reference or party name. Use when the user names one document.',
                },
            },
            required: ['type'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const rows = await deps.data.listDocuments(ctx.tenantId, {
                type: args.type,
                from: args.from,
                to: args.to,
                storeId,
                search: args.search,
                limit: 100,
            });
            const paged = page(rows as any[], args);
            return {
                ...(note ? { note } : {}),
                type: args.type,
                period: { from: args.from ?? null, to: args.to ?? null },
                totalRows: paged.totalRows,
                returned: paged.returned,
                offset: paged.offset,
                hasMore: paged.hasMore,
                truncated: paged.truncated,
                fetchLimitNote:
                    rows.length >= 100
                        ? 'This query hit its 100-document fetch limit — narrow the date range for a complete list.'
                        : null,
                rows: paged.rows.map((r: any) => ({
                    number: r.number,
                    date: r.date,
                    party: r.party,
                    branch: r.branch,
                    amount: money(r.amount),
                    ...(r.outstanding === undefined ? {} : { outstanding: money(r.outstanding) }),
                    ...(r.status === undefined ? {} : { status: r.status }),
                    ...(r.dueDate === undefined ? {} : { dueDate: r.dueDate }),
                    ...(r.note === undefined ? {} : { note: r.note }),
                })),
            };
        },
    },

    {
        name: 'describe_capabilities',
        // Everyone who can reach the chatbot at all can ask what it can see.
        permission: StorePermission.VIEW_PRODUCT_CATALOG,
        description:
            'What data this business actually has: how far back sales, purchases and accounting records go, how many ' +
            'products, customers, suppliers, employees and branches exist, and which tools you have available. ' +
            'Use when the user asks what you can do, when a question might fall outside the data, or before ' +
            'reporting an empty result — an empty period and an empty database need different answers.',
        parameters: { type: 'object', properties: {} },
        handler: async (ctx, _args, deps) => {
            const coverage = await deps.data.getDataCoverage(ctx.tenantId);
            return {
                branches: ctx.stores.map((s) => s.name),
                dataCoverage: coverage,
                guidance:
                    'If a requested period falls entirely outside these date ranges, say so plainly instead of ' +
                    'reporting zero as though it were a real figure.',
            };
        },
    },
];
