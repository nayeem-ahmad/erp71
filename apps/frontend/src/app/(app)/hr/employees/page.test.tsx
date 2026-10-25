'use client';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import EmployeesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getEmployees: jest.fn(),
        createEmployee: jest.fn(),
        updateEmployee: jest.fn(),
        getDepartments: jest.fn(),
        getDesignations: jest.fn(),
        importEmployees: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@/lib/use-tenant-plan-features', () => ({
    useTenantPlanFeatures: () => ({ permissions: ['VIEW_PAYROLL'], role: 'MANAGER' }),
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/hr/employees',
    useSearchParams: () => ({ get: jest.fn() }),
}));

// DataTable hides `hideOnMobile` columns and moves the toolbar filters into a
// sheet on a narrow viewport, which is all the global matchMedia mock reports.
let mockMdUp = false;
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => mockMdUp,
    useIsMdUp: () => mockMdUp,
}));

const mockEmployees = [
    {
        id: 'emp-1',
        employee_code: 'EMP001',
        name: 'Alice Rahman',
        phone: '01700000001',
        email: 'alice@example.com',
        nid: '1990123456',
        date_of_joining: '2024-01-15T00:00:00.000Z',
        department_id: 'dept-1',
        designation_id: 'des-1',
        basic_salary: '25000',
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
        department_id: null,
        designation_id: null,
        basic_salary: null,
        status: 'INACTIVE',
        created_at: '2024-02-01T00:00:00.000Z',
        department: null,
        designation: null,
        user: { id: 'usr-1', email: 'bob@example.com', name: 'Bob', mobile: '01700000002' },
    },
];

function rowOf(name: string) {
    return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('EmployeesPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getEmployees.mockResolvedValue(mockEmployees);
        api.createEmployee.mockResolvedValue({});
        api.getDepartments.mockResolvedValue([{ id: 'dept-1', name: 'Sales' }]);
        api.getDesignations.mockResolvedValue([{ id: 'des-1', name: 'Manager' }]);
    });

    afterEach(() => {
        jest.clearAllMocks();
        mockMdUp = false;
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

    it('displays employee codes and department names on a wide screen', async () => {
        mockMdUp = true;
        render(<EmployeesPage />);
        await waitFor(() => {
            expect(screen.getByText('EMP001')).toBeInTheDocument();
            expect(screen.getByText('EMP002')).toBeInTheDocument();
            expect(within(rowOf('Alice Rahman')).getByText('Sales')).toBeInTheDocument();
        });
    });

    it('shows how a linked employee signs in, not their account email', async () => {
        mockMdUp = true;
        render(<EmployeesPage />);
        const row = await waitFor(() => rowOf('Bob Hossain'));
        expect(within(row).getAllByText('01700000002').length).toBeGreaterThan(0);
        expect(within(row).queryByText('bob@example.com')).not.toBeInTheDocument();
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

    it('searches in the table toolbar box, with the list view options beside it', async () => {
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        expect(screen.getByRole('button', { name: 'View options' })).toBeInTheDocument();
        expect(screen.getAllByPlaceholderText(/search/i)).toHaveLength(1);
        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'bob' } });

        await waitFor(() => expect(screen.queryByText('Alice Rahman')).not.toBeInTheDocument());
        expect(screen.getByText('Bob Hossain')).toBeInTheDocument();
    });

    it('filters by an exact status from the toolbar, so Active leaves out Inactive', async () => {
        mockMdUp = true;
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'ACTIVE' } });

        await waitFor(() => expect(screen.queryByText('Bob Hossain')).not.toBeInTheDocument());
        expect(screen.getByText('Alice Rahman')).toBeInTheDocument();
    });

    it('filters by department from the toolbar', async () => {
        mockMdUp = true;
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'Sales' } });

        await waitFor(() => expect(screen.queryByText('Bob Hossain')).not.toBeInTheDocument());
        expect(screen.getByText('Alice Rahman')).toBeInTheDocument();
    });

    it('shows statuses by name', async () => {
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');
        expect(within(rowOf('Alice Rahman')).getByText('Active')).toBeInTheDocument();
        expect(within(rowOf('Bob Hossain')).getByText('Inactive')).toBeInTheDocument();
    });

    it('deactivates an active employee after asking, and offers Activate on the row', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.updateEmployee.mockResolvedValue({ ...mockEmployees[0], status: 'INACTIVE' });
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.click(within(rowOf('Alice Rahman')).getByRole('button', { name: 'Deactivate' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Deactivate this employee?')).toBeInTheDocument();
        expect(within(dialog).getByText(/Alice Rahman stays on record/)).toBeInTheDocument();
        expect(api.updateEmployee).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

        await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledWith('emp-1', { status: 'INACTIVE' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(toast.success).toHaveBeenCalledWith('Alice Rahman is now inactive.');
        expect(within(rowOf('Alice Rahman')).getByRole('button', { name: 'Activate' })).toBeInTheDocument();
        expect(within(rowOf('Alice Rahman')).getByText('Inactive')).toBeInTheDocument();
        // The row is swapped in place, not the whole roster refetched.
        expect(api.getEmployees).toHaveBeenCalledTimes(1);
    });

    it('activates an inactive employee', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.updateEmployee.mockResolvedValue({ ...mockEmployees[1], status: 'ACTIVE' });
        render(<EmployeesPage />);
        await screen.findByText('Bob Hossain');

        fireEvent.click(within(rowOf('Bob Hossain')).getByRole('button', { name: 'Activate' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activate' }));

        await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledWith('emp-2', { status: 'ACTIVE' }));
        expect(toast.success).toHaveBeenCalledWith('Bob Hossain is active again.');
        await waitFor(() => expect(within(rowOf('Bob Hossain')).getByText('Active')).toBeInTheDocument());
    });

    it('keeps the row as it was and says so when the status change fails', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.updateEmployee.mockRejectedValue(new Error('Forbidden resource'));
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.click(within(rowOf('Alice Rahman')).getByRole('button', { name: 'Deactivate' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Forbidden resource'));
        expect(within(rowOf('Alice Rahman')).getByText('Active')).toBeInTheDocument();
    });

    it('offers Activate to someone who has left, and Deactivate to someone on probation', async () => {
        const { api } = require('@/lib/api');
        api.getEmployees.mockResolvedValue([
            { ...mockEmployees[0], status: 'PROBATION' },
            { ...mockEmployees[1], status: 'RESIGNED' },
        ]);
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        expect(within(rowOf('Alice Rahman')).getByText('On probation')).toBeInTheDocument();
        expect(within(rowOf('Alice Rahman')).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
        expect(within(rowOf('Bob Hossain')).getByText('Resigned')).toBeInTheDocument();
        expect(within(rowOf('Bob Hossain')).getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    });

    it('edits an employee from the row: the form opens filled in and saves without touching the status', async () => {
        const { api } = require('@/lib/api');
        const { toast } = require('@/lib/toast');
        api.updateEmployee.mockResolvedValue({ ...mockEmployees[0], name: 'Alice R. Khan' });
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.click(within(rowOf('Alice Rahman')).getByRole('button', { name: 'Edit' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Edit Employee')).toBeInTheDocument();
        expect(within(dialog).getByDisplayValue('Alice Rahman')).toBeInTheDocument();
        expect(within(dialog).getByDisplayValue('01700000001')).toBeInTheDocument();
        expect(within(dialog).getByDisplayValue('2024-01-15')).toBeInTheDocument();
        expect(within(dialog).getByDisplayValue('25000')).toBeInTheDocument();
        // Status moves through Activate / Deactivate, not the form.
        expect(within(dialog).queryByText('Status')).not.toBeInTheDocument();

        fireEvent.change(within(dialog).getByDisplayValue('Alice Rahman'), { target: { value: 'Alice R. Khan' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledTimes(1));
        const [id, payload] = api.updateEmployee.mock.calls[0];
        expect(id).toBe('emp-1');
        expect(payload).toEqual({
            name: 'Alice R. Khan',
            phone: '01700000001',
            email: 'alice@example.com',
            nid: '1990123456',
            date_of_joining: '2024-01-15',
            department_id: 'dept-1',
            designation_id: 'des-1',
            basic_salary: 25000,
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(toast.success).toHaveBeenCalledWith('Employee updated successfully.');
        expect(screen.getByText('Alice R. Khan')).toBeInTheDocument();
    });

    it('clears an emptied department on edit', async () => {
        const { api } = require('@/lib/api');
        api.updateEmployee.mockResolvedValue({ ...mockEmployees[0], department_id: null, department: null });
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.click(within(rowOf('Alice Rahman')).getByRole('button', { name: 'Edit' }));
        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Sales' })).toBeInTheDocument());
        const department = within(dialog).getByDisplayValue('Sales');
        fireEvent.change(department, { target: { value: '' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledTimes(1));
        expect(api.updateEmployee.mock.calls[0][1]).toMatchObject({ department_id: null });
    });

    it('does not send the salary when editing an employee whose salary this user cannot see', async () => {
        const { api } = require('@/lib/api');
        const { basic_salary: _hidden, ...withoutSalary } = mockEmployees[0];
        api.getEmployees.mockResolvedValue([withoutSalary]);
        api.updateEmployee.mockResolvedValue(withoutSalary);
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.click(within(rowOf('Alice Rahman')).getByRole('button', { name: 'Edit' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).queryByText('Basic Salary')).not.toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledTimes(1));
        expect(api.updateEmployee.mock.calls[0][1]).not.toHaveProperty('basic_salary');
    });

    it('opens an empty form, with a status, for a new employee', async () => {
        const { api } = require('@/lib/api');
        render(<EmployeesPage />);
        await screen.findByText('Alice Rahman');

        fireEvent.click(screen.getByText('New Employee'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Add to staff directory')).toBeInTheDocument();
        expect(within(dialog).getByText('Status')).toBeInTheDocument();
        expect(within(dialog).queryByDisplayValue('Alice Rahman')).not.toBeInTheDocument();

        fireEvent.change(within(dialog).getByPlaceholderText('Rahim Uddin'), { target: { value: 'Karim' } });
        fireEvent.change(within(dialog).getByPlaceholderText('+8801234567890'), { target: { value: '01800000000' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add Employee' }));

        await waitFor(() => expect(api.createEmployee).toHaveBeenCalledWith({ name: 'Karim', phone: '01800000000', status: 'ACTIVE' }));
        await waitFor(() => expect(api.getEmployees).toHaveBeenCalledTimes(2));
    });
});
