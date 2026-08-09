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
