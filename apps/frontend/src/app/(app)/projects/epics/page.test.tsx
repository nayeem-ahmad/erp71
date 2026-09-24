import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectEpicsPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getProjectEpics: jest.fn(),
        getProjects: jest.fn(),
        createProjectEpic: jest.fn(),
        importProjectEpics: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// Without this the `hideOnMobile` columns (stories, progress) never render.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const epic = (overrides: Record<string, unknown> = {}) => ({
    id: 'epic-1',
    reference: 1,
    code: 'PRJ-0001-E1',
    title: 'Online payments',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    color: 'PURPLE',
    target_date: '2026-12-31T00:00:00.000Z',
    project: { id: 'p1', code: 'PRJ-0001', name: 'Till rebuild', short_name: 'Till' },
    progress: {
        storyCount: 4,
        doneStoryCount: 1,
        storyPoints: 13,
        doneStoryPoints: 3,
        taskCount: 9,
        doneTaskCount: 4,
        percentComplete: 25,
    },
    ...overrides,
});

beforeEach(() => {
    (api.createProjectEpic as jest.Mock).mockReset();
    (api.getProjectEpics as jest.Mock).mockReset().mockResolvedValue([epic()]);
    (api.getProjects as jest.Mock)
        .mockReset()
        .mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'Till rebuild' }] });
});

describe('Cross-project epics page', () => {
    it('lists an epic with its project and story rollup', async () => {
        render(<ProjectEpicsPage />);

        expect(await screen.findByText('Online payments')).toBeInTheDocument();
        expect(screen.getByText('PRJ-0001-E1')).toBeInTheDocument();
        expect(screen.getByText('PRJ-0001')).toBeInTheDocument();
        expect(screen.getByText('1/4 stories')).toBeInTheDocument();
        expect(screen.getByText(/3\/13 pts/)).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        expect(screen.getByText('2026-12-31')).toBeInTheDocument();
    });

    it('links an epic to the project that owns it, with the epic named', async () => {
        render(<ProjectEpicsPage />);

        const link = await screen.findByRole('link', { name: 'Online payments' });
        expect(link).toHaveAttribute('href', '/projects/p1?epic=epic-1');
    });

    it('sends the status filter to the server', async () => {
        render(<ProjectEpicsPage />);
        await screen.findByText('Online payments');

        (api.getProjectEpics as jest.Mock).mockResolvedValue([]);
        fireEvent.change(screen.getByDisplayValue('Any status'), { target: { value: 'CANCELLED' } });

        await waitFor(() =>
            expect(api.getProjectEpics).toHaveBeenLastCalledWith({
                projectId: undefined,
                status: 'CANCELLED',
                priority: undefined,
            }),
        );
        expect(await screen.findByText(/no epics match these filters/i)).toBeInTheDocument();
    });

    it('asks for a project, then creates the epic', async () => {
        (api.createProjectEpic as jest.Mock).mockResolvedValue(epic());
        render(<ProjectEpicsPage />);
        await screen.findByText('Online payments');

        fireEvent.click(screen.getByRole('button', { name: /New epic/ }));
        fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Reporting' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Pick a project.')).toBeInTheDocument();
        expect(api.createProjectEpic).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText(/Project/, { selector: 'select#epic-project' }), {
            target: { value: 'p1' },
        });
        expect(screen.getByPlaceholderText('PRJ-0001-E…')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createProjectEpic).toHaveBeenCalled());
        const sent = (api.createProjectEpic as jest.Mock).mock.calls[0][0];
        expect(sent).toMatchObject({ projectId: 'p1', title: 'Reporting', status: 'OPEN', color: 'BLUE' });
        // Blank ID: the server numbers it after the project code.
        expect(sent).not.toHaveProperty('code');
    });
});
