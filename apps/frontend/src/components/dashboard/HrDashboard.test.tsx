import React from 'react';
import { render, screen } from '@testing-library/react';
import HrDashboard from './HrDashboard';
import { api } from '@/lib/api';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    const actual = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: actual.formatMessage,
    };
});

jest.mock('@/lib/api', () => ({
    api: {
        getHrDashboardOverview: jest.fn(),
        getHrDashboardTrends: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const overview = (patch: Record<string, unknown> = {}) => ({
    filters: { from: '2026-07-01', to: '2026-07-31' },
    headcount: { active: 24, inactive: 3, joined_recently: 2, no_department: 1 },
    attendance: {
        counts: { PRESENT: 400, ABSENT: 20, HALF_DAY: 10, HOLIDAY: 60 },
        records: 430,
        rate_pct: 94.2,
        absent_today: 2,
        unrecorded_today: 4,
    },
    leave: { pending: 3, approved_days: 18, on_leave_today: 1 },
    payroll: {
        paid_in_period: 480_000,
        payments: 24,
        monthly_commitment: 500_000,
        employees_without_salary: 0,
    },
    departments: [
        { id: 'd1', name: 'Warehouse', headcount: 12 },
        { id: null, name: 'Unassigned', headcount: 1 },
    ],
    recent_payments: [{
        id: 'sp1',
        employee_name: 'Rahim Uddin',
        amount: 20_000,
        pay_period: '2026-07',
        payment_date: '2026-07-31T00:00:00.000Z',
    }],
    can_view_payroll: true,
    ...patch,
});

const identity = { greeting: 'Good morning 👋', tenantName: 'Team Co', renewalEnd: null };

describe('HrDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getHrDashboardOverview as jest.Mock).mockResolvedValue(overview());
        (api.getHrDashboardTrends as jest.Mock).mockResolvedValue({ points: [] });
    });

    it('raises who is absent, who is waiting on leave approval and who has no attendance marked', async () => {
        render(<HrDashboard {...identity} />);

        expect(await screen.findByText('2 absent today')).toBeInTheDocument();
        expect(screen.getByText('3 leave requests awaiting approval')).toBeInTheDocument();
        expect(screen.getByText('4 staff have no attendance marked today')).toBeInTheDocument();
        expect(screen.getByText('1 staff are in no department')).toBeInTheDocument();
    });

    it('says the team is accounted for rather than showing an empty strip', async () => {
        (api.getHrDashboardOverview as jest.Mock).mockResolvedValue(overview({
            headcount: { active: 24, inactive: 0, joined_recently: 0, no_department: 0 },
            attendance: { counts: {}, records: 0, rate_pct: null, absent_today: 0, unrecorded_today: 0 },
            leave: { pending: 0, approved_days: 0, on_leave_today: 0 },
        }));

        render(<HrDashboard {...identity} />);

        expect(await screen.findByText('Your team is all accounted for 🎉')).toBeInTheDocument();
    });

    it('shows headcount without a period comparison, because it is not churn', async () => {
        render(<HrDashboard {...identity} />);

        expect(await screen.findByText('Active staff')).toBeInTheDocument();
        expect(screen.getByText('24')).toBeInTheDocument();
        // No delta row: comparing headcount to last month would read as churn.
        expect(screen.getByText('3 inactive · 2 joined recently')).toBeInTheDocument();
    });

    it('hides payroll and says why when the user lacks the grant', async () => {
        (api.getHrDashboardOverview as jest.Mock).mockResolvedValue(overview({
            payroll: null,
            recent_payments: [],
            can_view_payroll: false,
        }));

        render(<HrDashboard {...identity} />);

        expect(await screen.findByText('You do not have access to payroll figures')).toBeInTheDocument();
        expect(screen.queryByText('Recent salary payments')).not.toBeInTheDocument();
        // Everything that is not money is still on the page.
        expect(screen.getByText('Headcount by department')).toBeInTheDocument();
        expect(screen.getByText('Warehouse')).toBeInTheDocument();
    });

    it('flags staff with no salary on file rather than quietly leaving them out of the bill', async () => {
        (api.getHrDashboardOverview as jest.Mock).mockResolvedValue(overview({
            payroll: {
                paid_in_period: 480_000,
                payments: 24,
                monthly_commitment: 500_000,
                employees_without_salary: 4,
            },
        }));

        render(<HrDashboard {...identity} />);

        // The tile says what the commitment leaves out; the strip says who to fix.
        expect(await screen.findByText('৳ 500,000.00 monthly, excluding 4 with no salary set')).toBeInTheDocument();
        expect(screen.getByText('4 staff have no salary on file')).toBeInTheDocument();
    });

    it('shows a dash rather than a fabricated attendance rate when nothing was recorded', async () => {
        (api.getHrDashboardOverview as jest.Mock).mockResolvedValue(overview({
            attendance: { counts: {}, records: 0, rate_pct: null, absent_today: 0, unrecorded_today: 0 },
        }));

        render(<HrDashboard {...identity} />);

        expect(await screen.findByText('Attendance rate')).toBeInTheDocument();
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('names employees with no department rather than dropping them', async () => {
        render(<HrDashboard {...identity} />);

        expect(await screen.findByText('Unassigned')).toBeInTheDocument();
    });

    it('drops the greeting when embedded under the HR hub header', async () => {
        const { rerender } = render(<HrDashboard {...identity} />);
        expect(await screen.findByText('Good morning 👋')).toBeInTheDocument();

        rerender(<HrDashboard {...identity} variant="embedded" />);
        expect(screen.queryByText('Good morning 👋')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    });

    it('surfaces an error when the overview itself fails', async () => {
        (api.getHrDashboardOverview as jest.Mock).mockRejectedValue(new Error('HR is down'));

        render(<HrDashboard {...identity} />);

        expect(await screen.findByText('HR is down')).toBeInTheDocument();
    });
});
