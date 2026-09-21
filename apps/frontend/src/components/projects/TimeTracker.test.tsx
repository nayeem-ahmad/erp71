import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import TimeTracker from './TimeTracker';

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getProjects: jest.fn(),
        getProjectTasks: jest.fn(),
        getProjectTimeTags: jest.fn(),
        getProjectTimer: jest.fn(),
        startProjectTimer: jest.fn(),
        stopProjectTimer: jest.fn(),
        updateProjectTimer: jest.fn(),
        discardProjectTimer: jest.fn(),
        logProjectTime: jest.fn(),
    },
}));

const toastError = jest.fn();
const toastInfo = jest.fn();
const toastSuccess = jest.fn();
jest.mock('@/lib/toast', () => ({
    toast: {
        success: (...args: unknown[]) => toastSuccess(...args),
        error: (...args: unknown[]) => toastError(...args),
        info: (...args: unknown[]) => toastInfo(...args),
    },
}));

const runningTimer = (overrides: Record<string, unknown> = {}) => ({
    id: 'timer-1',
    started_at: '2026-08-03T08:00:00.000Z',
    start_time: '14:00',
    elapsed_seconds: 3849,
    note: 'Ran the conduit',
    tags: [],
    task: { id: 't1', title: 'Wire the meter' },
    project: { id: 'p1', code: 'PRJ-0001', name: 'Fitout' },
    ...overrides,
});

/**
 * The panel floats and is draggable on a real screen and docks to the bottom of
 * a phone, and `useIsMdUp` is what tells them apart — so the suite has to say
 * which screen each test is standing on.
 */
const useScreen = (mdUp: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation((query: string) => ({
            matches: mdUp,
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        })),
    });
};

/** jsdom lays nothing out, so a drag needs a rectangle handed to it. */
const givePanelABox = (box: { left: number; top: number; width: number; height: number }) => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
    } as DOMRect);
};

const openTracker = () => useProjectTimerStore.setState({ open: true });

/** Open the task picker and choose a task by its title. */
const pickTask = async (title: string) => {
    const box = await screen.findByLabelText('Task to log against');
    fireEvent.focus(box);
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(title) }));
};

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    toastError.mockReset();
    toastInfo.mockReset();
    toastSuccess.mockReset();
    useProjectTimerStore.setState({
        timer: null,
        loaded: false,
        busy: false,
        open: false,
        revision: 0,
    });
    useScreen(true);
    api.getMe.mockReset().mockResolvedValue({ id: 'u1' });
    api.getProjects.mockReset().mockResolvedValue({
        items: [{ id: 'p1', code: 'PRJ-0001', name: 'Fitout' }],
    });
    api.getProjectTasks.mockReset().mockResolvedValue({
        items: [
            {
                id: 't1',
                title: 'Wire the meter',
                project: { id: 'p1', code: 'PRJ-0001', name: 'Fitout' },
            },
        ],
    });
    api.getProjectTimeTags.mockReset().mockResolvedValue([]);
    api.getProjectTimer.mockReset().mockResolvedValue(null);
    api.startProjectTimer.mockReset().mockResolvedValue({});
    api.stopProjectTimer.mockReset().mockResolvedValue({ entry: {}, overlap: null });
    api.updateProjectTimer.mockReset().mockResolvedValue({});
    api.discardProjectTimer.mockReset().mockResolvedValue({ success: true });
    api.logProjectTime.mockReset().mockResolvedValue({});
});

afterEach(() => jest.restoreAllMocks());

describe('The floating time tracker', () => {
    it('is not on screen at all until it is opened, with nothing running', async () => {
        const { api } = jest.requireMock('@/lib/api');
        render(<TimeTracker />);

        await waitFor(() => expect(api.getProjectTimer).toHaveBeenCalled());
        expect(screen.queryByRole('region', { name: 'Time tracker' })).not.toBeInTheDocument();
        // Nor does it fetch a project list behind a panel nobody has opened.
        expect(api.getProjects).not.toHaveBeenCalled();
    });

    it('shows itself on whatever page is open the moment a clock is running', async () => {
        const { api } = jest.requireMock('@/lib/api');
        api.getProjectTimer.mockResolvedValue(runningTimer());
        render(<TimeTracker />);

        expect(await screen.findByRole('region', { name: 'Time tracker' })).toBeInTheDocument();
        expect(screen.getByRole('timer')).toHaveTextContent('1:04:09');
    });

    /** "Always visible while it counts" is the whole point of moving it here. */
    it('offers no way to dismiss a running clock — only to fold it away', async () => {
        const { api } = jest.requireMock('@/lib/api');
        api.getProjectTimer.mockResolvedValue(runningTimer());
        render(<TimeTracker />);

        await screen.findByRole('region', { name: 'Time tracker' });
        expect(
            screen.queryByRole('button', { name: 'Hide the time tracker' }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Collapse the time tracker' }),
        ).toBeInTheDocument();
    });

    it('keeps the clock and its stop button in view once folded away', async () => {
        const { api } = jest.requireMock('@/lib/api');
        api.getProjectTimer.mockResolvedValue(runningTimer());
        render(<TimeTracker />);

        fireEvent.click(await screen.findByRole('button', { name: 'Collapse the time tracker' }));

        expect(screen.getByRole('timer')).toHaveTextContent('1:04:09');
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
        // The controls behind it are gone; the clock is not.
        expect(screen.queryByLabelText('What are you working on?')).not.toBeInTheDocument();
    });

    it('closes on request once nothing is running', async () => {
        openTracker();
        render(<TimeTracker />);

        fireEvent.click(await screen.findByRole('button', { name: 'Hide the time tracker' }));

        expect(screen.queryByRole('region', { name: 'Time tracker' })).not.toBeInTheDocument();
        expect(useProjectTimerStore.getState().open).toBe(false);
    });

    describe('being moved', () => {
        it('opens where it was last left', async () => {
            window.localStorage.setItem('floating-panel:time-tracker', '{"x":120,"y":80}');
            openTracker();
            render(<TimeTracker />);

            const panel = await screen.findByRole('region', { name: 'Time tracker' });
            await waitFor(() => expect(panel).toHaveStyle({ left: '120px', top: '80px' }));
        });

        it('follows a pointer dragging its header, and remembers where it was dropped', async () => {
            givePanelABox({ left: 100, top: 100, width: 352, height: 240 });
            openTracker();
            render(<TimeTracker />);

            const panel = await screen.findByRole('region', { name: 'Time tracker' });
            const grip = screen.getByRole('button', { name: 'Move the time tracker' });
            const header = grip.parentElement as HTMLElement;

            fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 140, clientY: 110 });
            fireEvent.pointerMove(header, { pointerId: 1, clientX: 240, clientY: 260 });
            fireEvent.pointerUp(header, { pointerId: 1, clientX: 240, clientY: 260 });

            // The grab was 40px into the panel and 10px down it, and the panel
            // keeps that hold rather than jumping its corner to the pointer.
            expect(panel).toHaveStyle({ left: '200px', top: '250px' });
            expect(window.localStorage.getItem('floating-panel:time-tracker')).toBe(
                '{"x":200,"y":250}',
            );
        });

        it('moves with the arrow keys, for anyone not dragging with a pointer', async () => {
            givePanelABox({ left: 100, top: 100, width: 352, height: 240 });
            window.localStorage.setItem('floating-panel:time-tracker', '{"x":100,"y":100}');
            openTracker();
            render(<TimeTracker />);

            const panel = await screen.findByRole('region', { name: 'Time tracker' });
            fireEvent.keyDown(screen.getByRole('button', { name: 'Move the time tracker' }), {
                key: 'ArrowRight',
            });

            expect(panel).toHaveStyle({ left: '116px', top: '100px' });
            expect(window.localStorage.getItem('floating-panel:time-tracker')).toBe(
                '{"x":116,"y":100}',
            );
        });

        /**
         * A card free-floating on a 360px screen covers whatever is under it
         * wherever it is put, so the phone gets a docked panel and no grip.
         */
        it('docks to the bottom of a phone instead of floating over it', async () => {
            useScreen(false);
            window.localStorage.setItem('floating-panel:time-tracker', '{"x":120,"y":80}');
            openTracker();
            render(<TimeTracker />);

            const panel = await screen.findByRole('region', { name: 'Time tracker' });
            expect(panel).not.toHaveStyle({ left: '120px' });
            expect(
                screen.queryByRole('button', { name: 'Move the time tracker' }),
            ).not.toBeInTheDocument();
        });
    });

    describe('the task list', () => {
        /**
         * The tracker logs *your* hours, so the list it offers is your work.
         * It used to be every task in whichever project you picked, which on a
         * real project is hundreds of other people's rows.
         */
        it('asks only for the signed-in user’s tasks', async () => {
            const { api } = jest.requireMock('@/lib/api');
            openTracker();
            render(<TimeTracker />);

            await waitFor(() =>
                expect(api.getProjectTasks).toHaveBeenCalledWith(
                    expect.objectContaining({ assigneeId: 'u1' }),
                ),
            );
        });

        /** Without a project the list is everything on your plate, not nothing. */
        it('spans every project until one is picked', async () => {
            const { api } = jest.requireMock('@/lib/api');
            openTracker();
            render(<TimeTracker />);

            await waitFor(() => expect(api.getProjectTasks).toHaveBeenCalled());
            expect(api.getProjectTasks).toHaveBeenCalledWith(
                expect.not.objectContaining({ projectId: expect.anything() }),
            );
            // And the rows say which project they came from, since the codes
            // are the only thing telling two "Wire the meter"s apart.
            fireEvent.focus(await screen.findByLabelText('Task to log against'));
            expect(await screen.findByText('PRJ-0001')).toBeInTheDocument();
        });

        it('narrows to one project once one is chosen', async () => {
            const { api } = jest.requireMock('@/lib/api');
            openTracker();
            render(<TimeTracker />);

            // Once the option is actually on the select — changing it before
            // the list lands is a no-op React discards.
            await screen.findByRole('option', { name: 'PRJ-0001 · Fitout' });
            fireEvent.change(screen.getByLabelText('Project to log against'), {
                target: { value: 'p1' },
            });

            await waitFor(() =>
                expect(api.getProjectTasks).toHaveBeenCalledWith(
                    expect.objectContaining({ projectId: 'p1', assigneeId: 'u1' }),
                ),
            );
        });

        /** Covering a colleague's task should not mean reassigning it first. */
        it('widens to everyone’s tasks on request', async () => {
            const { api } = jest.requireMock('@/lib/api');
            openTracker();
            render(<TimeTracker />);

            fireEvent.click(await screen.findByRole('button', { name: 'Everyone' }));

            await waitFor(() =>
                expect(api.getProjectTasks).toHaveBeenCalledWith(
                    expect.not.objectContaining({ assigneeId: expect.anything() }),
                ),
            );
        });

        /**
         * Waiting on the user id rather than firing an unfiltered request and
         * narrowing it: the unfiltered one is every task in the tenant.
         */
        it('does not ask for “my tasks” before it knows who that is', async () => {
            const { api } = jest.requireMock('@/lib/api');
            let resolveMe: (value: unknown) => void = () => {};
            api.getMe.mockReturnValue(
                new Promise((resolve) => {
                    resolveMe = resolve;
                }),
            );
            openTracker();
            render(<TimeTracker />);

            await waitFor(() => expect(api.getProjects).toHaveBeenCalled());
            expect(api.getProjectTasks).not.toHaveBeenCalled();

            resolveMe({ id: 'u1' });
            await waitFor(() =>
                expect(api.getProjectTasks).toHaveBeenCalledWith(
                    expect.objectContaining({ assigneeId: 'u1' }),
                ),
            );
        });

        it('filters the list as you type, over titles and project codes', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTasks.mockResolvedValue({
                items: [
                    {
                        id: 't1',
                        title: 'Wire the meter',
                        project: { id: 'p1', code: 'PRJ-0001', name: 'Fitout' },
                    },
                    {
                        id: 't2',
                        title: 'Paint the hall',
                        project: { id: 'p2', code: 'PRJ-0002', name: 'Rewire' },
                    },
                ],
            });
            openTracker();
            render(<TimeTracker />);

            const box = await screen.findByLabelText('Task to log against');
            fireEvent.focus(box);
            expect(await screen.findByRole('option', { name: /Paint the hall/ })).toBeInTheDocument();

            fireEvent.change(box, { target: { value: 'paint' } });
            expect(screen.getByRole('option', { name: /Paint the hall/ })).toBeInTheDocument();
            expect(screen.queryByRole('option', { name: /Wire the meter/ })).not.toBeInTheDocument();

            // The code finds it too, for anyone who thinks in project numbers.
            fireEvent.change(box, { target: { value: 'PRJ-0001' } });
            expect(screen.getByRole('option', { name: /Wire the meter/ })).toBeInTheDocument();
            expect(screen.queryByRole('option', { name: /Paint the hall/ })).not.toBeInTheDocument();
        });

        it('says so when a search matches nothing, rather than showing an empty box', async () => {
            openTracker();
            render(<TimeTracker />);

            const box = await screen.findByLabelText('Task to log against');
            fireEvent.focus(box);
            // Once there is a list to search — "nothing matched" and "nothing
            // loaded yet" are different sentences.
            await screen.findByRole('option', { name: /Wire the meter/ });
            fireEvent.change(box, { target: { value: 'zzz' } });

            expect(screen.getByText('No tasks match that search.')).toBeInTheDocument();
        });

        it('tells you when nothing is assigned to you at all', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTasks.mockResolvedValue({ items: [] });
            openTracker();
            render(<TimeTracker />);

            fireEvent.focus(await screen.findByLabelText('Task to log against'));

            expect(await screen.findByText('No tasks assigned to you.')).toBeInTheDocument();
        });

        it('picks with the keyboard, for anyone not reaching for a mouse', async () => {
            const { api } = jest.requireMock('@/lib/api');
            openTracker();
            render(<TimeTracker />);

            const box = await screen.findByLabelText('Task to log against');
            fireEvent.focus(box);
            await screen.findByRole('option', { name: /Wire the meter/ });
            fireEvent.keyDown(box, { key: 'ArrowDown' });
            fireEvent.keyDown(box, { key: 'Enter' });
            fireEvent.click(screen.getByRole('button', { name: 'Start' }));

            await waitFor(() =>
                expect(api.startProjectTimer).toHaveBeenCalledWith(
                    expect.objectContaining({ taskId: 't1' }),
                ),
            );
        });
    });

    describe('the running clock', () => {
        it('starts a timer on the task the panel is pointed at', async () => {
            const { api } = jest.requireMock('@/lib/api');
            openTracker();
            render(<TimeTracker />);

            await pickTask('Wire the meter');
            fireEvent.click(screen.getByRole('button', { name: 'Start' }));

            await waitFor(() =>
                expect(api.startProjectTimer).toHaveBeenCalledWith(
                    expect.objectContaining({ taskId: 't1' }),
                ),
            );
        });

        it('shows the running task and a stop button instead of start', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimer.mockResolvedValue(runningTimer());
            render(<TimeTracker />);

            expect(await screen.findByRole('button', { name: /Stop/ })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /^Start$/ })).not.toBeInTheDocument();
            expect(screen.getByText('Wire the meter')).toBeInTheDocument();
        });

        it('logs the sitting even when the clock barely ran', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimer.mockResolvedValue(runningTimer({ elapsed_seconds: 10 }));
            render(<TimeTracker />);

            fireEvent.click(await screen.findByRole('button', { name: /Stop/ }));

            // A stop that swallows the sitting is the bug this replaced: the
            // discard button beside it is the way to throw one away.
            await waitFor(() => expect(api.stopProjectTimer).toHaveBeenCalled());
            expect(toastSuccess).toHaveBeenCalled();
            expect(toastInfo).not.toHaveBeenCalled();
        });

        it('tells the page under it to refetch the hours a stop just wrote', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimer.mockResolvedValue(runningTimer());
            render(<TimeTracker />);

            fireEvent.click(await screen.findByRole('button', { name: /Stop/ }));

            await waitFor(() => expect(useProjectTimerStore.getState().revision).toBe(1));
        });

        it('corrects a running clock’s start to the time the work actually began', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimer.mockResolvedValue(runningTimer({ elapsed_seconds: 600 }));
            render(<TimeTracker />);

            const field = await screen.findByLabelText('Started at');
            expect(field).toHaveValue('14:00');

            fireEvent.change(field, { target: { value: '09:00' } });

            await waitFor(() =>
                expect(api.updateProjectTimer).toHaveBeenCalledWith({ startTime: '09:00' }),
            );
        });

        it('throws a misclick away without logging it', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimer.mockResolvedValue(runningTimer({ elapsed_seconds: 4 }));
            render(<TimeTracker />);

            fireEvent.click(await screen.findByRole('button', { name: 'Discard this timer' }));

            await waitFor(() => expect(api.discardProjectTimer).toHaveBeenCalled());
            expect(api.stopProjectTimer).not.toHaveBeenCalled();
        });
    });

    describe('hours typed after the fact', () => {
        const fillManualEntry = async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Enter hours by hand' }));
            await pickTask('Wire the meter');
        };

        it('asks before keeping two entries over the same minutes', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.logProjectTime
                .mockRejectedValueOnce(new Error('Those hours overlap time you already logged.'))
                .mockResolvedValueOnce({});
            openTracker();
            render(<TimeTracker />);
            await waitFor(() => expect(api.getProjects).toHaveBeenCalled());

            // A span plus a task is all a log needs.
            await fillManualEntry();
            fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '13:45' } });
            fireEvent.change(screen.getByLabelText('End time'), { target: { value: '18:08' } });
            fireEvent.click(screen.getByRole('button', { name: /Log hours/ }));

            expect(await screen.findByText(/Keep both entries anyway/)).toBeInTheDocument();
            expect(api.logProjectTime).toHaveBeenCalledTimes(1);
            expect(api.logProjectTime.mock.calls[0][0]).not.toHaveProperty('allowOverlap');

            fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));

            await waitFor(() => expect(api.logProjectTime).toHaveBeenCalledTimes(2));
            expect(api.logProjectTime.mock.calls[1][0]).toMatchObject({ allowOverlap: true });
        });

        it('reports any other failure rather than offering to keep both', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.logProjectTime.mockRejectedValue(new Error('Task not found'));
            openTracker();
            render(<TimeTracker />);
            await waitFor(() => expect(api.getProjects).toHaveBeenCalled());

            await fillManualEntry();
            fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '2' } });
            fireEvent.click(screen.getByRole('button', { name: /Log hours/ }));

            await waitFor(() => expect(toastError).toHaveBeenCalledWith('Task not found'));
            expect(screen.queryByText(/Keep both entries anyway/)).not.toBeInTheDocument();
        });
    });

    it('keeps a tag picker on hand whether or not the workspace has any tags', async () => {
        openTracker();
        render(<TimeTracker />);

        expect(await screen.findByLabelText('Tags')).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Tags'));
        expect(screen.getByText('No tags yet. Add them in project settings.')).toBeInTheDocument();
    });
});
