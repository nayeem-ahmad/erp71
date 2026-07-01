'use client';

import { render, screen, waitFor } from '@testing-library/react';
import EmployeesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getEmployees: jest.fn(),
        createEmployee: jest.fn(),
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
    usePathname: () => '/hr/employees',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// AddEmployeeModal is rendered inside the page; stub it to avoid deep dependency tree
jest.mock('./AddEmployeeModal', () => {
    const MockModal = ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="add-employee-modal" /> : null;
    MockModal.displayName = 'AddEmployeeModal';
    return MockModal;
});

const mockEmployees = [
    {
        id: 'emp-1',
        employee_code: 'EMP001',
        name: 'Alice Rahman',
        phone: '01700000001',
        email: 'alice@example.com',
        date_of_joining: '2024-01-15T00:00:00.000Z',
        status: 'ACTIVE',
        created_at: '2024-01-15T00:00:00.000Z',
        department: { id: 'dept-1', name: 'Sales' },
        designation: { id: 'des-1', name: 'Manager' },
        user: null,
    },
    {
        id: 'emp-2',
        employee_code: 'EMP002',
        name: 'Bob Hossain',
        phone: '01700000002',
        email: null,
        date_of_joining: null,
        status: 'INACTIVE',
        created_at: '2024-02-01T00:00:00.000Z',
        department: null,
        designation: null,
        user: { id: 'usr-1', email: 'bob@example.com', name: 'Bob' },
    },
];

describe('EmployeesPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getEmployees.mockResolvedValue(mockEmployees);
        api.createEmployee.mockResolvedValue({});
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Employees heading', async () => {
        render(<EmployeesPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Employees' })).toBeInTheDocument();
        });
    });

    it('displays employees loaded from the API', async () => {
        render(<EmployeesPage />);
        await waitFor(() => {
            expect(screen.getByText('Alice Rahman')).toBeInTheDocument();
            expect(screen.getByText('Bob Hossain')).toBeInTheDocument();
        });
    });

    it('displays employee codes', async () => {
        render(<EmployeesPage />);
        await waitFor(() => {
            expect(screen.getByText('EMP001')).toBeInTheDocument();
            expect(screen.getByText('EMP002')).toBeInTheDocument();
        });
    });

    it('shows department name when available', async () => {
        render(<EmployeesPage />);
        await waitFor(() => {
            expect(screen.getByText('Sales')).toBeInTheDocument();
        });
    });

    it('shows empty state when no employees exist', async () => {
        const { api } = require('@/lib/api');
        api.getEmployees.mockResolvedValue([]);
        render(<EmployeesPage />);
        await waitFor(() => {
            expect(screen.queryByText('Alice Rahman')).not.toBeInTheDocument();
        });
    });

    it('renders the New Employee button', async () => {
        render(<EmployeesPage />);
        await waitFor(() => {
            expect(screen.getByText('New Employee')).toBeInTheDocument();
        });
    });

    it('calls getEmployees on mount', async () => {
        const { api } = require('@/lib/api');
        render(<EmployeesPage />);
        await waitFor(() => {
            expect(api.getEmployees).toHaveBeenCalledTimes(1);
        });
    });
});
