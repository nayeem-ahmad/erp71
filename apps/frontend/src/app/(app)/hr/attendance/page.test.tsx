'use client';

import { render, screen, waitFor } from '@testing-library/react';
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
        await waitFor(() => {
            expect(screen.getByText('Present')).toBeInTheDocument();
            expect(screen.getByText('Absent')).toBeInTheDocument();
        });
    });

    it('renders the Log Attendance button', async () => {
        render(<AttendancePage />);
        await waitFor(() => {
            expect(screen.getByText('Log Attendance')).toBeInTheDocument();
        });
    });

    it('renders date filter inputs', async () => {
        render(<AttendancePage />);
        await waitFor(() => {
            expect(screen.getByText('From')).toBeInTheDocument();
            expect(screen.getByText('To')).toBeInTheDocument();
        });
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
