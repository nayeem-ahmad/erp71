import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. See ShortLinkManager.test.tsx.
import ProjectsPage from './page';
import { api } from '@/lib/api';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: { getProjects: jest.fn(), getProjectTypes: jest.fn(), deleteProject: jest.fn() },
}));

// Desktop: Sales-style filter chips sit inline rather than in the phone sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const project = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1',
    code: 'PRJ-0001',
    name: 'Shop fit-out',
    status: 'ACTIVE',
    priority: 'MEDIUM',
    visibility: 'PUBLIC',
    _count: { tasks: 4 },
    ...overrides,
});

const lastCall = () => (api.getProjects as jest.Mock).mock.calls.at(-1)![0];

beforeEach(() => {
    (api.getProjects as jest.Mock).mockReset().mockResolvedValue({
        items: [project()], total: 1, page: 1, limit: 25, pages: 1,
    });
    (api.getProjectTypes as jest.Mock).mockReset().mockResolvedValue([
        { id: 'ty1', name: 'Fit-out' },
    ]);
});

describe('Projects page — Sales list UI', () => {
    it('puts filters in the toolbar row with a summary strip', async () => {
        render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        expect(screen.getByRole('region', { name: 'Projects summary' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'View options' })).toBeInTheDocument();
        expect(screen.getByLabelText('Status')).toBeInTheDocument();
        expect(screen.getByLabelText('Type')).toBeInTheDocument();
        expect(screen.getByLabelText('Visibility')).toBeInTheDocument();
    });

    it('filters on the server, from page 1, rather than within the rows on screen', async () => {
        render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        fireEvent.change(screen.getByPlaceholderText(/search code, name or customer/i), {
            target: { value: 'shop' },
        });

        await waitFor(() => expect(lastCall()).toEqual(expect.objectContaining({ page: 1, search: 'shop' })));
    });

    it('comes back to the status the last visit left set', async () => {
        const first = render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ON_HOLD' } });
        await waitFor(() => expect(lastCall().status).toBe('ON_HOLD'));
        first.unmount();

        (api.getProjects as jest.Mock).mockClear();
        render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('ON_HOLD');
        // Never the unfiltered list on the way — no flash of everything.
        for (const call of (api.getProjects as jest.Mock).mock.calls) {
            expect(call[0].status).toBe('ON_HOLD');
        }
    });

    it('remembers the type and visibility filters too', async () => {
        const first = render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'ty1' } });
        fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'PRIVATE' } });
        await waitFor(() => expect(lastCall().visibility).toBe('PRIVATE'));
        first.unmount();

        (api.getProjects as jest.Mock).mockClear();
        render(<ProjectsPage />);

        await waitFor(() => expect(lastCall()).toMatchObject({
            projectTypeId: 'ty1',
            visibility: 'PRIVATE',
        }));
    });

    /**
     * The search box debounces, so a restored term has to bypass the debounce:
     * applying it 300ms late would send one request for the whole list first.
     */
    it('restores a search term with the first request, not 300ms after it', async () => {
        const first = render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        fireEvent.change(screen.getByPlaceholderText(/search code, name or customer/i), {
            target: { value: 'fit-out' },
        });
        await waitFor(() => expect(lastCall().search).toBe('fit-out'));
        first.unmount();

        (api.getProjects as jest.Mock).mockClear();
        render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        for (const call of (api.getProjects as jest.Mock).mock.calls) {
            expect(call[0].search).toBe('fit-out');
        }
    });

    it('opens on the whole list when nothing has been remembered yet', async () => {
        render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        expect(lastCall()).toMatchObject({
            search: undefined,
            status: undefined,
            projectTypeId: undefined,
        });
        const strip = screen.getByRole('region', { name: 'Projects summary' });
        expect(within(strip).getByText('Projects').parentElement).toHaveTextContent('1');
    });
});
