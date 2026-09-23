import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProjectStoriesCard, { type UserStory } from './ProjectStoriesCard';

const getProjectStory = jest.fn();
const createProjectStory = jest.fn().mockResolvedValue({});
const updateProjectStory = jest.fn().mockResolvedValue({});
const createProjectTask = jest.fn().mockResolvedValue({});
const deleteProjectStory = jest.fn().mockResolvedValue({ success: true });
const onStoriesChanged = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjectStory: (...args: unknown[]) => getProjectStory(...args),
        createProjectStory: (...args: unknown[]) => createProjectStory(...args),
        updateProjectStory: (...args: unknown[]) => updateProjectStory(...args),
        deleteProjectStory: (...args: unknown[]) => deleteProjectStory(...args),
        createProjectTask: (...args: unknown[]) => createProjectTask(...args),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const story = (overrides: Partial<UserStory> = {}): UserStory => ({
    id: 'story-1',
    reference: 3,
    code: 'OTB-3',
    title: 'Shopper pays with bKash',
    as_a: 'shopper',
    i_want: 'to pay with bKash',
    so_that: 'I do not have to carry cash',
    acceptance_criteria: null,
    status: 'READY',
    priority: 'MEDIUM',
    story_points: 5,
    progress: { taskCount: 4, doneTaskCount: 1, percentComplete: 25 },
    ...overrides,
});

/** The page owns the backlog; the card is handed it. */
const renderCard = (props: Partial<React.ComponentProps<typeof ProjectStoriesCard>> = {}) =>
    render(
        <ProjectStoriesCard
            projectId="p1"
            stories={[story()]}
            onStoriesChanged={onStoriesChanged}
            {...props}
        />,
    );

const expand = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Shopper pays with bKash/ }));
};

describe('ProjectStoriesCard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getProjectStory.mockResolvedValue({
            ...story(),
            tasks: [{ id: 'task-1', title: 'Wire the callback', status: { id: 's', name: 'To do', category: 'TODO' } }],
        });
    });

    it('says how much work is under a story before it is opened', async () => {
        renderCard();

        expect(await screen.findByText('OTB-3')).toBeInTheDocument();
        // The whole point of the collapsed row: without the count people open
        // every story just to find out whether there is anything under it.
        expect(screen.getByText('1/4 tasks')).toBeInTheDocument();
        expect(screen.getByText('5 pts')).toBeInTheDocument();
        expect(getProjectStory).not.toHaveBeenCalled();
    });

    it('fetches the tasks only when the story is opened', async () => {
        renderCard();
        await expand();

        await waitFor(() => expect(getProjectStory).toHaveBeenCalledWith('story-1'));
        expect(await screen.findByText('Wire the callback')).toBeInTheDocument();
    });

    it('composes the narrative from the three fields', async () => {
        renderCard();
        await expand();

        expect(
            await screen.findByText(
                'As a shopper, I want to pay with bKash so that I do not have to carry cash.',
            ),
        ).toBeInTheDocument();
    });

    it('files a quick-added task under the story it was typed into', async () => {
        const onTasksChanged = jest.fn();
        renderCard({ onTasksChanged });
        await expand();

        fireEvent.change(await screen.findByLabelText('Add task'), {
            target: { value: 'Wire the callback' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

        await waitFor(() => expect(createProjectTask).toHaveBeenCalled());
        expect(createProjectTask).toHaveBeenCalledWith({
            projectId: 'p1',
            title: 'Wire the callback',
            userStoryId: 'story-1',
        });
        // The project's flat task table is stale the moment a story grows a task.
        await waitFor(() => expect(onTasksChanged).toHaveBeenCalled());
    });

    it('opens a task through the page’s own panel rather than a second one', async () => {
        const onOpenTask = jest.fn();
        renderCard({ onOpenTask });
        await expand();

        fireEvent.click(await screen.findByText('Wire the callback'));
        expect(onOpenTask).toHaveBeenCalledWith('task-1');
    });

    it('sends no points as null, so an unsized story is not sized at zero', async () => {
        renderCard({ stories: [] });

        fireEvent.click(await screen.findByText('New user story'));
        fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Refunds' } });
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(createProjectStory).toHaveBeenCalled());
        expect(createProjectStory).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: 'p1', title: 'Refunds', storyPoints: null }),
        );
    });

    it('refuses to save a story with no title', async () => {
        renderCard({ stories: [] });

        fireEvent.click(await screen.findByText('New user story'));
        fireEvent.click(screen.getByText('Save'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Give the story a title.');
        expect(createProjectStory).not.toHaveBeenCalled();
    });

    it('warns that deleting a story keeps its tasks', async () => {
        renderCard();

        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

        expect(await screen.findByText(/tasks under it are kept/i)).toBeInTheDocument();
    });

    /**
     * How the cross-project backlog hands a row to the project that owns it:
     * without this the link lands on a collapsed list and the story somebody
     * clicked is one of forty identical rows.
     */
    describe('openStoryId', () => {
        it('opens the story the link names, and loads its tasks', async () => {
            renderCard({ stories: [story(), story({ id: 'story-2', reference: 4, code: 'OTB-4', title: 'Owner reads the day book' })], openStoryId: 'story-2' });

            await waitFor(() => expect(getProjectStory).toHaveBeenCalledWith('story-2'));
            expect(getProjectStory).not.toHaveBeenCalledWith('story-1');
        });

        it('leaves every row closed when the link names no story', async () => {
            renderCard({ openStoryId: null });

            // A closed row reads its counts from the list it was handed; only
            // opening one costs a request.
            await waitFor(() => expect(screen.getByText('1/4 tasks')).toBeInTheDocument());
            expect(getProjectStory).not.toHaveBeenCalled();
        });

        it('does not fight a reader who collapses the story the link opened', async () => {
            renderCard({ openStoryId: 'story-1' });

            await screen.findByText('Wire the callback');
            fireEvent.click(screen.getByRole('button', { name: /Shopper pays with bKash/ }));

            await waitFor(() =>
                expect(screen.queryByText('Wire the callback')).not.toBeInTheDocument(),
            );
        });
    });
});
