import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TimerChip from './TimerChip';
import { useProjectTimerStore } from '@/lib/project-timer-store';

const getProjectTimer = jest.fn();
const stopProjectTimer = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjectTimer: (...args: unknown[]) => getProjectTimer(...args),
        stopProjectTimer: (...args: unknown[]) => stopProjectTimer(...args),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const running = (overrides: Record<string, unknown> = {}) => ({
    id: 'tm1',
    started_at: new Date().toISOString(),
    elapsed_seconds: 65,
    task: { id: 't1', title: 'Wire the tracker' },
    ...overrides,
});

describe('TimerChip', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getProjectTimer.mockResolvedValue(null);
        stopProjectTimer.mockResolvedValue({});
        useProjectTimerStore.setState({ timer: null, loaded: true, busy: false, open: false });
    });

    it('offers a way to open the tracker when nothing is running', async () => {
        render(<TimerChip />);

        fireEvent.click(screen.getByRole('button', { name: /time tracker/i }));

        expect(useProjectTimerStore.getState().open).toBe(true);
    });

    it('shows the running clock', () => {
        useProjectTimerStore.setState({ timer: running() as never, receivedAt: Date.now(), loaded: true });
        render(<TimerChip />);

        // 65s seeded from the server.
        expect(screen.getByText('1:05')).toBeInTheDocument();
    });

    it('names the task the clock belongs to', () => {
        useProjectTimerStore.setState({ timer: running() as never, receivedAt: Date.now(), loaded: true });
        render(<TimerChip />);

        expect(screen.getByText('Wire the tracker')).toBeInTheDocument();
    });

    it('ticks while it runs', () => {
        jest.useFakeTimers();
        try {
            useProjectTimerStore.setState({ timer: running() as never, receivedAt: Date.now(), loaded: true });
            render(<TimerChip />);

            expect(screen.getByText('1:05')).toBeInTheDocument();
            act(() => {
                jest.advanceTimersByTime(3000);
            });
            expect(screen.getByText('1:08')).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('keeps the right time when the tab was throttled in the background', () => {
        // A background tab gets its intervals throttled to about one a minute,
        // so a clock counted by adding one per tick fell minutes behind. An
        // hour after the answer arrived, the clock must show an hour more.
        jest.useFakeTimers();
        try {
            useProjectTimerStore.setState({
                timer: running() as never,
                receivedAt: Date.now() - 3600 * 1000,
                loaded: true,
            });
            render(<TimerChip />);

            expect(screen.getByText('1:01:05')).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('stops the clock through the shared action, so every surface agrees', async () => {
        useProjectTimerStore.setState({ timer: running() as never, receivedAt: Date.now(), loaded: true });
        render(<TimerChip />);

        fireEvent.click(screen.getByRole('button', { name: /stop/i }));

        await waitFor(() => expect(stopProjectTimer).toHaveBeenCalled());
        // The shared stop refetches, and the server now says nothing is running.
        await waitFor(() => expect(useProjectTimerStore.getState().timer).toBeNull());
    });

    it('opens the tracker when the running chip is clicked, for the note and tags', () => {
        useProjectTimerStore.setState({ timer: running() as never, receivedAt: Date.now(), loaded: true, open: false });
        render(<TimerChip />);

        fireEvent.click(screen.getByText('1:05'));

        expect(useProjectTimerStore.getState().open).toBe(true);
    });

    it('asks the server once when the store has not loaded yet', async () => {
        useProjectTimerStore.setState({ timer: null, loaded: false });
        render(<TimerChip />);

        await waitFor(() => expect(getProjectTimer).toHaveBeenCalled());
    });

    it('does not re-ask when the store is already loaded', () => {
        useProjectTimerStore.setState({ timer: null, loaded: true });
        render(<TimerChip />);

        expect(getProjectTimer).not.toHaveBeenCalled();
    });

    it('survives a clock with no task attached', () => {
        useProjectTimerStore.setState({ timer: running({ task: null }) as never, receivedAt: Date.now(), loaded: true });
        render(<TimerChip />);

        expect(screen.getByText('1:05')).toBeInTheDocument();
    });
});
