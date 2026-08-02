import { render, screen, waitFor } from '@testing-library/react';
import TasksPage from './page';

const getProjectTasks = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ id: 'user-me' }),
        getProjects: jest.fn().mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'P1' }] }),
        getProjectTasks: (...args: unknown[]) => getProjectTasks(...args),
    },
}));

const task = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    title: 'Wire the meter',
    priority: 'MEDIUM',
    status: { id: 's1', name: 'To do', category: 'TODO' },
    project: { id: 'p1', code: 'PRJ-0001', name: 'P1' },
    ...overrides,
});

beforeEach(() => {
    getProjectTasks.mockReset();
    getProjectTasks.mockResolvedValue({ items: [task()], total: 1, page: 1, limit: 25, pages: 1 });
});

describe('Tasks page', () => {
    it('opens on the signed-in user’s tasks, preserving what My Tasks used to show', async () => {
        render(<TasksPage />);

        await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());
        expect(getProjectTasks).toHaveBeenCalledWith(
            expect.objectContaining({ assigneeId: 'user-me' }),
        );
    });

    it('never fetches before the user id resolves, so it cannot flash everyone’s tasks', async () => {
        // The default filter needs the id. Firing first and narrowing after would
        // briefly show the whole workspace.
        const { api } = jest.requireMock('@/lib/api');
        let resolveMe: (v: unknown) => void = () => {};
        api.getMe.mockReturnValueOnce(new Promise((r) => { resolveMe = r; }));

        render(<TasksPage />);
        expect(getProjectTasks).not.toHaveBeenCalled();

        resolveMe({ id: 'user-me' });
        await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());
    });

    it('shows the project on every row — it is the one list where it is not implied', async () => {
        render(<TasksPage />);
        await waitFor(() => expect(screen.getByText('Wire the meter')).toBeInTheDocument());
        expect(screen.getAllByText('PRJ-0001').length).toBeGreaterThan(0);
    });
});
