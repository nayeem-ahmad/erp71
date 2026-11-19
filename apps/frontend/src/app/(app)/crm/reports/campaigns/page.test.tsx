import { render, screen, waitFor, within } from '@testing-library/react';
import CrmCampaignPerformancePage from './page';

const getCrmCampaignPerformance = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));
jest.mock('@/lib/api', () => ({
    api: { getCrmCampaignPerformance: (...args: unknown[]) => getCrmCampaignPerformance(...args) },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { from: '2026-10-17', to: '2026-11-15', mine: false },
    rows: [
        { campaign_id: 'c1', name: 'Eid offer', channel: 'SMS', status: 'SENT', sent_at: '2026-11-10T10:00:00Z', recipients: 200, delivered: 190, failed: 10, delivery_pct: 95, orders: 12, revenue: 5000, conversion_pct: 6.3, revenue_per_order: 416.67 },
    ],
    by_channel: [{ channel: 'SMS', campaigns: 1, recipients: 200, delivered: 190, orders: 12, revenue: 5000 }],
    totals: { campaigns: 1, recipients: 200, delivered: 190, failed: 10, orders: 12, revenue: 5000, delivery_pct: 95, conversion_pct: 6.3 },
    ...overrides,
});

beforeEach(() => getCrmCampaignPerformance.mockReset().mockResolvedValue(report()));

describe('CRM campaign performance report', () => {
    it('asks for the last 30 days', async () => {
        render(<CrmCampaignPerformancePage />);

        await waitFor(() => expect(getCrmCampaignPerformance).toHaveBeenCalled());
        expect(getCrmCampaignPerformance.mock.calls[0][0].from).toBeTruthy();
    });

    it('shows delivery and revenue per campaign', async () => {
        render(<CrmCampaignPerformancePage />);

        const row = await screen.findByRole('row', { name: /Eid offer/ });
        const cell = (id: string) => row.querySelector(`[data-column-id="${id}"]`)?.textContent;
        expect(cell('deliveryPct')).toBe('95%');
        expect(cell('conversionPct')).toBe('6.3%');
        expect(cell('revenue')).toBe('৳\u00a05,000.00');
    });

    it('shows a dash where a campaign had no recipients', async () => {
        getCrmCampaignPerformance.mockResolvedValue(report({
            rows: [{ ...report().rows[0], recipients: 0, delivered: 0, delivery_pct: null, conversion_pct: null }],
        }));
        render(<CrmCampaignPerformancePage />);

        const row = await screen.findByRole('row', { name: /Eid offer/ });
        expect(row.querySelector('[data-column-id="deliveryPct"]')?.textContent).toBe('—');
    });

    it('handles a period with no campaigns', async () => {
        getCrmCampaignPerformance.mockResolvedValue(report({ rows: [], by_channel: [], totals: { campaigns: 0, recipients: 0, delivered: 0, failed: 0, orders: 0, revenue: 0, delivery_pct: null, conversion_pct: null } }));
        render(<CrmCampaignPerformancePage />);

        expect(await screen.findByText('No campaigns were sent in this period.')).toBeInTheDocument();
    });
});
