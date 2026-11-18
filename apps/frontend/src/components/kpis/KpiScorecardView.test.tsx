import { render, screen, waitFor, within } from '@testing-library/react';
import { KPI_DEFINITIONS, KpiAudience, unavailableKpiResult, type KpiResult, type KpiScorecard } from '@erp71/shared-types';
import KpiScorecardView, { kpiPeriodRange } from './KpiScorecardView';

const ok = (id: KpiResult['id'], value: number | null, previous: number | null = null, extra: Partial<KpiResult> = {}): KpiResult => ({
    id, status: 'ok', value, previous, basis: {}, notes: [], ...extra,
});

function scorecard(overrides: Partial<Record<KpiResult['id'], KpiResult>> = {}): KpiScorecard {
    return {
        audience: KpiAudience.TENANT,
        period: { from: '2026-11-01', to: '2026-11-17' },
        previousPeriod: { from: '2026-10-15', to: '2026-10-31' },
        storeId: null,
        unpostedVouchers: 0,
        generatedAt: '2026-11-17T10:00:00Z',
        kpis: KPI_DEFINITIONS.map((d) => overrides[d.id] ?? (
            d.availability.tenant.kind === 'live'
                ? { id: d.id, status: 'no_data', value: null, previous: null, basis: {}, notes: [] }
                : unavailableKpiResult(d.id, KpiAudience.TENANT)
        )),
    };
}

function renderView(card: KpiScorecard) {
    const load = jest.fn().mockResolvedValue(card);
    render(
        <KpiScorecardView
            audience={KpiAudience.TENANT}
            title="Business scorecard"
            subtitle="sub"
            breadcrumbs={[]}
            load={load}
        />,
    );
    return load;
}

describe('kpiPeriodRange', () => {
    it('turns presets into calendar days ending today', () => {
        expect(kpiPeriodRange('thisMonth', '2026-11-17')).toEqual({ from: '2026-11-01', to: '2026-11-17' });
        expect(kpiPeriodRange('lastMonth', '2026-11-17')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
        expect(kpiPeriodRange('lastMonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
        expect(kpiPeriodRange('last3Months', '2026-11-17')).toEqual({ from: '2026-09-01', to: '2026-11-17' });
        expect(kpiPeriodRange('last12Months', '2026-11-17')).toEqual({ from: '2025-12-01', to: '2026-11-17' });
        expect(kpiPeriodRange('thisYear', '2026-11-17')).toEqual({ from: '2026-01-01', to: '2026-11-17' });
    });
});

describe('KpiScorecardView', () => {
    it('shows measured KPIs with their change, and colours a worse change red', async () => {
        renderView(scorecard({
            gross_margin: ok('gross_margin', 32.5, 30),
            churn_rate: ok('churn_rate', 12, 8),
        }));

        const margin = await screen.findByTestId('kpi-gross_margin');
        expect(within(margin).getByText('32.5%')).toBeInTheDocument();
        expect(within(margin).getByText(/\+2\.5 pts/)).toHaveClass('text-emerald-700');

        const churn = screen.getByTestId('kpi-churn_rate');
        expect(within(churn).getByText(/\+4 pts/)).toHaveClass('text-red-700');
    });

    it('formats money in BDT and says cash-positive instead of a runway figure', async () => {
        renderView(scorecard({
            operating_cash_flow: ok('operating_cash_flow', 125000),
            cash_runway: ok('cash_runway', null, null, { notes: ['ledger_based', 'cash_positive'] }),
        }));

        const ocf = await screen.findByTestId('kpi-operating_cash_flow');
        expect(ocf.textContent).toContain('৳');
        expect(within(screen.getByTestId('kpi-cash_runway')).getByText('Cash-positive')).toBeInTheDocument();
    });

    it('has nothing coming soon any more, and leaves out the KPIs that do not apply to a shop', async () => {
        renderView(scorecard());

        expect(await screen.findByTestId('kpi-net_promoter_score')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Coming soon' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('kpi-burn_multiple')).not.toBeInTheDocument();
        expect(screen.queryByTestId('kpi-quick_ratio')).not.toBeInTheDocument();
    });

    it('says the platform is not burning cash instead of a burn multiple', async () => {
        const load = jest.fn().mockResolvedValue({
            ...scorecard(),
            audience: KpiAudience.PLATFORM,
            kpis: KPI_DEFINITIONS.map((d) => (d.id === 'burn_multiple'
                ? ok('burn_multiple', null, null, { notes: ['ledger_based', 'subscription_mrr', 'not_burning'] })
                : unavailableKpiResult(d.id, KpiAudience.PLATFORM))),
        });
        render(<KpiScorecardView audience={KpiAudience.PLATFORM} title="t" subtitle="s" breadcrumbs={[]} load={load} />);

        const burn = await screen.findByTestId('kpi-burn_multiple');
        expect(within(burn).getByText('Not burning cash')).toBeInTheDocument();
        expect(within(burn).getByText(/Cash grew over the period/)).toBeInTheDocument();
    });

    it('warns when vouchers awaiting approval are left out of the books', async () => {
        renderView({ ...scorecard(), unpostedVouchers: 3 });
        expect(await screen.findByText(/3 vouchers are waiting for approval/)).toBeInTheDocument();
    });

    it('asks for this month first', async () => {
        const load = renderView(scorecard());
        await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
        const { from } = load.mock.calls[0][0];
        expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    });
});
