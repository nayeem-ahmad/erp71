import { StorePermission } from '@erp71/shared-types';
import { DATE_RANGE_PROPS, money, page, PAGING_PROPS, pct, resolveStoreId, STORE_PROP, type ChatTool } from './types';

/** Caps how many ledger groups a statement hands back per section. */
const MAX_STATEMENT_GROUPS = 12;

export const FINANCE_TOOLS: ChatTool[] = [
    {
        name: 'expense_summary',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['retail', 'accounting'],
        description:
            "Total business expenses for a date range, broken down by category with each category's share of spend. " +
            'Use for "what did we spend", cost and overhead questions.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS, ...STORE_PROP, ...PAGING_PROPS },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result: any = await deps.expenses.getSummary(ctx.tenantId, {
                from: args.from,
                to: args.to,
                storeId,
            });
            const paged = page(result.byCategory ?? [], args);
            return {
                ...(note ? { note } : {}),
                period: { from: args.from, to: args.to },
                totalExpenses: money(result.total),
                ...paged,
                rows: paged.rows.map((r: any) => ({
                    category: r.name,
                    amount: money(r.amount),
                    sharePct: pct(r.sharePct),
                })),
            };
        },
    },

    {
        name: 'financial_statement',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['accounting'],
        description:
            'A statutory accounting statement from the general ledger: profit_loss, balance_sheet, cash_flow, ' +
            'trial_balance or ratios. Use for "what is my profit", "what is the business worth", "where did the cash go", ' +
            '"is my ledger balanced", "what is my current ratio". These come from posted vouchers, so they can differ ' +
            'from the sales reports, which come from invoices — say which one an answer used.',
        parameters: {
            type: 'object',
            properties: {
                statement: {
                    type: 'string',
                    enum: ['profit_loss', 'balance_sheet', 'cash_flow', 'trial_balance', 'ratios'],
                    description: 'Which statement to produce.',
                },
                ...DATE_RANGE_PROPS,
                ...STORE_PROP,
                asOfDate: {
                    type: 'string',
                    description:
                        'Point-in-time date (YYYY-MM-DD) for balance_sheet, trial_balance and ratios. Defaults to today.',
                },
            },
            required: ['statement'],
        },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const scoped = storeId ? { storeId } : {};
            const consolidated = Boolean(ctx.hasConsolidatedAccess);

            switch (args.statement) {
                case 'balance_sheet': {
                    const result: any = await deps.accounting.getBalanceSheet(
                        ctx.tenantId,
                        { asOfDate: args.asOfDate, ...scoped },
                        consolidated,
                    );
                    return {
                        ...(note ? { note } : {}),
                        statement: 'balance_sheet',
                        asOf: result.as_of,
                        totalAssets: money(result.assets?.total),
                        totalLiabilities: money(result.liabilities?.total),
                        totalEquity: money(result.equity?.total),
                        netProfit: money(result.equity?.net_profit),
                        isBalanced: result.is_balanced,
                        assets: projectGroups(result.assets?.groups),
                        liabilities: projectGroups(result.liabilities?.groups),
                        equity: projectGroups(result.equity?.groups),
                    };
                }
                case 'cash_flow': {
                    const result: any = await deps.accounting.getCashFlow(ctx.tenantId, {
                        from: args.from,
                        to: args.to,
                    });
                    return {
                        ...(note ? { note } : {}),
                        statement: 'cash_flow',
                        period: result.filters,
                        operatingNet: money(result.operating?.net),
                        investingNet: money(result.investing?.net),
                        financingNet: money(result.financing?.net),
                        netChangeInCash: money(result.net_change_in_cash),
                        openingCash: money(result.opening_cash_balance),
                        closingCash: money(result.closing_cash_balance),
                        note: result.note,
                        topOperatingLines: (result.operating?.activities ?? [])
                            .slice(0, MAX_STATEMENT_GROUPS)
                            .map((a: any) => ({ account: a.name, netChange: money(a.net_change) })),
                    };
                }
                case 'trial_balance': {
                    const result: any = await deps.accounting.getTrialBalance(
                        ctx.tenantId,
                        { asOfDate: args.asOfDate, ...scoped },
                        consolidated,
                    );
                    const rows = result.rows ?? result.accounts ?? [];
                    return {
                        ...(note ? { note } : {}),
                        statement: 'trial_balance',
                        asOf: result.as_of,
                        totalDebit: money(result.totals?.debit),
                        totalCredit: money(result.totals?.credit),
                        isBalanced: result.is_balanced ?? null,
                        accountCount: rows.length,
                        rows: rows.slice(0, MAX_STATEMENT_GROUPS).map((r: any) => ({
                            account: r.name ?? r.account?.name,
                            debit: money(r.debit),
                            credit: money(r.credit),
                        })),
                    };
                }
                case 'ratios': {
                    const result: any = await deps.accounting.getFinancialRatios(ctx.tenantId, {
                        asOfDate: args.asOfDate,
                        from: args.from,
                        to: args.to,
                    });
                    return {
                        ...(note ? { note } : {}),
                        statement: 'ratios',
                        asOf: result.as_of,
                        period: result.period,
                        currentRatio: result.ratios?.current_ratio,
                        netProfitMarginPct: pct(result.ratios?.net_profit_margin_pct),
                        dsoDays: result.ratios?.dso_days,
                        dpoDays: result.ratios?.dpo_days,
                        revenue: money(result.ratios?.revenue),
                        totalExpenses: money(result.ratios?.total_expenses),
                        netProfit: money(result.ratios?.net_profit),
                        totalAssets: money(result.ratios?.total_assets),
                        totalLiabilities: money(result.ratios?.total_liabilities),
                    };
                }
                default: {
                    const result: any = await deps.accounting.getProfitLoss(
                        ctx.tenantId,
                        { from: args.from, to: args.to, ...scoped },
                        consolidated,
                    );
                    return {
                        ...(note ? { note } : {}),
                        statement: 'profit_loss',
                        period: result.filters,
                        totalRevenue: money(result.revenue?.total),
                        totalExpenses: money(result.expenses?.total),
                        netProfit: money(result.net_profit),
                        netMarginPct:
                            Number(result.revenue?.total) > 0
                                ? pct((Number(result.net_profit) / Number(result.revenue.total)) * 100)
                                : null,
                        revenue: projectGroups(result.revenue?.groups),
                        expenses: projectGroups(result.expenses?.groups),
                    };
                }
            }
        },
    },

    {
        name: 'budget_vs_actual',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['accounting'],
        description:
            'Budgeted versus actual amounts per account for a fiscal year (optionally one month), with the variance. ' +
            'Use for "are we on budget", "where did we overspend", budget variance questions. ' +
            'Returns nothing useful if no budget has been set up.',
        parameters: {
            type: 'object',
            properties: {
                fiscalYear: { type: 'number', description: 'The fiscal year, e.g. 2026.' },
                month: { type: 'number', description: 'Optional month 1-12. Omit for the whole year.' },
                ...PAGING_PROPS,
            },
            required: ['fiscalYear'],
        },
        handler: async (ctx, args, deps) => {
            const result: any = await deps.accounting.getBudgetVsActual(ctx.tenantId, {
                fiscalYear: Number(args.fiscalYear),
                month: args.month === undefined ? undefined : Number(args.month),
            });
            const rows = result.rows ?? [];
            if (rows.length === 0) {
                return {
                    fiscalYear: result.fiscal_year,
                    month: result.month,
                    rows: [],
                    note: 'No budget has been set for this period, so there is nothing to compare actuals against.',
                };
            }
            // Worst overspend first — the variance nobody set a budget to discover.
            const paged = page([...rows].sort((a: any, b: any) => a.variance - b.variance), args);
            return {
                fiscalYear: result.fiscal_year,
                month: result.month,
                totalBudget: money(result.totals?.budget),
                totalActual: money(result.totals?.actual),
                totalVariance: money(result.totals?.variance),
                ...paged,
                rows: paged.rows.map((r: any) => ({
                    account: r.account?.name ?? r.name,
                    budget: money(r.budget),
                    actual: money(r.actual),
                    variance: money(r.variance),
                })),
            };
        },
    },

    {
        name: 'vat_tax_summary',
        permission: StorePermission.VIEW_FINANCIAL_REPORTS,
        modules: ['accounting'],
        description:
            'VAT and tax collected and paid over a date range, from the ledger. Use for "how much VAT do we owe", ' +
            'tax filing and return questions.',
        parameters: {
            type: 'object',
            properties: { ...DATE_RANGE_PROPS },
            required: ['from', 'to'],
        },
        handler: async (ctx, args, deps) => {
            const result: any = await deps.accounting.getVatTaxReport(ctx.tenantId, { from: args.from, to: args.to });
            return {
                period: { from: args.from, to: args.to },
                ...result,
            };
        },
    },

    {
        name: 'cash_position',
        permission: StorePermission.VIEW_LEDGER,
        modules: ['accounting', 'retail'],
        description:
            'Cash and bank balances right now, per account, plus any cashier session still open. Use for ' +
            '"how much cash do we have", "what is in the bank", "is anyone\'s till still open". ' +
            'Balances come from posted vouchers, so unposted transactions are not reflected.',
        parameters: { type: 'object', properties: { ...STORE_PROP } },
        handler: async (ctx, args, deps) => {
            const { storeId, note } = resolveStoreId(ctx, args.storeId);
            const result = await deps.data.getCashPosition(ctx.tenantId, storeId);
            return {
                ...(note ? { note } : {}),
                totalCash: money(result.totals.cash),
                totalBank: money(result.totals.bank),
                totalLiquid: money(result.totals.all),
                accounts: result.accounts.slice(0, MAX_STATEMENT_GROUPS).map((a) => ({
                    account: a.name,
                    kind: a.kind,
                    balance: money(a.balance),
                })),
                openCashierSessions: result.openCashierSessions,
            };
        },
    },
];

/** Statement sections carry every account; the model only needs the groups. */
function projectGroups(groups: any[] | undefined) {
    return (groups ?? []).slice(0, MAX_STATEMENT_GROUPS).map((g: any) => ({
        group: g.group?.name ?? g.name,
        total: money(g.total),
    }));
}
