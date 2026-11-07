'use client';

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ConsolidatedReportPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getConsolidatedReport: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    ...jest.requireActual('@/lib/format'),
    formatBDT: (n: number) => `৳${n}`,
    formatDate: (d: string) => d,
}));

// A wide screen, so the chips sit in the toolbar and every column is drawn.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

/** A toolbar chip: a button that opens its own panel. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

/** The figure beside a label in the summary strip. */
function stat(label: string): string {
    const strip = screen.getByRole('region', { name: 'Consolidated summary' });
    return within(strip).getByText(label).nextElementSibling?.textContent ?? '';
}

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/sales/reports/consolidated',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
    useParams: () => ({}),
}));

const mockReport = {
    period: { from: '2026-05-12', to: '2026-06-11' },
    overall: {
        revenue: 150000,
        transactions: 320,
        avg_order: 468.75,
        top_product: 'Widget A',
    },
    by_store: [
        {
            store_id: 'store1',
            store_name: 'Main Store',
            revenue: 90000,
            transactions: 200,
            avg_order: 450,
            revenue_share: 60,
        },
        {
            store_id: 'store2',
            store_name: 'Branch Store',
            revenue: 60000,
            transactions: 120,
            avg_order: 500,
            revenue_share: 40,
        },
    ],
};

const emptyReport = {
    period: { from: '2026-05-12', to: '2026-06-11' },
    overall: {
        revenue: 0,
        transactions: 0,
        avg_order: 0,
        top_product: null,
    },
    by_store: [],
};

describe('ConsolidatedReportPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(emptyReport);
    });

    it('renders the page heading', async () => {
        render(<ConsolidatedReportPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Consolidated Report' })).toBeInTheDocument();
    });

    it('renders the page description', async () => {
        render(<ConsolidatedReportPage />);
        await waitFor(() => {
            expect(
                screen.getByText('Cross-branch revenue and transaction overview'),
            ).toBeInTheDocument();
        });
    });

    it('calls getConsolidatedReport on mount with the last 30 days', async () => {
        const { api } = require('@/lib/api');
        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(api.getConsolidatedReport).toHaveBeenCalledTimes(1);
        });
        const [{ from, to }] = api.getConsolidatedReport.mock.calls[0];
        expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(29);
    });

    it('reloads when a period preset is picked from the toolbar', async () => {
        const { api } = require('@/lib/api');
        render(<ConsolidatedReportPage />);
        await waitFor(() => expect(api.getConsolidatedReport).toHaveBeenCalledTimes(1));

        fireEvent.click(chip(/^Period/));
        fireEvent.click(screen.getByRole('button', { name: 'This year' }));

        await waitFor(() => expect(api.getConsolidatedReport).toHaveBeenCalledTimes(2));
        expect(api.getConsolidatedReport).toHaveBeenLastCalledWith(
            expect.objectContaining({ from: expect.stringMatching(/-01-01$/) }),
        );
    });

    it('has no date boxes or Generate button of its own any more', async () => {
        render(<ConsolidatedReportPage />);
        await waitFor(() => expect(chip(/^Period/)).toBeInTheDocument());

        expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
        expect(screen.queryByText('From')).not.toBeInTheDocument();
    });

    it('shows the overall figures in the summary strip', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => expect(stat('Total Revenue')).toBe('৳150000'));
        expect(stat('Total Transactions')).toBe('320');
        expect(stat('Avg Order Value')).toBe('৳468.75');
        expect(stat('Branches')).toBe('2');
        expect(stat('Top Product')).toBe('Widget A');
    });

    it('displays a dash for top product when null', async () => {
        render(<ConsolidatedReportPage />);

        await waitFor(() => expect(stat('Top Product')).toBe('—'));
    });

    it('lists every store with its share and a total row', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Main Store')).toBeInTheDocument();
            expect(screen.getByText('Branch Store')).toBeInTheDocument();
        });
        expect(screen.getByText('60.0%')).toBeInTheDocument();
        expect(screen.getByText('40.0%')).toBeInTheDocument();
        expect(screen.getByText('200')).toBeInTheDocument();
        const footer = screen.getAllByRole('rowgroup').find((group) => group.tagName === 'TFOOT')!;
        expect(footer).toHaveTextContent('Total');
        expect(footer).toHaveTextContent('৳150000');
        expect(footer).toHaveTextContent('100.0%');
    });

    it('narrows to the branches picked, and the strip and total row follow', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockResolvedValue(mockReport);

        render(<ConsolidatedReportPage />);
        await screen.findByText('Branch Store');

        fireEvent.click(chip('Branch'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Branch Store' }));

        const body = () => screen.getAllByRole('rowgroup').find((group) => group.tagName === 'TBODY')!;
        await waitFor(() => expect(body()).not.toHaveTextContent('Main Store'));
        expect(body()).toHaveTextContent('Branch Store');
        expect(stat('Total Revenue')).toBe('৳60000');
        expect(stat('Branches')).toBe('1');
        expect(stat('Avg Order Value')).toBe('৳500');
    });

    it('shows the empty state when by_store is empty', async () => {
        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('No sales data found')).toBeInTheDocument();
        });
    });

    it('shows an error message when the API call fails', async () => {
        const { api } = require('@/lib/api');
        api.getConsolidatedReport.mockRejectedValue(new Error('Server unavailable'));

        render(<ConsolidatedReportPage />);

        await waitFor(() => {
            expect(screen.getByText('Server unavailable')).toBeInTheDocument();
        });
    });
});
