'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AttendancePage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getAttendance: jest.fn(),
        getEmployees: jest.fn(),
        upsertAttendance: jest.fn(),
        deleteAttendance: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/hr/attendance',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockEmployees = [
    { id: 'emp-1', employee_code: 'EMP001', name: 'Alice Rahman' },
    { id: 'emp-2', employee_code: 'EMP002', name: 'Bob Hossain' },
];

const mockRecords = [
    {
        id: 'att-1',
        employee_id: 'emp-1',
        date: '2026-06-01',
        clock_in: '2026-06-01T09:00:00.000Z',
        clock_out: '2026-06-01T17:00:00.000Z',
        status: 'PRESENT',
        notes: null,
        employee: { id: 'emp-1', name: 'Alice Rahman', employee_code: 'EMP001' },
    },
    {
        id: 'att-2',
        employee_id: 'emp-2',
        date: '2026-06-01',
        clock_in: null,
        clock_out: null,
        status: 'ABSENT',
        notes: 'Sick leave',
        employee: { id: 'emp-2', name: 'Bob Hossain', employee_code: 'EMP002' },
    },
];

describe('AttendancePage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getAttendance.mockResolvedValue(mockRecords);
        api.getEmployees.mockResolvedValue(mockEmployees);
        api.upsertAttendance.mockResolvedValue({});
        api.deleteAttendance.mockResolvedValue({});
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Attendance heading', async () => {
        render(<AttendancePage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Attendance' })).toBeInTheDocument();
        });
    });

    it('displays attendance records loaded from the API', async () => {
        render(<AttendancePage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Rahman')).toBeInTheDocument();
            expect(screen.getByText('Bob Hossain')).toBeInTheDocument();
        });
    });

    it('renders status badges for attendance records', async () => {
        render(<AttendancePage />);
        expect(await screen.findByText('Present')).toBeInTheDocument();
        expect(screen.getByText('Absent')).toBeInTheDocument();
    });

    describe('the day ledger', () => {
        it('groups a day under one header carrying its worked total', async () => {
            const { api } = require('@/lib/api');
            api.getAttendance.mockResolvedValue([
                { ...mockRecords[0], worked_minutes: 480 },
                { ...mockRecords[1], worked_minutes: 0 },
            ]);
            render(<AttendancePage />);

            const header = (await screen.findByRole('heading', { name: /Jun/ })).closest('header');
            expect(header).toHaveTextContent('8h');
            expect(header).toHaveTextContent('2 records');
        });

        it('splits the day header by status, so absences are visible without reading rows', async () => {
            const { api } = require('@/lib/api');
            api.getAttendance.mockResolvedValue(mockRecords);
            render(<AttendancePage />);

            const header = (await screen.findByRole('heading', { name: /Jun/ })).closest('header');
            expect(header).toHaveTextContent('1 Present');
            expect(header).toHaveTextContent('1 Absent');
        });

        it('reads the stored worked minutes rather than subtracting the clock times', async () => {
            const { api } = require('@/lib/api');
            // Nine hours between the stamps, but the schedule recorded eight —
            // an hour of break. The stored figure is the one payroll consumes.
            api.getAttendance.mockResolvedValue([
                {
                    ...mockRecords[0],
                    clock_in: '2026-06-01T08:00:00.000Z',
                    clock_out: '2026-06-01T17:00:00.000Z',
                    worked_minutes: 480,
                },
            ]);
            render(<AttendancePage />);

            const header = (await screen.findByRole('heading', { name: /Jun/ })).closest('header');
            expect(header).toHaveTextContent('8h');
            expect(header).not.toHaveTextContent('9h');
        });

        it('separates two dates into two day sections', async () => {
            const { api } = require('@/lib/api');
            api.getAttendance.mockResolvedValue([
                { ...mockRecords[0], worked_minutes: 480 },
                { ...mockRecords[1], id: 'att-3', date: '2026-05-31', worked_minutes: 240 },
            ]);
            render(<AttendancePage />);

            await screen.findByText('Alice Rahman');
            expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
        });
    });

    it('confirms before deleting a record instead of using a browser prompt', async () => {
        const { api } = require('@/lib/api');
        render(<AttendancePage />);

        fireEvent.click(
            (await screen.findAllByRole('button', { name: 'Delete attendance record' }))[0],
        );
        expect(api.deleteAttendance).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(api.deleteAttendance).toHaveBeenCalledWith('att-1'));
    });

    it('renders the Log Attendance button', async () => {
        render(<AttendancePage />);
        await waitFor(() => {
            expect(screen.getByText('Log Attendance')).toBeInTheDocument();
        });
    });

    it('renders date filter inputs', async () => {
        render(<AttendancePage />);
        // Named by `aria-label` rather than a visible caption, so the filter row
        // fits on one line on a phone without losing its accessible names.
        expect(await screen.findByLabelText('From')).toBeInTheDocument();
        expect(screen.getByLabelText('To')).toBeInTheDocument();
    });

    it('shows empty state when no records exist', async () => {
        const { api } = require('@/lib/api');
        api.getAttendance.mockResolvedValue([]);
        api.getEmployees.mockResolvedValue([]);
        render(<AttendancePage />);
        await waitFor(() => {
            expect(screen.queryByText('Alice Rahman')).not.toBeInTheDocument();
        });
    });

    it('calls getAttendance and getEmployees on mount', async () => {
        const { api } = require('@/lib/api');
        render(<AttendancePage />);
        await waitFor(() => {
            expect(api.getAttendance).toHaveBeenCalledTimes(1);
            expect(api.getEmployees).toHaveBeenCalledTimes(1);
        });
    });
});
