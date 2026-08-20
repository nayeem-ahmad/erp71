import { render, screen, waitFor } from '@testing-library/react';
import HrLeaveBalanceReportPage from './page';

const getHrLeaveBalanceReport = jest.fn();

// The daily-rate column is `hideOnMobile`, and jsdom reports no matchMedia
// match — so without this the desktop columns never render and the rate-source
// assertion below would be testing the mobile layout instead.
jest.mock('@/hooks/useMediaQuery', () => ({
    ...jest.requireActual('@/hooks/useMediaQuery'),
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getDepartments: jest.fn(),
        getLeaveTypes: jest.fn(),
        getHrLeaveBalanceReport: (...args: unknown[]) => getHrLeaveBalanceReport(...args),
    },
}));

const row = (overrides: Record<string, unknown> = {}) => ({
    key: 'e1:lt1',
    employeeId: 'e1',
    employeeName: 'Rina Akter',
    employeeCode: 'EMP-001',
    departmentName: 'Sales',
    leaveTypeName: 'Annual',
    entitledDays: 18,
    usedDays: 6,
    remainingDays: 12,
    carryForwardMaxDays: 10,
    allowsEncashment: true,
    dailyRate: 1000,
    dailyRateSource: 'BASIC_SALARY',
    liability: 12000,
    ...overrides,
});

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { year: 2026 },
    rows: [row()],
    summary: {
        employees: 1, entitledDays: 18, usedDays: 6, remainingDays: 12,
        encashableDays: 12, liability: 12000, unpricedRows: 0,
    },
    can_view_payroll: true,
    ...overrides,
});

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    getHrLeaveBalanceReport.mockReset().mockResolvedValue(report());
    api.getDepartments.mockReset().mockResolvedValue([{ id: 'd1', name: 'Sales' }]);
    api.getLeaveTypes.mockReset().mockResolvedValue([{ id: 'lt1', name: 'Annual' }]);
});

describe('HR leave balance & liability report', () => {
    it('shows remaining days beside what they are worth', async () => {
        render(<HrLeaveBalanceReportPage />);

        expect(await screen.findByText('Rina Akter')).toBeInTheDocument();
        expect(screen.getAllByText('12').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/12,000/).length).toBeGreaterThan(0);
    });

    it('names where the daily rate came from', async () => {
        render(<HrLeaveBalanceReportPage />);

        // A liability figure with no stated basis is a number nobody can check.
        expect(await screen.findByText('From basic salary')).toBeInTheDocument();
    });

    it('drops the money columns and says why when payroll access is missing', async () => {
        getHrLeaveBalanceReport.mockResolvedValue(report({
            can_view_payroll: false,
            rows: [row({ dailyRate: null, dailyRateSource: null, liability: null })],
            summary: {
                employees: 1, entitledDays: 18, usedDays: 6, remainingDays: 12,
                encashableDays: 12, liability: null, unpricedRows: null,
            },
        }));

        render(<HrLeaveBalanceReportPage />);

        expect(await screen.findByText(/View salary & payroll figures/)).toBeInTheDocument();
        expect(screen.queryByText('Liability')).not.toBeInTheDocument();
        // The days half still renders — that is the whole point of not 403ing.
        expect(screen.getByText('Rina Akter')).toBeInTheDocument();
    });

    it('warns when encashable rows could not be priced', async () => {
        getHrLeaveBalanceReport.mockResolvedValue(report({
            summary: {
                employees: 1, entitledDays: 18, usedDays: 6, remainingDays: 12,
                encashableDays: 12, liability: 0, unpricedRows: 2,
            },
        }));

        render(<HrLeaveBalanceReportPage />);

        expect(await screen.findByText(/2 encashable rows could not be priced/))
            .toBeInTheDocument();
    });

    it('asks for the current year by default', async () => {
        render(<HrLeaveBalanceReportPage />);

        await waitFor(() => expect(getHrLeaveBalanceReport).toHaveBeenCalled());
        expect(getHrLeaveBalanceReport.mock.calls[0][0].year).toBe(new Date().getFullYear());
    });
});
