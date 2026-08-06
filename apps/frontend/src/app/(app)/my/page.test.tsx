import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MyWorkspacePage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getMyProfile: jest.fn(),
        getMySummary: jest.fn(),
        getMyAttendance: jest.fn(),
        getMyLeaveBalances: jest.fn(),
        getMyLeaveRequests: jest.fn(),
        getMySalaryPayments: jest.fn(),
        getMyToday: jest.fn(),
        checkIn: jest.fn(),
        checkOut: jest.fn(),
        applyForLeave: jest.fn(),
        cancelMyLeaveRequest: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    useToastStore: (selector: any) => selector({ show: jest.fn() }),
}));

const { api } = jest.requireMock('@/lib/api');

const PROFILE = {
    employee: { id: 'emp-1', name: 'Alice', employee_code: 'EMP-00001', department: null, designation: null },
};

const seed = (overrides: Record<string, any> = {}) => {
    api.getMyProfile.mockResolvedValue(overrides.profile ?? PROFILE);
    api.getMySummary.mockResolvedValue(overrides.summary ?? {
        period: { year: 2026, month: 8 },
        attendance: { summary: { PRESENT: 18, ABSENT: 2, HALF_DAY: 1 }, total: 21 },
        pendingLeaveRequests: 1,
    });
    api.getMyAttendance.mockResolvedValue(overrides.attendance ?? { records: [] });
    api.getMyLeaveBalances.mockResolvedValue(overrides.balances ?? []);
    api.getMyLeaveRequests.mockResolvedValue(overrides.requests ?? []);
    api.getMySalaryPayments.mockResolvedValue(overrides.payments ?? []);
    api.getMyToday.mockResolvedValue(overrides.today ?? {
        date: '2026-08-10',
        record: null,
        isHoliday: false,
        isWorkingDay: true,
        scheduledStartMinute: 540,
        scheduledEndMinute: 1080,
        selfServiceEnabled: true,
        geofenceEnabled: false,
    });
};

describe('MyWorkspacePage', () => {
    beforeEach(() => jest.clearAllMocks());

    it('shows the employee their own month at a glance', async () => {
        seed();
        render(<MyWorkspacePage />);

        await waitFor(() => expect(screen.getByText('18')).toBeInTheDocument());
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('never sends an employee id — the token decides who this is', async () => {
        seed();
        render(<MyWorkspacePage />);

        await waitFor(() => expect(api.getMySummary).toHaveBeenCalled());
        for (const call of [
            api.getMyProfile, api.getMySummary, api.getMyAttendance,
            api.getMyLeaveBalances, api.getMyLeaveRequests, api.getMySalaryPayments,
        ]) {
            for (const args of call.mock.calls) {
                expect(JSON.stringify(args ?? [])).not.toContain('emp-');
            }
        }
    });

    it('renders an empty state rather than a broken table with no attendance', async () => {
        seed();
        render(<MyWorkspacePage />);
        await waitFor(() => expect(api.getMyAttendance).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /attendance/i }));
        expect(screen.getByText(/no attendance recorded/i)).toBeInTheDocument();
    });

    it('surfaces a load failure instead of an empty page', async () => {
        api.getMyProfile.mockRejectedValue(new Error('nope'));
        api.getMySummary.mockResolvedValue({});
        api.getMyAttendance.mockResolvedValue({ records: [] });
        api.getMyLeaveBalances.mockResolvedValue([]);
        api.getMyLeaveRequests.mockResolvedValue([]);
        api.getMySalaryPayments.mockResolvedValue([]);
        api.getMyToday.mockResolvedValue(null);

        render(<MyWorkspacePage />);
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    });

    describe('leave', () => {
        const BALANCES = [
            { leave_type_id: 'lt-1', leave_type: 'Annual', total_days: 10, used_days: 3, remaining_days: 7 },
        ];

        it('builds the leave-type picker from the balances HR set', async () => {
            // The staff leave-type endpoint is not reachable by an employee, so
            // the balances are the only source — this pins that.
            seed({ balances: BALANCES });
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyLeaveBalances).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /^leave$/i }));
            fireEvent.click(screen.getByRole('button', { name: /apply for leave/i }));

            expect(screen.getByRole('option', { name: 'Annual' })).toBeInTheDocument();
        });

        it('disables applying when HR has set no balances', async () => {
            seed({ balances: [] });
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyLeaveBalances).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /^leave$/i }));
            expect(screen.getByRole('button', { name: /apply for leave/i })).toBeDisabled();
            expect(screen.getByText(/no leave balances/i)).toBeInTheDocument();
        });

        it('offers withdrawal only on a pending request', async () => {
            seed({
                balances: BALANCES,
                requests: [
                    { id: 'r-1', start_date: '2026-09-01', end_date: '2026-09-02', days: 2, status: 'PENDING', leave_type: { id: 'lt-1', name: 'Annual' } },
                    { id: 'r-2', start_date: '2026-08-01', end_date: '2026-08-02', days: 2, status: 'APPROVED', leave_type: { id: 'lt-1', name: 'Annual' } },
                ],
            });
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyLeaveRequests).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /^leave$/i }));
            expect(screen.getAllByRole('button', { name: /withdraw/i })).toHaveLength(1);
        });
    });

    it('shows pay in taka, not dollars', async () => {
        seed({
            payments: [
                { id: 'p-1', amount: '25000', pay_period: '2026-07', payment_date: '2026-07-31', payment_method: 'CASH' },
            ],
        });
        render(<MyWorkspacePage />);
        await waitFor(() => expect(api.getMySalaryPayments).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /^pay$/i }));
        expect(screen.getByText('2026-07')).toBeInTheDocument();
        expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    });
    describe('check in', () => {
        it('offers check-in on a working day and records it', async () => {
            seed();
            api.checkIn.mockResolvedValue({});
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyToday).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /^check in$/i }));
            await waitFor(() => expect(api.checkIn).toHaveBeenCalled());
            // Geofencing off — no coordinates are sent at all.
            expect(api.checkIn).toHaveBeenCalledWith(undefined);
        });

        it('switches to check-out once clocked in', async () => {
            seed({ today: {
                date: '2026-08-10',
                record: { clock_in: '2026-08-10T09:00:00.000Z', clock_out: null },
                isHoliday: false, isWorkingDay: true,
                scheduledStartMinute: 540, scheduledEndMinute: 1080,
                selfServiceEnabled: true, geofenceEnabled: false,
            } });
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyToday).toHaveBeenCalled());

            expect(screen.getByRole('button', { name: /check out/i })).toBeInTheDocument();
        });

        it('says why rather than hiding the control on a rest day', async () => {
            // A missing button reads as a broken app.
            seed({ today: {
                date: '2026-08-14', record: null,
                isHoliday: false, isWorkingDay: false,
                scheduledStartMinute: null, scheduledEndMinute: null,
                selfServiceEnabled: true, geofenceEnabled: false,
            } });
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyToday).toHaveBeenCalled());

            expect(screen.getByText(/rest day/i)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument();
        });

        it('says why on a holiday', async () => {
            seed({ today: {
                date: '2026-04-14', record: null,
                isHoliday: true, isWorkingDay: true,
                scheduledStartMinute: 540, scheduledEndMinute: 1080,
                selfServiceEnabled: true, geofenceEnabled: false,
            } });
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyToday).toHaveBeenCalled());
            expect(screen.getByText(/holiday/i)).toBeInTheDocument();
        });

        it('says why when the business turned self check-in off', async () => {
            seed({ today: {
                date: '2026-08-10', record: null,
                isHoliday: false, isWorkingDay: true,
                scheduledStartMinute: 540, scheduledEndMinute: 1080,
                selfServiceEnabled: false, geofenceEnabled: false,
            } });
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyToday).toHaveBeenCalled());
            expect(screen.getByText(/turned off/i)).toBeInTheDocument();
        });

        it('shows the day as done once clocked out', async () => {
            seed({ today: {
                date: '2026-08-10',
                record: { clock_in: '2026-08-10T09:00:00.000Z', clock_out: '2026-08-10T18:00:00.000Z' },
                isHoliday: false, isWorkingDay: true,
                scheduledStartMinute: 540, scheduledEndMinute: 1080,
                selfServiceEnabled: true, geofenceEnabled: false,
            } });
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyToday).toHaveBeenCalled());
            expect(screen.getByText(/done for today/i)).toBeInTheDocument();
        });

        it('surfaces a rejected check-in instead of failing silently', async () => {
            seed();
            api.checkIn.mockRejectedValue(new Error('You appear to be 4000m from Gulshan.'));
            render(<MyWorkspacePage />);
            await waitFor(() => expect(api.getMyToday).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /^check in$/i }));
            await waitFor(() => expect(screen.getByText(/4000m from Gulshan/)).toBeInTheDocument());
        });
    });
});
