import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BoardPage from './page';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { COLUMN_ATTR } from '@/components/projects/board-drag';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'b1' }),
    useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/api', () => {
    class ApiError extends Error {
        constructor(message: string, public readonly status: number) {
            super(message);
            this.name = 'ApiError';
        }
    }
    return {
        ApiError,
        api: {
            getBoard: jest.fn(),
            moveBoardCard: jest.fn(),
            removeBoardTask: jest.fn(),
            getProjectLabels: jest.fn(),
            getProjects: jest.fn(),
            createBoardCard: jest.fn(),
        },
    };
});

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
        (api.getProjects as jest.Mock).mockReset().mockResolvedValue({
            items: [
                { id: 'p1', code: 'ALP', name: 'Alpha' },
                { id: 'p2', code: 'BET', name: 'Beta' },
            ],
        });
        (api.createBoardCard as jest.Mock).mockReset().mockResolvedValue({});
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

    describe('composing a card in a column', () => {
        /** The composer of the nth column, opened. */
        const openComposer = async (index: number) => {
            const triggers = await screen.findAllByRole('button', { name: /add a card/i });
            fireEvent.click(triggers[index]);
            return screen.getByRole('textbox', { name: /add a card/i });
        };

        it('creates the task in the column it was typed into', async () => {
            render(<BoardPage />);
            await screen.findByText('Ship docs');

            // Second column: the status the card opens in has to come from the
            // column, not the project's default, or it would jump lanes.
            const field = await openComposer(1);
            fireEvent.change(field, { target: { value: 'Write changelog' } });
            fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

            await waitFor(() =>
                expect(api.createBoardCard).toHaveBeenCalledWith('b1', 'c2', {
                    projectId: 'p1',
                    title: 'Write changelog',
                }),
            );
            // The new card only exists server-side until the board is re-read.
            await waitFor(() => expect(api.getBoard).toHaveBeenCalledTimes(2));
        });

        it('submits on Enter and keeps the composer open for the next card', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            const field = await openComposer(0);
            fireEvent.change(field, { target: { value: 'Rotate the keys' } });
            fireEvent.keyDown(field, { key: 'Enter' });

            await waitFor(() =>
                expect(api.createBoardCard).toHaveBeenCalledWith('b1', 'c1', {
                    projectId: 'p1',
                    title: 'Rotate the keys',
                }),
            );
            await waitFor(() => expect(field).toHaveValue(''));
            expect(screen.getByRole('textbox', { name: /add a card/i })).toBeInTheDocument();
        });

        it('sends the project chosen in the composer, since a board spans projects', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            const field = await openComposer(0);
            fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
                target: { value: 'p2' },
            });
            fireEvent.change(field, { target: { value: 'Draft the spec' } });
            fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

            await waitFor(() =>
                expect(api.createBoardCard).toHaveBeenCalledWith('b1', 'c1', {
                    projectId: 'p2',
                    title: 'Draft the spec',
                }),
            );
        });

        it('sends nothing for a blank title', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            const field = await openComposer(0);
            fireEvent.change(field, { target: { value: '   ' } });
            fireEvent.keyDown(field, { key: 'Enter' });

            expect(api.createBoardCard).not.toHaveBeenCalled();
        });
    });

    // Pointer dragging needs real layout to pick a drop target (see
    // board-drag.ts), which jsdom does not have — resolveDropTarget instead
    // asks `document.elementFromPoint`, so a full drag can be driven here by
    // stubbing that one lookup to say "the pointer is over this column".
    // Everything else — beginDrag/continueDrag/endDrag, the optimistic
    // update, and the real `move` handler under test — runs unmodified.
    const dragCardToColumn = (cardTitle: string, columnId: string) => {
        const card = screen.getByRole('button', { name: new RegExp(`open task: ${cardTitle}`, 'i') });
        const column = document.querySelector(`[${COLUMN_ATTR}="${columnId}"]`) as Element;
        (document.elementFromPoint as jest.Mock).mockReturnValue(column);

        fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(card, { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 40 });
        fireEvent.pointerUp(card, { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 40 });
    };

    describe('a refused drop', () => {
        let toastErrorSpy: jest.SpyInstance;

        beforeEach(() => {
            document.elementFromPoint = jest.fn();
            toastErrorSpy = jest.spyOn(toast, 'error').mockImplementation(() => '');
        });

        afterEach(() => {
            toastErrorSpy.mockRestore();
        });

        it('reports the target column as unmapped for this card’s project on a 400, and reloads', async () => {
            (api.moveBoardCard as jest.Mock).mockRejectedValue(
                new ApiError('That column is not mapped', 400),
            );

            render(<BoardPage />);
            await screen.findByText('Fix login');

            dragCardToColumn('Fix login', 'c2');

            await waitFor(() => expect(api.moveBoardCard).toHaveBeenCalled());
            await waitFor(() =>
                expect(toastErrorSpy).toHaveBeenCalledWith('That column is not mapped for ALP. Map it in board settings.'),
            );
            // The optimistic move is undone by a reload, not left dangling.
            await waitFor(() => expect(api.getBoard).toHaveBeenCalledTimes(2));
        });

        it('shows a generic failure, not the unmapped-column message, for a non-400 error', async () => {
            (api.moveBoardCard as jest.Mock).mockRejectedValue(new ApiError('Server error', 500));

            render(<BoardPage />);
            await screen.findByText('Fix login');

            dragCardToColumn('Fix login', 'c2');

            await waitFor(() => expect(api.moveBoardCard).toHaveBeenCalled());
            await waitFor(() => expect(toastErrorSpy).toHaveBeenCalled());
            expect(toastErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('not mapped'));
        });
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
