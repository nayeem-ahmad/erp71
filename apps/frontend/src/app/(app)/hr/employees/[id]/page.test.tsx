'use client';

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import EmployeeDetailPage from './page';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'emp-1' }),
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/hr/employees/emp-1',
    useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getEmployee: jest.fn(),
        updateEmployee: jest.fn(),
        getDepartments: jest.fn(),
        getDesignations: jest.fn(),
        linkEmployeeUser: jest.fn(),
        unlinkEmployeeUser: jest.fn(),
        grantEmployeePortalAccess: jest.fn(),
        revokeEmployeePortalAccess: jest.fn(),
        createEmployeeLogin: jest.fn(),
        resetEmployeeLoginPassword: jest.fn(),
        revokeEmployeeLogin: jest.fn(),
        getMe: jest.fn(),
    },
}));

jest.mock('@/lib/format', () => ({
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

        const { api } = require('@/lib/api');
        api.getEmployee.mockResolvedValue(mockEmployee);
        api.updateEmployee.mockResolvedValue({ ...mockEmployee, name: 'Jane Updated' });
        api.getDepartments.mockResolvedValue(mockDepartments);
        api.getDesignations.mockResolvedValue(mockDesignations);
        api.linkEmployeeUser.mockResolvedValue({ ...mockEmployee, user_id: 'user-1' });
        api.unlinkEmployeeUser.mockResolvedValue({ ...mockEmployee, user_id: null });
        api.createEmployeeLogin.mockResolvedValue({
            employee_id: 'emp-1',
            has_login: true,
            portal_access: true,
            sign_in_identifier: '+8801711000001',
            must_change_password: true,
            password: 'Hunter7Gecko#4',
        });
        api.resetEmployeeLoginPassword.mockResolvedValue({
            employee_id: 'emp-1',
            has_login: true,
            portal_access: true,
            sign_in_identifier: '+8801711000001',
            must_change_password: true,
            password: 'Marble9Tundra@2',
        });
        api.revokeEmployeeLogin.mockResolvedValue({
            employee_id: 'emp-1',
            has_login: true,
            portal_access: false,
            sign_in_identifier: '+8801711000001',
            must_change_password: false,
        });
        api.getMe.mockResolvedValue({ tenants: [] });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('shows loading state initially', () => {
        const { api } = require('@/lib/api');
        api.getEmployee.mockReturnValue(new Promise(() => {}));
        api.getDepartments.mockReturnValue(new Promise(() => {}));
        api.getDesignations.mockReturnValue(new Promise(() => {}));
        render(<EmployeeDetailPage />);
        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('renders employee details after loading', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Jane Smith' })).toBeInTheDocument();
        });
        expect(screen.getAllByText('EMP-001').length).toBeGreaterThan(0);
    });

    it('shows "Employee not found" when API returns null', async () => {
        const { api } = require('@/lib/api');
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
            expect(screen.getAllByText('Sales').length).toBeGreaterThan(0);
            expect(screen.getAllByText('Manager').length).toBeGreaterThan(0);
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
        const { api } = require('@/lib/api');
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
        const { api } = require('@/lib/api');
        api.updateEmployee.mockRejectedValue(new Error('Update failed'));
        render(<EmployeeDetailPage />);
        await waitFor(() => screen.getByRole('button', { name: /save changes/i }));
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
        await waitFor(() => {
            // Either 'Failed to update employee.' or the error message from the API
            const errorEl = screen.queryByText(/failed to update/i) ||
                screen.queryByText(/update failed/i);
            expect(errorEl).not.toBeNull();
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

    it('offers linking an existing account behind a disclosure, not as an equal choice', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => screen.getByRole('button', { name: /create login/i }));

        // Hidden until asked for: creating a login is the answer for nearly
        // everyone, and two primary-looking options would make it a decision.
        expect(screen.queryByPlaceholderText(/paste user id/i)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /link an existing user account/i }));
        expect(screen.getByPlaceholderText(/paste user id/i)).toBeInTheDocument();
    });

    it('shows status select with Active option', async () => {
        render(<EmployeeDetailPage />);
        await waitFor(() => {
            // Status select shows "Active" (display text) not "ACTIVE" (value)
            const statusSelect = screen.getByDisplayValue('Active');
            expect(statusSelect).toBeInTheDocument();
        });
    });

    it('shows unlink button when employee has linked user', async () => {
        const { api } = require('@/lib/api');
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
        const { api } = require('@/lib/api');
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

    /**
     * The generated password comes back once and is never readable again, so
     * what these pin is that it reaches the screen and that nothing dismisses
     * the dialog by accident.
     */
    describe('employee login', () => {
        const withLogin = {
            ...mockEmployee,
            user_id: 'user-1',
            portal_access: true,
            user: {
                id: 'user-1',
                email: 'emp-emp-1@employee.erp71.invalid',
                name: 'Jane Smith',
                mobile: '+8801711000001',
                must_change_password: true,
            },
        };

        it('offers to create a login for an employee who has none', async () => {
            render(<EmployeeDetailPage />);
            await waitFor(() => {
                expect(screen.getByRole('button', { name: /create login/i })).toBeInTheDocument();
            });
        });

        it('shows the generated password once the login is created', async () => {
            const { api } = require('@/lib/api');
            render(<EmployeeDetailPage />);
            await waitFor(() => screen.getByRole('button', { name: /create login/i }));

            fireEvent.click(screen.getByRole('button', { name: /create login/i }));

            await waitFor(() => {
                expect(api.createEmployeeLogin).toHaveBeenCalledWith('emp-1');
            });
            const dialog = await screen.findByRole('dialog');
            expect(within(dialog).getByText('Hunter7Gecko#4')).toBeInTheDocument();
            // The number they sign in with, beside the password they sign in
            // with — handing over one without the other is useless.
            expect(within(dialog).getByText('+8801711000001')).toBeInTheDocument();
        });

        it('switches the panel to the has-login state without a refetch', async () => {
            const { api } = require('@/lib/api');
            render(<EmployeeDetailPage />);
            await waitFor(() => screen.getByRole('button', { name: /create login/i }));
            fireEvent.click(screen.getByRole('button', { name: /create login/i }));

            // The employee row in state still says `user: null` — the create
            // response is the only thing that knows better, and without reading
            // it the panel would offer to create the login it just created.
            await waitFor(() => {
                expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
            });
            expect(screen.queryByRole('button', { name: /create login/i })).not.toBeInTheDocument();
            expect(api.getEmployee).toHaveBeenCalledTimes(1);
        });

        it('warns that the password is not shown again', async () => {
            render(<EmployeeDetailPage />);
            await waitFor(() => screen.getByRole('button', { name: /create login/i }));
            fireEvent.click(screen.getByRole('button', { name: /create login/i }));

            expect(await screen.findByText(/not shown again/i)).toBeInTheDocument();
        });

        it('surfaces the reason when the number already belongs to someone', async () => {
            const { api } = require('@/lib/api');
            api.createEmployeeLogin.mockRejectedValue(
                new Error('An account already uses this mobile number. Link that user to this employee instead.'),
            );
            render(<EmployeeDetailPage />);
            await waitFor(() => screen.getByRole('button', { name: /create login/i }));
            fireEvent.click(screen.getByRole('button', { name: /create login/i }));

            expect(await screen.findByText(/already uses this mobile number/i)).toBeInTheDocument();
            expect(screen.queryByText(/not shown again/i)).not.toBeInTheDocument();
        });

        it('shows the sign-in number rather than the placeholder address', async () => {
            const { api } = require('@/lib/api');
            api.getEmployee.mockResolvedValue(withLogin);
            render(<EmployeeDetailPage />);

            await waitFor(() => {
                expect(screen.getByText('+8801711000001')).toBeInTheDocument();
            });
            // `emp-…@employee.erp71.invalid` is a value in a NOT NULL column,
            // not an address anyone can be reached at.
            expect(screen.queryByText(/erp71\.invalid/)).not.toBeInTheDocument();
        });

        it('says when the employee has not replaced the temporary password', async () => {
            const { api } = require('@/lib/api');
            api.getEmployee.mockResolvedValue(withLogin);
            render(<EmployeeDetailPage />);

            await waitFor(() => {
                expect(screen.getByText(/have not set their own password/i)).toBeInTheDocument();
            });
        });

        it('mints a new password on reset', async () => {
            const { api } = require('@/lib/api');
            api.getEmployee.mockResolvedValue(withLogin);
            render(<EmployeeDetailPage />);
            await waitFor(() => screen.getByRole('button', { name: /reset password/i }));

            fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

            await waitFor(() => {
                expect(api.resetEmployeeLoginPassword).toHaveBeenCalledWith('emp-1');
            });
            expect(await screen.findByText('Marble9Tundra@2')).toBeInTheDocument();
        });

        it('ends the session when portal access is switched off', async () => {
            const { api } = require('@/lib/api');
            api.getEmployee.mockResolvedValue(withLogin);
            render(<EmployeeDetailPage />);
            await waitFor(() => screen.getByRole('button', { name: /disable self-service portal/i }));

            fireEvent.click(screen.getByRole('button', { name: /disable self-service portal/i }));

            // Through the login revoke, not `revokeEmployeePortalAccess`: only
            // the former bumps `token_version`, and without that the employee
            // keeps a working token until it expires.
            await waitFor(() => {
                expect(api.revokeEmployeeLogin).toHaveBeenCalledWith('emp-1');
            });
            expect(api.revokeEmployeePortalAccess).not.toHaveBeenCalled();
            expect(screen.queryByText(/not shown again/i)).not.toBeInTheDocument();
        });

        it('offers one way to switch access off, not two that differ invisibly', async () => {
            const { api } = require('@/lib/api');
            api.getEmployee.mockResolvedValue(withLogin);
            render(<EmployeeDetailPage />);
            await waitFor(() => screen.getByRole('button', { name: /disable self-service portal/i }));

            expect(screen.queryByRole('button', { name: /remove login/i })).not.toBeInTheDocument();
        });

        it('uses the same endpoint for an employee linked to a staff account', async () => {
            // Whether signing that account out is right is the server's call —
            // it only does so when the portal was the whole of their access. The
            // screen does not have to know which case it is looking at.
            const { api } = require('@/lib/api');
            api.getEmployee.mockResolvedValue({
                ...withLogin,
                user: { id: 'user-1', email: 'boss@shop.com.bd', name: 'Owner' },
            });
            render(<EmployeeDetailPage />);
            await waitFor(() => screen.getByRole('button', { name: /disable self-service portal/i }));

            fireEvent.click(screen.getByRole('button', { name: /disable self-service portal/i }));

            await waitFor(() => {
                expect(api.revokeEmployeeLogin).toHaveBeenCalledWith('emp-1');
            });
            expect(api.revokeEmployeePortalAccess).not.toHaveBeenCalled();
        });
    });
});
