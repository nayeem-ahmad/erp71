import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TaskDetailPanel from './TaskDetailPanel';

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const getProjectTask = jest.fn();
const getProjectLabels = jest.fn();
const updateProjectTask = jest.fn();
const addTaskChecklistItem = jest.fn();
const updateTaskChecklistItem = jest.fn();
const deleteTaskChecklistItem = jest.fn();
const reorderTaskChecklist = jest.fn();
const getTaskComments = jest.fn();
const getTaskActivity = jest.fn();
const getTaskWatchers = jest.fn();
const addTaskComment = jest.fn();
const updateTaskComment = jest.fn();
const deleteTaskComment = jest.fn();
const watchTask = jest.fn();
const unwatchTask = jest.fn();
const getProjectColumns = jest.fn();
const getTaskAttachments = jest.fn();
const addTaskAttachment = jest.fn();
const deleteTaskAttachment = jest.fn();
const getProject = jest.fn();
const logProjectTime = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjectTask: (...args: unknown[]) => getProjectTask(...args),
        getProjectLabels: (...args: unknown[]) => getProjectLabels(...args),
        updateProjectTask: (...args: unknown[]) => updateProjectTask(...args),
        getTaskRemainingHistory: jest.fn().mockResolvedValue([]),
        getProjectTaskStatuses: jest.fn().mockResolvedValue([]),
        addTaskChecklistItem: (...args: unknown[]) => addTaskChecklistItem(...args),
        updateTaskChecklistItem: (...args: unknown[]) => updateTaskChecklistItem(...args),
        deleteTaskChecklistItem: (...args: unknown[]) => deleteTaskChecklistItem(...args),
        reorderTaskChecklist: (...args: unknown[]) => reorderTaskChecklist(...args),
        getMe: jest.fn().mockResolvedValue({ id: 'user-me' }),
        getTaskComments: (...args: unknown[]) => getTaskComments(...args),
        getTaskActivity: (...args: unknown[]) => getTaskActivity(...args),
        getTaskWatchers: (...args: unknown[]) => getTaskWatchers(...args),
        addTaskComment: (...args: unknown[]) => addTaskComment(...args),
        updateTaskComment: (...args: unknown[]) => updateTaskComment(...args),
        deleteTaskComment: (...args: unknown[]) => deleteTaskComment(...args),
        watchTask: (...args: unknown[]) => watchTask(...args),
        unwatchTask: (...args: unknown[]) => unwatchTask(...args),
        getProjectColumns: (...args: unknown[]) => getProjectColumns(...args),
        getTaskAttachments: (...args: unknown[]) => getTaskAttachments(...args),
        addTaskAttachment: (...args: unknown[]) => addTaskAttachment(...args),
        deleteTaskAttachment: (...args: unknown[]) => deleteTaskAttachment(...args),
        getProject: (...args: unknown[]) => getProject(...args),
        logProjectTime: (...args: unknown[]) => logProjectTime(...args),
        deleteProjectTimeEntry: jest.fn().mockResolvedValue({}),
    },
}));

const blocked = { id: 'l1', name: 'Blocked', color: 'RED' };
const waiting = { id: 'l2', name: 'Client waiting', color: 'AMBER' };

const item = (id: string, text: string, isDone = false, sortOrder = 0) => ({
    id,
    text,
    is_done: isDone,
    sort_order: sortOrder,
});

const withChecklist = (items: ReturnType<typeof item>[]) => ({
    id: 't1',
    title: 'Wire the meter',
    project: { id: 'project-1', code: 'PRJ-0001', name: 'Fit-out' },
    checklistItems: items,
    timeEntries: [],
});

beforeEach(() => {
    for (const mock of [
        getProjectTask,
        getProjectLabels,
        updateProjectTask,
        addTaskChecklistItem,
        updateTaskChecklistItem,
        deleteTaskChecklistItem,
        reorderTaskChecklist,
        getTaskComments,
        getTaskActivity,
        getTaskWatchers,
        addTaskComment,
        updateTaskComment,
        deleteTaskComment,
        watchTask,
        unwatchTask,
        getProjectColumns,
        getTaskAttachments,
        addTaskAttachment,
        deleteTaskAttachment,
        getProject,
        logProjectTime,
    ]) {
        mock.mockReset();
        mock.mockResolvedValue({});
    }
    getProject.mockResolvedValue({ id: 'project-1', members: [] });
    getProjectLabels.mockResolvedValue([]);
    getTaskComments.mockResolvedValue([]);
    getTaskActivity.mockResolvedValue([]);
    getTaskWatchers.mockResolvedValue([]);
    getProjectColumns.mockResolvedValue([]);
    getTaskAttachments.mockResolvedValue([]);
    getProjectTask.mockResolvedValue(
        withChecklist([item('c1', 'Pull the cable', true), item('c2', 'Fit the box', false, 1)]),
    );
});

const panel = () => render(<TaskDetailPanel taskId="t1" onClose={jest.fn()} />);

describe('TaskDetailPanel checklist', () => {
    it('renders the items the task already carries', async () => {
        panel();

        expect(await screen.findByText('Pull the cable')).toBeInTheDocument();
        expect(screen.getByText('Fit the box')).toBeInTheDocument();
    });

    it('shows progress against the total', async () => {
        panel();
        expect(await screen.findByText('1 of 2')).toBeInTheDocument();
    });

    it('says all done rather than 2 of 2', async () => {
        getProjectTask.mockResolvedValue(
            withChecklist([item('c1', 'Pull the cable', true), item('c2', 'Fit the box', true, 1)]),
        );
        panel();

        expect(await screen.findByText('All done')).toBeInTheDocument();
    });

    it('ticking an item sends only the done flag', async () => {
        panel();
        fireEvent.click(await screen.findByLabelText('Fit the box'));

        await waitFor(() =>
            expect(updateTaskChecklistItem).toHaveBeenCalledWith('c2', { isDone: true }),
        );
    });

    it('unticks an item that is already done', async () => {
        panel();
        fireEvent.click(await screen.findByLabelText('Pull the cable'));

        await waitFor(() =>
            expect(updateTaskChecklistItem).toHaveBeenCalledWith('c1', { isDone: false }),
        );
    });

    it('adds an item and clears the field', async () => {
        panel();
        await screen.findByText('Pull the cable');

        const field = screen.getByPlaceholderText('What needs doing?');
        fireEvent.change(field, { target: { value: '  Test the circuit  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add an item' }));

        await waitFor(() =>
            // Trimmed — a leading space should not become part of the item.
            expect(addTaskChecklistItem).toHaveBeenCalledWith('t1', { text: 'Test the circuit' }),
        );
        await waitFor(() => expect(field).toHaveValue(''));
    });

    it('refuses to add a blank item', async () => {
        panel();
        await screen.findByText('Pull the cable');

        const field = screen.getByPlaceholderText('What needs doing?');
        fireEvent.change(field, { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add an item' }));

        expect(addTaskChecklistItem).not.toHaveBeenCalled();
    });

    it('renames an item on Enter', async () => {
        panel();
        fireEvent.click(await screen.findByText('Fit the box'));

        const editor = screen.getByDisplayValue('Fit the box');
        fireEvent.change(editor, { target: { value: 'Fit the junction box' } });
        fireEvent.keyDown(editor, { key: 'Enter' });

        await waitFor(() =>
            expect(updateTaskChecklistItem).toHaveBeenCalledWith('c2', {
                text: 'Fit the junction box',
            }),
        );
    });

    it('discards the edit on Escape', async () => {
        panel();
        fireEvent.click(await screen.findByText('Fit the box'));

        const editor = screen.getByDisplayValue('Fit the box');
        fireEvent.change(editor, { target: { value: 'Something else' } });
        fireEvent.keyDown(editor, { key: 'Escape' });

        expect(updateTaskChecklistItem).not.toHaveBeenCalled();
        expect(screen.getByText('Fit the box')).toBeInTheDocument();
    });

    it('does not save a rename that changed nothing', async () => {
        panel();
        fireEvent.click(await screen.findByText('Fit the box'));
        fireEvent.blur(screen.getByDisplayValue('Fit the box'));

        expect(updateTaskChecklistItem).not.toHaveBeenCalled();
    });

    // Two PATCHes swapping a pair can half-apply and leave both items on the
    // same sort_order, and checklistItems only orders by sort_order.
    it('reordering sends the whole order, not the swapped pair', async () => {
        panel();
        await screen.findByText('Pull the cable');

        fireEvent.click(screen.getAllByLabelText('Move up')[1]);

        await waitFor(() =>
            expect(reorderTaskChecklist).toHaveBeenCalledWith('t1', ['c2', 'c1']),
        );
        expect(updateTaskChecklistItem).not.toHaveBeenCalled();
    });

    it('cannot move the first item up or the last item down', async () => {
        panel();
        await screen.findByText('Pull the cable');

        expect(screen.getAllByLabelText('Move up')[0]).toBeDisabled();
        expect(screen.getAllByLabelText('Move down')[1]).toBeDisabled();
    });

    it('deletes an item', async () => {
        panel();
        await screen.findByText('Pull the cable');

        fireEvent.click(screen.getAllByLabelText('Delete item')[0]);

        await waitFor(() => expect(deleteTaskChecklistItem).toHaveBeenCalledWith('c1'));
    });

    it('reloads the task after a change so the panel shows the saved state', async () => {
        panel();
        await screen.findByText('Pull the cable');
        expect(getProjectTask).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Fit the box'));

        await waitFor(() => expect(getProjectTask).toHaveBeenCalledTimes(2));
    });

    it('says so when there is no checklist yet', async () => {
        getProjectTask.mockResolvedValue(withChecklist([]));
        panel();

        expect(await screen.findByText('No checklist items yet.')).toBeInTheDocument();
    });

    it('hides the progress bar when there is nothing to track', async () => {
        getProjectTask.mockResolvedValue(withChecklist([]));
        panel();

        await screen.findByText('No checklist items yet.');
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('reports a failed save instead of silently dropping it', async () => {
        const { toast } = jest.requireMock('@/lib/toast');
        updateTaskChecklistItem.mockRejectedValue(new Error('Nope'));
        panel();

        fireEvent.click(await screen.findByLabelText('Fit the box'));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nope'));
        // There is no optimistic tick to roll back — the panel only re-reads the
        // task on success, so a failed save leaves the item as the server has it.
        expect(screen.getByLabelText('Fit the box')).not.toBeChecked();
        expect(screen.getByText('1 of 2')).toBeInTheDocument();
    });
});

describe('TaskDetailPanel labels', () => {
    beforeEach(() => {
        getProjectLabels.mockResolvedValue([blocked, waiting]);
    });

    it('offers every label in the workspace', async () => {
        panel();
        expect(await screen.findByRole('button', { name: 'Blocked' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Client waiting' })).toBeInTheDocument();
    });

    it('shows which are on the task', async () => {
        getProjectTask.mockResolvedValue({ ...withChecklist([]), labels: [{ label: blocked }] });
        panel();

        expect(await screen.findByRole('button', { name: 'Blocked' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByRole('button', { name: 'Client waiting' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    // The endpoint replaces the set rather than patching it, so a toggle has to
    // send everything that should remain — not just the one that changed.
    it('adds a label by sending the whole set', async () => {
        getProjectTask.mockResolvedValue({ ...withChecklist([]), labels: [{ label: blocked }] });
        panel();

        fireEvent.click(await screen.findByRole('button', { name: 'Client waiting' }));

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { labelIds: ['l1', 'l2'] }),
        );
    });

    it('removes a label by sending the set without it', async () => {
        getProjectTask.mockResolvedValue({
            ...withChecklist([]),
            labels: [{ label: blocked }, { label: waiting }],
        });
        panel();

        fireEvent.click(await screen.findByRole('button', { name: 'Blocked' }));

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { labelIds: ['l2'] }),
        );
    });

    it('clears the last label with an empty array, not by omitting the field', async () => {
        getProjectTask.mockResolvedValue({ ...withChecklist([]), labels: [{ label: blocked }] });
        panel();

        fireEvent.click(await screen.findByRole('button', { name: 'Blocked' }));

        await waitFor(() => expect(updateProjectTask).toHaveBeenCalledWith('t1', { labelIds: [] }));
    });

    it('hides the section entirely when the workspace has no labels', async () => {
        getProjectLabels.mockResolvedValue([]);
    getTaskComments.mockResolvedValue([]);
    getTaskActivity.mockResolvedValue([]);
    getTaskWatchers.mockResolvedValue([]);
    getProjectColumns.mockResolvedValue([]);
    getTaskAttachments.mockResolvedValue([]);
        panel();

        await screen.findByText('Pull the cable');
        expect(screen.queryByRole('button', { name: 'Blocked' })).not.toBeInTheDocument();
    });
});

describe('TaskDetailPanel dates', () => {
    it('shows the dates the task carries, trimmed to the date part', async () => {
        getProjectTask.mockResolvedValue({
            ...withChecklist([]),
            start_date: '2026-08-01T00:00:00.000Z',
            due_date: '2026-08-10T00:00:00.000Z',
        });
        panel();

        expect(await screen.findByLabelText('Start date')).toHaveValue('2026-08-01');
        expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-10');
    });

    it('saves a start date', async () => {
        panel();
        fireEvent.change(await screen.findByLabelText('Start date'), {
            target: { value: '2026-08-05' },
        });

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { startDate: '2026-08-05' }),
        );
    });

    // PATCH reads undefined as "leave alone", so only '' can mean "no date" —
    // and the DTO has a ValidateIf so the empty string is not a 400.
    it('clears a date by sending an empty string, not undefined', async () => {
        getProjectTask.mockResolvedValue({
            ...withChecklist([]),
            due_date: '2026-08-10T00:00:00.000Z',
        });
        panel();

        fireEvent.change(await screen.findByLabelText('Due date'), { target: { value: '' } });

        await waitFor(() => expect(updateProjectTask).toHaveBeenCalledWith('t1', { dueDate: '' }));
    });

    it('warns when the start is after the due date', async () => {
        getProjectTask.mockResolvedValue({
            ...withChecklist([]),
            start_date: '2026-08-20T00:00:00.000Z',
            due_date: '2026-08-10T00:00:00.000Z',
        });
        panel();

        expect(await screen.findByText('The start is after the due date.')).toBeInTheDocument();
    });

    it('says nothing when the dates are in order', async () => {
        getProjectTask.mockResolvedValue({
            ...withChecklist([]),
            start_date: '2026-08-01T00:00:00.000Z',
            due_date: '2026-08-10T00:00:00.000Z',
        });
        panel();

        await screen.findByLabelText('Start date');
        expect(screen.queryByText('The start is after the due date.')).not.toBeInTheDocument();
    });

    it('reports a failed save', async () => {
        const { toast } = jest.requireMock('@/lib/toast');
        updateProjectTask.mockRejectedValue(new Error('Nope'));
        panel();

        fireEvent.change(await screen.findByLabelText('Start date'), {
            target: { value: '2026-08-05' },
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nope'));
    });
});

describe('TaskDetailPanel activity', () => {
    const comment = (id: string, at: string, userId = 'user-me') => ({
        id,
        body: `Comment ${id}`,
        created_at: at,
        user: { id: userId, name: 'Karim', email: 'k@x.com' },
    });

    it('shows comments and activity in one timeline', async () => {
        getTaskComments.mockResolvedValue([comment('c1', '2026-08-03T10:00:00Z')]);
        getTaskActivity.mockResolvedValue([
            {
                id: 'a1',
                type: 'STATUS_CHANGED',
                data: { from: 'To do', to: 'Doing' },
                created_at: '2026-08-03T11:00:00Z',
                actor: { id: 'user-2', name: 'Rahim', email: 'r@x.com' },
            },
        ]);
        panel();

        expect(await screen.findByText('Comment c1')).toBeInTheDocument();
        expect(screen.getByText(/moved it from To do to Doing/)).toBeInTheDocument();
    });

    it('posts a comment and clears the box', async () => {
        panel();
        const box = await screen.findByLabelText('Add a comment…');
        fireEvent.change(box, { target: { value: '  Looks done  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

        await waitFor(() => expect(addTaskComment).toHaveBeenCalledWith('t1', 'Looks done'));
        await waitFor(() => expect(box).toHaveValue(''));
    });

    it('will not post an empty comment', async () => {
        panel();
        await screen.findByLabelText('Add a comment…');
        expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
    });

    it('offers edit and delete only on your own comment', async () => {
        getTaskComments.mockResolvedValue([
            comment('mine', '2026-08-03T10:00:00Z', 'user-me'),
            comment('theirs', '2026-08-03T09:00:00Z', 'user-2'),
        ]);
        panel();

        await screen.findByText('Comment mine');
        // One Edit and one Delete — for the one comment that is yours.
        expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    });

    // Scoped to the comment: the re-estimate form above has its own Save.
    const commentEditor = () =>
        within(screen.getByLabelText('Edit comment').closest('li') as HTMLElement);

    it('edits your own comment', async () => {
        getTaskComments.mockResolvedValue([comment('c1', '2026-08-03T10:00:00Z')]);
        panel();

        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'Revised' } });
        fireEvent.click(commentEditor().getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(updateTaskComment).toHaveBeenCalledWith('c1', 'Revised'));
    });

    it('does not save an edit that changed nothing', async () => {
        getTaskComments.mockResolvedValue([comment('c1', '2026-08-03T10:00:00Z')]);
        panel();

        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        fireEvent.click(commentEditor().getByRole('button', { name: 'Save' }));

        expect(updateTaskComment).not.toHaveBeenCalled();
    });

    it('watches and unwatches', async () => {
        panel();
        fireEvent.click(await screen.findByRole('button', { name: /Watch/ }));
        await waitFor(() => expect(watchTask).toHaveBeenCalledWith('t1'));

        getTaskWatchers.mockResolvedValue([{ user_id: 'user-me' }]);
        panel();
        fireEvent.click(await screen.findByRole('button', { name: /Watching/ }));
        await waitFor(() => expect(unwatchTask).toHaveBeenCalledWith('t1'));
    });

    it('shows you are already watching when you are', async () => {
        getTaskWatchers.mockResolvedValue([{ user_id: 'user-me' }]);
        panel();

        expect(await screen.findByRole('button', { name: /Watching/ })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    // An empty timeline and a broken one look identical otherwise — the trap
    // logged against useServerList, in miniature.
    it('says the feed failed rather than showing it as empty', async () => {
        getTaskActivity.mockRejectedValue(new Error('nope'));
        panel();

        expect(await screen.findByText('Could not load the activity.')).toBeInTheDocument();
        expect(screen.queryByText('Nothing has happened here yet.')).not.toBeInTheDocument();
    });

    it('says so when there is genuinely nothing yet', async () => {
        panel();
        expect(await screen.findByText('Nothing has happened here yet.')).toBeInTheDocument();
    });
});

describe('TaskDetailPanel title', () => {
    it('turns the heading into an input and saves on Enter', async () => {
        panel();
        fireEvent.click(await screen.findByRole('button', { name: 'Edit title: Wire the meter' }));

        const field = screen.getByDisplayValue('Wire the meter');
        fireEvent.change(field, { target: { value: '  Wire the sub-meter  ' } });
        fireEvent.keyDown(field, { key: 'Enter' });

        await waitFor(() =>
            // Trimmed — trailing whitespace is never part of what they meant.
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { title: 'Wire the sub-meter' }),
        );
    });

    it('saves when the field loses focus', async () => {
        panel();
        fireEvent.click(await screen.findByRole('button', { name: /^Edit title/ }));

        const field = screen.getByDisplayValue('Wire the meter');
        fireEvent.change(field, { target: { value: 'Wire the riser' } });
        fireEvent.blur(field);

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { title: 'Wire the riser' }),
        );
    });

    it('discards the edit on Escape', async () => {
        panel();
        fireEvent.click(await screen.findByRole('button', { name: /^Edit title/ }));

        const field = screen.getByDisplayValue('Wire the meter');
        fireEvent.change(field, { target: { value: 'Something else' } });
        fireEvent.keyDown(field, { key: 'Escape' });

        expect(await screen.findByRole('button', { name: /^Edit title/ })).toBeInTheDocument();
        expect(updateProjectTask).not.toHaveBeenCalled();
    });

    it('refuses to blank the title', async () => {
        panel();
        fireEvent.click(await screen.findByRole('button', { name: /^Edit title/ }));

        const field = screen.getByDisplayValue('Wire the meter');
        fireEvent.change(field, { target: { value: '   ' } });
        fireEvent.keyDown(field, { key: 'Enter' });

        expect(updateProjectTask).not.toHaveBeenCalled();
    });
});

describe('TaskDetailPanel description', () => {
    const descriptionSection = (editor: HTMLElement) => editor.closest('section') as HTMLElement;

    const withDescription = (description: string | null) => ({
        id: 't1',
        title: 'Wire the meter',
        description,
        checklistItems: [],
        timeEntries: [],
    });

    it('offers to add one when the task has none', async () => {
        getProjectTask.mockResolvedValue(withDescription(null));
        panel();

        expect(await screen.findByRole('button', { name: 'Add a description…' })).toBeInTheDocument();
    });

    it('renders what is there as markdown rather than as source', async () => {
        getProjectTask.mockResolvedValue(withDescription('**Isolate** the board first'));
        panel();

        const bold = await screen.findByText('Isolate');
        expect(bold.tagName).toBe('STRONG');
        expect(screen.queryByText('**Isolate** the board first')).not.toBeInTheDocument();
    });

    it('saves the text the editor holds', async () => {
        getProjectTask.mockResolvedValue(withDescription(null));
        panel();
        fireEvent.click(await screen.findByRole('button', { name: 'Add a description…' }));

        const editor = screen.getByLabelText('Description');
        fireEvent.change(editor, { target: { value: '  Two circuits, one meter  ' } });
        // Scoped: the card carries other Save buttons (hours, re-estimate).
        fireEvent.click(within(descriptionSection(editor)).getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', {
                description: 'Two circuits, one meter',
            }),
        );
    });

    it('clears the description when the text is emptied', async () => {
        getProjectTask.mockResolvedValue(withDescription('Old detail'));
        panel();
        fireEvent.click(await screen.findByRole('button', { name: 'Edit description' }));

        const editor = screen.getByLabelText('Description');
        fireEvent.change(editor, { target: { value: '' } });
        fireEvent.click(within(descriptionSection(editor)).getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { description: '' }),
        );
    });

    it('wraps the selection when a formatting button is used', async () => {
        getProjectTask.mockResolvedValue(withDescription(null));
        panel();
        fireEvent.click(await screen.findByRole('button', { name: 'Add a description…' }));

        const editor = screen.getByLabelText('Description') as HTMLTextAreaElement;
        fireEvent.change(editor, { target: { value: 'isolate the board' } });
        editor.setSelectionRange(0, 7);
        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

        await waitFor(() => expect(editor).toHaveValue('**isolate** the board'));
    });

    it('leaves the card open when Escape cancels the edit', async () => {
        const onClose = jest.fn();
        getProjectTask.mockResolvedValue(withDescription(null));
        render(<TaskDetailPanel taskId="t1" onClose={onClose} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add a description…' }));

        fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'Escape' });

        expect(await screen.findByRole('button', { name: 'Add a description…' })).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(updateProjectTask).not.toHaveBeenCalled();
    });
});

describe('TaskDetailPanel assignee', () => {
    const karim = { id: 'user-2', name: 'Karim', email: 'karim@x.com' };
    const rahim = { id: 'emp-1', name: 'Rahim Uddin' };

    const roster = () =>
        getProject.mockResolvedValue({
            id: 'project-1',
            members: [
                { id: 'm1', user: karim },
                { id: 'm2', employee: rahim },
            ],
        });

    // The roster loads after the task, so every case here waits for an option
    // rather than for the select — which is on screen before either arrives.
    const picker = async () => {
        await screen.findByRole('option', { name: 'Karim' });
        return screen.getByLabelText('Assignee');
    };

    it('offers the project roster, including the employees with no login', async () => {
        roster();
        panel();

        const select = within(await picker());
        expect(select.getByRole('option', { name: 'Karim' })).toBeInTheDocument();
        expect(select.getByRole('option', { name: 'Rahim Uddin' })).toBeInTheDocument();
        expect(select.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
    });

    it('shows who holds the card', async () => {
        roster();
        getProjectTask.mockResolvedValue({ ...withChecklist([]), assignee: karim });
        panel();

        await waitFor(() => expect(screen.getByLabelText('Assignee')).toHaveValue('user:user-2'));
    });

    // Sending only the column that gained a value would leave a card holding a
    // user and an employee at the same time.
    it('assigns a user and clears the employee column in the same PATCH', async () => {
        roster();
        panel();

        fireEvent.change(await picker(), { target: { value: 'user:user-2' } });

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', {
                assigneeId: 'user-2',
                assigneeEmployeeId: '',
            }),
        );
    });

    it('assigns an employee who has no login', async () => {
        roster();
        panel();

        fireEvent.change(await picker(), { target: { value: 'employee:emp-1' } });

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', {
                assigneeId: '',
                assigneeEmployeeId: 'emp-1',
            }),
        );
    });

    // PATCH reads undefined as "leave alone", so only '' can mean nobody — and
    // the DTO has a ValidateIf so the empty string is not a 400.
    it('unassigns with empty strings, not undefined', async () => {
        roster();
        getProjectTask.mockResolvedValue({ ...withChecklist([]), assignee: karim });
        panel();

        fireEvent.change(await screen.findByLabelText('Assignee'), { target: { value: '' } });

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', {
                assigneeId: '',
                assigneeEmployeeId: '',
            }),
        );
    });

    // Otherwise the select falls back to its first option and the card reads as
    // assigned to somebody it is not.
    it('still lists the holder after they have left the project', async () => {
        getProject.mockResolvedValue({ id: 'project-1', members: [] });
        getProjectTask.mockResolvedValue({ ...withChecklist([]), assignee: karim });
        panel();

        await waitFor(() => expect(screen.getByLabelText('Assignee')).toHaveValue('user:user-2'));
        expect(screen.getByRole('option', { name: 'Karim' })).toBeInTheDocument();
    });

    it('opens with the picker usable when the roster cannot be read', async () => {
        getProject.mockRejectedValue(new Error('nope'));
        panel();

        expect(await screen.findByLabelText('Assignee')).toBeInTheDocument();
        expect(screen.getByText('Pull the cable')).toBeInTheDocument();
    });
});

describe('TaskDetailPanel estimate', () => {
    const withEstimate = (estimate: string | null) => ({
        ...withChecklist([]),
        estimate_hours: estimate,
    });

    it('shows the estimate the task carries', async () => {
        getProjectTask.mockResolvedValue(withEstimate('6'));
        panel();

        expect(await screen.findByLabelText('Estimate (h)')).toHaveValue(6);
    });

    it('saves a new estimate on Enter', async () => {
        getProjectTask.mockResolvedValue(withEstimate('6'));
        panel();

        const field = await screen.findByLabelText('Estimate (h)');
        fireEvent.change(field, { target: { value: '8' } });
        fireEvent.keyDown(field, { key: 'Enter' });

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { estimateHours: 8 }),
        );
    });

    it('saves when the field loses focus', async () => {
        getProjectTask.mockResolvedValue(withEstimate('6'));
        panel();

        const field = await screen.findByLabelText('Estimate (h)');
        fireEvent.change(field, { target: { value: '2.5' } });
        fireEvent.blur(field);

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { estimateHours: 2.5 }),
        );
    });

    it('does not save an estimate that changed nothing', async () => {
        getProjectTask.mockResolvedValue(withEstimate('6'));
        panel();

        fireEvent.blur(await screen.findByLabelText('Estimate (h)'));

        expect(updateProjectTask).not.toHaveBeenCalled();
    });

    // Reading an emptied box as zero would throw the burndown off without
    // anyone having asked for it.
    it('puts the stored figure back when the box is emptied', async () => {
        getProjectTask.mockResolvedValue(withEstimate('6'));
        panel();

        const field = await screen.findByLabelText('Estimate (h)');
        fireEvent.change(field, { target: { value: '' } });
        fireEvent.blur(field);

        expect(updateProjectTask).not.toHaveBeenCalled();
        await waitFor(() => expect(field).toHaveValue(6));
    });

    it('discards the edit on Escape', async () => {
        getProjectTask.mockResolvedValue(withEstimate('6'));
        panel();

        const field = await screen.findByLabelText('Estimate (h)');
        fireEvent.change(field, { target: { value: '9' } });
        fireEvent.keyDown(field, { key: 'Escape' });

        await waitFor(() => expect(field).toHaveValue(6));
        expect(updateProjectTask).not.toHaveBeenCalled();
    });

    it('reports a failed save and restores what the server has', async () => {
        const { toast } = jest.requireMock('@/lib/toast');
        getProjectTask.mockResolvedValue(withEstimate('6'));
        updateProjectTask.mockRejectedValue(new Error('Nope'));
        panel();

        const field = await screen.findByLabelText('Estimate (h)');
        fireEvent.change(field, { target: { value: '8' } });
        fireEvent.blur(field);

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nope'));
        await waitFor(() => expect(field).toHaveValue(6));
    });
});

// Hours and the revised remaining figure used to be two forms with two Save
// buttons; logging an afternoon and re-estimating it was two round trips.
describe('TaskDetailPanel logging work', () => {
    const workSection = (field: HTMLElement) => within(field.closest('section') as HTMLElement);

    // Wrapped in act: the click starts a request whose resolution clears the
    // form, and React warns about that state update landing outside a test.
    const save = async () => {
        const hours = await screen.findByLabelText('Hours');
        await act(async () => {
            fireEvent.click(workSection(hours).getByRole('button', { name: 'Save' }));
        });
    };

    it('logs hours with the remaining figure in one save', async () => {
        panel();

        fireEvent.change(await screen.findByLabelText('Hours'), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText('Remaining after this'), {
            target: { value: '4' },
        });
        fireEvent.change(screen.getByLabelText('Note'), { target: { value: '  Rewired  ' } });
        await save();

        await waitFor(() =>
            expect(logProjectTime).toHaveBeenCalledWith(
                expect.objectContaining({
                    taskId: 't1',
                    hours: 3,
                    remainingHours: 4,
                    note: 'Rewired',
                }),
            ),
        );
        expect(updateProjectTask).not.toHaveBeenCalled();
    });

    it('leaves the remaining figure to the server when the box is blank', async () => {
        panel();

        fireEvent.change(await screen.findByLabelText('Hours'), { target: { value: '3' } });
        await save();

        await waitFor(() =>
            expect(logProjectTime).toHaveBeenCalledWith(
                expect.objectContaining({ hours: 3, remainingHours: undefined }),
            ),
        );
    });

    // The same form, with no hours in it, is the re-estimate that used to have a
    // section of its own.
    it('re-estimates without logging time when only the remaining figure is given', async () => {
        panel();

        fireEvent.change(await screen.findByLabelText('Remaining after this'), {
            target: { value: '9' },
        });
        fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Two more rooms' } });
        await save();

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', {
                remainingHours: 9,
                remainingNote: 'Two more rooms',
            }),
        );
        expect(logProjectTime).not.toHaveBeenCalled();
    });

    it('has nothing to save until one of the two is filled in', async () => {
        panel();
        const hours = await screen.findByLabelText('Hours');

        expect(workSection(hours).getByRole('button', { name: 'Save' })).toBeDisabled();

        fireEvent.change(hours, { target: { value: '2' } });
        expect(workSection(hours).getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('clears the form after a save', async () => {
        panel();

        const hours = await screen.findByLabelText('Hours');
        fireEvent.change(hours, { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Rewired' } });
        await save();

        await waitFor(() => expect(hours).toHaveValue(null));
        expect(screen.getByLabelText('Note')).toHaveValue('');
    });

    it('reports a failed log instead of clearing the form', async () => {
        const { toast } = jest.requireMock('@/lib/toast');
        logProjectTime.mockRejectedValue(new Error('Nope'));
        panel();

        const hours = await screen.findByLabelText('Hours');
        fireEvent.change(hours, { target: { value: '3' } });
        await save();

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nope'));
        expect(hours).toHaveValue(3);
    });
});

describe('TaskDetailPanel board columns', () => {
    // Since Phase 3L the tenant template and a board's columns are different
    // sets. Offering the template here would let someone move a card into a
    // column its own board does not have.
    it('offers the task’s own board columns, not the tenant template', async () => {
        getProjectColumns.mockResolvedValue([{ id: 's1', name: 'Site visit', category: 'TODO' }]);
        panel();

        expect(await screen.findByText('Site visit')).toBeInTheDocument();
        await waitFor(() => expect(getProjectColumns).toHaveBeenCalledWith('project-1'));
        const { api } = jest.requireMock('@/lib/api');
        expect(api.getProjectTaskStatuses).not.toHaveBeenCalled();
    });
});

describe('TaskDetailPanel cover', () => {
    it('marks the colour the card is wearing', async () => {
        getProjectTask.mockResolvedValue({ ...withChecklist([]), cover_color: 'BLUE' });
        panel();

        expect(await screen.findByLabelText('Cover colour Blue')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByLabelText('Cover colour Red')).toHaveAttribute('aria-pressed', 'false');
    });

    it('sets a cover', async () => {
        panel();
        fireEvent.click(await screen.findByLabelText('Cover colour Red'));

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { coverColor: 'RED' }),
        );
    });

    it('clears it with an empty string, the PATCH-clearing convention', async () => {
        getProjectTask.mockResolvedValue({ ...withChecklist([]), cover_color: 'BLUE' });
        panel();

        fireEvent.click(await screen.findByRole('button', { name: 'No cover' }));

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { coverColor: '' }),
        );
    });

    it('cannot clear a cover that is not set', async () => {
        panel();
        expect(await screen.findByRole('button', { name: 'No cover' })).toBeDisabled();
    });
});

describe('TaskDetailPanel attachments', () => {
    const file = (name: string, type: string, size = 1000) => {
        const f = new File(['x'], name, { type });
        Object.defineProperty(f, 'size', { value: size });
        return f;
    };

    it('lists what is attached', async () => {
        getTaskAttachments.mockResolvedValue([
            {
                id: 'a1',
                file_url: 'https://cdn/plan.png',
                file_name: 'plan.png',
                file_size: 2048,
                created_at: '2026-08-03T10:00:00Z',
            },
        ]);
        panel();

        const link = await screen.findByRole('link', { name: 'plan.png' });
        expect(link).toHaveAttribute('href', 'https://cdn/plan.png');
    });

    it('uploads a file', async () => {
        panel();
        const input = await screen.findByLabelText('Attach a file');

        fireEvent.change(input, { target: { files: [file('plan.png', 'image/png')] } });

        await waitFor(() =>
            expect(addTaskAttachment).toHaveBeenCalledWith(
                't1',
                expect.objectContaining({ fileName: 'plan.png', mimeType: 'image/png' }),
            ),
        );
    });

    // Checked before reading: no point turning 20 MB into base64 to be told no.
    it('refuses an oversized file without uploading it', async () => {
        const { toast } = jest.requireMock('@/lib/toast');
        panel();
        const input = await screen.findByLabelText('Attach a file');

        fireEvent.change(input, {
            target: { files: [file('huge.png', 'image/png', 9 * 1024 * 1024)] },
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That file is larger than 5 MB.'));
        expect(addTaskAttachment).not.toHaveBeenCalled();
    });

    it('refuses a type that is not allowed', async () => {
        const { toast } = jest.requireMock('@/lib/toast');
        panel();
        const input = await screen.findByLabelText('Attach a file');

        fireEvent.change(input, {
            target: { files: [file('run.exe', 'application/x-msdownload')] },
        });

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith('Use a JPEG, PNG, WebP or PDF.'),
        );
        expect(addTaskAttachment).not.toHaveBeenCalled();
    });

    it('accepts a PDF', async () => {
        panel();
        const input = await screen.findByLabelText('Attach a file');

        fireEvent.change(input, { target: { files: [file('spec.pdf', 'application/pdf')] } });

        await waitFor(() => expect(addTaskAttachment).toHaveBeenCalled());
    });

    it('removes an attachment', async () => {
        getTaskAttachments.mockResolvedValue([
            {
                id: 'a1',
                file_url: 'https://cdn/plan.png',
                file_name: 'plan.png',
                created_at: '2026-08-03T10:00:00Z',
            },
        ]);
        panel();

        fireEvent.click(await screen.findByLabelText('Remove attachment plan.png'));

        await waitFor(() => expect(deleteTaskAttachment).toHaveBeenCalledWith('a1'));
    });

    it('says the list failed rather than showing it as empty', async () => {
        getTaskAttachments.mockRejectedValue(new Error('nope'));
        panel();

        expect(await screen.findByText('Could not load the attachments.')).toBeInTheDocument();
        expect(screen.queryByText('Nothing attached yet.')).not.toBeInTheDocument();
    });
});
