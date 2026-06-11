'use client';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EmployeeDetailPage from './page';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'emp-1' }),
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/employees/emp-1',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('../../../../lib/api', () => ({
    api: {
        getEmployee: jest.fn(),
        updateEmployee: jest.fn(),
        getDepartments: jest.fn(),
        getDesignations: jest.fn(),
        linkEmployeeUser: jest.fn(),
        unlinkEmployeeUser: jest.fn(),
        getMe: jest.fn(),
    },
}));

jest.mock('../../../../lib/format', () => ({
    formatDate: (v: string) => `DATE:${v}`,
}));

const mockEmployee = {
    id: 'emp-1',
    employee_code: 'EMP-001',
    name: 'Jane Smith',
    phone: '01711000001',
    email: 'jane@example.com',
    nid: '1234567890',
    date_of_joining: '2025-01-01T00:00:00Z',
    department_id: 'dept-1',
    designation_id: 'desig-1',
    user_id: null,
    status: 'ACTIVE',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    department: { id: 'dept-1', name: 'Sales' },
    designation: { id: 'desig-1', name: 'Manager' },
    user: null,
};

const mockDepartments = [
    { id: 'dept-1', name: 'Sales' },
    { id: 'dept-2', name: 'Engineering' },
];

const mockDesignations = [
    { id: 'desig-1', name: 'Manager' },
    { id: 'desig-2', name: 'Engineer' },
];

describe('EmployeeDetailPage', () => {
    beforeEach(() => {
        window.alert = jest.fn();

        const { api } = require('../../../../lib/api');
        api.getEmployee.mockResolvedValue(mockEmployee);
        api.updateEmployee.mockResolvedValue({ ...mockEmployee, name: 'Jane Updated' });
        api.getDepartments.mockResolvedValue(mockDepartments);
        api.getDesignations.mockResolvedValue(mockDesignations);
        api.linkEmployeeUser.mockResolvedValue({ ...mockEmployee, user_id: 'user-1' });
        api.unlinkEmployeeUser.mockResolvedValue({ ...mockEmployee, user_id: null });
        api.getMe.mockResolvedValue({ tenants: [] });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('shows loading state initially', () => {
        const { api } = require('../../../../lib/api');
        api.getEmployee.mockReturnValue(new Promise(() => {}));
        api.getDepartments.mockReturnValue(new Promise(() => {}));
        api.getDesignations.mockReturnValue(new Promise(() => {}));
        render(<EmployeeDetailPage />);
        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('renders employee details after loading', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('Jane Smith')).toBeInTheDocument();
        });
        expect(screen.getByText('EMP-001')).toBeInTheDocument();
    });

    it('shows "Employee not found" when API returns null', async () => {
        const { api } = require('../../../../lib/api');
        api.getEmployee.mockRejectedValue(new Error('Not found'));
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByText(/employee not found/i) || screen.getByText(/failed to load/i)).toBeInTheDocument();
        });
    });

    it('displays employee status badge', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('ACTIVE')).toBeInTheDocument();
        });
    });

    it('displays department and designation', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByText('Sales')).toBeInTheDocument();
            expect(screen.getByText('Manager')).toBeInTheDocument();
        });
    });

    it('renders edit form with employee data', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('Jane Smith')).toBeInTheDocument();
            expect(screen.getByDisplayValue('01711000001')).toBeInTheDocument();
        });
    });

    it('renders email field', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
        });
    });

    it('renders NID field', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('1234567890')).toBeInTheDocument();
        });
    });

    it('renders Save Changes button', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
        });
    });

    it('updates form when name input changes', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => screen.getByDisplayValue('Jane Smith'));
        fireEvent.change(screen.getByDisplayValue('Jane Smith'), {
            target: { value: 'Jane Updated' },
        });
        expect(screen.getByDisplayValue('Jane Updated')).toBeInTheDocument();
    });

    it('calls updateEmployee when Save Changes is submitted', async () => {
        const { api } = require('../../../../lib/api');
        render(<EmployeeDetailPage />);
        await waitFor(() => screen.getByRole('button', { name: /save changes/i }));
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => {
            expect(api.updateEmployee).toHaveBeenCalledWith(
                'emp-1',
                expect.objectContaining({ name: 'Jane Smith' }),
            );
        });
    });

    it('shows success message after saving', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => screen.getByRole('button', { name: /save changes/i }));
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => {
            expect(screen.getByText(/updated successfully/i)).toBeInTheDocument();
        });
    });

    it('shows error message when update fails', async () => {
        const { api } = require('../../../../lib/api');
        api.updateEmployee.mockRejectedValue(new Error('Update failed'));
        render(<EmployeeDetailPage />);
        await waitFor(() => screen.getByRole('button', { name: /save changes/i }));
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => {
            expect(screen.getByText(/failed to update/i) || screen.getByText(/update failed/i)).toBeInTheDocument();
        });
    });

    it('renders breadcrumb navigation to employees list', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('link', { name: /employees/i })).toBeInTheDocument();
        });
    });

    it('renders department select with options', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('Sales')).toBeInTheDocument();
        });
    });

    it('renders designation select with options', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByDisplayValue('Manager')).toBeInTheDocument();
        });
    });

    it('renders link user section', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            // Link section should appear when no user is linked
            expect(screen.getByText(/link/i)).toBeInTheDocument();
        });
    });

    it('shows status select with ACTIVE option', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            const statusSelect = screen.getByDisplayValue('ACTIVE');
            expect(statusSelect).toBeInTheDocument();
        });
    });

    it('shows unlink button when employee has linked user', async () => {
        const { api } = require('../../../../lib/api');
        api.getEmployee.mockResolvedValue({
            ...mockEmployee,
            user_id: 'user-1',
            user: { id: 'user-1', email: 'linked@example.com', name: 'Linked User' },
        });
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /unlink/i })).toBeInTheDocument();
        });
    });

    it('calls unlinkEmployeeUser when Unlink is clicked', async () => {
        const { api } = require('../../../../lib/api');
        api.getEmployee.mockResolvedValue({
            ...mockEmployee,
            user_id: 'user-1',
            user: { id: 'user-1', email: 'linked@example.com', name: 'Linked User' },
        });
        render(<EmployeeDetailPage />);
        await waitFor(() => screen.getByRole('button', { name: /unlink/i }));
        fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
        await waitFor(() => {
            expect(api.unlinkEmployeeUser).toHaveBeenCalledWith('emp-1');
        });
    });
});
