import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HrPayrollCostReportPage from './page';

const getHrPayrollCost = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getDepartments: jest.fn(),
        getHrPayrollCost: (...args: unknown[]) => getHrPayrollCost(...args),
    },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { groupBy: 'department' },
    rows: [
        {
            key: 'd1', label: 'Sales', sublabel: null, employees: 3,
            grossEarnings: 90000, overtimeAmount: 3000, absenceDeduction: 1000,
            totalDeductions: 9000, netPay: 81000, share: 75,
        },
    ],
    summary: {
        employees: 4, months: 3, grossEarnings: 120000, overtimeAmount: 3000,
        totalDeductions: 12000, netPay: 108000, averagePerEmployee: 27000,
        latestMonth: '2026-03', previousMonthNet: 30000, monthOverMonth: 25,
    },
    ...overrides,
});

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    getHrPayrollCost.mockReset().mockResolvedValue(report());
    api.getDepartments.mockReset().mockResolvedValue([{ id: 'd1', name: 'Sales' }]);
});

describe('HR payroll cost report', () => {
    it('opens grouped by department — the question a shop actually asks', async () => {
        render(<HrPayrollCostReportPage />);

        await waitFor(() => expect(getHrPayrollCost).toHaveBeenCalled());
        expect(getHrPayrollCost.mock.calls[0][0].groupBy).toBe('department');
    });

    it('shows net pay in taka, not a bare number', async () => {
        render(<HrPayrollCostReportPage />);

        expect(await screen.findByText('৳ 108,000.00')).toBeInTheDocument();
        expect(screen.getByText('৳ 81,000.00')).toBeInTheDocument();
    });

    it('signs the month-on-month movement and names the month it compares', async () => {
        render(<HrPayrollCostReportPage />);

        expect(await screen.findByText('+25.0%')).toBeInTheDocument();
        expect(screen.getByText('Against 2026-03.')).toBeInTheDocument();
    });

    it('shows a dash rather than a fake zero when there is no month to compare', async () => {
        getHrPayrollCost.mockResolvedValue(report({
            summary: {
                employees: 1, months: 1, grossEarnings: 0, overtimeAmount: 0,
                totalDeductions: 0, netPay: 0, averagePerEmployee: null,
                latestMonth: '2026-03', previousMonthNet: null, monthOverMonth: null,
            },
        }));

        render(<HrPayrollCostReportPage />);

        await waitFor(() => expect(getHrPayrollCost).toHaveBeenCalled());
        expect(await screen.findAllByText('—')).not.toHaveLength(0);
    });

    it('refetches when the month range preset changes', async () => {
        render(<HrPayrollCostReportPage />);
        await waitFor(() => expect(getHrPayrollCost).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByLabelText('Custom range'), { target: { value: '12' } });

        await waitFor(() => expect(getHrPayrollCost).toHaveBeenCalledTimes(2));
        const first = getHrPayrollCost.mock.calls[0][0];
        const second = getHrPayrollCost.mock.calls[1][0];
        expect(second.fromYear * 12 + second.fromMonth)
            .toBeLessThan(first.fromYear * 12 + first.fromMonth);
    });
});
