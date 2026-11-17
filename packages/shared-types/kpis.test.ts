import {
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

    it('describes a planned KPI by the phase and data gap that unlock it', () => {
        expect(unavailableKpiResult('churn_rate', KpiAudience.PLATFORM)).toMatchObject({
            status: 'planned',
            phase: 2,
            needs: 'mrr_history',
            value: null,
        });
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
