import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectEpicsPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getAllProjectsBacklog: jest.fn(),
        getProjects: jest.fn(),
        createProjectEpic: jest.fn(),
        importProjectEpics: jest.fn(),
        reorderBacklogScope: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/components/projects/TaskDetailPanel', () => {
    const Panel = () => null;
    Panel.displayName = 'TaskDetailPanel';
    return Panel;
});

const backlog = () => ({
    projects: [{ id: 'p1', code: 'PRJ-0001', name: 'Till rebuild' }],
    epics: [
        { id: 'e1', project_id: 'p1', code: 'PRJ-0001-E1', title: 'Online payments', status: 'IN_PROGRESS', priority: 'HIGH', color: 'PURPLE', sort_order: 0 },
        { id: 'e2', project_id: 'p1', code: 'PRJ-0001-E2', title: 'Reporting', status: 'OPEN', priority: 'LOW', color: 'BLUE', sort_order: 1 },
    ],
    stories: [
        { id: 's1', project_id: 'p1', code: 'PRJ-0001-1', title: 'Pay with bKash', status: 'DONE', priority: 'HIGH', story_points: 3, epic_id: 'e1', sort_order: 0 },
        { id: 's2', project_id: 'p1', code: 'PRJ-0001-2', title: 'Pay with Nagad', status: 'BACKLOG', priority: 'HIGH', story_points: 5, epic_id: 'e1', sort_order: 1 },
    ],
    tasks: [],
});

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (api.getAllProjectsBacklog as jest.Mock).mockResolvedValue(backlog());
    (api.getProjects as jest.Mock).mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'Till rebuild' }] });
    (api.reorderBacklogScope as jest.Mock).mockResolvedValue({ success: true });
});

const rowOf = (text: string) => screen.getByText(text).closest('[role="treeitem"]') as HTMLElement;

describe('ProjectEpicsPage', () => {
    it('folds the tree to the epics, each with its story rollup', async () => {
        render(<ProjectEpicsPage />);
        expect(await screen.findByText('Online payments')).toBeInTheDocument();
        expect(screen.queryByText('Pay with bKash')).not.toBeInTheDocument();
        const row = rowOf('Online payments');
        expect(within(row).getByText('1/2 stories')).toBeInTheDocument();
        expect(within(row).getByText('3/8 pts')).toBeInTheDocument();
    });

    it('reorders epics from the keyboard', async () => {
        render(<ProjectEpicsPage />);
        await screen.findByText('Online payments');
        fireEvent.keyDown(rowOf('Online payments'), { key: 'ArrowDown', altKey: true });
        await waitFor(() =>
            expect(api.reorderBacklogScope).toHaveBeenCalledWith('p1', {
                kind: 'epic',
                id: 'e1',
                orderedIds: ['e2', 'e1'],
            }),
        );
    });

    it('asks for a project, then creates the epic', async () => {
        (api.createProjectEpic as jest.Mock).mockResolvedValue({ id: 'e9' });
        render(<ProjectEpicsPage />);
        await screen.findByText('Online payments');

        fireEvent.click(screen.getByRole('button', { name: /New epic/ }));
        const dialog = screen.getByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: 'Stock alerts' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Pick a project.')).toBeInTheDocument();

        fireEvent.change(within(dialog).getByLabelText(/Project/, { selector: 'select#epic-project' }), {
            target: { value: 'p1' },
        });
        expect(within(dialog).getByPlaceholderText('PRJ-0001-E…')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createProjectEpic).toHaveBeenCalled());
        const sent = (api.createProjectEpic as jest.Mock).mock.calls[0][0];
        expect(sent).toMatchObject({ projectId: 'p1', title: 'Stock alerts', status: 'OPEN', color: 'BLUE' });
        expect(sent).not.toHaveProperty('code');
    });

    it('opens the import dialog', async () => {
        render(<ProjectEpicsPage />);
        await screen.findByText('Online payments');
        fireEvent.click(screen.getByRole('button', { name: /Import/ }));
        expect(await screen.findByText('Drag & drop or click to browse')).toBeInTheDocument();
    });
});
