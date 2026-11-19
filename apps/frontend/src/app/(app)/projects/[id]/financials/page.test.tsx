import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectFinancialsPage from './page';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'p1' }),
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/projects/p1/financials',
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getProjectFinancials: jest.fn(),
        priceProjectHours: jest.fn(),
        getProjectDirectCosts: jest.fn(),
        removeProjectCost: jest.fn(),
        reverseProjectMaterialIssue: jest.fn(),
        getProjectCostSources: jest.fn().mockResolvedValue([]),
        addProjectCost: jest.fn(),
        setProjectBudget: jest.fn(),
    },
}));

jest.mock('@/hooks/use-me', () => ({
    fetchMe: jest.fn().mockResolvedValue({ tenants: [{ id: 't1', role: 'OWNER', permissions: [] }] }),
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as {
    api: {
        getProjectFinancials: jest.Mock;
        priceProjectHours: jest.Mock;
        getProjectDirectCosts: jest.Mock;
        removeProjectCost: jest.Mock;
        reverseProjectMaterialIssue: jest.Mock;
        getProjectCostSources: jest.Mock;
        addProjectCost: jest.Mock;
        setProjectBudget: jest.Mock;
    };
};
const { fetchMe } = jest.requireMock('@/hooks/use-me') as { fetchMe: jest.Mock };
const { toast } = jest.requireMock('@/lib/toast') as { toast: { success: jest.Mock; error: jest.Mock } };

const financials = (overrides: Record<string, any> = {}) => ({
    project: { id: 'p1', code: 'BS23', name: 'Fit-out' },
    settings: { standardMonthlyHours: 208, overheadPct: 0 },
    totals: {
        hours: 19,
        costedHours: 14,
        uncostedHours: 5,
        labourCost: 3500,
        directCost: 0,
        totalCost: 3500,
        budget: 10000,
        budgetUsedPct: 35,
        budgetRemaining: 6500,
        averageRate: 250,
    },
    uncosted: { noEmployeeHours: 4, noRateHours: 1, materialLines: 0 },
    budgetByCategory: false,
    byCategory: [{ category: 'LABOUR', amount: 3500, budget: null, remaining: null, usedPct: null }],
    forecast: {
        remainingHours: 10,
        estimatedRemainingCost: 2500,
        unratedHours: 0,
        remainingDirectCost: 0,
        estimateAtCompletion: 6000,
        byPerson: [
            { key: 'unassigned', name: '', employeeId: null, remainingHours: 6, rate: 250, rateSource: 'AVERAGE', cost: 1500 },
            { key: 'employee:e1', name: 'Karim', employeeId: 'e1', remainingHours: 4, rate: 250, rateSource: 'PERSON', cost: 1000 },
        ],
    },
    byPerson: [
        { key: 'employee:e1', employeeId: 'e1', userId: null, name: 'Karim', employeeCode: 'EMP-1', hours: 10, labourCost: 2000, uncostedHours: 0 },
        { key: 'user:u3', employeeId: null, userId: 'u3', name: 'Temp', employeeCode: null, hours: 4, labourCost: 0, uncostedHours: 4 },
    ],
    byMonth: [{ month: '2026-08', hours: 15, labourCost: 3000, directCost: 0, totalCost: 3000 }],
    ...overrides,
});

describe('ProjectFinancialsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getProjectFinancials.mockResolvedValue(financials());
        api.priceProjectHours.mockResolvedValue({ priced: 3, stillUncosted: 0 });
        api.getProjectDirectCosts.mockResolvedValue([]);
        api.setProjectBudget.mockResolvedValue({ lines: [], total: null });
        fetchMe.mockResolvedValue({ tenants: [{ id: 't1', role: 'OWNER', permissions: [] }] });
    });

    it('shows labour cost against the budget, and the forecast', async () => {
        render(<ProjectFinancialsPage />);

        expect(await screen.findByText('Total cost', { selector: 'p' })).toBeInTheDocument();
        expect(screen.getByText('Labour cost', { selector: 'p' })).toBeInTheDocument();
        expect(screen.getByText('35%')).toBeInTheDocument();
        expect(screen.getByText('Estimated cost at completion')).toBeInTheDocument();
        expect(api.getProjectFinancials).toHaveBeenCalledWith('p1');
    });

    it('counts uncosted hours apart, with the reason and the fix for each', async () => {
        render(<ProjectFinancialsPage />);

        expect(await screen.findByText('5 hours have no cost')).toBeInTheDocument();
        expect(screen.getByText(/4 h were logged by people whose login is not linked/)).toBeInTheDocument();
        expect(screen.getByText(/1 h were logged by employees with no salary/)).toBeInTheDocument();
    });

    it('prices the uncosted hours on request, then re-reads the totals', async () => {
        render(<ProjectFinancialsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Price these hours' }));

        await waitFor(() => expect(api.priceProjectHours).toHaveBeenCalledWith('p1'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('3 entries priced'));
        expect(api.getProjectFinancials).toHaveBeenCalledTimes(2);
    });

    it('links each person with a card to it', async () => {
        render(<ProjectFinancialsPage />);

        expect(await screen.findByRole('link', { name: 'Karim' })).toHaveAttribute('href', '/hr/employees/e1');
    });

    it('calls a project past its budget over budget', async () => {
        api.getProjectFinancials.mockResolvedValue(
            financials({
                totals: { ...financials().totals, labourCost: 12000, budgetUsedPct: 120, budgetRemaining: -2000 },
            }),
        );
        render(<ProjectFinancialsPage />);

        expect(await screen.findByText('Over budget')).toBeInTheDocument();
    });

    it('says why it cannot show anything to someone the server refuses', async () => {
        api.getProjectFinancials.mockRejectedValue(new Error('Forbidden'));
        render(<ProjectFinancialsPage />);

        expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    });

    describe('direct costs', () => {
        const rows = [
            { kind: 'ISSUE', id: 'iss-1', date: '2026-09-02', category: 'MATERIAL', description: '10 × Cement', source: 'Main', amount: 5200, uncosted: false },
            { kind: 'EXPENSE', id: 'x1', date: '2026-08-15', category: 'EXPENSE', description: 'Site tea', source: 'Refreshments', amount: 200, uncosted: false },
            { kind: 'ENTRY', id: 'c1', date: '2026-08-10', category: 'SERVICES', description: 'Transport', source: 'PUR-1 · Hauliers', amount: 400, uncosted: false },
        ];

        beforeEach(() => {
            api.getProjectDirectCosts.mockResolvedValue(rows);
            api.removeProjectCost.mockResolvedValue({ removed: true });
            api.reverseProjectMaterialIssue.mockResolvedValue({ reversed: true });
        });

        it('lists every kind of direct cost with its category', async () => {
            render(<ProjectFinancialsPage />);

            expect(await screen.findByText('10 × Cement')).toBeInTheDocument();
            expect(screen.getByText('PUR-1 · Hauliers')).toBeInTheDocument();
            expect(screen.getByText('Bought-in services')).toBeInTheDocument();
        });

        it('removes a cost entry, and returns an issue to stock', async () => {
            render(<ProjectFinancialsPage />);
            await screen.findByText('Transport');

            fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
            await waitFor(() => expect(api.removeProjectCost).toHaveBeenCalledWith('p1', 'c1'));

            fireEvent.click(await screen.findByRole('button', { name: 'Return to stock' }));
            await waitFor(() => expect(api.reverseProjectMaterialIssue).toHaveBeenCalledWith('p1', 'iss-1'));
        });

        it('leaves an expense to be corrected where it posts', async () => {
            render(<ProjectFinancialsPage />);
            await screen.findByText('Site tea');

            // One remove (the entry) and one return (the issue) — nothing for the expense.
            expect(screen.getAllByRole('button', { name: /^(Remove|Return to stock)$/ })).toHaveLength(2);
        });

        it('adds a cost from the page', async () => {
            api.addProjectCost.mockResolvedValue({ id: 'c2' });
            render(<ProjectFinancialsPage />);

            fireEvent.click(await screen.findByRole('button', { name: 'Add cost' }));
            fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'OVERHEAD' } });
            fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '750' } });
            fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Site office share' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));

            await waitFor(() =>
                expect(api.addProjectCost).toHaveBeenCalledWith('p1', expect.objectContaining({
                    category: 'OVERHEAD', amount: 750, description: 'Site office share',
                })),
            );
        });
    });
    describe('Phase D', () => {
        it('prices the rest of the work by who is on it, naming unassigned work and the average fallback', async () => {
            render(<ProjectFinancialsPage />);

            expect(await screen.findByText('Unassigned')).toBeInTheDocument();
            expect(screen.getAllByText('Karim').length).toBeGreaterThan(0);
            expect(screen.getByText('project average')).toBeInTheDocument();
            expect(screen.getAllByText('Labour to come').length).toBeGreaterThan(0);
        });

        it('warns about remaining hours no rate can price', async () => {
            api.getProjectFinancials.mockResolvedValue(financials({
                forecast: { ...financials().forecast, unratedHours: 3 },
            }));
            render(<ProjectFinancialsPage />);

            expect(await screen.findByText(/3 h of remaining work have no rate yet/)).toBeInTheDocument();
        });

        it('compares each category with its budget line, calling an overspend what it is', async () => {
            api.getProjectFinancials.mockResolvedValue(financials({
                budgetByCategory: true,
                byCategory: [
                    { category: 'LABOUR', amount: 3500, budget: 5000, remaining: 1500, usedPct: 70 },
                    { category: 'MATERIAL', amount: 2500, budget: 2000, remaining: -500, usedPct: 125 },
                    { category: 'SERVICES', amount: 1000, budget: null, remaining: null, usedPct: null },
                ],
            }));
            render(<ProjectFinancialsPage />);

            expect(await screen.findByText('Budget vs actual')).toBeInTheDocument();
            expect(screen.getByText(/500\.00 over/)).toHaveClass('text-red-600');
            expect(screen.getByText('125%')).toBeInTheDocument();
            // Split already: the "split it" hint is gone.
            expect(screen.queryByText(/Split the budget by category/)).not.toBeInTheDocument();
        });

        it('splits the budget by category, sending only the categories given an amount', async () => {
            render(<ProjectFinancialsPage />);

            fireEvent.click(await screen.findByRole('button', { name: 'Budget by category' }));
            fireEvent.change(await screen.findByLabelText('Labour'), { target: { value: '5000' } });
            fireEvent.change(screen.getByLabelText('Materials'), { target: { value: '2000' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));

            await waitFor(() =>
                expect(api.setProjectBudget).toHaveBeenCalledWith('p1', [
                    { category: 'LABOUR', amount: 5000 },
                    { category: 'MATERIAL', amount: 2000 },
                ]),
            );
            expect(toast.success).toHaveBeenCalledWith('Budget saved.');
            await waitFor(() => expect(api.getProjectFinancials).toHaveBeenCalledTimes(2));
        });

        it('opens the split with the lines as they stand', async () => {
            api.getProjectFinancials.mockResolvedValue(financials({
                budgetByCategory: true,
                byCategory: [{ category: 'LABOUR', amount: 3500, budget: 5000, remaining: 1500, usedPct: 70 }],
            }));
            render(<ProjectFinancialsPage />);

            fireEvent.click(await screen.findByRole('button', { name: 'Budget by category' }));

            expect(await screen.findByLabelText('Labour')).toHaveValue(5000);
            expect(screen.getByLabelText('Materials')).toHaveValue(null);
        });

        it('offers no budget split without the right to manage the project', async () => {
            fetchMe.mockResolvedValue({ tenants: [{ id: 't1', role: 'MEMBER', permissions: ['VIEW_PROJECT_FINANCIALS'] }] });
            render(<ProjectFinancialsPage />);

            expect(await screen.findByText('Unassigned')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Budget by category' })).not.toBeInTheDocument();
        });

        it('shows how far a fixed-price job is by cost, and what it has earned against what it billed', async () => {
            api.getProjectFinancials.mockResolvedValue(financials({
                revenue: {
                    billingType: 'FIXED_PRICE', contractValue: 12000, invoiced: 5750, revenue: 5000, margin: 1500, marginPct: 30,
                    leftToInvoice: 7000, unbilledHours: null, unbilledAmount: null, unratedHours: null,
                    expectedRevenue: 12000, expectedCost: 6000, expectedMargin: 6000,
                    percentComplete: 58.33, earnedRevenue: 7000, earnedMargin: 3500, billedAheadOfWork: -2000,
                },
            }));
            render(<ProjectFinancialsPage />);

            expect(await screen.findByText('58.33%')).toBeInTheDocument();
            expect(screen.getByText('Earned to date')).toBeInTheDocument();
            expect(screen.getByText('Earned, not yet billed')).toBeInTheDocument();
        });
    });
});
