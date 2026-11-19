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
    };
};
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
    byCategory: [{ category: 'LABOUR', amount: 3500 }],
    forecast: { remainingHours: 10, estimatedRemainingCost: 2500, estimateAtCompletion: 6000 },
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
    });

    it('shows labour cost against the budget, and the forecast', async () => {
        render(<ProjectFinancialsPage />);

        expect(await screen.findByText('Total cost', { selector: 'p' })).toBeInTheDocument();
        expect(screen.getByText('Labour cost', { selector: 'p' })).toBeInTheDocument();
        expect(screen.getByText('35%')).toBeInTheDocument();
        expect(screen.getByText('Estimated labour cost at completion')).toBeInTheDocument();
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
});
