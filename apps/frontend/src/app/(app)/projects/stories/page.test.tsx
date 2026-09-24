import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import ProjectStoriesPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getProjectStories: jest.fn(),
        getProjects: jest.fn(),
        createProjectStory: jest.fn(),
        importProjectStories: jest.fn(),
        getProjectEpics: jest.fn(),
    },
}));

// The global matchMedia mock always reports non-matching, so without this the
// `hideOnMobile` columns this suite asserts on (priority, points, tasks) never render.
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const story = (overrides: Record<string, unknown> = {}) => ({
    id: 'story-1',
    reference: 3,
    code: 'OTB-3',
    title: 'Shopper pays with bKash',
    i_want: 'to pay with bKash',
    status: 'READY',
    priority: 'HIGH',
    story_points: 5,
    project: { id: 'p1', code: 'PRJ-0001', name: 'Till rebuild', short_name: 'Till' },
    progress: { taskCount: 4, doneTaskCount: 1, percentComplete: 25 },
    ...overrides,
});

beforeEach(() => {
    (api.createProjectStory as jest.Mock).mockReset();
    (api.getProjectStories as jest.Mock).mockReset().mockResolvedValue([story()]);
    (api.getProjectEpics as jest.Mock)
        .mockReset()
        .mockResolvedValue([{ id: 'epic-1', code: 'PRJ-0001-E1', title: 'Online payments', color: 'BLUE' }]);
    (api.getProjects as jest.Mock)
        .mockReset()
        .mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'Till rebuild' }] });
});

describe('Cross-project user stories page', () => {
    it('lists a story with its reference, project and task rollup', async () => {
        render(<ProjectStoriesPage />);

        expect(await screen.findByText('Shopper pays with bKash')).toBeInTheDocument();
        expect(screen.getByText('OTB-3')).toBeInTheDocument();
        expect(screen.getByText('PRJ-0001')).toBeInTheDocument();
        expect(screen.getByText('1/4 tasks')).toBeInTheDocument();
        expect(screen.getByText('5 pts')).toBeInTheDocument();
    });

    /**
     * There is no story route: a story is edited beside the rest of its
     * project's backlog, so the title links back to the project page with this
     * story named. Without the query the link would land on a collapsed list of
     * forty and the row that was clicked would be lost.
     */
    it('links a story to the project that owns it, with the story named', async () => {
        render(<ProjectStoriesPage />);

        const link = await screen.findByRole('link', { name: 'Shopper pays with bKash' });
        expect(link).toHaveAttribute('href', '/projects/p1?story=story-1');
    });

    it('keeps the columns and filters on screen when no project has a story yet', async () => {
        (api.getProjectStories as jest.Mock).mockResolvedValue([]);
        render(<ProjectStoriesPage />);

        expect(await screen.findByText(/no user stories yet/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('All projects')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Any status')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Any priority')).toBeInTheDocument();
    });

    it('narrows by search text without re-querying the server', async () => {
        (api.getProjectStories as jest.Mock).mockResolvedValue([
            story(),
            story({ id: 'story-2', reference: 4, code: 'OTB-4', title: 'Owner reads the day book', i_want: null }),
        ]);
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');

        fireEvent.change(screen.getByPlaceholderText(/search a story title/i), {
            target: { value: 'day book' },
        });

        // Awaited, not read synchronously: narrowing hands DataTable a new
        // `data` array and it resets the page index in an effect.
        expect(await screen.findByText('Owner reads the day book')).toBeInTheDocument();
        expect(screen.queryByText('Shopper pays with bKash')).not.toBeInTheDocument();
        expect(api.getProjectStories).toHaveBeenCalledTimes(1);
    });

    it('searches the want as well as the title, the two fields the server searches', async () => {
        (api.getProjectStories as jest.Mock).mockResolvedValue([
            story(),
            story({ id: 'story-2', reference: 4, code: 'OTB-4', title: 'Owner reads the day book', i_want: null }),
        ]);
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');

        // Matches nothing in the title — only the "I want" line.
        fireEvent.change(screen.getByPlaceholderText(/search a story title/i), {
            target: { value: 'pay with' },
        });

        expect(await screen.findByText('Shopper pays with bKash')).toBeInTheDocument();
        expect(screen.queryByText('Owner reads the day book')).not.toBeInTheDocument();
    });

    it('sends the project, status and priority filters to the server', async () => {
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');

        fireEvent.change(screen.getByDisplayValue('Any priority'), { target: { value: 'URGENT' } });

        await waitFor(() =>
            expect(api.getProjectStories).toHaveBeenLastCalledWith({
                projectId: undefined,
                status: undefined,
                priority: 'URGENT',
                epicId: undefined,
                noEpic: undefined,
            }),
        );
    });

    it('shows each story’s epic and filters to one epic, or to stories under none', async () => {
        (api.getProjectStories as jest.Mock).mockResolvedValue([
            story({ epic: { id: 'epic-1', code: 'PRJ-0001-E1', title: 'Online payments', color: 'BLUE' } }),
        ]);
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');
        // The chip in the row, beside the same code in the filter's option.
        expect(screen.getAllByText('PRJ-0001-E1').length).toBeGreaterThan(0);

        fireEvent.change(screen.getByDisplayValue('Any epic'), { target: { value: 'epic-1' } });
        await waitFor(() =>
            expect(api.getProjectStories).toHaveBeenLastCalledWith(
                expect.objectContaining({ epicId: 'epic-1', noEpic: undefined }),
            ),
        );

        fireEvent.change(screen.getByDisplayValue('PRJ-0001-E1 · Online payments'), {
            target: { value: 'none' },
        });
        await waitFor(() =>
            expect(api.getProjectStories).toHaveBeenLastCalledWith(
                expect.objectContaining({ epicId: undefined, noEpic: true }),
            ),
        );
    });

    it('says the filters are what is hiding the rows, not that there are none', async () => {
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');

        (api.getProjectStories as jest.Mock).mockResolvedValue([]);
        fireEvent.change(screen.getByDisplayValue('Any status'), { target: { value: 'DONE' } });

        expect(await screen.findByText(/no stories match these filters/i)).toBeInTheDocument();
    });

    describe('writing and importing from here', () => {
        it('asks for a project, then creates the story with the ID typed', async () => {
            (api.createProjectStory as jest.Mock).mockResolvedValue(story());
            render(<ProjectStoriesPage />);
            await screen.findByText('Shopper pays with bKash');

            fireEvent.click(screen.getByRole('button', { name: /New user story/ }));
            fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Refunds' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));

            // No project picked yet: refused inline, nothing sent.
            expect(await screen.findByText('Pick a project.')).toBeInTheDocument();
            expect(api.createProjectStory).not.toHaveBeenCalled();

            fireEvent.change(screen.getByLabelText(/Project/, { selector: 'select#story-project' }), {
                target: { value: 'p1' },
            });
            fireEvent.change(screen.getByLabelText(/Story ID/), { target: { value: 'LEGACY-9' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));

            await waitFor(() =>
                expect(api.createProjectStory).toHaveBeenCalledWith(
                    expect.objectContaining({ projectId: 'p1', code: 'LEGACY-9', title: 'Refunds' }),
                ),
            );
        });

        it('leaves the ID out when it is blank, so the server numbers it after the project code', async () => {
            (api.createProjectStory as jest.Mock).mockResolvedValue(story());
            render(<ProjectStoriesPage />);
            await screen.findByText('Shopper pays with bKash');

            fireEvent.click(screen.getByRole('button', { name: /New user story/ }));
            fireEvent.change(screen.getByLabelText(/Project/, { selector: 'select#story-project' }), {
                target: { value: 'p1' },
            });
            expect(screen.getByPlaceholderText('PRJ-0001-…')).toBeInTheDocument();
            fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Refunds' } });
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));

            await waitFor(() => expect(api.createProjectStory).toHaveBeenCalled());
            expect((api.createProjectStory as jest.Mock).mock.calls[0][0]).not.toHaveProperty('code');
        });

        it('opens the import dialog', async () => {
            render(<ProjectStoriesPage />);
            await screen.findByText('Shopper pays with bKash');

            fireEvent.click(screen.getByRole('button', { name: /Import/ }));

            expect(await screen.findByText('Drag & drop or click to browse')).toBeInTheDocument();
        });
    });
});
