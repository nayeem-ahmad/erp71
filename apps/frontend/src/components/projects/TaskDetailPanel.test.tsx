import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskDetailPanel from './TaskDetailPanel';

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const getProjectTask = jest.fn();
const addTaskChecklistItem = jest.fn();
const updateTaskChecklistItem = jest.fn();
const deleteTaskChecklistItem = jest.fn();
const reorderTaskChecklist = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjectTask: (...args: unknown[]) => getProjectTask(...args),
        getTaskRemainingHistory: jest.fn().mockResolvedValue([]),
        getProjectTaskStatuses: jest.fn().mockResolvedValue([]),
        addTaskChecklistItem: (...args: unknown[]) => addTaskChecklistItem(...args),
        updateTaskChecklistItem: (...args: unknown[]) => updateTaskChecklistItem(...args),
        deleteTaskChecklistItem: (...args: unknown[]) => deleteTaskChecklistItem(...args),
        reorderTaskChecklist: (...args: unknown[]) => reorderTaskChecklist(...args),
    },
}));

const item = (id: string, text: string, isDone = false, sortOrder = 0) => ({
    id,
    text,
    is_done: isDone,
    sort_order: sortOrder,
});

const withChecklist = (items: ReturnType<typeof item>[]) => ({
    id: 't1',
    title: 'Wire the meter',
    checklistItems: items,
    timeEntries: [],
});

beforeEach(() => {
    for (const mock of [
        getProjectTask,
        addTaskChecklistItem,
        updateTaskChecklistItem,
        deleteTaskChecklistItem,
        reorderTaskChecklist,
    ]) {
        mock.mockReset();
        mock.mockResolvedValue({});
    }
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
