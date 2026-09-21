import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BoardPage from './page';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { COLUMN_ATTR } from '@/components/projects/board-drag';
import {
    BOARD_VIEW_STORAGE_KEY,
    columnWidthClass,
    DEFAULT_BOARD_VIEW,
    type BoardView,
} from '@/components/projects/board-view';
import { BOARD_BACKGROUND_CLASS } from '@/components/projects/board-background';
import { boardFiltersKey } from '@/components/projects/board-filter-storage';

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
            updateBoard: jest.fn(),
            setBoardBackgroundImage: jest.fn(),
            clearBoardBackground: jest.fn(),
            // Board settings opens in a modal over the board now, so the
            // columns editor's own calls are part of this page's surface.
            getBoardColumns: jest.fn(),
            createBoardColumn: jest.fn(),
            updateBoardColumn: jest.fn(),
            deleteBoardColumn: jest.fn(),
            reorderBoardColumns: jest.fn(),
            setBoardColumnStatuses: jest.fn(),
            getProjectColumns: jest.fn(),
            moveBoardCards: jest.fn(),
            removeBoardCards: jest.fn(),
            setBoardColumnCardOrder: jest.fn(),
            getMe: jest.fn(),
            getProject: jest.fn(),
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
        (api.updateBoard as jest.Mock).mockReset().mockResolvedValue({});
        (api.getProjectLabels as jest.Mock).mockReset().mockResolvedValue([]);
        (api.getProjects as jest.Mock).mockReset().mockResolvedValue({
            items: [
                { id: 'p1', code: 'ALP', name: 'Alpha' },
                { id: 'p2', code: 'BET', name: 'Beta' },
            ],
        });
        (api.createBoardCard as jest.Mock).mockReset().mockResolvedValue({});
        (api.getBoardColumns as jest.Mock).mockReset().mockResolvedValue([]);
        (api.createBoardColumn as jest.Mock).mockReset().mockResolvedValue({});
        (api.updateBoardColumn as jest.Mock).mockReset().mockResolvedValue({});
        (api.reorderBoardColumns as jest.Mock).mockReset().mockResolvedValue([]);
        (api.getProjectColumns as jest.Mock).mockReset().mockResolvedValue([]);
        (api.moveBoardCards as jest.Mock).mockReset().mockResolvedValue({
            id: 'b1',
            name: 'Release 4',
            columns: [],
            unsorted: [],
        });
        (api.removeBoardCards as jest.Mock).mockReset().mockResolvedValue({
            id: 'b1',
            name: 'Release 4',
            columns: [],
            unsorted: [],
        });
        (api.setBoardColumnCardOrder as jest.Mock).mockReset().mockResolvedValue({});
        // Who is composing — a card with no filter set lands on them.
        (api.getMe as jest.Mock).mockReset().mockResolvedValue({ id: 'me-1' });
        // The project roster behind the composer's assignee picker, loaded
        // lazily by `useProjectMeta` the first time the picker is opened.
        (api.getProject as jest.Mock).mockReset().mockResolvedValue({
            id: 'p1',
            members: [
                { user: { id: 'u-rafi', name: 'Rafi Hasan', email: 'rafi@erp71.com' } },
                { employee: { id: 'e-sumaiya', name: 'Sumaiya Akter' } },
            ],
        });
    });

    /** Board settings, open on the tab this test needs. */
    const openSettings = async (tab?: 'Appearance' | 'Background') => {
        fireEvent.click(screen.getByRole('button', { name: 'Board settings' }));
        if (tab) fireEvent.click(await screen.findByRole('tab', { name: tab }));
    };

    /** The `…` menu of the named column, opened. */
    const openColumnMenu = (columnName: string) =>
        fireEvent.click(
            screen.getByRole('button', { name: new RegExp(`Column actions — ${columnName}`) }),
        );

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
                expect(api.createBoardCard).toHaveBeenCalledWith(
                    'b1',
                    'c2',
                    expect.objectContaining({ projectId: 'p1', title: 'Write changelog' }),
                ),
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
                expect(api.createBoardCard).toHaveBeenCalledWith(
                    'b1',
                    'c1',
                    expect.objectContaining({ projectId: 'p1', title: 'Rotate the keys' }),
                ),
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
                expect(api.createBoardCard).toHaveBeenCalledWith(
                    'b1',
                    'c1',
                    expect.objectContaining({ projectId: 'p2', title: 'Draft the spec' }),
                ),
            );
        });

        /**
         * The whole point of the pair: composing a run of cards while the board
         * is filtered to somebody means those cards are for them. The filter
         * wins over the signed-in user; an explicit pick in the composer wins
         * over both.
         */
        describe('who the card lands on', () => {
            /**
             * Its own board: the assignee filter's options are built from
             * whoever holds a card, so these tests need held cards — and the
             * shared fixture's unheld `k1` is what several tests above read.
             */
            beforeEach(() => {
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
                                {
                                    ...task('k1', 'Fix login', { id: 'p1', code: 'ALP' }),
                                    assignee: {
                                        id: 'u-rafi',
                                        name: 'Rafi Hasan',
                                        email: 'rafi@erp71.com',
                                    },
                                },
                                {
                                    ...task('k2', 'Ship docs', { id: 'p1', code: 'ALP' }),
                                    assigneeEmployee: { id: 'e-sumaiya', name: 'Sumaiya Akter' },
                                },
                            ],
                        },
                    ],
                    unsorted: [],
                });
            });

            /** Sets the board's assignee filter to the named option. */
            const filterTo = (value: string) =>
                fireEvent.change(screen.getByLabelText('Assignee'), { target: { value } });

            /**
             * Overrides the composer's assignee. Focus first, because that is
             * what loads the project's roster — the options do not exist until
             * somebody opens the picker.
             */
            const pickAssignee = async (value: string, label: string) => {
                const select = screen.getByRole('combobox', { name: 'Assign card to' });
                fireEvent.focus(select);
                await within(select).findByRole('option', { name: label });
                fireEvent.change(select, { target: { value } });
            };

            it('puts the card on the signed-in user when no filter is set', async () => {
                render(<BoardPage />);
                await screen.findByText('Fix login');

                const field = await openComposer(0);
                fireEvent.change(field, { target: { value: 'Rotate the keys' } });
                fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

                await waitFor(() =>
                    expect(api.createBoardCard).toHaveBeenCalledWith(
                        'b1',
                        'c1',
                        expect.objectContaining({ assigneeId: 'me-1', assigneeEmployeeId: '' }),
                    ),
                );
            });

            it('puts it on the filtered user instead, so a filtered run is theirs', async () => {
                render(<BoardPage />);
                await screen.findByText('Fix login');

                filterTo('user:u-rafi');
                const field = await openComposer(0);
                fireEvent.change(field, { target: { value: 'Rotate the keys' } });
                fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

                await waitFor(() =>
                    expect(api.createBoardCard).toHaveBeenCalledWith(
                        'b1',
                        'c1',
                        expect.objectContaining({
                            assigneeId: 'u-rafi',
                            assigneeEmployeeId: '',
                        }),
                    ),
                );
            });

            it('carries an employee filter into the employee column', async () => {
                render(<BoardPage />);
                await screen.findByText('Fix login');

                filterTo('employee:e-sumaiya');
                const field = await openComposer(0);
                fireEvent.change(field, { target: { value: 'Rotate the keys' } });
                fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

                await waitFor(() =>
                    expect(api.createBoardCard).toHaveBeenCalledWith(
                        'b1',
                        'c1',
                        expect.objectContaining({
                            assigneeId: '',
                            assigneeEmployeeId: 'e-sumaiya',
                        }),
                    ),
                );
            });

            // Looking at nobody's work is a deliberate choice, not an accident
            // for the composer to correct by handing the card to the composer.
            it('leaves the card unheld when the board is filtered to unassigned', async () => {
                render(<BoardPage />);
                await screen.findByText('Fix login');

                filterTo('none');
                const field = await openComposer(0);
                fireEvent.change(field, { target: { value: 'Rotate the keys' } });
                fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

                await waitFor(() =>
                    expect(api.createBoardCard).toHaveBeenCalledWith(
                        'b1',
                        'c1',
                        expect.objectContaining({ assigneeId: '', assigneeEmployeeId: '' }),
                    ),
                );
            });

            it('opens the picker on whoever the filter chose', async () => {
                render(<BoardPage />);
                await screen.findByText('Fix login');

                filterTo('user:u-rafi');
                await openComposer(0);

                await waitFor(() =>
                    expect(screen.getByRole('combobox', { name: 'Assign card to' })).toHaveValue(
                        'user:u-rafi',
                    ),
                );
            });

            /**
             * The signed-in user need not hold a card on this board, so there
             * may be no name for them anywhere on the page until the project's
             * roster arrives. The picker still has to say who the card is going
             * to rather than falling back to "Unassigned".
             */
            it('names the unfiltered default before the roster arrives', async () => {
                // Never resolves: the roster is still in flight.
                (api.getProject as jest.Mock).mockImplementation(() => new Promise(() => {}));

                render(<BoardPage />);
                await screen.findByText('Fix login');
                await openComposer(0);

                const select = screen.getByRole('combobox', { name: 'Assign card to' });
                await waitFor(() => expect(select).toHaveValue('user:me-1'));
                expect(within(select).getByRole('option', { name: 'Me' })).toBeInTheDocument();
            });

            it('lets the composer override the filter for one card', async () => {
                render(<BoardPage />);
                await screen.findByText('Fix login');

                filterTo('user:u-rafi');
                const field = await openComposer(0);
                await pickAssignee('employee:e-sumaiya', 'Sumaiya Akter');
                fireEvent.change(field, { target: { value: 'Rotate the keys' } });
                fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

                await waitFor(() =>
                    expect(api.createBoardCard).toHaveBeenCalledWith(
                        'b1',
                        'c1',
                        expect.objectContaining({
                            assigneeId: '',
                            assigneeEmployeeId: 'e-sumaiya',
                        }),
                    ),
                );
            });

            it('can hand a card to nobody even with a filter set', async () => {
                render(<BoardPage />);
                await screen.findByText('Fix login');

                filterTo('user:u-rafi');
                const field = await openComposer(0);
                fireEvent.change(screen.getByRole('combobox', { name: 'Assign card to' }), {
                    target: { value: '' },
                });
                fireEvent.change(field, { target: { value: 'Rotate the keys' } });
                fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

                await waitFor(() =>
                    expect(api.createBoardCard).toHaveBeenCalledWith(
                        'b1',
                        'c1',
                        expect.objectContaining({ assigneeId: '', assigneeEmployeeId: '' }),
                    ),
                );
            });

            // A run of cards is the case this control exists for: the composer
            // stays open after a save, and it must not silently reset to the
            // filter's default once somebody has overridden it.
            it('keeps an override across a run of cards', async () => {
                render(<BoardPage />);
                await screen.findByText('Fix login');

                const field = await openComposer(0);
                await pickAssignee('user:u-rafi', 'Rafi Hasan');
                fireEvent.change(field, { target: { value: 'First' } });
                fireEvent.keyDown(field, { key: 'Enter' });

                await waitFor(() => expect(field).toHaveValue(''));
                fireEvent.change(field, { target: { value: 'Second' } });
                fireEvent.keyDown(field, { key: 'Enter' });

                await waitFor(() =>
                    expect(api.createBoardCard).toHaveBeenLastCalledWith(
                        'b1',
                        'c1',
                        expect.objectContaining({
                            title: 'Second',
                            assigneeId: 'u-rafi',
                        }),
                    ),
                );
            });
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

    describe('appearance settings', () => {
        const storeView = (view: Partial<BoardView>) =>
            localStorage.setItem(
                BOARD_VIEW_STORAGE_KEY,
                JSON.stringify({ ...DEFAULT_BOARD_VIEW, ...view }),
            );

        afterEach(() => localStorage.clear());

        it('reaches the appearance controls through board settings', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            // One button in the header instead of three: the appearance
            // popover and the background modal are tabs of this panel now.
            expect(screen.queryByRole('button', { name: 'Appearance' })).not.toBeInTheDocument();
            await openSettings('Appearance');
            expect(screen.getByRole('button', { name: 'Compact' })).toBeInTheDocument();
        });

        it('drops a card field the viewer switched off, and keeps the card', async () => {
            storeView({ fields: { ...DEFAULT_BOARD_VIEW.fields, project: false } });

            render(<BoardPage />);
            await screen.findByText('Fix login');

            // The project chip is gone; the task it belongs to is not.
            await waitFor(() => expect(screen.queryByText('ALP')).not.toBeInTheDocument());
            expect(screen.getByText('Fix login')).toBeInTheDocument();
        });

        it('drops the assignee line rather than leaving an empty row behind it', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');
            // Scoped to the card: the assignee filter above the board offers an
            // "Unassigned" option of its own, which this setting does not touch.
            const card = () =>
                screen.getByRole('button', { name: /open task: Fix login/i });
            expect(within(card()).getByText('Unassigned')).toBeInTheDocument();

            await openSettings('Appearance');
            fireEvent.click(screen.getByRole('checkbox', { name: 'Assignee' }));

            await waitFor(() =>
                expect(within(card()).queryByText('Unassigned')).not.toBeInTheDocument(),
            );
        });

        it('carries the stored column width onto every column', async () => {
            storeView({ columnWidth: 'narrow' });

            render(<BoardPage />);
            await screen.findByText('Fix login');

            const column = () => document.querySelector(`[${COLUMN_ATTR}="c1"]`) as Element;
            await waitFor(() =>
                expect(column().className).toContain(columnWidthClass('narrow')),
            );
            expect(column().className).not.toContain(columnWidthClass('standard'));
        });

        it('gives a column its own scroller when the viewer asked for one', async () => {
            storeView({ scroll: 'column' });

            render(<BoardPage />);
            await screen.findByText('Fix login');

            const cards = () =>
                document.querySelector(`[${COLUMN_ATTR}="c1"] [class*="overflow-y-auto"]`);
            await waitFor(() => expect(cards()).not.toBeNull());

            // The cards are in it and the composer is not: "Add a card" is how
            // a column grows, and it must not scroll away with the fortieth.
            expect(cards()).toHaveTextContent('Fix login');
            expect(cards()).not.toHaveTextContent('Add a card');
            expect(screen.getAllByRole('button', { name: 'Add a card' }).length).toBeGreaterThan(0);

            // A card in a bounded flex column shrinks to fit before it will
            // overflow, so without this the column squeezes forty cards into
            // one screen instead of scrolling them. jsdom lays nothing out, so
            // the class is all that can be asserted here — it was measured in
            // a browser, and this is what keeps it from being tidied away.
            expect(
                screen.getByRole('button', { name: /open task: Fix login/i }).className,
            ).toContain('shrink-0');
        });

        it('leaves the scrolling to the page unless it was asked not to', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            expect(
                document.querySelector(`[${COLUMN_ATTR}="c1"] [class*="overflow-y-auto"]`),
            ).toBeNull();
        });

        it('takes a setting change without dropping the board or re-fetching it', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');
            expect(api.getBoard).toHaveBeenCalledTimes(1);

            await openSettings('Appearance');
            fireEvent.click(screen.getByRole('button', { name: 'Compact' }));

            // Appearance is this browser's, not the board's: nothing is saved
            // server-side and the cards stay where they were. The settings
            // panel reads the columns for its own editor, which is why this
            // asserts on `getBoard` rather than on every call.
            expect(screen.getByText('Fix login')).toBeInTheDocument();
            expect(api.getBoard).toHaveBeenCalledTimes(1);
            expect(JSON.parse(localStorage.getItem(BOARD_VIEW_STORAGE_KEY) ?? '{}').density).toBe(
                'compact',
            );
        });

        it('fills the WIP meter in proportion to what the column holds', async () => {
            (api.getBoard as jest.Mock).mockResolvedValue({
                id: 'b1',
                name: 'Release 4',
                columns: [
                    {
                        id: 'c1',
                        name: 'To Do',
                        category: 'TODO',
                        wip_limit: 4,
                        tasks: [task('k1', 'Fix login', { id: 'p1', code: 'ALP' })],
                    },
                ],
                unsorted: [],
            });

            render(<BoardPage />);
            await screen.findByText('Fix login');

            const meter = document
                .querySelector(`[${COLUMN_ATTR}="c1"]`)
                ?.querySelector('[style*="width"]') as HTMLElement;
            expect(meter).toHaveStyle({ width: '25%' });
        });
    });

    /**
     * The other half of the appearance story, and deliberately the opposite
     * kind of setting: the appearance panel above is this browser's preference,
     * while the background is stored on the board and everyone sees it.
     */
    describe('header layout', () => {
        it('keeps the filters in the header beside the buttons, not on a row of their own', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            // The filter bar cost a whole row of board height before this; what
            // makes that back is the selects sharing the header's action row,
            // so it is the shared ancestor that is worth asserting rather than
            // the selects merely existing somewhere on the page.
            const assignee = screen.getByLabelText('Assignee');
            const settings = screen.getByRole('button', { name: 'Board settings' });
            const header = assignee.closest('div.flex.flex-wrap.items-center.justify-end');

            expect(header).not.toBeNull();
            expect(header).toContainElement(settings);
        });

        it('names every filter for a screen reader without a visible label', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            // The visible label text is what was traded away for the height, so
            // the accessible name has to come from somewhere else.
            for (const name of ['Assignee', 'Priority', 'Due']) {
                expect(screen.getByLabelText(name).tagName).toBe('SELECT');
            }
        });
    });

    describe('background', () => {
        /**
         * The painted surface. It wraps the header *and* the columns, so it can
         * no longer be found by walking up from a column to the scroller — the
         * scroller is now an undecorated child of it.
         */
        const canvas = () => screen.getByTestId('board-canvas');

        it('leaves a board with no background on the page surface', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            expect(canvas().className).not.toContain('bg-gradient-to-br');
            // No inline style at all, rather than an empty one: the canvas has
            // nothing to say about its background on a plain board.
            expect(canvas().getAttribute('style')).toBeNull();
        });

        it('paints the colour the board is stored with', async () => {
            (api.getBoard as jest.Mock).mockResolvedValue({
                id: 'b1',
                name: 'Release 4',
                background_color: 'BLUE',
                columns: [
                    { id: 'c1', name: 'To Do', category: 'TODO', wip_limit: null, tasks: [task('k1', 'Fix login', { id: 'p1', code: 'ALP' })] },
                ],
                unsorted: [],
            });

            render(<BoardPage />);
            await screen.findByText('Fix login');

            expect(canvas().className).toContain(BOARD_BACKGROUND_CLASS.BLUE);
            // Columns lose their edges on anything painted without this.
            expect(document.querySelector(`[${COLUMN_ATTR}="c1"]`)?.className).toContain('shadow-md');
        });

        it('hangs an uploaded picture behind the columns', async () => {
            (api.getBoard as jest.Mock).mockResolvedValue({
                id: 'b1',
                name: 'Release 4',
                background_image_url: 'https://cdn/office.jpg',
                columns: [
                    { id: 'c1', name: 'To Do', category: 'TODO', wip_limit: null, tasks: [task('k1', 'Fix login', { id: 'p1', code: 'ALP' })] },
                ],
                unsorted: [],
            });

            render(<BoardPage />);
            await screen.findByText('Fix login');

            expect(canvas()).toHaveStyle({ backgroundImage: 'url("https://cdn/office.jpg")' });
            expect(canvas().className).toContain('bg-cover');
        });

        it('repaints from the API answer rather than re-fetching the whole board', async () => {
            (api.updateBoard as jest.Mock).mockResolvedValue({
                background_color: 'PURPLE',
                background_image_url: null,
            });

            render(<BoardPage />);
            await screen.findByText('Fix login');
            expect(api.getBoard).toHaveBeenCalledTimes(1);

            await openSettings('Background');
            fireEvent.click(screen.getByRole('button', { name: 'Purple' }));

            await waitFor(() =>
                expect(canvas().className).toContain(BOARD_BACKGROUND_CLASS.PURPLE),
            );
            // Blinking every column for a colour change would be a worse board
            // than no colour at all — and the cards have not changed.
            expect(api.getBoard).toHaveBeenCalledTimes(1);
            expect(screen.getByText('Fix login')).toBeInTheDocument();
        });
    });
    describe('searching the cards', () => {
        it('narrows the board to what matches, columns and Unsorted alike', async () => {
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
                            task('k1', 'Fix login', { id: 'p1', code: 'ALP' }),
                            task('k2', 'Ship docs', { id: 'p2', code: 'BET' }),
                        ],
                    },
                ],
                unsorted: [task('k9', 'Fix the printer', { id: 'p3', code: 'GAM' })],
            });

            render(<BoardPage />);
            await screen.findByText('Fix login');

            fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 'fix' } });

            expect(screen.getByText('Fix login')).toBeInTheDocument();
            expect(screen.getByText('Fix the printer')).toBeInTheDocument();
            expect(screen.queryByText('Ship docs')).not.toBeInTheDocument();
            // Searching is filtering, so it says how much of the board is left
            // and offers the same way out as the selects beside it.
            expect(screen.getByText('2 of 3 cards')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /clear/i }));
            expect(screen.getByText('Ship docs')).toBeInTheDocument();
        });

        it('searches without asking the server for anything', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 'ship' } });

            // The whole board is already here; a request per keystroke would be
            // slower than the filter it replaced.
            expect(api.getBoard).toHaveBeenCalledTimes(1);
        });
    });

    describe('a column’s own actions', () => {
        it('renames a column from its head, without leaving the board', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            fireEvent.doubleClick(screen.getByText('To Do'));
            const field = screen.getByLabelText('Rename — To Do');
            fireEvent.change(field, { target: { value: 'Backlog' } });
            fireEvent.keyDown(field, { key: 'Enter' });

            await waitFor(() =>
                expect(api.updateBoardColumn).toHaveBeenCalledWith('b1', 'c1', { name: 'Backlog' }),
            );
            // Optimistic: the head shows the new name without waiting for a reload.
            expect(screen.getByText('Backlog')).toBeInTheDocument();
        });

        it('sends nothing for a rename that was cancelled or left unchanged', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            fireEvent.doubleClick(screen.getByText('To Do'));
            fireEvent.keyDown(screen.getByLabelText('Rename — To Do'), { key: 'Escape' });
            expect(api.updateBoardColumn).not.toHaveBeenCalled();

            fireEvent.doubleClick(screen.getByText('To Do'));
            fireEvent.blur(screen.getByLabelText('Rename — To Do'));
            expect(api.updateBoardColumn).not.toHaveBeenCalled();
        });

        it('moves a column along the board and sends the whole new order', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            openColumnMenu('To Do');
            fireEvent.click(screen.getByRole('menuitem', { name: 'Move right' }));

            await waitFor(() =>
                expect(api.reorderBoardColumns).toHaveBeenCalledWith('b1', ['c2', 'c1']),
            );
        });

        it('offers no move past either end', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            openColumnMenu('To Do');
            expect(screen.getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
            expect(screen.getByRole('menuitem', { name: 'Move right' })).toBeEnabled();
        });

        it('sorts a column’s cards and stores the order it arrived at', async () => {
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
                            { ...task('k1', 'Low one', { id: 'p1', code: 'ALP' }), priority: 'LOW' },
                            { ...task('k2', 'Urgent one', { id: 'p1', code: 'ALP' }), priority: 'URGENT' },
                            { ...task('k3', 'High one', { id: 'p1', code: 'ALP' }), priority: 'HIGH' },
                        ],
                    },
                ],
                unsorted: [],
            });

            render(<BoardPage />);
            await screen.findByText('Low one');

            openColumnMenu('To Do');
            fireEvent.click(screen.getByRole('menuitem', { name: 'By priority' }));

            // The rule stays in the browser; only the result is stored, so the
            // next drag is not fighting an order the board keeps reapplying.
            await waitFor(() =>
                expect(api.setBoardColumnCardOrder).toHaveBeenCalledWith('b1', 'c1', [
                    'k2',
                    'k3',
                    'k1',
                ]),
            );
        });

        it('moves every card in a column to another one in a single request', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            openColumnMenu('To Do');
            fireEvent.click(screen.getByRole('menuitem', { name: 'Done' }));

            await waitFor(() =>
                expect(api.moveBoardCards).toHaveBeenCalledWith('b1', {
                    taskIds: ['k1'],
                    columnId: 'c2',
                }),
            );
        });
    });

    describe('selecting cards', () => {
        it('selects a column’s cards, then moves them together', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            // Nothing is selected, so no boxes and no bar.
            expect(screen.queryByLabelText(/select card/i)).not.toBeInTheDocument();

            openColumnMenu('To Do');
            fireEvent.click(screen.getByRole('menuitem', { name: 'Select all cards' }));

            expect(screen.getByText('1 selected')).toBeInTheDocument();
            // The box shows on every card while a selection is running, so it
            // can be widened by hand from any column.
            expect(screen.getAllByLabelText(/^select card/i)).toHaveLength(2);

            fireEvent.change(screen.getByLabelText('Move selected to…'), {
                target: { value: 'c2' },
            });

            await waitFor(() =>
                expect(api.moveBoardCards).toHaveBeenCalledWith('b1', {
                    taskIds: ['k1'],
                    columnId: 'c2',
                }),
            );
            // The bar goes with the selection it was acting on.
            await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument());
        });

        it('takes a selection off the board in one request', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            openColumnMenu('To Do');
            fireEvent.click(screen.getByRole('menuitem', { name: 'Select all cards' }));
            openColumnMenu('Done');
            fireEvent.click(screen.getByRole('menuitem', { name: 'Select all cards' }));

            // Selecting in a second column widens the selection rather than
            // replacing it — the only way to move a mixed set in one go.
            expect(screen.getByText('2 selected')).toBeInTheDocument();

            fireEvent.click(
                within(screen.getByText('2 selected').parentElement as HTMLElement).getByRole(
                    'button',
                    { name: /remove from board/i },
                ),
            );

            await waitFor(() =>
                expect(api.removeBoardCards).toHaveBeenCalledWith('b1', ['k1', 'k2']),
            );
        });

        it('drops a card from the selection once a filter hides it', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            openColumnMenu('To Do');
            fireEvent.click(screen.getByRole('menuitem', { name: 'Select all cards' }));
            expect(screen.getByText('1 selected')).toBeInTheDocument();

            // "Remove these" has to mean the ones in front of the reader, so a
            // search that hides the selected card unselects it too.
            fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 'docs' } });

            await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument());
        });

        it('clears the selection without touching the cards', async () => {
            render(<BoardPage />);
            await screen.findByText('Fix login');

            openColumnMenu('To Do');
            fireEvent.click(screen.getByRole('menuitem', { name: 'Select all cards' }));
            fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));

            expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
            expect(api.removeBoardCards).not.toHaveBeenCalled();
            expect(screen.getByText('Fix login')).toBeInTheDocument();
        });
    });

    it('adds a column from the board, after the last one', async () => {
        render(<BoardPage />);
        await screen.findByText('Fix login');

        fireEvent.click(screen.getByRole('button', { name: /^add column$/i }));
        const field = screen.getByLabelText('Add column');
        fireEvent.change(field, { target: { value: 'In review' } });
        fireEvent.keyDown(field, { key: 'Enter' });

        await waitFor(() =>
            expect(api.createBoardColumn).toHaveBeenCalledWith('b1', {
                name: 'In review',
                // The category is asked for rather than guessed: it decides
                // whether a card in this lane counts as finished.
                category: 'TODO',
            }),
        );
        await waitFor(() => expect(api.getBoard).toHaveBeenCalledTimes(2));
    });

    it('reorders the columns by dragging one onto another', async () => {
        document.elementFromPoint = jest.fn();

        render(<BoardPage />);
        await screen.findByText('Fix login');

        const head = screen.getByText('To Do');
        const target = document.querySelector(`[${COLUMN_ATTR}="c2"]`) as Element;
        (document.elementFromPoint as jest.Mock).mockReturnValue(target);

        fireEvent.pointerDown(head, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(head, { pointerId: 2, pointerType: 'mouse', clientX: 80, clientY: 0 });
        fireEvent.pointerUp(head, { pointerId: 2, pointerType: 'mouse', clientX: 80, clientY: 0 });

        await waitFor(() =>
            expect(api.reorderBoardColumns).toHaveBeenCalledWith('b1', ['c2', 'c1']),
        );
    });

    it('treats a click on a column head as a click, not a drag', async () => {
        document.elementFromPoint = jest.fn();

        render(<BoardPage />);
        await screen.findByText('Fix login');

        const head = screen.getByText('To Do');
        (document.elementFromPoint as jest.Mock).mockReturnValue(
            document.querySelector(`[${COLUMN_ATTR}="c2"]`),
        );

        // Two pixels is a click on the head — under the threshold that tells a
        // drag from a press, exactly as it is for a card.
        fireEvent.pointerDown(head, { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(head, { pointerId: 3, pointerType: 'mouse', clientX: 2, clientY: 0 });
        fireEvent.pointerUp(head, { pointerId: 3, pointerType: 'mouse', clientX: 2, clientY: 0 });

        expect(api.reorderBoardColumns).not.toHaveBeenCalled();
    });
    /**
     * A filter picked on a board is picked again on the next visit. Someone
     * who works one lane of a shared board sets the same two controls every
     * time they open it, and re-picking them is the tax this removes.
     */
    describe('remembered filters', () => {
        const boardWithAssignees = {
            id: 'b1',
            name: 'Release 4',
            columns: [
                {
                    id: 'c1',
                    name: 'To Do',
                    category: 'TODO',
                    wip_limit: null,
                    tasks: [
                        {
                            ...task('k1', 'Fix login', { id: 'p1', code: 'ALP' }),
                            assignee: { id: 'u-rafi', name: 'Rafi Hasan', email: 'rafi@erp71.com' },
                        },
                        {
                            ...task('k2', 'Ship docs', { id: 'p1', code: 'ALP' }),
                            assigneeEmployee: { id: 'e-sumaiya', name: 'Sumaiya Akter' },
                        },
                    ],
                },
            ],
            unsorted: [],
        };

        beforeEach(() => {
            localStorage.clear();
            (api.getBoard as jest.Mock).mockResolvedValue(boardWithAssignees);
        });
        afterEach(() => localStorage.clear());

        it('reopens the board on the filter the last visit left', async () => {
            const first = render(<BoardPage />);
            await screen.findByText('Fix login');

            fireEvent.change(screen.getByLabelText('Assignee'), {
                target: { value: 'user:u-rafi' },
            });
            // Rafi's card stays, Sumaiya's goes.
            expect(screen.queryByText('Ship docs')).not.toBeInTheDocument();
            first.unmount();

            render(<BoardPage />);
            await screen.findByText('Fix login');
            await waitFor(() =>
                expect(screen.getByLabelText('Assignee')).toHaveValue('user:u-rafi'),
            );
            expect(screen.queryByText('Ship docs')).not.toBeInTheDocument();
        });

        it('reopens unfiltered once the filter is cleared', async () => {
            const first = render(<BoardPage />);
            await screen.findByText('Fix login');
            fireEvent.change(screen.getByLabelText('Assignee'), {
                target: { value: 'user:u-rafi' },
            });
            fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
            first.unmount();

            render(<BoardPage />);
            expect(await screen.findByText('Ship docs')).toBeInTheDocument();
        });

        it('does not carry one board\u2019s filter onto another', async () => {
            // The stored assignee is an id, and it means a different person —
            // or nobody — on the next board.
            localStorage.setItem(
                boardFiltersKey('other-board'),
                JSON.stringify({ assignee: 'user:u-rafi' }),
            );

            render(<BoardPage />);
            expect(await screen.findByText('Ship docs')).toBeInTheDocument();
            expect(screen.getByLabelText('Assignee')).toHaveValue('all');
        });

        it('ignores a remembered assignee who no longer holds a card here', async () => {
            // Otherwise the board opens empty under a select showing
            // "Assignee", and nothing on screen explains the missing cards.
            localStorage.setItem(
                boardFiltersKey('b1'),
                JSON.stringify({ assignee: 'user:u-departed' }),
            );

            render(<BoardPage />);
            expect(await screen.findByText('Fix login')).toBeInTheDocument();
            expect(screen.getByText('Ship docs')).toBeInTheDocument();
            expect(screen.getByLabelText('Assignee')).toHaveValue('all');
        });

        it('never restores the search box', async () => {
            localStorage.setItem(
                boardFiltersKey('b1'),
                JSON.stringify({ priority: 'HIGH', text: 'login' }),
            );

            render(<BoardPage />);
            await screen.findByText('Fix login');
            // The stored filter that *is* restorable still is — waited for,
            // because the restore lands with the labels fetch rather than with
            // the cards.
            await waitFor(() => expect(screen.getByLabelText('Priority')).toHaveValue('HIGH'));
            expect(screen.getByLabelText('Search cards')).toHaveValue('');
        });
    });
});
