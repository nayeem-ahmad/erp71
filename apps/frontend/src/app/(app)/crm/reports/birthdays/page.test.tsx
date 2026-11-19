import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrmBirthdaysPage from './page';

const getCrmBirthdays = jest.fn();

jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true, useIsMdUp: () => true }));
jest.mock('@/lib/api', () => ({
    api: { getCrmBirthdays: (...args: unknown[]) => getCrmBirthdays(...args) },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    filters: { from: '2026-11-15', to: '2026-12-14' },
    days: 30,
    rows: [
        { customer_id: 'c1', name: 'Karim Ahmed', phone: '01711000001', birthday: '1992-11-20', next_birthday: '2026-11-20', days_until: 5, turning: 34, today: false },
        { customer_id: 'c2', name: 'Rahima Begum', phone: null, birthday: '1990-11-15', next_birthday: '2026-11-15', days_until: 0, turning: 36, today: true },
    ],
    total: 2,
    today: 1,
    ...overrides,
});

beforeEach(() => getCrmBirthdays.mockReset().mockResolvedValue(report()));

describe('CRM upcoming birthdays report', () => {
    it('asks for the next 30 days by default', async () => {
        render(<CrmBirthdaysPage />);

        await waitFor(() => expect(getCrmBirthdays).toHaveBeenCalledWith({ days: 30 }));
    });

    it('shows how many days away each birthday is', async () => {
        render(<CrmBirthdaysPage />);

        const row = await screen.findByRole('row', { name: /Karim Ahmed/ });
        expect(row.querySelector('[data-column-id="days_until"]')?.textContent).toBe('5');
        expect(row.querySelector('[data-column-id="turning"]')?.textContent).toBe('34');
    });

    it('marks a birthday that is today', async () => {
        render(<CrmBirthdaysPage />);

        expect(await screen.findByText('Today')).toBeInTheDocument();
    });

    it('refetches with a longer window', async () => {
        render(<CrmBirthdaysPage />);
        await waitFor(() => expect(getCrmBirthdays).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByRole('combobox', { name: 'Window' }), { target: { value: '90' } });

        await waitFor(() => expect(getCrmBirthdays).toHaveBeenCalledWith({ days: 90 }));
    });

    it('handles an empty window', async () => {
        getCrmBirthdays.mockResolvedValue(report({ rows: [], total: 0, today: 0 }));
        render(<CrmBirthdaysPage />);

        expect(await screen.findByText('No birthdays in this window.')).toBeInTheDocument();
    });
});
