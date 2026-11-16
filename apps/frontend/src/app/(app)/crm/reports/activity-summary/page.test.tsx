import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CrmActivitySummaryReportPage from './page';

const getCrmActivitySummaryReport = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getCrmActivitySummaryReport: (...args: unknown[]) => getCrmActivitySummaryReport(...args),
    },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { from: '2026-10-17', to: '2026-11-15', mine: false },
    channels: [
        { code: 'CALL', name: 'Call', total: 17 },
        { code: 'WHATSAPP', name: 'WhatsApp', total: 18 },
        { code: 'UNSPECIFIED', name: 'UNSPECIFIED', total: 2 },
    ],
    rows: [
        {
            user_id: 'u1', name: 'Karim Ahmed',
            counts: { CALL: 12, WHATSAPP: 8, UNSPECIFIED: 1 }, total: 21, share_pct: 56.8,
        },
        {
            user_id: null, name: null,
            counts: { CALL: 5, WHATSAPP: 10, UNSPECIFIED: 1 }, total: 16, share_pct: 43.2,
        },
    ],
    totals: { total: 37, unspecified: 2, counts: { CALL: 17, WHATSAPP: 18, UNSPECIFIED: 2 } },
    ...overrides,
});

beforeEach(() => {
    localStorage.clear();
    getCrmActivitySummaryReport.mockReset().mockResolvedValue(report());
});

describe('CRM activity summary report', () => {
    it('asks for the last 30 days with the mine scope off', async () => {
        render(<CrmActivitySummaryReportPage />);

        await waitFor(() => expect(getCrmActivitySummaryReport).toHaveBeenCalled());
        const first = getCrmActivitySummaryReport.mock.calls[0][0];
        expect(first.mine).toBe(false);
        expect(first.from).toBeTruthy();
        expect(first.to).toBeTruthy();
    });

    it('sends mine when the remembered toggle is on', async () => {
        localStorage.setItem('crm_mine_only', 'true');
        render(<CrmActivitySummaryReportPage />);

        await waitFor(() => expect(getCrmActivitySummaryReport).toHaveBeenCalled());
        expect(getCrmActivitySummaryReport.mock.calls[0][0].mine).toBe(true);
    });

    it('draws one row per person with a column per type and a total', async () => {
        render(<CrmActivitySummaryReportPage />);

        const row = await screen.findByRole('row', { name: /Karim Ahmed/ });
        const cell = (id: string) => row.querySelector(`[data-column-id="${id}"]`)?.textContent;
        expect(cell('user')).toBe('Karim Ahmed');
        expect(cell('CALL')).toBe('12');
        expect(cell('WHATSAPP')).toBe('8');
        expect(cell('total')).toBe('21');
    });

    it('labels the unassigned row', async () => {
        render(<CrmActivitySummaryReportPage />);

        expect(await screen.findByRole('cell', { name: 'Unassigned' })).toBeInTheDocument();
    });

    it('keeps a totals row under the people', async () => {
        render(<CrmActivitySummaryReportPage />);

        await screen.findByRole('row', { name: /Karim Ahmed/ });
        // The footer is the last row of the table; the header also carries "Total".
        const table = screen.getByRole('table');
        const footer = within(table).getAllByRole('row').at(-1)!;
        const cell = (id: string) => footer.querySelector(`[data-column-id="${id}"]`)?.textContent;
        expect(cell('CALL')).toBe('17');
        expect(cell('WHATSAPP')).toBe('18');
        expect(cell('total')).toBe('37');
    });

    it('explains activities that have no type', async () => {
        render(<CrmActivitySummaryReportPage />);

        expect(await screen.findByText(/2 completed activities have no type/)).toBeInTheDocument();
    });

    it('hides that note when every activity has a type', async () => {
        getCrmActivitySummaryReport.mockResolvedValue(report({
            totals: { total: 35, unspecified: 0, counts: { CALL: 17, WHATSAPP: 18 } },
        }));
        render(<CrmActivitySummaryReportPage />);

        await waitFor(() => expect(getCrmActivitySummaryReport).toHaveBeenCalled());
        expect(screen.queryByText(/have no type/)).not.toBeInTheDocument();
    });

    it('handles an empty period without crashing', async () => {
        getCrmActivitySummaryReport.mockResolvedValue(report({
            channels: [{ code: 'CALL', name: 'Call', total: 0 }],
            rows: [],
            totals: { total: 0, unspecified: 0, counts: { CALL: 0 } },
        }));
        render(<CrmActivitySummaryReportPage />);

        expect(await screen.findByText('No activities were completed in this period.')).toBeInTheDocument();
    });

    it('refetches when the period changes', async () => {
        render(<CrmActivitySummaryReportPage />);
        await waitFor(() => expect(getCrmActivitySummaryReport).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getAllByRole('button', { name: /^Period/ }).find((b) => b.getAttribute('aria-haspopup') === 'dialog')!);
        fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

        await waitFor(() => expect(getCrmActivitySummaryReport).toHaveBeenCalledTimes(2));
    });
});
