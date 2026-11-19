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
    api: { getProjectFinancials: jest.fn(), priceProjectHours: jest.fn() },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as {
    api: { getProjectFinancials: jest.Mock; priceProjectHours: jest.Mock };
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
        budget: 10000,
        budgetUsedPct: 35,
        budgetRemaining: 6500,
        averageRate: 250,
    },
    uncosted: { noEmployeeHours: 4, noRateHours: 1 },
    forecast: { remainingHours: 10, estimatedRemainingCost: 2500, estimateAtCompletion: 6000 },
    byPerson: [
        { key: 'employee:e1', employeeId: 'e1', userId: null, name: 'Karim', employeeCode: 'EMP-1', hours: 10, labourCost: 2000, uncostedHours: 0 },
        { key: 'user:u3', employeeId: null, userId: 'u3', name: 'Temp', employeeCode: null, hours: 4, labourCost: 0, uncostedHours: 4 },
    ],
    byMonth: [{ month: '2026-08', hours: 15, labourCost: 3000 }],
    ...overrides,
});

describe('ProjectFinancialsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getProjectFinancials.mockResolvedValue(financials());
        api.priceProjectHours.mockResolvedValue({ priced: 3, stillUncosted: 0 });
    });

    it('shows labour cost against the budget, and the forecast', async () => {
        render(<ProjectFinancialsPage />);

        expect(await screen.findByText('Labour cost', { selector: 'p' })).toBeInTheDocument();
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
});
