import { render, screen, waitFor } from '@testing-library/react';
import CrmContactCoveragePage from './page';

const getCrmContactCoverage = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));
jest.mock('@/lib/api', () => ({
    api: { getCrmContactCoverage: (...args: unknown[]) => getCrmContactCoverage(...args) },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    by_party: [
        { party: 'lead', total: 10, by_phone: 6, by_email: 4, by_both: 2, reachable: 8, unreachable: 2, reachable_pct: 80 },
        { party: 'customer', total: 20, by_phone: 18, by_email: 10, by_both: 9, reachable: 19, unreachable: 1, reachable_pct: 95 },
    ],
    by_source: [
        { source_id: 's1', name: 'Facebook', total: 6, reachable: 3, reachable_pct: 50 },
        { source_id: null, name: null, total: 4, reachable: 1, reachable_pct: 25 },
    ],
    totals: { total: 30, reachable: 27, unreachable: 3, reachable_pct: 90 },
    ...overrides,
});

beforeEach(() => getCrmContactCoverage.mockReset().mockResolvedValue(report()));

describe('CRM contact coverage report', () => {
    it('loads the coverage snapshot', async () => {
        render(<CrmContactCoveragePage />);

        await waitFor(() => expect(getCrmContactCoverage).toHaveBeenCalled());
    });

    it('shows reachability per party, not one blended figure', async () => {
        render(<CrmContactCoveragePage />);

        const leadRow = await screen.findByRole('row', { name: /Open leads/ });
        expect(leadRow.querySelector('[data-column-id="reachable_pct"]')?.textContent).toBe('80%');
        const customerRow = screen.getByRole('row', { name: /Customers/ });
        expect(customerRow.querySelector('[data-column-id="reachable_pct"]')?.textContent).toBe('95%');
    });

    it('names the source that brings unreachable leads', async () => {
        render(<CrmContactCoveragePage />);

        const row = await screen.findByRole('row', { name: /Facebook/ });
        expect(row.querySelector('[data-column-id="reachable_pct"]')?.textContent).toBe('50%');
        // Leads with no source are their own row.
        expect(screen.getByRole('row', { name: /Unspecified/ })).toBeInTheDocument();
    });

    it('shows a dash rather than 0% for an empty base', async () => {
        getCrmContactCoverage.mockResolvedValue(report({
            by_party: [{ party: 'lead', total: 0, by_phone: 0, by_email: 0, by_both: 0, reachable: 0, unreachable: 0, reachable_pct: null }],
            by_source: [],
            totals: { total: 0, reachable: 0, unreachable: 0, reachable_pct: null },
        }));
        render(<CrmContactCoveragePage />);

        const row = await screen.findByRole('row', { name: /Open leads/ });
        expect(row.querySelector('[data-column-id="reachable_pct"]')?.textContent).toBe('—');
    });
});
