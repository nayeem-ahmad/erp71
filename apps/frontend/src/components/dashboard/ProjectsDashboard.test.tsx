import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ProjectsDashboard from './ProjectsDashboard';
import { api } from '@/lib/api';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('@/lib/localization/messages/en');
    const actual = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({ t: enMessages, locale: 'en' }),
        formatMessage: actual.formatMessage,
    };
});

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn(),
        getProjectTasks: jest.fn(),
        getProjectTimeReport: jest.fn(),
        getProjects: jest.fn(),
        getProjectTimer: jest.fn(),
    },
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const identity = { greeting: 'Good morning, Nayeem 👋', tenantName: 'Acme', renewalEnd: null };

beforeEach(() => {
    jest.clearAllMocks();
    (api.getMe as jest.Mock).mockResolvedValue({ id: 'user-1', name: 'Nayeem' });
    (api.getProjectTasks as jest.Mock).mockResolvedValue({
        data: [
            { id: 'task-1', title: 'Wire the invoice printer', project: { id: 'p1', name: 'Till rollout' } },
            { id: 'task-2', title: 'Fix the chalan layout', project: { id: 'p1', name: 'Till rollout' } },
        ],
        total: 2,
    });
    (api.getProjectTimeReport as jest.Mock).mockResolvedValue({ summary: { hours: 6.5 }, rows: [] });
    (api.getProjects as jest.Mock).mockResolvedValue({ data: [{ id: 'p1', name: 'Till rollout' }], total: 1 });
    (api.getProjectTimer as jest.Mock).mockResolvedValue(null);
});

it('shows the four tiles built from the member\'s own rows', async () => {
    render(<ProjectsDashboard {...identity} />);

    expect(await screen.findByText('My Open Tasks')).toBeInTheDocument();
    expect(screen.getByText('Hours Today')).toBeInTheDocument();
    expect(screen.getByText('Hours This Week')).toBeInTheDocument();
    expect(screen.getByText('Active Projects')).toBeInTheDocument();
});

it('asks only for its own hours, whatever the record scope says', async () => {
    // A wide Project User would otherwise see the team's hours under a tile
    // labelled "my hours". The label has to be true at either scope.
    render(<ProjectsDashboard {...identity} />);

    await waitFor(() => expect(api.getProjectTimeReport).toHaveBeenCalled());
    for (const call of (api.getProjectTimeReport as jest.Mock).mock.calls) {
        expect(call[0].userId).toBe('user-1');
    }
});

it('lists the member\'s open tasks', async () => {
    render(<ProjectsDashboard {...identity} />);

    expect(await screen.findByText('Wire the invoice printer')).toBeInTheDocument();
    expect(screen.getByText('Fix the chalan layout')).toBeInTheDocument();
});

it('renders an empty workload without crashing', async () => {
    (api.getProjectTasks as jest.Mock).mockResolvedValue({ data: [], total: 0 });
    (api.getProjects as jest.Mock).mockResolvedValue({ data: [], total: 0 });
    (api.getProjectTimeReport as jest.Mock).mockResolvedValue({ summary: { hours: 0 }, rows: [] });

    render(<ProjectsDashboard {...identity} />);

    expect(await screen.findByText('Nothing assigned yet')).toBeInTheDocument();
});

it('survives an endpoint failing', async () => {
    (api.getProjectTimer as jest.Mock).mockRejectedValue(new Error('boom'));

    render(<ProjectsDashboard {...identity} />);

    expect(await screen.findByText('My Open Tasks')).toBeInTheDocument();
});
