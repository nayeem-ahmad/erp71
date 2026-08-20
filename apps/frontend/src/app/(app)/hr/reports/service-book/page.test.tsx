import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ServiceBookPage from './page';

const getServiceBook = jest.fn();

// The revision note rides in a `hideOnMobile` column and jsdom reports no
// matchMedia match, so the desktop layout has to be asked for explicitly.
jest.mock('@/hooks/useMediaQuery', () => ({
    ...jest.requireActual('@/hooks/useMediaQuery'),
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getEmployees: jest.fn(),
        getServiceBook: (...args: unknown[]) => getServiceBook(...args),
    },
}));

const book = (overrides: Record<string, unknown> = {}) => ({
    employee: {
        id: 'e1', employee_code: 'EMP-001', name: 'Rina Akter', phone: '01700000000',
        date_of_joining: '2024-01-15', status: 'ACTIVE',
        last_working_day: null, exit_reason: null,
        department: { name: 'Sales' }, designation: { name: 'Cashier' },
    },
    salary_revisions: [{ effective_from: '2025-01-01', note: 'Annual review', line_count: 4 }],
    leave_taken: [{ leave_type: 'Annual', start_date: '2025-04-01', end_date: '2025-04-03', days: 3 }],
    total_leave_days: 3,
    months_paid: 14,
    notes: ['Department and designation history is not recorded; only the current assignment is shown.'],
    ...overrides,
});

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    getServiceBook.mockReset().mockResolvedValue(book());
    api.getEmployees.mockReset().mockResolvedValue([
        { id: 'e1', name: 'Rina Akter', employee_code: 'EMP-001' },
    ]);
});

describe('Service book', () => {
    it('fetches nothing until an employee is chosen', async () => {
        render(<ServiceBookPage />);

        await waitFor(() => expect(screen.getByText('EMP-001 · Rina Akter')).toBeInTheDocument());
        expect(getServiceBook).not.toHaveBeenCalled();
    });

    it('loads the chosen employee record', async () => {
        render(<ServiceBookPage />);
        await waitFor(() => expect(screen.getByText('EMP-001 · Rina Akter')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });

        await waitFor(() => expect(getServiceBook).toHaveBeenCalledWith('e1'));
        expect(await screen.findByText('Annual review')).toBeInTheDocument();
        expect(screen.getByText('Salary revisions')).toBeInTheDocument();
    });

    it('renders the caveat the endpoint ships with its figures', async () => {
        render(<ServiceBookPage />);
        await waitFor(() => expect(screen.getByText('EMP-001 · Rina Akter')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });

        // The note is load-bearing: without it the page implies a job history
        // the system does not actually record.
        expect(await screen.findByText(/Department and designation history is not recorded/))
            .toBeInTheDocument();
    });

    it('says so when the employee has no record', async () => {
        getServiceBook.mockResolvedValue(null);
        render(<ServiceBookPage />);
        await waitFor(() => expect(screen.getByText('EMP-001 · Rina Akter')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });

        expect(await screen.findByText('No record for this employee.')).toBeInTheDocument();
    });
});
