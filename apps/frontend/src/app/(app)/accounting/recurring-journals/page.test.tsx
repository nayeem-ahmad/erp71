import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import RecurringJournalsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        listRecurringJournals: jest.fn(),
        createRecurringJournal: jest.fn(),
        postRecurringJournal: jest.fn(),
        getAccounts: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
    ...jest.requireActual('@/lib/format'),
    formatBDT: (v: number) => `৳${v}`,
    formatDate: (v: string) => v,
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// A wide screen, so the chips sit in the toolbar rather than the phone's Filters sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/accounting/recurring-journals'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({})),
}));

const mockTemplates = [
    {
        id: 'rj-1',
        name: 'Monthly Rent',
        description: 'Rent payment',
        frequency: 'MONTHLY',
        next_due_date: '2026-07-01',
        last_run_date: '2026-06-01',
        is_active: true,
        lines: [
            { account: { name: 'Rent Expense' }, debit_amount: 5000, credit_amount: 0 },
            { account: { name: 'Cash' }, debit_amount: 0, credit_amount: 5000 },
        ],
    },
    {
        id: 'rj-2',
        name: 'Weekly Payroll',
        description: 'Staff wages',
        frequency: 'WEEKLY',
        next_due_date: '2026-06-15',
        last_run_date: null,
        is_active: true,
        lines: [],
    },
];

const mockAccounts = [
    { id: 'acc-1', name: 'Cash', code: '1001' },
    { id: 'acc-2', name: 'Rent Expense', code: '6001' },
];

function getApi() {
    return require('@/lib/api').api;
}

describe('RecurringJournalsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const api = getApi();
        api.listRecurringJournals.mockResolvedValue([]);
        api.getAccounts.mockResolvedValue(mockAccounts);
        api.createRecurringJournal.mockResolvedValue({ id: 'rj-new' });
        api.postRecurringJournal.mockResolvedValue({ message: 'Journal posted.' });
    });

    it('renders the page heading', async () => {
        render(<RecurringJournalsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /recurring journals/i })).toBeInTheDocument();
        });
    });

    it('calls listRecurringJournals on mount', async () => {
        const api = getApi();
        render(<RecurringJournalsPage />);
        await waitFor(() => {
            expect(api.listRecurringJournals).toHaveBeenCalledTimes(1);
        });
    });

    it('shows empty state when no templates', async () => {
        render(<RecurringJournalsPage />);
        await waitFor(() => {
            expect(screen.getByText(/no recurring journals/i)).toBeInTheDocument();
        });
    });

    it('shows templates list after loading', async () => {
        const api = getApi();
        api.listRecurringJournals.mockResolvedValue(mockTemplates);
        render(<RecurringJournalsPage />);
        await waitFor(() => {
            expect(screen.getByText('Monthly Rent')).toBeInTheDocument();
            expect(screen.getByText('Weekly Payroll')).toBeInTheDocument();
        });
    });

    it('shows the frequency in words', async () => {
        const api = getApi();
        api.listRecurringJournals.mockResolvedValue(mockTemplates);
        render(<RecurringJournalsPage />);
        await screen.findByText('Monthly Rent');
        expect(screen.getByRole('cell', { name: 'Monthly' })).toBeInTheDocument();
    });

    it('narrows the rows and the strip together through the Frequency chip', async () => {
        const api = getApi();
        api.listRecurringJournals.mockResolvedValue(mockTemplates);
        render(<RecurringJournalsPage />);
        await screen.findByText('Monthly Rent');
        const strip = screen.getByRole('region', { name: 'Recurring journal figures' });
        expect(within(strip).getByText('৳5000')).toBeInTheDocument();

        fireEvent.click(
            screen.getAllByRole('button', { name: /^Frequency/ })
                .find((button) => button.getAttribute('aria-haspopup') === 'dialog')!,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Weekly' }));

        await waitFor(() => expect(screen.queryByText('Monthly Rent')).not.toBeInTheDocument());
        expect(screen.getByText('Weekly Payroll')).toBeInTheDocument();
        expect(within(strip).getByText('৳0')).toBeInTheDocument();
    });

    it('shows New Template button', async () => {
        render(<RecurringJournalsPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /new template/i })).toBeInTheDocument();
        });
    });

    it('shows create form when New Template is clicked', async () => {
        render(<RecurringJournalsPage />);
        await waitFor(() => screen.getByRole('button', { name: /new template/i }));
        fireEvent.click(screen.getByRole('button', { name: /new template/i }));
        await waitFor(() => {
            expect(screen.getByPlaceholderText(/e.g. monthly rent/i)).toBeInTheDocument();
        });
    });

    it('shows frequency select in create form', async () => {
        render(<RecurringJournalsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /new template/i }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('option', { name: 'Monthly' })).toBeInTheDocument();
        expect(within(dialog).getByRole('option', { name: 'Weekly' })).toBeInTheDocument();
    });

    it('shows error message when load fails', async () => {
        const api = getApi();
        api.listRecurringJournals.mockRejectedValue(new Error('Failed to load'));
        render(<RecurringJournalsPage />);
        await waitFor(() => {
            expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
        });
    });

    it('shows Post button for each template', async () => {
        const api = getApi();
        api.listRecurringJournals.mockResolvedValue(mockTemplates);
        render(<RecurringJournalsPage />);
        await waitFor(() => {
            const postButtons = screen.getAllByRole('button', { name: /post now/i });
            expect(postButtons.length).toBeGreaterThan(0);
        });
    });

    it('calls postRecurringJournal when Post button clicked', async () => {
        const api = getApi();
        api.listRecurringJournals.mockResolvedValue(mockTemplates);
        render(<RecurringJournalsPage />);
        await waitFor(() => screen.getAllByRole('button', { name: /post now/i }));
        fireEvent.click(screen.getAllByRole('button', { name: /post now/i })[0]);
        await waitFor(() => {
            expect(api.postRecurringJournal).toHaveBeenCalledWith('rj-1');
        });
    });

    it('shows Save Template button disabled in empty form', async () => {
        render(<RecurringJournalsPage />);
        await waitFor(() => screen.getByRole('button', { name: /new template/i }));
        fireEvent.click(screen.getByRole('button', { name: /new template/i }));
        await waitFor(() => {
            const saveBtn = screen.getByRole('button', { name: /save template/i });
            expect(saveBtn).toBeDisabled();
        });
    });
});
