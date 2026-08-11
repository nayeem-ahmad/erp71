import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SchedulesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getHolidays: jest.fn(),
        createHoliday: jest.fn(),
        updateHoliday: jest.fn(),
        deleteHoliday: jest.fn(),
        getHolidaySuggestions: jest.fn(),
        bulkCreateHolidays: jest.fn(),
        copyHolidayYear: jest.fn(),
        clearHolidayYear: jest.fn(),
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

const SUGGESTIONS = [
    { date: '2026-02-21', name: 'Shaheed Day', exists: false },
    { date: '2026-03-26', name: 'Independence Day', exists: false },
    { date: '2026-12-16', name: 'Victory Day', exists: true },
];

const seed = (holidays: any[] = [], schedules: any[] = []) => {
    api.getHolidays.mockResolvedValue(holidays);
    api.getWorkSchedules.mockResolvedValue(schedules);
    api.getHolidaySuggestions.mockResolvedValue(SUGGESTIONS);
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

    describe('managing the whole year', () => {
        const openYearModal = async () => {
            render(<SchedulesPage />);
            // The toolbar does not exist while the page is still loading.
            const manage = await screen.findByRole('button', { name: /manage year/i });
            fireEvent.click(manage);
            await waitFor(() => expect(api.getHolidaySuggestions).toHaveBeenCalled());
            await screen.findByText(/shaheed day/i);
        };

        it('counts the year’s holidays next to the picker', async () => {
            seed([
                { id: 'h-1', date: '2026-04-14', name: 'Pohela Boishakh' },
                { id: 'h-2', date: '2026-12-16', name: 'Victory Day' },
            ]);
            render(<SchedulesPage />);
            await waitFor(() => expect(screen.getByText(/^2 set for /)).toBeInTheDocument());
        });

        it('pre-ticks only the suggestions the year is missing', async () => {
            // The already-set one is shown so the list is the whole calendar,
            // but it must not be re-sent — that would be a guaranteed conflict.
            seed([]);
            await openYearModal();

            const victoryDay = screen.getByLabelText(/victory day/i) as HTMLInputElement;
            expect(victoryDay.disabled).toBe(true);
            expect(screen.getByRole('button', { name: /add 2 holidays/i })).toBeInTheDocument();
        });

        it('sends only the ticked suggestions and reloads', async () => {
            seed([]);
            api.bulkCreateHolidays.mockResolvedValue({ created: 1, updated: 0, skipped: 0 });
            await openYearModal();

            fireEvent.click(screen.getByLabelText(/independence day/i));
            fireEvent.click(screen.getByRole('button', { name: /add 1 holidays/i }));

            await waitFor(() => expect(api.bulkCreateHolidays).toHaveBeenCalled());
            expect(api.bulkCreateHolidays.mock.calls[0][0].items).toEqual([
                { date: '2026-02-21', name: 'Shaheed Day' },
            ]);
            await waitFor(() => expect(api.getHolidays).toHaveBeenCalledTimes(2));
        });

        it('copies another year into the selected one', async () => {
            seed([]);
            api.copyHolidayYear.mockResolvedValue({ created: 5, updated: 0, skipped: 0, unmapped: 0 });
            await openYearModal();

            fireEvent.click(screen.getByRole('button', { name: /copy a year/i }));
            fireEvent.click(screen.getByRole('button', { name: /^copy \d{4} into \d{4}$/i }));

            await waitFor(() => expect(api.copyHolidayYear).toHaveBeenCalled());
            const sent = api.copyHolidayYear.mock.calls[0][0];
            expect(sent.to_year).toBe(new Date().getFullYear());
            expect(sent.from_year).toBe(new Date().getFullYear() - 1);
        });

        it('clears the year only after the confirm', async () => {
            seed([{ id: 'h-1', date: '2026-04-14', name: 'Pohela Boishakh' }]);
            api.clearHolidayYear.mockResolvedValue({ deleted: 1 });
            window.confirm = jest.fn(() => false);
            await openYearModal();

            fireEvent.click(screen.getByRole('button', { name: /clear year/i }));
            fireEvent.click(screen.getByRole('button', { name: /delete all \d{4} holidays/i }));
            expect(api.clearHolidayYear).not.toHaveBeenCalled();

            (window.confirm as jest.Mock).mockReturnValue(true);
            fireEvent.click(screen.getByRole('button', { name: /delete all \d{4} holidays/i }));
            await waitFor(() => expect(api.clearHolidayYear).toHaveBeenCalledWith(new Date().getFullYear()));
        });

        it('offers nothing to clear on an empty year', async () => {
            seed([]);
            await openYearModal();
            fireEvent.click(screen.getByRole('button', { name: /clear year/i }));

            expect(screen.getByText(/no holidays in \d{4} to clear/i)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /delete all/i })).not.toBeInTheDocument();
        });

        it('surfaces a failed batch in the modal instead of closing it', async () => {
            seed([]);
            api.bulkCreateHolidays.mockRejectedValue(new Error('server said no'));
            await openYearModal();

            fireEvent.click(screen.getByRole('button', { name: /add 2 holidays/i }));

            await waitFor(() => expect(screen.getByText('server said no')).toBeInTheDocument());
            expect(screen.getByRole('button', { name: /add 2 holidays/i })).toBeInTheDocument();
        });
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
