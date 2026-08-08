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
});
