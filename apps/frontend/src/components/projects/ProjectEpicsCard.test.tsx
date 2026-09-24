import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProjectEpicsCard, { type Epic } from './ProjectEpicsCard';

const getProjectEpic = jest.fn();
const createProjectStory = jest.fn().mockResolvedValue({});
const updateProjectEpic = jest.fn().mockResolvedValue({});
const deleteProjectEpic = jest.fn().mockResolvedValue({ success: true });

jest.mock('@/lib/api', () => ({
    api: {
        getProjectEpic: (...args: unknown[]) => getProjectEpic(...args),
        createProjectStory: (...args: unknown[]) => createProjectStory(...args),
        updateProjectEpic: (...args: unknown[]) => updateProjectEpic(...args),
        deleteProjectEpic: (...args: unknown[]) => deleteProjectEpic(...args),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const epic = (overrides: Partial<Epic> = {}): Epic => ({
    id: 'epic-1',
    reference: 1,
    code: 'OTB-E1',
    title: 'Online payments',
    description: 'Take money without cash.',
    status: 'OPEN',
    priority: 'MEDIUM',
    color: 'BLUE',
    progress: {
        storyCount: 3,
        doneStoryCount: 1,
        storyPoints: 8,
        doneStoryPoints: 3,
        taskCount: 5,
        doneTaskCount: 2,
        percentComplete: 33,
    },
    ...overrides,
});

const renderCard = (props: Partial<React.ComponentProps<typeof ProjectEpicsCard>> = {}) =>
    render(
        <ProjectEpicsCard
            projectId="p1"
            projectCode="OTB"
            epics={[epic()]}
            onEpicsChanged={jest.fn()}
            {...props}
        />,
    );

describe('ProjectEpicsCard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getProjectEpic.mockResolvedValue({
            ...epic(),
            stories: [{ id: 's1', code: 'OTB-1', title: 'Pay with bKash', status: 'DONE', story_points: 3 }],
        });
    });

    it('says how many stories are done before the epic is opened', async () => {
        renderCard();

        expect(await screen.findByText('OTB-E1')).toBeInTheDocument();
        expect(screen.getByText('1/3 stories')).toBeInTheDocument();
        expect(getProjectEpic).not.toHaveBeenCalled();
    });

    it('fetches the stories only when the epic is opened', async () => {
        renderCard();
        fireEvent.click(screen.getByRole('button', { name: /Online payments/ }));

        await waitFor(() => expect(getProjectEpic).toHaveBeenCalledWith('epic-1'));
        expect(await screen.findByText('Pay with bKash')).toBeInTheDocument();
        expect(screen.getByText('Take money without cash.')).toBeInTheDocument();
        expect(screen.getByText(/3\/8 pts/)).toBeInTheDocument();
    });

    it('arrives open when the page names it', async () => {
        renderCard({ openEpicId: 'epic-1' });
        expect(await screen.findByText('Pay with bKash')).toBeInTheDocument();
    });

    it('files a quick-added story under the epic it was typed into', async () => {
        const onStoriesChanged = jest.fn();
        renderCard({ openEpicId: 'epic-1', onStoriesChanged });

        fireEvent.change(await screen.findByLabelText('Add story'), { target: { value: 'Pay with Nagad' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add story' }));

        await waitFor(() =>
            expect(createProjectStory).toHaveBeenCalledWith({
                projectId: 'p1',
                title: 'Pay with Nagad',
                epicId: 'epic-1',
            }),
        );
        await waitFor(() => expect(onStoriesChanged).toHaveBeenCalled());
    });

    it('clears a target date with an empty string when editing', async () => {
        renderCard({ epics: [epic({ target_date: '2026-12-31T00:00:00.000Z' })] });

        fireEvent.click(screen.getByRole('button', { name: 'Edit epic' }));
        fireEvent.change(screen.getByLabelText('Target date'), { target: { value: '' } });
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(updateProjectEpic).toHaveBeenCalled());
        expect(updateProjectEpic).toHaveBeenCalledWith(
            'epic-1',
            expect.objectContaining({ code: 'OTB-E1', targetDate: '' }),
        );
    });

    it('refuses to save an epic with no title', async () => {
        renderCard({ epics: [] });

        fireEvent.click(await screen.findByText('New epic'));
        fireEvent.click(screen.getByText('Save'));

        expect(await screen.findByText('Give the epic a title.')).toBeInTheDocument();
    });
});
