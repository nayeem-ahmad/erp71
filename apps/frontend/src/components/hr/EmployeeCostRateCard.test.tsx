import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmployeeCostRateCard from './EmployeeCostRateCard';

jest.mock('@/lib/api', () => ({
    api: { getEmployeeCostRates: jest.fn(), createEmployeeCostRate: jest.fn(), deleteEmployeeCostRate: jest.fn() },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as {
    api: { getEmployeeCostRates: jest.Mock; createEmployeeCostRate: jest.Mock; deleteEmployeeCostRate: jest.Mock };
};

const settings = { standardMonthlyHours: 208, overheadPct: 0 };

describe('EmployeeCostRateCard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.createEmployeeCostRate.mockResolvedValue({});
        api.deleteEmployeeCostRate.mockResolvedValue({});
    });

    it('says an hour is priced from the salary when no rate is set', async () => {
        api.getEmployeeCostRates.mockResolvedValue({ rates: [], current: { hourlyCost: 200, source: 'SALARY' }, derivedFromSalary: 200, settings });
        render(<EmployeeCostRateCard employeeId="e1" canEdit={false} />);

        expect(await screen.findByText('From salary')).toBeInTheDocument();
        expect(screen.getByText('No rates set. Hours are priced from the salary.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add rate' })).not.toBeInTheDocument();
    });

    it('warns when nothing can price their hours', async () => {
        api.getEmployeeCostRates.mockResolvedValue({ rates: [], current: null, derivedFromSalary: null, settings });
        render(<EmployeeCostRateCard employeeId="e1" canEdit={false} />);

        expect(await screen.findByText(/no salary or cost rate/i)).toBeInTheDocument();
    });

    it('adds a rate from a date for someone who may edit', async () => {
        api.getEmployeeCostRates.mockResolvedValue({ rates: [], current: null, derivedFromSalary: null, settings });
        render(<EmployeeCostRateCard employeeId="e1" canEdit />);

        fireEvent.change(await screen.findByLabelText('Hourly cost'), { target: { value: '320' } });
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add rate' }));

        await waitFor(() =>
            expect(api.createEmployeeCostRate).toHaveBeenCalledWith('e1', { hourlyCost: 320, effectiveFrom: '2026-09-01' }),
        );
        expect(api.getEmployeeCostRates).toHaveBeenCalledTimes(2);
    });

    it('removes a rate', async () => {
        api.getEmployeeCostRates.mockResolvedValue({
            rates: [{ id: 'r1', hourlyCost: 320, effectiveFrom: '2026-09-01', note: null, createdAt: '' }],
            current: { hourlyCost: 320, source: 'RATE' },
            derivedFromSalary: 200,
            settings,
        });
        render(<EmployeeCostRateCard employeeId="e1" canEdit />);

        fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(api.deleteEmployeeCostRate).toHaveBeenCalledWith('e1', 'r1'));
    });
});
