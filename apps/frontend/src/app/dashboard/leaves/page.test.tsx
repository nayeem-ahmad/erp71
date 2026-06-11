'use client';

import { render, screen, waitFor } from '@testing-library/react';
import LeavesPage from './page';

jest.mock('../../../lib/api', () => ({
    api: {
        getLeaveRequests: jest.fn(),
        getLeaveTypes: jest.fn(),
        getEmployees: jest.fn(),
        createLeaveRequest: jest.fn(),
        reviewLeaveRequest: jest.fn(),
        cancelLeaveRequest: jest.fn(),
        createLeaveType: jest.fn(),
        updateLeaveType: jest.fn(),
        deleteLeaveType: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/leaves',
    useSearchParams: () => ({ get: jest.fn() }),
}));

describe('LeavesPage', () => {
    beforeEach(() => {
        const { api } = require('../../../lib/api');
        api.getLeaveRequests.mockResolvedValue([]);
        api.getLeaveTypes.mockResolvedValue([]);
        api.getEmployees.mockResolvedValue([]);
        jest.clearAllMocks();
    });

    it('renders the page heading', async () => {
        const { api } = require('../../../lib/api');
        api.getLeaveRequests.mockResolvedValue([]);
        api.getLeaveTypes.mockResolvedValue([]);
        api.getEmployees.mockResolvedValue([]);
        render(<LeavesPage />);
        await waitFor(() => {
            expect(screen.getByText('Leaves')).toBeInTheDocument();
        });
    });

    it('displays loaded leave requests', async () => {
        const { api } = require('../../../lib/api');
        api.getLeaveRequests.mockResolvedValue([
            {
                id: '1',
                employee_id: 'e1',
                leave_type_id: 'lt1',
                start_date: '2025-06-01',
                end_date: '2025-06-03',
                days: 3,
                reason: 'Family visit',
                status: 'PENDING',
                approver_note: null,
                created_at: '2025-05-20T00:00:00Z',
                employee: { id: 'e1', name: 'Karim Hossain', employee_code: 'EMP001' },
                leave_type: { id: 'lt1', name: 'Annual Leave', days_per_year: 20 },
                approver: null,
            },
        ]);
        api.getLeaveTypes.mockResolvedValue([{ id: 'lt1', name: 'Annual Leave', days_per_year: 20 }]);
        api.getEmployees.mockResolvedValue([{ id: 'e1', name: 'Karim Hossain', employee_code: 'EMP001' }]);
        render(<LeavesPage />);
        await waitFor(() => {
            expect(screen.getByText('Karim Hossain')).toBeInTheDocument();
        });
    });

    it('handles empty leave requests', async () => {
        const { api } = require('../../../lib/api');
        api.getLeaveRequests.mockResolvedValue([]);
        api.getLeaveTypes.mockResolvedValue([]);
        api.getEmployees.mockResolvedValue([]);
        render(<LeavesPage />);
        await waitFor(() => {
            expect(screen.getByText('Leaves')).toBeInTheDocument();
        });
    });

    it('renders the New Request button', async () => {
        const { api } = require('../../../lib/api');
        api.getLeaveRequests.mockResolvedValue([]);
        api.getLeaveTypes.mockResolvedValue([]);
        api.getEmployees.mockResolvedValue([]);
        render(<LeavesPage />);
        await waitFor(() => {
            expect(screen.getByText('New Request')).toBeInTheDocument();
        });
    });
});
