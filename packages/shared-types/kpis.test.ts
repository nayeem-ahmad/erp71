import {
    resolveKpiAccountClass,
    KPI_DEFINITIONS,
    KPI_IDS,
    KpiAudience,
    kpiChange,
    kpiDefinitionsFor,
    unavailableKpiResult,
} from './kpis';

describe('KPI definitions', () => {
    it('lists every id once, numbered 1 to 18 in order', () => {
        expect(KPI_DEFINITIONS.map((d) => d.id)).toEqual([...KPI_IDS]);
        expect(KPI_DEFINITIONS.map((d) => d.number)).toEqual(KPI_IDS.map((_, i) => i + 1));
    });

    it('drops the SaaS-only KPIs for tenants but keeps all of them for the platform', () => {
        const tenantIds = kpiDefinitionsFor(KpiAudience.TENANT).map((d) => d.id);
        expect(tenantIds).not.toContain('burn_multiple');
        expect(tenantIds).not.toContain('quick_ratio');
        expect(kpiDefinitionsFor(KpiAudience.PLATFORM)).toHaveLength(18);
    });

    it('has every KPI live for the platform, and only the SaaS-only two not applicable to a shop', () => {
        expect(KPI_DEFINITIONS.every((d) => d.availability.platform.kind === 'live')).toBe(true);
        expect(KPI_DEFINITIONS.filter((d) => d.availability.tenant.kind !== 'live').map((d) => d.id))
            .toEqual(['burn_multiple', 'quick_ratio']);
        expect(unavailableKpiResult('burn_multiple', KpiAudience.TENANT).status).toBe('not_applicable');
    });
});

describe('kpiChange', () => {
    const margin = { unit: 'percent' as const, higherIsBetter: true };
    const churn = { unit: 'percent' as const, higherIsBetter: false };
    const cash = { unit: 'money' as const, higherIsBetter: true };

    it('moves percentages by points', () => {
        expect(kpiChange(margin, 25, 20)).toEqual({ kind: 'points', amount: 5, improved: true });
    });

    it('treats a rise as bad news when lower is better', () => {
        expect(kpiChange(churn, 8, 5)).toEqual({ kind: 'points', amount: 3, improved: false });
    });

    it('moves everything else by its relative change, measured against the size of the old value', () => {
        expect(kpiChange(cash, 12000, 10000)).toEqual({ kind: 'relative', amount: 20, improved: true });
        // From -10k to -5k is an improvement of half the old loss.
        expect(kpiChange(cash, -5000, -10000)).toEqual({ kind: 'relative', amount: 50, improved: true });
    });

    it('has nothing to say without both values, or a relative change from zero', () => {
        expect(kpiChange(cash, 100, null)).toBeNull();
        expect(kpiChange(cash, 100, 0)).toBeNull();
        expect(kpiChange(margin, 20, 20)).toEqual({ kind: 'points', amount: 0, improved: null });
    });
});

describe('resolveKpiAccountClass', () => {
    const expense = (name: string, extra: Record<string, string | null> = {}) => ({ type: 'expense', name, ...extra });

    it('guesses from the account name', () => {
        expect(resolveKpiAccountClass(expense('Depreciation Expense'))).toBe('depreciation');
        expect(resolveKpiAccountClass(expense('Loan Interest'))).toBe('interest');
        expect(resolveKpiAccountClass(expense('Income Tax'))).toBe('tax');
        expect(resolveKpiAccountClass(expense('Facebook Advertising'))).toBe('sales_marketing');
        expect(resolveKpiAccountClass(expense('Rent'))).toBeNull();
    });

    it('falls back to the subgroup and group, as the default charts are laid out', () => {
        expect(resolveKpiAccountClass(expense('Purchases', { subgroupName: 'Cost of Sales', groupName: 'Operating Expenses' }))).toBe('cost_of_sales');
        expect(resolveKpiAccountClass(expense('Server & Hosting', { subgroupName: 'Hosting & Services', groupName: 'Infrastructure & Platform Costs' }))).toBe('cost_of_sales');
        expect(resolveKpiAccountClass(expense('Referral Commission', { subgroupName: 'Sales & Marketing' }))).toBe('sales_marketing');
    });

    it('lets a class set by hand win, and operating switch the guess off', () => {
        expect(resolveKpiAccountClass(expense('Rent', { kpiClass: 'cost_of_sales' }))).toBe('cost_of_sales');
        expect(resolveKpiAccountClass(expense('Depreciation Expense', { kpiClass: 'operating' }))).toBeNull();
    });

    it('never classifies an account that is not an expense', () => {
        expect(resolveKpiAccountClass({ type: 'asset', name: 'Accumulated Depreciation' })).toBeNull();
    });
});
