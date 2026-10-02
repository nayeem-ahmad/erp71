import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import BulkEditCardsModal from './BulkEditCardsModal';
import { useProjectMeta } from './use-project-meta';
import { api } from '@/lib/api';
import type { ProjectLabel } from './board-tasks';

jest.mock('@/lib/api', () => ({
    api: { getSprints: jest.fn(), getProject: jest.fn(), getProjectColumns: jest.fn() },
}));

const blocked: ProjectLabel = { id: 'l1', name: 'Blocked', color: 'RED' };
const urgent: ProjectLabel = { id: 'l2', name: 'Customer', color: 'BLUE' };

/** The modal as the board mounts it, with a real roster cache behind it. */
function Harness({
    onSubmit = jest.fn(),
    onClose = jest.fn(),
    labels = [blocked, urgent],
    projectIds = ['p1'],
}: {
    onSubmit?: jest.Mock;
    onClose?: jest.Mock;
    labels?: ProjectLabel[];
    projectIds?: string[];
}) {
    const projectMeta = useProjectMeta();
    return (
        <BulkEditCardsModal
            count={3}
            projectIds={projectIds}
            projects={[
                { id: 'p1', code: 'ALP', name: 'Alpha' },
                { id: 'p2', code: 'BET', name: 'Beta' },
            ]}
            labels={labels}
            assignees={[{ key: 'user:u-karim', label: 'Karim' }]}
            projectMeta={projectMeta}
            busy={false}
            onSubmit={onSubmit}
            onClose={onClose}
        />
    );
}

const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Apply to 3 cards' }));

describe('BulkEditCardsModal', () => {
    beforeEach(() => {
        (api.getSprints as jest.Mock).mockReset().mockResolvedValue([
            { id: 's4', name: 'Sprint 4', status: 'ACTIVE' },
            { id: 's5', name: 'Sprint 5', status: 'PLANNED' },
            { id: 's3', name: 'Sprint 3', status: 'COMPLETED' },
        ]);
        (api.getProject as jest.Mock).mockReset().mockResolvedValue({
            id: 'p1',
            members: [
                { user: { id: 'u-rafi', name: 'Rafi Hasan', email: 'rafi@erp71.com' } },
                { employee: { id: 'e-sumaiya', name: 'Sumaiya Akter' } },
            ],
        });
        (api.getProjectColumns as jest.Mock).mockReset().mockResolvedValue([]);
    });

    it('keeps Apply off until a field is changed', async () => {
        render(<Harness />);
        await screen.findByRole('option', { name: 'Sprint 5' });

        expect(screen.getByRole('button', { name: 'Apply to 3 cards' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'LOW' } });
        expect(screen.getByRole('button', { name: 'Apply to 3 cards' })).toBeEnabled();
    });

    it('sends only the fields that were changed', async () => {
        const onSubmit = jest.fn();
        render(<Harness onSubmit={onSubmit} />);
        await screen.findByRole('option', { name: 'Sprint 5' });

        fireEvent.change(screen.getByLabelText('Sprint'), { target: { value: 's5' } });
        fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } });
        apply();

        expect(onSubmit).toHaveBeenCalledWith({ sprintId: 's5', projectId: 'p2' });
    });

    it('clears the sprint, the assignee and the due date with null', async () => {
        const onSubmit = jest.fn();
        render(<Harness onSubmit={onSubmit} />);
        await screen.findByRole('option', { name: 'Sprint 5' });

        fireEvent.change(screen.getByLabelText('Sprint'), { target: { value: 'none' } });
        fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'none' } });
        fireEvent.change(screen.getByLabelText('Due date'), { target: { value: 'clear' } });
        apply();

        expect(onSubmit).toHaveBeenCalledWith({ sprintId: null, assignee: null, dueDate: null });
    });

    it('sets a due date once one is picked', async () => {
        const onSubmit = jest.fn();
        render(<Harness onSubmit={onSubmit} />);
        await screen.findByRole('option', { name: 'Sprint 5' });

        fireEvent.change(screen.getByLabelText('Due date'), { target: { value: 'set' } });
        // "Set a date" with no date yet is not a change.
        expect(screen.getByRole('button', { name: 'Apply to 3 cards' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('New due date'), { target: { value: '2026-10-09' } });
        apply();

        expect(onSubmit).toHaveBeenCalledWith({ dueDate: '2026-10-09' });
    });

    it('offers open sprints only, the running one marked', async () => {
        render(<Harness />);
        const sprint = screen.getByLabelText('Sprint');

        expect(await within(sprint).findByRole('option', { name: 'Sprint 4 (active)' })).toBeInTheDocument();
        expect(within(sprint).queryByRole('option', { name: /Sprint 3/ })).not.toBeInTheDocument();
    });

    it('offers the team of every project the cards come from, beside who holds them now', async () => {
        render(<Harness />);
        const assignee = screen.getByLabelText('Assignee');

        expect(await within(assignee).findByRole('option', { name: 'Rafi Hasan' })).toHaveValue('user:u-rafi');
        expect(within(assignee).getByRole('option', { name: 'Sumaiya Akter' })).toHaveValue('employee:e-sumaiya');
        expect(within(assignee).getByRole('option', { name: 'Karim' })).toBeInTheDocument();
        expect(api.getProject).toHaveBeenCalledWith('p1');
    });

    it('sends a picked assignee as its key', async () => {
        const onSubmit = jest.fn();
        render(<Harness onSubmit={onSubmit} />);
        const assignee = screen.getByLabelText('Assignee');
        await within(assignee).findByRole('option', { name: 'Rafi Hasan' });

        fireEvent.change(assignee, { target: { value: 'user:u-rafi' } });
        apply();

        expect(onSubmit).toHaveBeenCalledWith({ assignee: 'user:u-rafi' });
    });

    it('adds and removes labels, and never both for one label', async () => {
        const onSubmit = jest.fn();
        render(<Harness onSubmit={onSubmit} />);
        await screen.findByRole('option', { name: 'Sprint 5' });

        const adding = screen.getByRole('group', { name: 'Add labels' });
        const removing = screen.getByRole('group', { name: 'Remove labels' });

        fireEvent.click(within(adding).getByRole('button', { name: 'Blocked' }));
        fireEvent.click(within(removing).getByRole('button', { name: 'Customer' }));
        // Picking Blocked for removal takes it back out of the additions.
        fireEvent.click(within(removing).getByRole('button', { name: 'Blocked' }));
        expect(within(adding).getByRole('button', { name: 'Blocked' })).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(within(adding).getByRole('button', { name: 'Blocked' }));
        apply();

        expect(onSubmit).toHaveBeenCalledWith({ addLabelIds: ['l1'], removeLabelIds: ['l2'] });
    });

    it('leaves the labels out when the workspace has none', async () => {
        render(<Harness labels={[]} />);
        await screen.findByRole('option', { name: 'Sprint 5' });

        expect(screen.queryByRole('group', { name: 'Add labels' })).not.toBeInTheDocument();
    });

    it('warns what a project move does to the cards', async () => {
        render(<Harness />);
        await screen.findByRole('option', { name: 'Sprint 5' });

        expect(screen.queryByText(/new key/i)).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } });
        expect(screen.getByText(/new key/i)).toBeInTheDocument();
    });

    it('still opens when the sprints cannot be read', async () => {
        (api.getSprints as jest.Mock).mockRejectedValue(new Error('offline'));
        const onSubmit = jest.fn();
        render(<Harness onSubmit={onSubmit} />);

        await waitFor(() => expect(api.getSprints).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText('Sprint'), { target: { value: 'none' } });
        apply();
        expect(onSubmit).toHaveBeenCalledWith({ sprintId: null });
    });
});
