import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    formatBDT: (v: number) => `৳${v}`,
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

    it('shows template details', async () => {
        const api = getApi();
        api.listRecurringJournals.mockResolvedValue(mockTemplates);
        render(<RecurringJournalsPage />);
        await waitFor(() => {
            expect(screen.getByText('MONTHLY')).toBeInTheDocument();
        });
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
        await waitFor(() => screen.getByRole('button', { name: /new template/i }));
        fireEvent.click(screen.getByRole('button', { name: /new template/i }));
        await waitFor(() => {
            expect(screen.getByText('Monthly')).toBeInTheDocument();
            expect(screen.getByText('Weekly')).toBeInTheDocument();
        });
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
