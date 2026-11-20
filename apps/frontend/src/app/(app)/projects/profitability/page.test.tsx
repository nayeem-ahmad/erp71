import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectProfitabilityPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/projects/profitability',
}));
jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
jest.mock('@/lib/api', () => ({ api: { getProjectProfitability: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as { api: { getProjectProfitability: jest.Mock } };

const row = (overrides: Record<string, unknown>) => ({
    id: 'p',
    code: 'P',
    name: 'Project',
    status: 'ACTIVE',
    billingType: 'FIXED_PRICE',
    customer: 'Rahim Traders',
    budget: null,
    labourCost: 0,
    directCost: 0,
    cost: 0,
    budgetUsedPct: null,
    contractValue: null,
    revenue: 0,
    margin: 0,
    marginPct: null,
    uncostedHours: 0,
    ...overrides,
});

const report = () => ({
    rows: [
        row({ id: 'p1', code: 'BS23', name: 'Fit-out', cost: 4500, revenue: 4000, margin: -500, marginPct: -12.5, budget: 10000, budgetUsedPct: 45 }),
        row({ id: 'p2', code: 'AC10', name: 'Annual care', billingType: 'TIME_AND_MATERIALS', cost: 1000, revenue: 2000, margin: 1000, marginPct: 50, uncostedHours: 3 }),
        row({ id: 'p3', code: 'IT01', name: 'New tills', billingType: 'INTERNAL', customer: null, cost: 500, margin: null }),
    ],
    totals: { projects: 3, cost: 6000, internalCost: 500, revenue: 6000, billedCost: 5500, margin: 500, marginPct: 8.33, uncostedHours: 3 },
    truncated: false,
});

const codes = () => within(screen.getByRole('table')).getAllByRole('link').map((link) => link.textContent);

describe('ProjectProfitabilityPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getProjectProfitability.mockResolvedValue(report());
    });

    it('opens on the work still under way, worst margin first, internal projects last', async () => {
        render(<ProjectProfitabilityPage />);

        await screen.findByRole('table');
        expect(api.getProjectProfitability).toHaveBeenCalledWith({ status: 'DRAFT,ACTIVE,ON_HOLD', billingType: undefined });
        expect(codes()).toEqual(['BS23', 'AC10', 'IT01']);
        expect(screen.getByRole('link', { name: 'BS23' })).toHaveAttribute('href', '/projects/p1/financials');
    });

    it('shows margin totals over billed work, with internal cost apart', async () => {
        render(<ProjectProfitabilityPage />);

        expect(await screen.findByText('8.33%')).toBeInTheDocument();
        expect(screen.getByText('Cost of internal projects')).toBeInTheDocument();
        // An internal project has a cost but no margin.
        expect(screen.getByText('Not billed')).toBeInTheDocument();
    });

    it('flags uncosted hours, overall and on the project that has them', async () => {
        render(<ProjectProfitabilityPage />);

        expect(await screen.findByText(/3 h on these projects have no cost yet/)).toBeInTheDocument();
        expect(screen.getByText('3 h uncosted')).toBeInTheDocument();
    });

    it('re-reads the report when a filter changes, and re-sorts without one', async () => {
        render(<ProjectProfitabilityPage />);
        await screen.findByRole('table');

        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } });
        await waitFor(() =>
            expect(api.getProjectProfitability).toHaveBeenLastCalledWith({ status: 'COMPLETED', billingType: undefined }),
        );
        fireEvent.change(screen.getByLabelText('How it is billed'), { target: { value: 'INTERNAL' } });
        await waitFor(() =>
            expect(api.getProjectProfitability).toHaveBeenLastCalledWith({ status: 'COMPLETED', billingType: 'INTERNAL' }),
        );

        await screen.findByRole('table');
        const calls = api.getProjectProfitability.mock.calls.length;
        fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'cost' } });
        expect(codes()).toEqual(['BS23', 'AC10', 'IT01']);
        fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'code' } });
        expect(codes()).toEqual(['AC10', 'BS23', 'IT01']);
        expect(api.getProjectProfitability).toHaveBeenCalledTimes(calls);
    });

    it('says so when nothing matches', async () => {
        api.getProjectProfitability.mockResolvedValue({ ...report(), rows: [], totals: { ...report().totals, projects: 0 } });
        render(<ProjectProfitabilityPage />);

        expect(await screen.findByText('No projects match these filters.')).toBeInTheDocument();
    });

    it('shows the error when the report cannot load', async () => {
        api.getProjectProfitability.mockRejectedValue(new Error('Forbidden'));
        render(<ProjectProfitabilityPage />);

        expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    });
});
