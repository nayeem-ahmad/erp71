import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WagesRegisterPage from './page';

const getWagesRegister = jest.fn();

jest.mock('@/lib/api', () => ({
    api: { getWagesRegister: (...args: unknown[]) => getWagesRegister(...args) },
}));

const register = (overrides: Record<string, unknown> = {}) => ({
    period: { year: 2026, month: 3 },
    rows: [
        {
            employee_code: 'EMP-001', employee_name: 'Rina Akter',
            designation: 'Cashier', department: 'Sales',
            scheduled_days: 26, present_days: 24, overtime_minutes: 120,
            gross_earnings: 30000, total_deductions: 3000, net_pay: 27000,
        },
    ],
    totals: { gross_earnings: 30000, total_deductions: 3000, net_pay: 27000 },
    ...overrides,
});

beforeEach(() => {
    getWagesRegister.mockReset().mockResolvedValue(register());
});

describe('Wages register', () => {
    it('opens on the current month', async () => {
        render(<WagesRegisterPage />);

        await waitFor(() => expect(getWagesRegister).toHaveBeenCalled());
        const now = new Date();
        expect(getWagesRegister.mock.calls[0][0]).toEqual({
            year: now.getFullYear(),
            month: now.getMonth() + 1,
        });
    });

    it('renders the salary sheet a labour inspection asks for', async () => {
        render(<WagesRegisterPage />);

        expect(await screen.findByText('Rina Akter')).toBeInTheDocument();
        expect(screen.getByText('EMP-001 · Cashier')).toBeInTheDocument();
        expect(screen.getAllByText('৳ 27,000.00').length).toBeGreaterThan(0);
    });

    it('refetches when the month changes', async () => {
        render(<WagesRegisterPage />);
        await waitFor(() => expect(getWagesRegister).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByLabelText('Month'), { target: { value: '3' } });

        await waitFor(() => expect(getWagesRegister).toHaveBeenCalledTimes(2));
        expect(getWagesRegister.mock.calls[1][0].month).toBe(3);
    });

    it('says the month has no settled run rather than showing a generic empty table', async () => {
        getWagesRegister.mockResolvedValue(register({ rows: [], totals: null }));
        render(<WagesRegisterPage />);

        expect(await screen.findByText('No settled payroll run for this month.'))
            .toBeInTheDocument();
    });
});
