import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import AddBoardTasksModal from './AddBoardTasksModal';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: { getProjects: jest.fn(), getProjectTasks: jest.fn(), addBoardTasks: jest.fn() },
}));

describe('AddBoardTasksModal', () => {
    beforeEach(() => {
        // The mocked `api` module is shared across every test in this file, so its
        // call history must be reset here — otherwise `toHaveBeenLastCalledWith`
        // and friends could read state left over from an earlier test.
        (api.getProjects as jest.Mock).mockReset().mockResolvedValue({
            items: [
                { id: 'p1', name: 'Alpha', code: 'ALP' },
                { id: 'p2', name: 'Beta', code: 'BET' },
            ],
        });
        (api.getProjectTasks as jest.Mock).mockReset().mockResolvedValue({
            items: [
                { id: 'k1', title: 'Fix login', project: { id: 'p1', code: 'ALP', name: 'Alpha' } },
                { id: 'k2', title: 'Ship docs', project: { id: 'p2', code: 'BET', name: 'Beta' } },
            ],
        });
        (api.addBoardTasks as jest.Mock).mockReset().mockResolvedValue({});
    });

    it('lists tasks from more than one project together', async () => {
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);

        expect(await screen.findByText('Fix login')).toBeInTheDocument();
        expect(screen.getByText('Ship docs')).toBeInTheDocument();
    });

    it('submits every selected task in one request', async () => {
        const onAdded = jest.fn();
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={onAdded} />);
        await screen.findByText('Fix login');

        fireEvent.click(screen.getByRole('checkbox', { name: /fix login/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /ship docs/i }));
        fireEvent.click(screen.getByRole('button', { name: /add/i }));

        await waitFor(() => expect(api.addBoardTasks).toHaveBeenCalledWith('b1', ['k1', 'k2']));
        expect(onAdded).toHaveBeenCalled();
    });

    it('passes the project filter to the task query', async () => {
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');

        fireEvent.change(screen.getByLabelText(/project/i), { target: { value: 'p2' } });

        await waitFor(() =>
            expect(api.getProjectTasks).toHaveBeenLastCalledWith(
                expect.objectContaining({ projectId: 'p2' }),
            ),
        );
    });

    it('keeps an earlier pick selected when the project filter no longer returns it', async () => {
        // Genuinely different result sets per project — a mock that returned the
        // same two tasks regardless of the filter would make this test pass even
        // if selection were (incorrectly) derived from the visible rows instead
        // of held independently.
        (api.getProjectTasks as jest.Mock).mockImplementation((params: Record<string, unknown>) => {
            if (params?.projectId === 'p2') {
                return Promise.resolve({
                    items: [{ id: 'k2', title: 'Ship docs', project: { id: 'p2', code: 'BET', name: 'Beta' } }],
                });
            }
            return Promise.resolve({
                items: [
                    { id: 'k1', title: 'Fix login', project: { id: 'p1', code: 'ALP', name: 'Alpha' } },
                    { id: 'k2', title: 'Ship docs', project: { id: 'p2', code: 'BET', name: 'Beta' } },
                ],
            });
        });

        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');

        fireEvent.click(screen.getByRole('checkbox', { name: /fix login/i }));

        fireEvent.change(screen.getByLabelText(/project/i), { target: { value: 'p2' } });

        // The filtered view no longer shows "Fix login" at all.
        await waitFor(() => expect(screen.queryByText('Fix login')).not.toBeInTheDocument());
        expect(screen.getByText('Ship docs')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: /ship docs/i }));
        fireEvent.click(screen.getByRole('button', { name: /add/i }));

        // k1 was picked before the filter narrowed it out of view; it must still
        // land in the request alongside k2, not be silently dropped.
        await waitFor(() => expect(api.addBoardTasks).toHaveBeenCalledWith('b1', ['k1', 'k2']));
    });

    it('picks every listed task at once from the select-all box', async () => {
        // The complaint this answers: filling a board from a project meant one
        // click per card with nothing to select them together.
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');

        fireEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
        fireEvent.click(screen.getByRole('button', { name: /add/i }));

        await waitFor(() => expect(api.addBoardTasks).toHaveBeenCalledWith('b1', ['k1', 'k2']));
    });

    it('drops the whole selection on clear, including picks scrolled out of view', async () => {
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');

        fireEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
        expect(await screen.findByText(/2 selected/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));

        // Nothing left to add, so the footer button goes back to disabled.
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /add/i })).toBeDisabled(),
        );
    });

    it('leaves a task already on the board out of the list entirely', async () => {
        render(
            <AddBoardTasksModal
                boardId="b1"
                onBoardTaskIds={['k1']}
                onClose={jest.fn()}
                onAdded={jest.fn()}
            />,
        );
        await screen.findByText('Ship docs');

        // Not merely disabled — gone. The picker offers what can be added.
        expect(screen.queryByText('Fix login')).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /fix login/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
        fireEvent.click(screen.getByRole('button', { name: /add/i }));

        await waitFor(() => expect(api.addBoardTasks).toHaveBeenCalledWith('b1', ['k2']));
    });

    it('counts what can be added, not what the server returned', async () => {
        // `total` from the server counts the board's own cards too. Reporting it
        // raw would say "showing 1 of 2" beside a list holding one row, and would
        // leave a Load more button that fetches rows the picker then hides.
        render(
            <AddBoardTasksModal
                boardId="b1"
                onBoardTaskIds={['k1']}
                onClose={jest.fn()}
                onAdded={jest.fn()}
            />,
        );
        await screen.findByText('Ship docs');

        expect(screen.getByText(/showing 1 of 1/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('says so when every task the filter found is already on the board', async () => {
        render(
            <AddBoardTasksModal
                boardId="b1"
                onBoardTaskIds={['k1', 'k2']}
                onClose={jest.fn()}
                onAdded={jest.fn()}
            />,
        );

        // An empty list here means "nothing left to add", which is a different
        // thing from a search that matched nothing — but both are empty states,
        // and the reader needs to be told which one they are looking at.
        expect(await screen.findByText(/already on this board/i)).toBeInTheDocument();
    });

    it('opens on the board own project when it was given one', async () => {
        render(
            <AddBoardTasksModal
                boardId="b1"
                defaultProjectId="p2"
                onClose={jest.fn()}
                onAdded={jest.fn()}
            />,
        );

        await waitFor(() =>
            expect(api.getProjectTasks).toHaveBeenLastCalledWith(
                expect.objectContaining({ projectId: 'p2' }),
            ),
        );
    });

    it('pages through the rest of a project rather than stopping at the first 50', async () => {
        // The old picker asked for 50 rows and said nothing about the rest, so a
        // project with more tasks than that simply could not be seen in full.
        (api.getProjectTasks as jest.Mock).mockImplementation((params: Record<string, unknown>) =>
            Promise.resolve(
                params?.page === 2
                    ? { items: [{ id: 'k3', title: 'Third task' }], total: 3 }
                    : {
                          items: [
                              { id: 'k1', title: 'Fix login' },
                              { id: 'k2', title: 'Ship docs' },
                          ],
                          total: 3,
                      },
            ),
        );

        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');
        expect(screen.getByText(/showing 2 of 3/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /load more/i }));

        // Appended, not replaced: an earlier page must stay pickable.
        expect(await screen.findByText('Third task')).toBeInTheDocument();
        expect(screen.getByText('Fix login')).toBeInTheDocument();
        expect(api.getProjectTasks).toHaveBeenLastCalledWith(
            expect.objectContaining({ page: 2, limit: 200 }),
        );
    });

    it('asks for the largest page the backend will serve', async () => {
        // `project-tasks.service.ts` clamps `limit` to 200. Asking for more is
        // silently reduced, so 200 is both the ceiling and the right request:
        // most boards are filled in a single page.
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');

        expect(api.getProjectTasks).toHaveBeenLastCalledWith(
            expect.objectContaining({ limit: 200 }),
        );
    });

    it('loads every remaining page at once from load all', async () => {
        (api.getProjectTasks as jest.Mock).mockImplementation((params: Record<string, unknown>) => {
            const page = Number(params?.page ?? 1);
            return Promise.resolve({
                items: [{ id: `k${page}`, title: `Task page ${page}` }],
                total: 4,
            });
        });

        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Task page 1');

        fireEvent.click(screen.getByRole('button', { name: /load all/i }));

        // Pages until the server's count is satisfied, rather than one click per
        // page — that is the whole point of the button.
        expect(await screen.findByText('Task page 4')).toBeInTheDocument();
        expect(screen.getByText('Task page 1')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText(/showing 4 of 4/i)).toBeInTheDocument());

        // Nothing left to fetch, so neither button remains.
        expect(screen.queryByRole('button', { name: /load all/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('still offers the rest when a whole page turns out to be on the board', async () => {
        // The nastiest shape: page 1 comes back full, every row of it is already
        // a card, so the list renders empty — but there are more pages. Settling
        // on "everything is already here" would strand them with no way to look.
        (api.getProjectTasks as jest.Mock).mockImplementation((params: Record<string, unknown>) =>
            Promise.resolve(
                Number(params?.page ?? 1) === 2
                    ? { items: [{ id: 'k3', title: 'Addable task' }], total: 3 }
                    : {
                          items: [
                              { id: 'k1', title: 'Fix login' },
                              { id: 'k2', title: 'Ship docs' },
                          ],
                          total: 3,
                      },
            ),
        );

        render(
            <AddBoardTasksModal
                boardId="b1"
                onBoardTaskIds={['k1', 'k2']}
                onClose={jest.fn()}
                onAdded={jest.fn()}
            />,
        );

        const loadMore = await screen.findByRole('button', { name: /load more/i });
        expect(screen.queryByText(/already on this board/i)).not.toBeInTheDocument();

        fireEvent.click(loadMore);

        expect(await screen.findByText('Addable task')).toBeInTheDocument();
    });

    it('offers no load all when the first page already holds everything', async () => {
        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');

        expect(screen.queryByRole('button', { name: /load all/i })).not.toBeInTheDocument();
    });

    it('keeps an earlier pick selected when the search text no longer returns it', async () => {
        // Same guard as above, but for the debounced search filter instead of
        // the project select.
        (api.getProjectTasks as jest.Mock).mockImplementation((params: Record<string, unknown>) => {
            if (params?.search === 'ship') {
                return Promise.resolve({
                    items: [{ id: 'k2', title: 'Ship docs', project: { id: 'p2', code: 'BET', name: 'Beta' } }],
                });
            }
            return Promise.resolve({
                items: [
                    { id: 'k1', title: 'Fix login', project: { id: 'p1', code: 'ALP', name: 'Alpha' } },
                    { id: 'k2', title: 'Ship docs', project: { id: 'p2', code: 'BET', name: 'Beta' } },
                ],
            });
        });

        render(<AddBoardTasksModal boardId="b1" onClose={jest.fn()} onAdded={jest.fn()} />);
        await screen.findByText('Fix login');

        fireEvent.click(screen.getByRole('checkbox', { name: /fix login/i }));

        fireEvent.change(screen.getByLabelText(/search tasks/i), { target: { value: 'ship' } });

        // The debounced search narrows the view down to just "Ship docs".
        await waitFor(() => expect(screen.queryByText('Fix login')).not.toBeInTheDocument(), { timeout: 2000 });
        expect(screen.getByText('Ship docs')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /add/i }));

        // k1 was picked before the search narrowed it out of view; submitting
        // without re-selecting anything must still include it.
        await waitFor(() => expect(api.addBoardTasks).toHaveBeenCalledWith('b1', ['k1']));
    });
});
