import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SchedulesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getHolidays: jest.fn(),
        createHoliday: jest.fn(),
        updateHoliday: jest.fn(),
        deleteHoliday: jest.fn(),
        getWorkSchedules: jest.fn(),
        createWorkSchedule: jest.fn(),
        updateWorkSchedule: jest.fn(),
        deleteWorkSchedule: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    useToastStore: (selector: any) => selector({ show: jest.fn() }),
}));

const { api } = jest.requireMock('@/lib/api');

const STANDARD = {
    id: 'sched-1',
    name: 'Standard',
    is_default: true,
    days: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        is_working: weekday <= 4,
        start_minute: weekday <= 4 ? 540 : null,
        end_minute: weekday <= 4 ? 1080 : null,
        break_minutes: weekday <= 4 ? 60 : 0,
    })),
};

const seed = (holidays: any[] = [], schedules: any[] = []) => {
    api.getHolidays.mockResolvedValue(holidays);
    api.getWorkSchedules.mockResolvedValue(schedules);
};

describe('SchedulesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.confirm = jest.fn(() => true);
    });

    it('lists the year’s holidays', async () => {
        seed([{ id: 'h-1', date: '2026-04-14', name: 'Pohela Boishakh' }]);
        render(<SchedulesPage />);
        await waitFor(() => expect(screen.getByText('Pohela Boishakh')).toBeInTheDocument());
    });

    it('shows an empty state rather than a bare table', async () => {
        seed([]);
        render(<SchedulesPage />);
        await waitFor(() => expect(screen.getByText(/no holidays set/i)).toBeInTheDocument());
    });

    it('reloads holidays when the year changes', async () => {
        seed([]);
        render(<SchedulesPage />);
        // Wait for the render, not just the call — the year picker does not
        // exist while the page is still loading.
        await waitFor(() => expect(screen.getByText(/no holidays set/i)).toBeInTheDocument());

        const thisYear = new Date().getFullYear();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: String(thisYear - 1) } });

        await waitFor(() => expect(api.getHolidays).toHaveBeenLastCalledWith(thisYear - 1));
    });

    it('surfaces a load failure', async () => {
        api.getHolidays.mockRejectedValue(new Error('boom'));
        api.getWorkSchedules.mockResolvedValue([]);
        render(<SchedulesPage />);
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    });

    describe('schedules tab', () => {
        it('marks the default schedule and sums its weekly hours', async () => {
            seed([], [STANDARD]);
            render(<SchedulesPage />);
            await waitFor(() => expect(api.getWorkSchedules).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /work schedules/i }));
            expect(screen.getByText('Standard')).toBeInTheDocument();
            expect(screen.getByText('Default')).toBeInTheDocument();
            // 5 days × (9h − 1h break) = 40h
            expect(screen.getByText('40h per week')).toBeInTheDocument();
        });

        it('blanks the hours of a rest day before sending', async () => {
            // A working day with no hours is a 400 from the server; the user
            // should not have to discover that by hitting save.
            seed([], []);
            api.createWorkSchedule.mockResolvedValue({});
            render(<SchedulesPage />);
            await waitFor(() => expect(api.getWorkSchedules).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /work schedules/i }));
            fireEvent.click(screen.getByRole('button', { name: /add schedule/i }));

            fireEvent.change(screen.getByLabelText(/schedule name/i), { target: { value: 'Shop floor' } });
            // Friday (index 5) already defaults to non-working.
            fireEvent.submit(screen.getByRole('button', { name: /save/i }).closest('form')!);

            await waitFor(() => expect(api.createWorkSchedule).toHaveBeenCalled());
            const friday = api.createWorkSchedule.mock.calls[0][0].days[5];
            expect(friday.is_working).toBe(false);
            expect(friday.start_minute).toBeNull();
            expect(friday.break_minutes).toBe(0);
        });

        it('converts the time inputs back to minutes from midnight', async () => {
            seed([], []);
            api.createWorkSchedule.mockResolvedValue({});
            render(<SchedulesPage />);
            await waitFor(() => expect(api.getWorkSchedules).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /work schedules/i }));
            fireEvent.click(screen.getByRole('button', { name: /add schedule/i }));

            fireEvent.change(screen.getByLabelText(/schedule name/i), { target: { value: 'Late shift' } });
            fireEvent.change(screen.getByLabelText(/^sunday start$/i), { target: { value: '14:30' } });
            fireEvent.submit(screen.getByRole('button', { name: /save/i }).closest('form')!);

            await waitFor(() => expect(api.createWorkSchedule).toHaveBeenCalled());
            expect(api.createWorkSchedule.mock.calls[0][0].days[0].start_minute).toBe(870);
        });

        it('pre-fills the form when editing an existing schedule', async () => {
            seed([], [STANDARD]);
            render(<SchedulesPage />);
            await waitFor(() => expect(api.getWorkSchedules).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: /work schedules/i }));
            fireEvent.click(screen.getByRole('button', { name: /edit work schedule/i }));

            expect(screen.getByLabelText(/schedule name/i)).toHaveValue('Standard');
            expect(screen.getByLabelText(/^sunday start$/i)).toHaveValue('09:00');
        });
    });
});
