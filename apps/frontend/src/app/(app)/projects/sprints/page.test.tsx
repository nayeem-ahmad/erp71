import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import SprintsPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getSprints: jest.fn(),
        getProjects: jest.fn(),
        createSprint: jest.fn(),
        startSprint: jest.fn(),
        completeSprint: jest.fn(),
        deleteSprint: jest.fn(),
    },
}));

// The global matchMedia mock always reports non-matching, so without this the
// `hideOnMobile` columns this suite asserts on (dates, projects, tasks) never render.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const sprint = (overrides: Record<string, unknown> = {}) => ({
    id: 's1',
    name: 'Sprint 12',
    goal: 'Finish the fit-out',
    status: 'PLANNED',
    start_date: '2026-08-01T00:00:00.000Z',
    end_date: '2026-08-14T00:00:00.000Z',
    estimated_hours: 40,
    remaining_hours: 24,
    projects: [{ id: 'p1', code: 'PRJ-0001', name: 'P1' }],
    _count: { tasks: 6 },
    ...overrides,
});

beforeEach(() => {
    (api.getSprints as jest.Mock).mockReset().mockResolvedValue([sprint()]);
    (api.getProjects as jest.Mock)
        .mockReset()
        .mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'P1' }] });
});

describe('Sprints page', () => {
    it('lists each sprint with the projects its tasks came from', async () => {
        render(<SprintsPage />);

        expect(await screen.findByText('Sprint 12')).toBeInTheDocument();
        expect(screen.getByText('PRJ-0001')).toBeInTheDocument();
        expect(screen.getByText('24h')).toBeInTheDocument();
    });

    it('keeps the search box and filters on screen when there are no sprints', async () => {
        // An empty workspace used to get one line of grey text and nothing else —
        // no columns, no filters, nothing saying what this page is for.
        (api.getSprints as jest.Mock).mockResolvedValue([]);
        render(<SprintsPage />);

        expect(await screen.findByText(/no sprints yet/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/search sprint name or goal/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('Any status')).toBeInTheDocument();
        expect(screen.getByDisplayValue('All projects')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /new sprint/i })).toBeInTheDocument();
    });

    it('narrows the list by search text without re-querying the server', async () => {
        (api.getSprints as jest.Mock).mockResolvedValue([
            sprint(),
            sprint({ id: 's2', name: 'Hardening', goal: null }),
        ]);
        render(<SprintsPage />);
        await screen.findByText('Sprint 12');

        fireEvent.change(screen.getByPlaceholderText(/search sprint name or goal/i), {
            target: { value: 'harden' },
        });

        expect(screen.getByText('Hardening')).toBeInTheDocument();
        expect(screen.queryByText('Sprint 12')).not.toBeInTheDocument();
        expect(api.getSprints).toHaveBeenCalledTimes(1);
    });

    it('filters by status against the list already fetched', async () => {
        (api.getSprints as jest.Mock).mockResolvedValue([
            sprint(),
            sprint({ id: 's2', name: 'Hardening', status: 'ACTIVE' }),
        ]);
        render(<SprintsPage />);
        await screen.findByText('Sprint 12');

        fireEvent.change(screen.getByDisplayValue('Any status'), { target: { value: 'ACTIVE' } });

        expect(screen.getByText('Hardening')).toBeInTheDocument();
        expect(screen.queryByText('Sprint 12')).not.toBeInTheDocument();
    });

    it('sends the project filter to the server, which is what scopes by participation', async () => {
        render(<SprintsPage />);
        await screen.findByText('Sprint 12');

        fireEvent.change(screen.getByDisplayValue('All projects'), { target: { value: 'p1' } });

        await waitFor(() => expect(api.getSprints).toHaveBeenCalledWith('p1'));
    });

    it('creates a sprint from the modal and reloads the list', async () => {
        (api.createSprint as jest.Mock).mockResolvedValue({ id: 's2' });
        render(<SprintsPage />);
        await screen.findByText('Sprint 12');

        fireEvent.click(screen.getByRole('button', { name: /new sprint/i }));
        fireEvent.change(screen.getByLabelText(/sprint name/i), { target: { value: 'Sprint 13' } });
        fireEvent.change(screen.getByLabelText(/^starts/i), { target: { value: '2026-09-01' } });
        fireEvent.change(screen.getByLabelText(/^ends/i), { target: { value: '2026-09-14' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        await waitFor(() =>
            expect(api.createSprint).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Sprint 13',
                    startDate: '2026-09-01',
                    endDate: '2026-09-14',
                }),
            ),
        );
        expect(api.getSprints).toHaveBeenCalledTimes(2);
    });
});
