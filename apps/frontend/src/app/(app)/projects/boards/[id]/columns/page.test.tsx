import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BoardColumnsSettingsPage from './page';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'b1' }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getBoardColumns: jest.fn(),
        getBoard: jest.fn(),
        getProjects: jest.fn(),
        getProjectColumns: jest.fn(),
        createBoardColumn: jest.fn(),
        updateBoardColumn: jest.fn(),
        deleteBoardColumn: jest.fn(),
        setBoardColumnStatuses: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const binding = (
    id: string,
    statusId: string,
    statusName: string,
    projectId: string,
) => ({ id, status_id: statusId, status: { id: statusId, name: statusName, project_id: projectId } });

const baseColumns = [
    {
        id: 'c1',
        name: 'To Do',
        category: 'TODO',
        sort_order: 0,
        wip_limit: null,
        bindings: [binding('b1', 's-alpha-todo', 'To Do', 'p1'), binding('b2', 's-beta-todo', 'Backlog', 'p2')],
    },
    {
        id: 'c2',
        name: 'Done',
        category: 'DONE',
        sort_order: 1,
        wip_limit: 5,
        bindings: [],
    },
];

describe('BoardColumnsSettingsPage', () => {
    beforeEach(() => {
        // The mocked `api` module is shared across every test in this file, so its
        // call history and resolved values must be reset here — otherwise an
        // assertion could read state left over from an earlier test.
        (api.getBoardColumns as jest.Mock).mockReset().mockResolvedValue(baseColumns);
        (api.getBoard as jest.Mock).mockReset().mockResolvedValue({ id: 'b1', name: 'Release 4' });
        (api.getProjects as jest.Mock).mockReset().mockResolvedValue({
            items: [
                { id: 'p1', code: 'ALP', name: 'Alpha', short_name: null },
                { id: 'p2', code: 'BET', name: 'Beta', short_name: null },
            ],
        });
        (api.getProjectColumns as jest.Mock).mockReset().mockImplementation((projectId: string) => {
            if (projectId === 'p1') {
                return Promise.resolve([
                    { id: 's-alpha-todo', name: 'To Do' },
                    { id: 's-alpha-progress', name: 'In Progress' },
                ]);
            }
            return Promise.resolve([
                { id: 's-beta-todo', name: 'Backlog' },
                { id: 's-beta-doing', name: 'Doing' },
            ]);
        });
        (api.createBoardColumn as jest.Mock).mockReset().mockResolvedValue({});
        (api.updateBoardColumn as jest.Mock).mockReset().mockResolvedValue({});
        (api.deleteBoardColumn as jest.Mock).mockReset().mockResolvedValue({});
        (api.setBoardColumnStatuses as jest.Mock).mockReset().mockResolvedValue({});
        (toast.error as jest.Mock).mockReset();
        (toast.success as jest.Mock).mockReset();
    });

    it('lists every column and the board it belongs to', async () => {
        render(<BoardColumnsSettingsPage />);
        expect(await screen.findByDisplayValue('To Do')).toBeInTheDocument();
        // "Done" is ambiguous by display value alone — it is both the column
        // name and the selected text of its own category <select>.
        expect(screen.getByLabelText('Column name — Done')).toBeInTheDocument();
        // Appears both in the subtitle and in the breadcrumb link back to the board.
        expect(screen.getAllByText('Release 4').length).toBeGreaterThan(0);
    });

    it('shows mapped statuses grouped by project', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');
        expect(screen.getByText('ALP · To Do')).toBeInTheDocument();
        expect(screen.getByText('BET · Backlog')).toBeInTheDocument();
    });

    it('shows the empty-mappings hint for a column with no bindings', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByLabelText('Column name — Done');
        expect(screen.getByText(/not mapped for any project/i)).toBeInTheDocument();
    });

    it('adds a column from the inline form', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');

        fireEvent.change(screen.getByPlaceholderText(/column name/i), { target: { value: 'Review' } });
        fireEvent.click(screen.getByRole('button', { name: /^add column$/i }));

        await waitFor(() =>
            expect(api.createBoardColumn).toHaveBeenCalledWith('b1', { name: 'Review', category: 'TODO' }),
        );
    });

    it('saves an edited column name, category and WIP limit', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');

        fireEvent.change(screen.getByDisplayValue('To Do'), { target: { value: 'Backlog' } });
        fireEvent.change(screen.getByLabelText('WIP limit — To Do'), { target: { value: '3' } });
        fireEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

        await waitFor(() =>
            expect(api.updateBoardColumn).toHaveBeenCalledWith('b1', 'c1', {
                name: 'Backlog',
                category: 'TODO',
                wipLimit: 3,
            }),
        );
    });

    it('rejects a WIP limit under 1 with an inline error instead of calling the API', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');

        fireEvent.change(screen.getByLabelText('WIP limit — To Do'), { target: { value: '0' } });
        fireEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

        expect(await screen.findByText(/wip limit must be at least 1/i)).toBeInTheDocument();
        expect(api.updateBoardColumn).not.toHaveBeenCalled();
    });

    it('deletes a column after confirmation', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');

        fireEvent.click(screen.getByRole('button', { name: /delete column — to do/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));

        await waitFor(() => expect(api.deleteBoardColumn).toHaveBeenCalledWith('b1', 'c1'));
    });

    it('rebinds a project to a different status in one call, keeping the other project bindings', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');

        const select = await screen.findByLabelText('Mapped statuses — ALP — To Do');
        // Wait for that project's status list to arrive — the option has to
        // actually exist in the DOM before a native <select> will accept it.
        await waitFor(() => expect(within(select).getByText('In Progress')).toBeInTheDocument());

        fireEvent.change(select, { target: { value: 's-alpha-progress' } });

        await waitFor(() =>
            expect(api.setBoardColumnStatuses).toHaveBeenCalledWith(
                'b1',
                'c1',
                expect.arrayContaining(['s-alpha-progress', 's-beta-todo']),
            ),
        );
        const [, , sentIds] = (api.setBoardColumnStatuses as jest.Mock).mock.calls[0];
        expect(sentIds).toHaveLength(2);
    });

    it('unmaps a project by choosing the "None" option', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');

        fireEvent.change(await screen.findByLabelText('Mapped statuses — ALP — To Do'), {
            target: { value: '' },
        });

        await waitFor(() =>
            expect(api.setBoardColumnStatuses).toHaveBeenCalledWith('b1', 'c1', ['s-beta-todo']),
        );
    });

    it('shows an error state when the columns fail to load', async () => {
        (api.getBoardColumns as jest.Mock).mockReset().mockRejectedValue(new Error('nope'));
        render(<BoardColumnsSettingsPage />);
        expect(await screen.findByText(/could not load the columns/i)).toBeInTheDocument();
    });

    it('offers a project whose statuses are entirely unbound — because that is exactly what this page is for', async () => {
        // Project GAM has a card sitting in Unsorted (its status is not bound to
        // any column) and is deliberately absent from the tenant-wide project
        // list below — its name has to come from the board's own cards, not
        // from a fallback lookup, or this test would pass for the wrong reason.
        (api.getBoard as jest.Mock).mockReset().mockResolvedValue({
            id: 'b1',
            name: 'Release 4',
            columns: [
                {
                    tasks: [
                        { project: { id: 'p1', code: 'ALP', name: 'Alpha', short_name: null } },
                        { project: { id: 'p2', code: 'BET', name: 'Beta', short_name: null } },
                    ],
                },
            ],
            unsorted: [{ project: { id: 'p3', code: 'GAM', name: 'Gamma', short_name: null } }],
        });
        (api.getProjectColumns as jest.Mock).mockImplementation((projectId: string) => {
            if (projectId === 'p3') {
                return Promise.resolve([{ id: 's-gamma-todo', name: 'Backlog' }]);
            }
            if (projectId === 'p1') {
                return Promise.resolve([
                    { id: 's-alpha-todo', name: 'To Do' },
                    { id: 's-alpha-progress', name: 'In Progress' },
                ]);
            }
            return Promise.resolve([
                { id: 's-beta-todo', name: 'Backlog' },
                { id: 's-beta-doing', name: 'Doing' },
            ]);
        });

        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');

        const select = await screen.findByLabelText('Mapped statuses — GAM — To Do');
        expect((select as HTMLSelectElement).value).toBe('');
        await waitFor(() => expect(within(select).getByText('Backlog')).toBeInTheDocument());

        fireEvent.change(select, { target: { value: 's-gamma-todo' } });

        // The wholesale payload keeps c1's two pre-existing bindings and adds
        // the newly-mapped project's status alongside them.
        await waitFor(() =>
            expect(api.setBoardColumnStatuses).toHaveBeenCalledWith(
                'b1',
                'c1',
                expect.arrayContaining(['s-alpha-todo', 's-beta-todo', 's-gamma-todo']),
            ),
        );
        const [, , sentIds] = (api.setBoardColumnStatuses as jest.Mock).mock.calls[0];
        expect(sentIds).toHaveLength(3);
    });

    it('reverts the select and shows an error toast when a binding write fails', async () => {
        (api.setBoardColumnStatuses as jest.Mock).mockReset().mockRejectedValue(new Error('Conflict'));

        render(<BoardColumnsSettingsPage />);
        await screen.findByDisplayValue('To Do');

        const select = (await screen.findByLabelText(
            'Mapped statuses — ALP — To Do',
        )) as HTMLSelectElement;
        expect(select.value).toBe('s-alpha-todo');

        fireEvent.change(select, { target: { value: '' } });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Conflict'));
        // Nothing was persisted, so the select must show the last-saved
        // binding again, not the value the failed change attempted.
        expect(select.value).toBe('s-alpha-todo');
    });

    it('marks a status option that belongs to a different column on this board', async () => {
        render(<BoardColumnsSettingsPage />);
        await screen.findByLabelText('Column name — Done');

        // Column c2 ("Done") has no bindings of its own, but project ALP's
        // "To Do" status is already bound to c1 — its option in c2's ALP
        // select must say so, while "In Progress" (unbound anywhere) is plain.
        const select = await screen.findByLabelText('Mapped statuses — ALP — Done');
        await waitFor(() =>
            expect(within(select).getByText('To Do (currently in To Do)')).toBeInTheDocument(),
        );
        expect(within(select).getByText('In Progress')).toBeInTheDocument();
    });
});
