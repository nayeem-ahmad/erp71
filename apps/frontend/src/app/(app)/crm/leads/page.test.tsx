'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadsPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

/** Reassigned per test to deep-link the page at a filtered slice. */
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/crm/leads',
    useSearchParams: () => searchParams,
    useParams: () => ({}),
}));

// DataTable drops `hideOnMobile` columns when this reports a narrow viewport,
// and the global matchMedia mock always reports non-matching.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    // The page narrows on `instanceof ApiError`, so the mock has to export a real
    // class rather than a jest.fn() — a plain Error would take the empty-list path.
    ApiError: class ApiError extends Error {
        constructor(message: string, public readonly status: number, public readonly code?: string) {
            super(message);
            this.name = 'ApiError';
        }
    },
    api: {
        getLeads: jest.fn(),
        getCustomFields: jest.fn().mockResolvedValue([]),
        getTeamMembers: jest.fn().mockResolvedValue([]),
        getLeadTaxonomy: jest.fn().mockResolvedValue([]),
        deleteLead: jest.fn(),
        bulkLeadAction: jest.fn(),
        importLeads: jest.fn(),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const baseLead = {
    mobile: '01700000000',
    email: null,
    category: null,
    categoryOption: null,
    source: 'WALK_IN',
    sourceOption: { id: 'src-1', name: 'Walk-in' },
    priority: 'MEDIUM',
    status: 'NEW',
    score: 20,
    photo_url: null,
    next_step: null,
    next_step_date: null,
    last_contacted_at: null,
    nextStepAssignee: null,
    custom_fields: null,
    created_at: '2026-08-01T08:00:00.000Z',
};

const leads = [
    { ...baseLead, id: 'lead-1', name: 'Karim Traders', email: 'karim@example.com', assigned_to: 'user-2', assignee: { id: 'user-2', name: 'Rifat' } },
    { ...baseLead, id: 'lead-2', name: 'Rahim Stores', assigned_to: null, assignee: null },
];

/** The owner filter sits among several unlabelled filter selects. */
function selectByOption(optionText: string): HTMLSelectElement {
    const option = screen.getByRole('option', { name: optionText });
    return option.closest('select') as HTMLSelectElement;
}

describe('LeadsPage — lead owner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getTeamMembers.mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]);
    });

    it('shows a Lead Owner column naming the owner, and a dash when nobody owns it', async () => {
        render(<LeadsPage />);

        expect(await screen.findByText('Karim Traders')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /lead owner/i })).toBeInTheDocument();
        // A cell, not the filter's option of the same name.
        expect(screen.getByRole('cell', { name: 'Rifat' })).toBeInTheDocument();

        const owned = screen.getByRole('cell', { name: 'Karim Traders' }).closest('tr')!;
        const unowned = screen.getByRole('cell', { name: 'Rahim Stores' }).closest('tr')!;
        const ownerColumn = screen.getAllByRole('columnheader').findIndex((h) => /lead owner/i.test(h.textContent ?? ''));
        expect(owned.querySelectorAll('td')[ownerColumn]).toHaveTextContent('Rifat');
        expect(unowned.querySelectorAll('td')[ownerColumn]).toHaveTextContent('—');
    });

    it('filters the list to one owner', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All owners'), { target: { value: 'user-2' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'user-2' })),
        );
    });

    it('filters the list to leads nobody owns', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All owners'), { target: { value: 'unassigned' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'unassigned' })),
        );
    });
});
describe('LeadsPage — email', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getTeamMembers.mockResolvedValue([]);
    });

    it('shows an Email column with the address, and a dash where there is none', async () => {
        render(<LeadsPage />);

        expect(await screen.findByText('Karim Traders')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /email/i })).toBeInTheDocument();

        const emailColumn = screen
            .getAllByRole('columnheader')
            .findIndex((h) => /email/i.test(h.textContent ?? ''));
        const withEmail = screen.getByRole('cell', { name: 'Karim Traders' }).closest('tr')!;
        const without = screen.getByRole('cell', { name: 'Rahim Stores' }).closest('tr')!;
        expect(withEmail.querySelectorAll('td')[emailColumn]).toHaveTextContent('karim@example.com');
        expect(without.querySelectorAll('td')[emailColumn]).toHaveTextContent('—');
    });

    it('filters the list to leads with no email', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All emails'), { target: { value: 'empty' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ emailPresence: 'empty' })),
        );
    });

    it('filters the list to leads that have one', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All emails'), { target: { value: 'has' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ emailPresence: 'has' })),
        );
    });

    it('sends no email filter while the control sits at its default', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        expect(api.getLeads).toHaveBeenCalledWith(
            expect.objectContaining({ emailPresence: undefined }),
        );
    });
});

/**
 * The CRM dashboard's attention tiles link here rather than at the bare list —
 * a tile that counts 5 and opens a list of 300 is worse than no link at all. The
 * hrefs those tiles build are asserted in CrmDashboard.test.tsx; these are the
 * receiving half.
 */
describe('LeadsPage — filters arriving in the URL', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getTeamMembers.mockResolvedValue([{ userId: 'user-1', name: 'Nayeem' }]);
    });

    it('opens showing only unowned leads still in the open pipeline', async () => {
        searchParams = new URLSearchParams('status=open&assignedTo=unassigned');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'open', assignedTo: 'unassigned' }),
            ),
        );
        // Both filters are visible in their controls, so the list says why it is
        // short and either can be widened without editing the address bar.
        expect(selectByOption('All owners').value).toBe('unassigned');
        expect(selectByOption('All statuses').value).toBe('open');
    });

    it('opens showing only leads with no activity for the linked window', async () => {
        searchParams = new URLSearchParams('status=open&staleDays=14');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'open', staleDays: 14 }),
            ),
        );
        expect(screen.getByRole('button', { name: /no activity in 14 days/i })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('labels the toggle with the window it queries, not a hardcoded one', async () => {
        searchParams = new URLSearchParams('staleDays=30');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ staleDays: 30 })),
        );
        expect(screen.getByRole('button', { name: /no activity in 30 days/i })).toBeInTheDocument();
    });

    it('drops the stale filter when the toggle is switched off', async () => {
        searchParams = new URLSearchParams('staleDays=14');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.click(screen.getByRole('button', { name: /no activity in 14 days/i }));

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenLastCalledWith(
                expect.objectContaining({ staleDays: undefined }),
            ),
        );
    });

    // The pipeline funnel has linked at ?status=NEW since the CRM dashboard
    // landed, and the page ignored it — those five stage links navigated here and
    // showed everything.
    it('primes the status select from a funnel stage link', async () => {
        searchParams = new URLSearchParams('status=QUALIFIED');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ status: 'QUALIFIED' })),
        );
        expect(selectByOption('All statuses').value).toBe('QUALIFIED');
    });

    it('ignores params the API would reject rather than opening an empty list', async () => {
        searchParams = new URLSearchParams('status=BOGUS&staleDays=99999');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ status: undefined, staleDays: undefined }),
            ),
        );
        expect(selectByOption('All statuses').value).toBe('');
    });

    it('opens showing only the leads with no email address', async () => {
        searchParams = new URLSearchParams('emailPresence=empty');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ emailPresence: 'empty' }),
            ),
        );
        // Visible in its control, like the filters above — the list says why it
        // is short and can be widened without editing the address bar.
        expect(selectByOption('All emails').value).toBe('empty');
    });

    it('ignores an email presence value the API would reject', async () => {
        searchParams = new URLSearchParams('emailPresence=maybe');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ emailPresence: undefined }),
            ),
        );
        expect(selectByOption('All emails').value).toBe('');
    });

    it('leaves every filter open when no params are given', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ status: undefined, assignedTo: undefined, staleDays: undefined }),
            ),
        );
    });
});

describe('LeadsPage — address, remarks and web links', () => {
    const detailed = [
        {
            ...baseLead,
            id: 'lead-3',
            name: 'Karim Traders',
            address: '14/B Gulshan Avenue, Dhaka',
            remarks: 'Asked for a quote on 50 units',
            linkedin_url: 'https://www.linkedin.com/in/karim/',
            fb_url: null,
            x_url: null,
            // Stored as free text, so it can arrive without a scheme.
            website_url: 'karimtraders.com.bd',
            assignee: null,
        },
        { ...baseLead, id: 'lead-4', name: 'Rahim Stores', assignee: null },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        api.getLeads.mockResolvedValue({ items: detailed, total: 2 });
        api.getTeamMembers.mockResolvedValue([]);
    });

    /** The cell under a header, on the row whose Name cell reads `leadName`. */
    function cellUnder(header: RegExp, leadName: string): HTMLElement {
        const index = screen
            .getAllByRole('columnheader')
            .findIndex((h) => header.test(h.textContent ?? ''));
        const row = screen.getByRole('cell', { name: leadName }).closest('tr')!;
        return row.querySelectorAll('td')[index] as HTMLElement;
    }

    it('shows the address and remarks, and a dash where there are none', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        expect(cellUnder(/^address$/i, 'Karim Traders')).toHaveTextContent('14/B Gulshan Avenue, Dhaka');
        expect(cellUnder(/^remarks$/i, 'Karim Traders')).toHaveTextContent('Asked for a quote on 50 units');
        expect(cellUnder(/^address$/i, 'Rahim Stores')).toHaveTextContent('—');
        expect(cellUnder(/^remarks$/i, 'Rahim Stores')).toHaveTextContent('—');
    });

    it('links each web column out, and dashes the ones the lead has not got', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        const linkedin = cellUnder(/^linkedin$/i, 'Karim Traders').querySelector('a')!;
        expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/karim/');
        expect(linkedin).toHaveAttribute('rel', 'noopener noreferrer');
        // The scheme and the `www.` are dropped from the label, not the href.
        expect(linkedin).toHaveTextContent('linkedin.com/in/karim');

        expect(cellUnder(/^facebook$/i, 'Karim Traders')).toHaveTextContent('—');
        expect(cellUnder(/x \(twitter\)/i, 'Karim Traders')).toHaveTextContent('—');
    });

    it('sends a scheme-less website out to the web, not to a route inside the app', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        const website = cellUnder(/^website$/i, 'Karim Traders').querySelector('a')!;
        expect(website).toHaveAttribute('href', 'https://karimtraders.com.bd');
        expect(website).toHaveTextContent('karimtraders.com.bd');
    });
});


/**
 * A filtered list is a slice somebody is working through, and opening a lead
 * from it is part of that work — not the end of it. Coming back to the whole
 * list, and re-picking every filter, is the tax this removes.
 */
describe('LeadsPage — remembered filters', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getTeamMembers.mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]);
    });

    it('comes back to the filters the last visit left set', async () => {
        const first = render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All owners'), { target: { value: 'user-2' } });
        fireEvent.change(selectByOption('All priorities'), { target: { value: 'HIGH' } });
        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ assignedTo: 'user-2', priority: 'HIGH' }),
            ),
        );
        first.unmount();

        jest.clearAllMocks();
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        expect(selectByOption('All owners').value).toBe('user-2');
        expect(selectByOption('All priorities').value).toBe('HIGH');
        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ assignedTo: 'user-2', priority: 'HIGH' }),
            ),
        );
    });

    it('never fetches the unfiltered list on the way to the remembered one', async () => {
        const first = render(<LeadsPage />);
        await screen.findByText('Karim Traders');
        fireEvent.change(selectByOption('All owners'), { target: { value: 'user-2' } });
        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'user-2' })),
        );
        first.unmount();

        jest.clearAllMocks();
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        // Every request carries the remembered owner — no flash of all leads.
        for (const call of api.getLeads.mock.calls) {
            expect(call[0]).toEqual(expect.objectContaining({ assignedTo: 'user-2' }));
        }
    });

    it('lets a dashboard link win over a remembered filter, so its count still means something', async () => {
        const first = render(<LeadsPage />);
        await screen.findByText('Karim Traders');
        fireEvent.change(selectByOption('All owners'), { target: { value: 'user-2' } });
        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'user-2' })),
        );
        first.unmount();

        jest.clearAllMocks();
        // The "leads nobody owns" tile links here naming its own owner filter.
        searchParams = new URLSearchParams('assignedTo=unassigned');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        expect(selectByOption('All owners').value).toBe('unassigned');
        for (const call of api.getLeads.mock.calls) {
            expect(call[0]).toEqual(expect.objectContaining({ assignedTo: 'unassigned' }));
        }
    });

    it('still remembers the filters a link did not name', async () => {
        const first = render(<LeadsPage />);
        await screen.findByText('Karim Traders');
        fireEvent.change(selectByOption('All priorities'), { target: { value: 'HIGH' } });
        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ priority: 'HIGH' })),
        );
        first.unmount();

        jest.clearAllMocks();
        searchParams = new URLSearchParams('assignedTo=unassigned');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(
                expect.objectContaining({ assignedTo: 'unassigned', priority: 'HIGH' }),
            ),
        );
    });

    it('applies a remembered search at once rather than after the typing debounce', async () => {
        const first = render(<LeadsPage />);
        await screen.findByText('Karim Traders');
        fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: 'karim' } });
        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ search: 'karim' })),
        );
        first.unmount();

        jest.clearAllMocks();
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        expect(screen.getByPlaceholderText(/search by name/i)).toHaveValue('karim');
        for (const call of api.getLeads.mock.calls) {
            expect(call[0]).toEqual(expect.objectContaining({ search: 'karim' }));
        }
    });
});


/**
 * The CRM-wide "only mine" scope. Unlike the filters above it lives in
 * localStorage and is shared with the Overview and the other CRM lists, so it is
 * cleared between tests here rather than left to leak.
 */
describe('LeadsPage — only mine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        searchParams = new URLSearchParams();
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getTeamMembers.mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]);
    });

    const toggle = () => screen.getByRole('button', { name: 'Only mine' });
    const lastCall = () => api.getLeads.mock.calls.at(-1)[0];

    it('shows the whole team until somebody asks for their own', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        expect(lastCall().mine).toBeUndefined();
        expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('narrows the list to the caller, letting the server resolve the id', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.click(toggle());

        await waitFor(() => expect(lastCall().mine).toBe(true));
        // No user id is looked up or sent — that is the server's job.
        expect(lastCall().assignedTo).toBeUndefined();
    });

    it('locks the owner filter while the scope is on, rather than lying about it', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.click(toggle());

        await waitFor(() => expect(selectByOption('Only mine')).toBeDisabled());
    });

    it('releases the owner filter again when the scope is switched off', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.click(toggle());
        await waitFor(() => expect(lastCall().mine).toBe(true));
        fireEvent.click(toggle());

        await waitFor(() => expect(lastCall().mine).toBeUndefined());
        expect(selectByOption('All owners')).not.toBeDisabled();
    });

    it('keeps the other filters, so the scope narrows the slice rather than replacing it', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All priorities'), { target: { value: 'HIGH' } });
        await waitFor(() => expect(lastCall().priority).toBe('HIGH'));
        fireEvent.click(toggle());

        await waitFor(() => expect(lastCall()).toEqual(
            expect.objectContaining({ mine: true, priority: 'HIGH' }),
        ));
    });

    it('remembers the choice for the next visit', async () => {
        const first = render(<LeadsPage />);
        await screen.findByText('Karim Traders');
        fireEvent.click(toggle());
        await waitFor(() => expect(lastCall().mine).toBe(true));
        first.unmount();

        jest.clearAllMocks();
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getTeamMembers.mockResolvedValue([]);

        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        expect(toggle()).toHaveAttribute('aria-pressed', 'true');
        // And never a first request for everybody's rows before the remembered
        // scope lands — that flash is what `scopeReady` exists to prevent.
        for (const call of api.getLeads.mock.calls) {
            expect(call[0].mine).toBe(true);
        }
    });
});

describe('LeadsPage — a denied list is not an empty one', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ApiError } = require('@/lib/api');

    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
    });

    it('explains a 403 rather than showing "No leads yet"', async () => {
        api.getLeads.mockRejectedValue(new ApiError('Forbidden', 403));

        render(<LeadsPage />);

        // Shown in the banner and reused as the table's empty text, so that the
        // two can never contradict each other.
        expect((await screen.findAllByText(/plan does not include the CRM module/i)).length).toBeGreaterThan(0);
        // The whole point: the tenant must not be told their pipeline is empty
        // when what actually happened is that the request was refused.
        expect(screen.queryByText('No leads yet')).not.toBeInTheDocument();
    });

    it('shows the ordinary empty state when the tenant genuinely has no leads', async () => {
        api.getLeads.mockResolvedValue({ items: [], total: 0 });

        render(<LeadsPage />);

        expect(await screen.findByText('No leads yet')).toBeInTheDocument();
        expect(screen.queryAllByText(/plan does not include the CRM module/i)).toHaveLength(0);
    });

    it('clears the notice once access is restored', async () => {
        api.getLeads.mockRejectedValueOnce(new ApiError('Forbidden', 403));
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });

        render(<LeadsPage />);
        await screen.findAllByText(/plan does not include the CRM module/i);

        fireEvent.click(screen.getAllByRole('button')[0]);

        expect(await screen.findByText('Karim Traders')).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.queryAllByText(/plan does not include the CRM module/i)).toHaveLength(0),
        );
    });

    it('does not mistake a non-permission failure for a plan problem', async () => {
        api.getLeads.mockRejectedValue(new ApiError('Server error', 500));

        render(<LeadsPage />);

        expect(await screen.findByText('No leads yet')).toBeInTheDocument();
        expect(screen.queryAllByText(/plan does not include the CRM module/i)).toHaveLength(0);
    });
});
