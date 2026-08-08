import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BoardPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'b1' }),
    useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/api', () => ({
    api: { getBoard: jest.fn(), moveBoardCard: jest.fn(), removeBoardTask: jest.fn() },
}));

const task = (id: string, title: string, project: { id: string; code: string; short_name?: string }) => ({
    id,
    title,
    priority: 'MEDIUM',
    status_id: `s-${id}`,
    project: { name: project.code, ...project },
    labels: [],
    checklistItems: [],
    _count: { subtasks: 0, comments: 0 },
});

describe('BoardPage', () => {
    beforeEach(() => {
        // The mocked `api` module is shared across every test in this file, so its
        // call history must be reset here — otherwise `toHaveBeenCalledWith`
        // assertions could read state left over from an earlier test.
        (api.getBoard as jest.Mock).mockReset().mockResolvedValue({
            id: 'b1',
            name: 'Release 4',
            columns: [
                { id: 'c1', name: 'To Do', category: 'TODO', wip_limit: null, tasks: [task('k1', 'Fix login', { id: 'p1', code: 'ALP' })] },
                { id: 'c2', name: 'Done', category: 'DONE', wip_limit: null, tasks: [task('k2', 'Ship docs', { id: 'p2', code: 'BET' })] },
            ],
            unsorted: [],
        });
        (api.moveBoardCard as jest.Mock).mockReset().mockResolvedValue({});
        (api.removeBoardTask as jest.Mock).mockReset().mockResolvedValue({});
    });

    it('renders each column with its cards', async () => {
        render(<BoardPage />);
        expect(await screen.findByText('Fix login')).toBeInTheDocument();
        expect(screen.getByText('Ship docs')).toBeInTheDocument();
        expect(screen.getByText('To Do')).toBeInTheDocument();
    });

    it('shows a project chip on every card, because a board spans projects', async () => {
        render(<BoardPage />);
        await screen.findByText('Fix login');
        expect(screen.getByText('ALP')).toBeInTheDocument();
        expect(screen.getByText('BET')).toBeInTheDocument();
    });

    it('does not render the Unsorted column when nothing is unbound', async () => {
        render(<BoardPage />);
        await screen.findByText('Fix login');
        expect(screen.queryByText(/unsorted/i)).not.toBeInTheDocument();
    });

    it('renders the Unsorted column when a card has no bound column', async () => {
        (api.getBoard as jest.Mock).mockResolvedValue({
            id: 'b1',
            name: 'Release 4',
            columns: [{ id: 'c1', name: 'To Do', category: 'TODO', wip_limit: null, tasks: [] }],
            unsorted: [task('k9', 'Orphan card', { id: 'p3', code: 'GAM' })],
        });

        render(<BoardPage />);
        expect(await screen.findByText(/unsorted/i)).toBeInTheDocument();
        expect(screen.getByText('Orphan card')).toBeInTheDocument();
    });

    it('removes a card from the board without touching the task', async () => {
        render(<BoardPage />);
        await screen.findByText('Fix login');

        fireEvent.click(screen.getAllByRole('button', { name: /remove from board/i })[0]);

        await waitFor(() => expect(api.removeBoardTask).toHaveBeenCalledWith('b1', 'k1'));
    });
});
