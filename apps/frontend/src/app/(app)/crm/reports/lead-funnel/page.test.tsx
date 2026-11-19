import { render, screen, waitFor } from '@testing-library/react';
import CrmLeadFunnelPage from './page';

const getCrmLeadFunnel = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));
jest.mock('@/lib/api', () => ({
    api: { getCrmLeadFunnel: (...args: unknown[]) => getCrmLeadFunnel(...args) },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    months: ['2026-10', '2026-11'],
    rows: [
        { month: '2026-10', arrived: 10, new: 2, contacted: 3, qualified: 1, converted: 3, lost: 1, open: 6, conversion_pct: 30 },
        { month: '2026-11', arrived: 4, new: 1, contacted: 1, qualified: 0, converted: 2, lost: 0, open: 2, conversion_pct: 50 },
    ],
    totals: { arrived: 14, converted: 5, lost: 1, open: 8, conversion_pct: 35.7 },
    ...overrides,
});

beforeEach(() => getCrmLeadFunnel.mockReset().mockResolvedValue(report()));

describe('CRM lead funnel report', () => {
    it('asks for the window', async () => {
        render(<CrmLeadFunnelPage />);

        await waitFor(() => expect(getCrmLeadFunnel).toHaveBeenCalled());
    });

    it('draws a row per arrival month with the whole cohort counted', async () => {
        render(<CrmLeadFunnelPage />);

        const row = await screen.findByRole('row', { name: /2026-10/ });
        const cell = (id: string) => row.querySelector(`[data-column-id="${id}"]`)?.textContent;
        expect(cell('arrived')).toBe('10');
        expect(cell('converted')).toBe('3');
        expect(cell('lost')).toBe('1');
        expect(cell('open')).toBe('6');
        expect(cell('conversion_pct')).toBe('30%');
    });

    it('shows a dash for a month with no arrivals', async () => {
        getCrmLeadFunnel.mockResolvedValue(report({
            rows: [{ month: '2026-11', arrived: 0, new: 0, contacted: 0, qualified: 0, converted: 0, lost: 0, open: 0, conversion_pct: null }],
            totals: { arrived: 0, converted: 0, lost: 0, open: 0, conversion_pct: null },
        }));
        render(<CrmLeadFunnelPage />);

        const row = await screen.findByRole('row', { name: /2026-11/ });
        expect(row.querySelector('[data-column-id="conversion_pct"]')?.textContent).toBe('—');
    });

    it('explains that a lead shows only its current stage', async () => {
        render(<CrmLeadFunnelPage />);

        expect(await screen.findByText(/current stage only/)).toBeInTheDocument();
    });

    it('handles a window with no arrivals', async () => {
        getCrmLeadFunnel.mockResolvedValue(report({
            rows: [],
            totals: { arrived: 0, converted: 0, lost: 0, open: 0, conversion_pct: null },
        }));
        render(<CrmLeadFunnelPage />);

        expect(await screen.findByText('No leads arrived in this period.')).toBeInTheDocument();
    });
});
