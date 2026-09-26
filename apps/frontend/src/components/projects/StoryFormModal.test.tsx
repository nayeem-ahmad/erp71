import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StoryFormModal, type UserStory } from './StoryFormModal';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        createProjectStory: jest.fn(),
        updateProjectStory: jest.fn(),
        getProjectEpics: jest.fn().mockResolvedValue([]),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const story = (overrides: Partial<UserStory> = {}): UserStory => ({
    id: 's1',
    reference: 3,
    code: 'OTB-3',
    title: 'Pay with bKash',
    status: 'BACKLOG',
    priority: 'MEDIUM',
    story_points: 5,
    project_id: 'p1',
    epic_id: 'e1',
    ...overrides,
});

const epics = [{ id: 'e1', code: 'OTB-E1', title: 'Payments', color: 'BLUE' }];

function renderModal(value: UserStory | null, onSaved = jest.fn()) {
    render(
        <StoryFormModal projectId="p1" projectCode="OTB" story={value} epics={epics} onClose={jest.fn()} onSaved={onSaved} />,
    );
    return { onSaved };
}

const statusSelect = () => screen.getByLabelText('Status') as HTMLSelectElement;
const optionValues = (select: HTMLSelectElement) => within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);

beforeEach(() => jest.clearAllMocks());

describe('StoryFormModal', () => {
    it('offers every status on a story with no tasks', () => {
        renderModal(story());
        expect(statusSelect()).not.toBeDisabled();
        expect(optionValues(statusSelect())).toEqual(['BACKLOG', 'READY', 'IN_PROGRESS', 'DONE']);
    });

    it('leaves only Backlog and Ready while none of its tasks has started', () => {
        renderModal(story({ progress: { taskCount: 2, doneTaskCount: 0, percentComplete: 0 } }));
        expect(optionValues(statusSelect())).toEqual(['BACKLOG', 'READY']);
        expect(screen.getByText('Follows its tasks once any has started.')).toBeInTheDocument();
    });

    it('locks the status once work has started', () => {
        renderModal(story({ status: 'IN_PROGRESS', progress: { taskCount: 2, doneTaskCount: 1, percentComplete: 50 } }));
        expect(statusSelect()).toBeDisabled();
        expect(optionValues(statusSelect())).toEqual(['IN_PROGRESS']);
    });

    it('saves the edited fields, with points as a number and a cleared epic as empty', async () => {
        (api.updateProjectStory as jest.Mock).mockResolvedValue({});
        const { onSaved } = renderModal(story());
        fireEvent.change(screen.getByLabelText(/Points/), { target: { value: '8' } });
        fireEvent.change(screen.getByLabelText('Epic'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(api.updateProjectStory).toHaveBeenCalledWith(
            's1',
            expect.objectContaining({ storyPoints: 8, epicId: '', title: 'Pay with bKash' }),
        );
    });

    it('points a taken ID back at the ID field', async () => {
        (api.createProjectStory as jest.Mock).mockRejectedValue(new Error('Story ID "OTB-1" is already used in this project'));
        renderModal(null);
        fireEvent.change(screen.getByLabelText(/Story ID/), { target: { value: 'OTB-1' } });
        fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Refunds' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Story ID "OTB-1" is already used in this project')).toBeInTheDocument();
    });
});
