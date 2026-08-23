import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectSettingsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getProjectTypes: jest.fn(),
        getProjectTaskStatuses: jest.fn(),
        getProjectLabels: jest.fn(),
        getProjectTimeTags: jest.fn(),
        createProjectTimeTag: jest.fn(),
        updateProjectTimeTag: jest.fn(),
        deleteProjectTimeTag: jest.fn(),
        createProjectLabel: jest.fn(),
        updateProjectLabel: jest.fn(),
        deleteProjectLabel: jest.fn(),
        createProjectType: jest.fn(),
        updateProjectType: jest.fn(),
        deleteProjectType: jest.fn(),
        createProjectTaskStatus: jest.fn(),
        updateProjectTaskStatus: jest.fn(),
        deleteProjectTaskStatus: jest.fn(),
    },
}));

const toastInfo = jest.fn();
jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: (...a: unknown[]) => toastInfo(...a) },
}));

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    toastInfo.mockReset();
    api.getProjectTypes.mockReset().mockResolvedValue([]);
    api.getProjectTaskStatuses.mockReset().mockResolvedValue([]);
    api.getProjectLabels.mockReset().mockResolvedValue([]);
    api.getProjectTimeTags.mockReset().mockResolvedValue([]);
    api.createProjectTimeTag.mockReset().mockResolvedValue({});
    api.updateProjectTimeTag.mockReset().mockResolvedValue({});
    api.deleteProjectTimeTag.mockReset().mockResolvedValue({ success: true });
});

/**
 * The hour-log capture bar tells people to add tags "in project settings", so
 * this section existing is what keeps that sentence from being a lie. It is
 * also the only way the tag vocabulary can be created at all — the endpoints
 * are otherwise reachable only by curl.
 */
describe('Project settings — hour-log tags', () => {
    it('has a section of its own, separate from task labels', async () => {
        render(<ProjectSettingsPage />);

        expect(await screen.findByText('Hour-log tags')).toBeInTheDocument();
        expect(screen.getByText('Labels')).toBeInTheDocument();
    });

    it('creates a tag with the colour chosen beside it', async () => {
        const { api } = jest.requireMock('@/lib/api');
        render(<ProjectSettingsPage />);

        fireEvent.change(await screen.findByLabelText('Add tag'), {
            target: { value: '  Billable  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Add tag/ }));

        await waitFor(() =>
            // Trimmed, and defaulting to a colour distinct from the label form's.
            expect(api.createProjectTimeTag).toHaveBeenCalledWith({
                name: 'Billable',
                color: 'EMERALD',
            }),
        );
    });

    it('does not create a tag with a blank name', async () => {
        const { api } = jest.requireMock('@/lib/api');
        render(<ProjectSettingsPage />);

        fireEvent.change(await screen.findByLabelText('Add tag'), { target: { value: '   ' } });
        expect(screen.getByRole('button', { name: /Add tag/ })).toBeDisabled();
        expect(api.createProjectTimeTag).not.toHaveBeenCalled();
    });

    it('reports how many hours lost a tag when it is deleted', async () => {
        const { api } = jest.requireMock('@/lib/api');
        api.getProjectTimeTags.mockResolvedValue([
            { id: 'tag-1', name: 'Billable', color: 'EMERALD' },
        ]);
        api.deleteProjectTimeTag.mockResolvedValue({ success: true, untagged: 12 });
        render(<ProjectSettingsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Delete Billable' }));

        await waitFor(() =>
            expect(toastInfo).toHaveBeenCalledWith('Removed from 12 hour log(s).'),
        );
    });

    it('says nothing about untagging when the tag was unused', async () => {
        const { api } = jest.requireMock('@/lib/api');
        api.getProjectTimeTags.mockResolvedValue([
            { id: 'tag-1', name: 'Billable', color: 'EMERALD' },
        ]);
        render(<ProjectSettingsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Delete Billable' }));

        await waitFor(() => expect(api.deleteProjectTimeTag).toHaveBeenCalledWith('tag-1'));
        expect(toastInfo).not.toHaveBeenCalled();
    });

    it('recolours a tag in place', async () => {
        const { api } = jest.requireMock('@/lib/api');
        api.getProjectTimeTags.mockResolvedValue([
            { id: 'tag-1', name: 'Billable', color: 'EMERALD' },
        ]);
        render(<ProjectSettingsPage />);

        fireEvent.change(await screen.findByLabelText('Colour — Billable'), {
            target: { value: 'AMBER' },
        });

        await waitFor(() =>
            expect(api.updateProjectTimeTag).toHaveBeenCalledWith('tag-1', { color: 'AMBER' }),
        );
    });

    it('shows an empty state rather than a bare list when there are no tags', async () => {
        render(<ProjectSettingsPage />);
        expect(await screen.findByText('No tags yet.')).toBeInTheDocument();
    });
});
