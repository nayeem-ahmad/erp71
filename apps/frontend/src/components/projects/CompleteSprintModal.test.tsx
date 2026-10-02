import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CompleteSprintModal from './CompleteSprintModal';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getSprintBurndown: jest.fn(),
        getSprints: jest.fn(),
        completeSprint: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const sprint = {
    id: 'sprint-7',
    name: 'Sprint 7',
    start_date: '2026-08-02T00:00:00.000Z',
    end_date: '2026-08-13T00:00:00.000Z',
};

const current = (over: Record<string, number> = {}) => ({
    current: { remaining_hours: 23, committed_hours: 60, task_count: 17, done_task_count: 12, ...over },
});

const sprints = [
    { id: 'sprint-7', name: 'Sprint 7', status: 'ACTIVE' },
    { id: 'sprint-9', name: 'Sprint 9', status: 'PLANNED' },
    { id: 'sprint-6', name: 'Sprint 6', status: 'COMPLETED' },
];

function open(onCompleted = jest.fn()) {
    render(<CompleteSprintModal sprint={sprint} onClose={jest.fn()} onCompleted={onCompleted} />);
    return onCompleted;
}

beforeEach(() => {
    jest.clearAllMocks();
    (api.getSprintBurndown as jest.Mock).mockResolvedValue(current());
    (api.getSprints as jest.Mock).mockResolvedValue(sprints);
    (api.completeSprint as jest.Mock).mockResolvedValue({ carried_over: 5, carried_to: { id: 'new', name: 'Sprint 8' } });
});

describe('CompleteSprintModal', () => {
    it('says how much is done and how much is not', async () => {
        open();
        expect(await screen.findByText('12 done · 5 unfinished (23h remaining)')).toBeInTheDocument();
    });

    it('offers a new sprint by default, prefilled from the old one', async () => {
        open();
        await screen.findByText('Move the 5 unfinished task(s) to');

        expect(screen.getByLabelText('A new sprint')).toBeChecked();
        expect(screen.getByLabelText(/Sprint name/)).toHaveValue('Sprint 8');
        expect(screen.getByLabelText(/Starts/)).toHaveValue('2026-08-14');
        expect(screen.getByLabelText(/Ends/)).toHaveValue('2026-08-25');
        expect(screen.getByLabelText('Start it now')).not.toBeChecked();
    });

    it('carries the work into the new sprint', async () => {
        const onCompleted = open();
        await screen.findByText('Move the 5 unfinished task(s) to');
        fireEvent.click(screen.getByLabelText('Start it now'));
        fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }));

        await waitFor(() => expect(onCompleted).toHaveBeenCalled());
        expect(api.completeSprint).toHaveBeenCalledWith('sprint-7', {
            kind: 'new',
            name: 'Sprint 8',
            startDate: '2026-08-14',
            endDate: '2026-08-25',
            start: true,
        });
        expect(toast.success).toHaveBeenCalledWith('5 unfinished task(s) moved to Sprint 8');
    });

    it('offers only planned sprints, and carries into the one picked', async () => {
        open();
        await screen.findByText('Move the 5 unfinished task(s) to');
        fireEvent.click(screen.getByLabelText('A planned sprint'));

        const picker = screen.getByLabelText('Choose a sprint');
        const options = Array.from((picker as HTMLSelectElement).options).map((o) => o.textContent);
        expect(options).toEqual(['Sprint 9']);

        fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }));
        await waitFor(() =>
            expect(api.completeSprint).toHaveBeenCalledWith('sprint-7', { kind: 'sprint', sprintId: 'sprint-9' }),
        );
    });

    it('disables the planned-sprint choice when there is none', async () => {
        (api.getSprints as jest.Mock).mockResolvedValue([sprints[0]]);
        open();
        await screen.findByText('There are no planned sprints.');
        expect(screen.getByLabelText('A planned sprint')).toBeDisabled();
    });

    it('can still send the work to the backlog', async () => {
        (api.completeSprint as jest.Mock).mockResolvedValue({ carried_over: 5, carried_to: null });
        open();
        await screen.findByText('Move the 5 unfinished task(s) to');
        fireEvent.click(screen.getByLabelText('The backlog'));
        fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }));

        await waitFor(() => expect(api.completeSprint).toHaveBeenCalledWith('sprint-7', { kind: 'backlog' }));
        expect(toast.success).toHaveBeenCalledWith('5 unfinished task(s) returned to the backlog');
    });

    it('asks nothing when every task is done', async () => {
        (api.getSprintBurndown as jest.Mock).mockResolvedValue(current({ done_task_count: 17, remaining_hours: 0 }));
        (api.completeSprint as jest.Mock).mockResolvedValue({ carried_over: 0, carried_to: null });
        open();

        expect(await screen.findByText('Every task is done — nothing to carry over.')).toBeInTheDocument();
        expect(screen.queryByLabelText('A new sprint')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }));
        await waitFor(() => expect(api.completeSprint).toHaveBeenCalledWith('sprint-7', undefined));
    });

    it('refuses a new sprint without a name, inline', async () => {
        open();
        await screen.findByText('Move the 5 unfinished task(s) to');
        fireEvent.change(screen.getByLabelText(/Sprint name/), { target: { value: '  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }));

        expect(await screen.findByText('Give the new sprint a name.')).toBeInTheDocument();
        expect(api.completeSprint).not.toHaveBeenCalled();
    });

    it('refuses a new sprint that ends before it starts, inline', async () => {
        open();
        await screen.findByText('Move the 5 unfinished task(s) to');
        fireEvent.change(screen.getByLabelText(/Ends/), { target: { value: '2026-08-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }));

        expect(await screen.findByText('The end date is before the start date.')).toBeInTheDocument();
        expect(api.completeSprint).not.toHaveBeenCalled();
    });

    it("shows the server's reason when completing fails", async () => {
        (api.completeSprint as jest.Mock).mockRejectedValue(new Error('That sprint is already complete.'));
        const onCompleted = open();
        await screen.findByText('Move the 5 unfinished task(s) to');
        fireEvent.click(screen.getByRole('button', { name: 'Complete sprint' }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That sprint is already complete.'));
        expect(onCompleted).not.toHaveBeenCalled();
    });
});
