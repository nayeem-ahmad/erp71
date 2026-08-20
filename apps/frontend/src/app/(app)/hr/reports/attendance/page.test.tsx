import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HrAttendanceReportPage from './page';

const getHrAttendanceSummary = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getDepartments: jest.fn(),
        getHrAttendanceSummary: (...args: unknown[]) => getHrAttendanceSummary(...args),
    },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { groupBy: 'employee' },
    summary: {
        employees: 2,
        employeeMonths: 4,
        frozenMonths: 3,
        presentDays: 44,
        absentDays: 2,
        leaveDays: 3,
        workedHours: 384,
        overtimeHours: 6,
        attendanceRate: 88.5,
    },
    rows: [
        {
            key: 'e1', label: 'Rina Akter', sublabel: 'EMP-001',
            employees: 1, months: 2, scheduledDays: 51, presentDays: 44, absentDays: 2,
            leaveDays: 3, lateDays: 5, workedHours: 384, overtimeHours: 6, attendanceRate: 86.3,
        },
    ],
    ...overrides,
});

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    getHrAttendanceSummary.mockReset().mockResolvedValue(report());
    api.getDepartments.mockReset().mockResolvedValue([{ id: 'd1', name: 'Sales' }]);
});

describe('HR attendance summary report', () => {
    it('opens grouped by employee over a month range that runs forwards', async () => {
        render(<HrAttendanceReportPage />);

        await waitFor(() => expect(getHrAttendanceSummary).toHaveBeenCalled());
        const params = getHrAttendanceSummary.mock.calls[0][0];
        expect(params.groupBy).toBe('employee');
        expect(params.fromYear * 12 + params.fromMonth)
            .toBeLessThanOrEqual(params.toYear * 12 + params.toMonth);
    });

    it('shows the attendance rate and the per-row breakdown', async () => {
        render(<HrAttendanceReportPage />);

        expect(await screen.findByText('88.5%')).toBeInTheDocument();
        expect(screen.getByText('Rina Akter')).toBeInTheDocument();
        expect(screen.getByText('EMP-001')).toBeInTheDocument();
    });

    it('reports how much of the range payroll has frozen', async () => {
        render(<HrAttendanceReportPage />);

        // 3 of 4 employee-months consumed by a run — the rest can still move.
        expect(await screen.findByText('3/4')).toBeInTheDocument();
    });

    it('refetches when the grouping changes', async () => {
        render(<HrAttendanceReportPage />);
        await waitFor(() => expect(getHrAttendanceSummary).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'department' } });

        await waitFor(() => expect(getHrAttendanceSummary).toHaveBeenCalledTimes(2));
        expect(getHrAttendanceSummary.mock.calls[1][0].groupBy).toBe('department');
    });

    it('sends no departmentId when the filter is left on All departments', async () => {
        render(<HrAttendanceReportPage />);

        await waitFor(() => expect(getHrAttendanceSummary).toHaveBeenCalled());
        // An empty string would reach the DTO as a malformed uuid, not "no filter".
        expect(getHrAttendanceSummary.mock.calls[0][0].departmentId).toBeUndefined();
    });

    it('empties the table rather than showing stale rows when the load fails', async () => {
        getHrAttendanceSummary.mockRejectedValueOnce(new Error('nope'));
        render(<HrAttendanceReportPage />);

        expect(await screen.findByText('No data for this selection.')).toBeInTheDocument();
    });
});
