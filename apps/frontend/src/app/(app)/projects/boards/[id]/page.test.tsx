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
    api: {
        getBoard: jest.fn(),
        moveBoardCard: jest.fn(),
        removeBoardTask: jest.fn(),
        getProjectLabels: jest.fn(),
    },
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
        (api.getProjectLabels as jest.Mock).mockReset().mockResolvedValue([]);
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

    it('narrows the board by label, including cards sitting in Unsorted', async () => {
        const blocked = { id: 'l1', name: 'Blocked', color: 'RED' };
        (api.getProjectLabels as jest.Mock).mockResolvedValue([blocked]);
        (api.getBoard as jest.Mock).mockResolvedValue({
            id: 'b1',
            name: 'Release 4',
            columns: [
                {
                    id: 'c1',
                    name: 'To Do',
                    category: 'TODO',
                    wip_limit: null,
                    tasks: [
                        { ...task('k1', 'Fix login', { id: 'p1', code: 'ALP' }), labels: [{ label: blocked }] },
                        task('k2', 'Ship docs', { id: 'p2', code: 'BET' }),
                    ],
                },
            ],
            unsorted: [
                { ...task('k9', 'Orphan card', { id: 'p3', code: 'GAM' }), labels: [{ label: blocked }] },
                task('k8', 'Other orphan', { id: 'p3', code: 'GAM' }),
            ],
        });

        render(<BoardPage />);
        await screen.findByText('Fix login');
        expect(screen.getByText('Orphan card')).toBeInTheDocument();

        fireEvent.change(await screen.findByLabelText('Label'), { target: { value: 'l1' } });

        // Kept: both cards actually tagged "Blocked".
        expect(screen.getByText('Fix login')).toBeInTheDocument();
        expect(screen.getByText('Orphan card')).toBeInTheDocument();
        // Dropped: the untagged card in a real column and the untagged card
        // sitting in Unsorted — the filter has to reach both collections, not
        // just the mapped columns.
        expect(screen.queryByText('Ship docs')).not.toBeInTheDocument();
        expect(screen.queryByText('Other orphan')).not.toBeInTheDocument();
    });

    it('shows a loading state before the board arrives, and an error state (not a stuck spinner) when the fetch fails', async () => {
        let resolveBoard: (value: unknown) => void = () => {};
        (api.getBoard as jest.Mock)
            .mockReset()
            .mockReturnValueOnce(new Promise((resolve) => { resolveBoard = resolve; }))
            .mockRejectedValueOnce(new Error('Not found'));

        const { unmount } = render(<BoardPage />);

        // Still in flight: a loading message, no error, no "back to boards" exit.
        expect(await screen.findByText(/loading/i)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /back/i })).not.toBeInTheDocument();

        resolveBoard({ id: 'b1', name: 'Release 4', columns: [], unsorted: [] });
        await screen.findByRole('heading', { name: 'Release 4' });
        unmount();

        // A second board, whose fetch rejects outright.
        render(<BoardPage />);

        // Failed: an error message and a way back, and the loading text is gone
        // — the two states must be visibly distinguishable, not just internally
        // different flags.
        expect(await screen.findByRole('link', { name: /back/i })).toBeInTheDocument();
        expect(screen.queryByText(/^loading/i)).not.toBeInTheDocument();
    });
});
