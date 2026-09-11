import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

describe('Projects page — remembered filters', () => {
    it('comes back to the status the last visit left set', async () => {
        const first = render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        fireEvent.change(screen.getByDisplayValue('Status'), { target: { value: 'ON_HOLD' } });
        await waitFor(() => expect(lastCall().status).toBe('ON_HOLD'));
        first.unmount();

        (api.getProjects as jest.Mock).mockClear();
        render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        expect((screen.getByDisplayValue('On hold') as HTMLSelectElement).value).toBe('ON_HOLD');
        // Never the unfiltered list on the way — no flash of everything.
        for (const call of (api.getProjects as jest.Mock).mock.calls) {
            expect(call[0].status).toBe('ON_HOLD');
        }
    });

    it('remembers the type and visibility filters too', async () => {
        const first = render(<ProjectsPage />);
        await screen.findByText('Shop fit-out');

        fireEvent.change(screen.getByDisplayValue('Type'), { target: { value: 'ty1' } });
        fireEvent.change(screen.getByDisplayValue('Visibility'), { target: { value: 'PRIVATE' } });
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
            visibility: undefined,
        });
    });
});
