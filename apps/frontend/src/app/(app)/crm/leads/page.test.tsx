'use client';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LeadsPage from './page';
import { useToastStore } from '@/lib/toast';

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
        getCrmAssignees: jest.fn().mockResolvedValue([]),
        getLeadTaxonomy: jest.fn().mockResolvedValue([]),
        deleteLead: jest.fn(),
        bulkLeadAction: jest.fn(),
        bulkUpdateLeads: jest.fn(),
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
        api.getCrmAssignees.mockResolvedValue([
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
        api.getCrmAssignees.mockResolvedValue([]);
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
        api.getCrmAssignees.mockResolvedValue([{ userId: 'user-1', name: 'Nayeem' }]);
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
        api.getCrmAssignees.mockResolvedValue([]);
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
        api.getCrmAssignees.mockResolvedValue([
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
        api.getCrmAssignees.mockResolvedValue([
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
        api.getCrmAssignees.mockResolvedValue([]);

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

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

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

describe('LeadsPage — tenant stages', () => {
    const STAGES = [
        { id: 'st-new', code: 'NEW', name: 'New', lifecycle: 'NEW', sort_order: 1, is_system: true, is_active: true },
        { id: 'st-neg', code: 'NEGOTIATION', name: 'Negotiation', lifecycle: 'QUALIFIED', sort_order: 2, is_system: false, is_active: true },
        { id: 'st-won', code: 'CONVERTED', name: 'Won deal', lifecycle: 'CONVERTED', sort_order: 3, is_system: true, is_active: true },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        api.getLeadTaxonomy.mockImplementation(async (kind: string) => (kind === 'statuses' ? STAGES : []));
        api.getLeads.mockResolvedValue({
            items: [{ ...leads[0], status: 'QUALIFIED', statusOption: STAGES[1] }],
            total: 1,
        });
    });

    afterAll(() => {
        api.getLeadTaxonomy.mockResolvedValue([]);
    });

    it('shows the stage name the tenant chose', async () => {
        render(<LeadsPage />);

        expect(await screen.findByRole('cell', { name: 'Negotiation' })).toBeInTheDocument();
    });

    it('filters by one stage, sent as statusId', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.change(selectByOption('All statuses'), { target: { value: 'st-neg' } });

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenLastCalledWith(
                expect.objectContaining({ statusId: 'st-neg', status: undefined }),
            ),
        );
    });

    it('opens on a stage from a funnel link', async () => {
        searchParams = new URLSearchParams('statusId=st-neg');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ statusId: 'st-neg' })),
        );
    });

    it('shows a hidden stage it was linked at, rather than pretending to show everything', async () => {
        api.getLeadTaxonomy.mockImplementation(async (kind: string) =>
            kind === 'statuses'
                ? [...STAGES, { id: 'st-old', code: 'OLD', name: 'Paused', lifecycle: 'QUALIFIED', sort_order: 4, is_system: false, is_active: false }]
                : [],
        );
        searchParams = new URLSearchParams('statusId=st-old');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() => expect(selectByOption('All statuses').value).toBe('st-old'));
        expect(screen.getByRole('option', { name: 'Paused (Hidden)' })).toBeInTheDocument();
    });

    it('drops a remembered stage that no longer exists', async () => {
        searchParams = new URLSearchParams('statusId=st-deleted');
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        await waitFor(() =>
            expect(api.getLeads).toHaveBeenLastCalledWith(
                expect.objectContaining({ statusId: undefined }),
            ),
        );
        expect(selectByOption('All statuses').value).toBe('');
    });

    it('offers only open stages to the bulk edit', async () => {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit field' }));
        fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'status' } });

        const options = Array.from((screen.getByLabelText('New value') as HTMLSelectElement).options).map((o) => o.value);
        expect(options).toEqual(['', 'st-new', 'st-neg']);
    });
});

/**
 * List or board is a preference kept in localStorage, so it is cleared on both
 * sides of every test here — a board left behind would open every later suite
 * on the board.
 */
describe('LeadsPage — board view', () => {
    const STAGES = [
        { id: 'st-new', code: 'NEW', name: 'New', lifecycle: 'NEW', sort_order: 1, is_system: true, is_active: true },
        { id: 'st-neg', code: 'NEGOTIATION', name: 'Negotiation', lifecycle: 'QUALIFIED', sort_order: 2, is_system: false, is_active: true },
        { id: 'st-lost', code: 'LOST', name: 'Lost', lifecycle: 'LOST', sort_order: 3, is_system: true, is_active: true },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        searchParams = new URLSearchParams();
        api.getLeadTaxonomy.mockImplementation(async (kind: string) => (kind === 'statuses' ? STAGES : []));
        api.getCrmAssignees.mockResolvedValue([{ userId: 'user-2', name: 'Rifat' }]);
        // The list, and the board's Negotiation column, hold both leads.
        api.getLeads.mockImplementation(async (q: any) =>
            q.statusId === 'st-neg' || (!q.statusId && !q.priority && !q.assignedTo)
                ? { items: leads, total: 2 }
                : { items: [], total: 0 },
        );
    });

    afterEach(() => {
        localStorage.clear();
    });

    afterAll(() => {
        api.getLeadTaxonomy.mockResolvedValue([]);
    });

    const boardButton = () => screen.getByRole('button', { name: 'Board' });

    it('lays the leads out in a column per stage, grouped by status unless told otherwise', async () => {
        render(<LeadsPage />);
        await screen.findByRole('cell', { name: 'Karim Traders' });

        fireEvent.click(boardButton());

        const negotiation = await screen.findByRole('region', { name: 'Negotiation' });
        expect(await within(negotiation).findByText('Karim Traders')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'New' })).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(boardButton()).toHaveAttribute('aria-pressed', 'true');
        expect(selectByOption('Status').value).toBe('status');
        expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ statusId: 'st-new', page: 1 }));
    });

    it('re-lays the columns by the field chosen', async () => {
        render(<LeadsPage />);
        await screen.findByRole('cell', { name: 'Karim Traders' });
        fireEvent.click(boardButton());
        await screen.findByRole('region', { name: 'Negotiation' });

        fireEvent.change(selectByOption('Status'), { target: { value: 'priority' } });

        expect(await screen.findByRole('region', { name: 'Urgent' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Negotiation' })).not.toBeInTheDocument();
        await waitFor(() =>
            expect(api.getLeads).toHaveBeenCalledWith(expect.objectContaining({ priority: 'URGENT', page: 1 })),
        );
    });

    it('turns the stage filter into the columns it allows, not an extra filter on each', async () => {
        render(<LeadsPage />);
        await screen.findByRole('cell', { name: 'Karim Traders' });
        fireEvent.change(selectByOption('All statuses'), { target: { value: 'open' } });
        fireEvent.click(boardButton());

        await screen.findByRole('region', { name: 'Negotiation' });
        expect(screen.queryByRole('region', { name: 'Lost' })).not.toBeInTheDocument();
        const columnCalls = api.getLeads.mock.calls.map(([q]: any[]) => q).filter((q: any) => q.statusId);
        expect(columnCalls.length).toBeGreaterThan(0);
        expect(columnCalls.every((q: any) => q.status === undefined)).toBe(true);
    });

    it('opens on the board next time without fetching a page of the list first', async () => {
        localStorage.setItem('crm_leads_view', JSON.stringify({ view: 'board', groupBy: 'status' }));
        render(<LeadsPage />);

        await within(await screen.findByRole('region', { name: 'Negotiation' })).findByText('Karim Traders');
        // Every request is a column's page or the board's one-row total.
        expect(api.getLeads.mock.calls.every(([q]: any[]) => q.statusId || q.limit === 1)).toBe(true);
    });

    it('cannot group by owner while only my leads are shown, and returns to it when the scope is off', async () => {
        localStorage.setItem('crm_leads_view', JSON.stringify({ view: 'board', groupBy: 'owner' }));
        localStorage.setItem('crm_mine_only', 'true');
        render(<LeadsPage />);

        await screen.findByRole('region', { name: 'Negotiation' });
        expect(selectByOption('Status').value).toBe('status');
        expect(screen.getByRole('option', { name: 'Lead Owner' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Only mine' }));

        expect(await screen.findByRole('region', { name: 'Rifat' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Unassigned' })).toBeInTheDocument();
    });
});

describe('LeadsPage — bulk actions', () => {
    const toasts = () => useToastStore.getState().toasts.map((item) => [item.type, item.message]);
    /** Each row carries its own Delete, so the bar's is found inside the bar. */
    const bulkBar = () => within(screen.getByText(/^\d+ selected$/).parentElement as HTMLElement);

    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams();
        useToastStore.setState({ toasts: [] });
        api.getLeads.mockResolvedValue({ items: leads, total: 2 });
        api.getCrmAssignees.mockResolvedValue([{ userId: 'user-1', name: 'Nayeem' }]);
        api.getCustomFields.mockResolvedValue([{ key: 'area', label: 'Area' }]);
    });

    afterAll(() => {
        api.getCustomFields.mockResolvedValue([]);
    });

    /** Waits for the custom-field column first: its arrival re-renders the rows. */
    async function selectBoth() {
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');
        await screen.findByText('Area');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
        await screen.findByText('2 selected');
    }

    function editField(field: string, value: string) {
        fireEvent.click(screen.getByRole('button', { name: 'Edit field' }));
        fireEvent.change(screen.getByLabelText('Field'), { target: { value: field } });
        fireEvent.change(screen.getByLabelText('New value'), { target: { value } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 lead(s)' }));
    }

    it('offers Edit field and Delete for the selection, and no separate status or owner pickers', async () => {
        await selectBoth();

        expect(screen.getByText('2 selected')).toBeInTheDocument();
        expect(bulkBar().getByRole('button', { name: 'Edit field' })).toBeInTheDocument();
        expect(bulkBar().getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Set status…' })).not.toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Assign to…' })).not.toBeInTheDocument();
    });

    it('sets one field on every selected lead, then reloads and clears the selection', async () => {
        api.bulkUpdateLeads.mockResolvedValue({ count: 2, skipped: 0 });
        await selectBoth();
        const loadsBefore = api.getLeads.mock.calls.length;

        editField('owner', 'user-1');

        await waitFor(() =>
            expect(api.bulkUpdateLeads).toHaveBeenCalledWith(['lead-1', 'lead-2'], { assigned_to: 'user-1' }),
        );
        await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument());
        expect(screen.queryByLabelText('Field')).not.toBeInTheDocument();
        expect(api.getLeads.mock.calls.length).toBeGreaterThan(loadsBefore);
        expect(toasts()).toEqual([['success', '2 lead(s) updated.']]);
    });

    it('sets a custom field on the selection', async () => {
        api.bulkUpdateLeads.mockResolvedValue({ count: 2, skipped: 0 });
        await selectBoth();

        editField('cf:area', 'Mirpur');

        await waitFor(() =>
            expect(api.bulkUpdateLeads).toHaveBeenCalledWith(['lead-1', 'lead-2'], { custom_fields: { area: 'Mirpur' } }),
        );
    });

    it('says how many converted leads were left alone', async () => {
        api.bulkUpdateLeads.mockResolvedValue({ count: 1, skipped: 1 });
        await selectBoth();

        editField('priority', 'HIGH');

        await waitFor(() =>
            expect(toasts()).toEqual([
                ['success', '1 lead(s) updated.'],
                ['info', '1 converted lead(s) skipped — converted leads cannot be edited.'],
            ]),
        );
    });

    it('keeps the dialog and the selection when the edit fails, and still reloads', async () => {
        api.bulkUpdateLeads.mockRejectedValue(new Error('Invalid status.'));
        await selectBoth();
        const loadsBefore = api.getLeads.mock.calls.length;

        editField('priority', 'HIGH');

        await waitFor(() => expect(toasts()).toEqual([['error', 'Invalid status.']]));
        expect(screen.getByLabelText('Field')).toBeInTheDocument();
        await waitFor(() => expect(api.getLeads.mock.calls.length).toBeGreaterThan(loadsBefore));
    });

    it('deletes the selection only after it is confirmed in a dialog', async () => {
        api.bulkLeadAction.mockResolvedValue({ count: 2 });
        await selectBoth();

        fireEvent.click(bulkBar().getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Delete 2 selected lead(s)? This cannot be undone.')).toBeInTheDocument();
        expect(api.bulkLeadAction).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.bulkLeadAction).toHaveBeenCalledWith(['lead-1', 'lead-2'], 'delete'));
        await waitFor(() => expect(toasts()).toEqual([['success', '2 lead(s) deleted.']]));
    });

    it('deletes one lead from its row after confirming in a dialog, not a browser prompt', async () => {
        const confirmSpy = jest.spyOn(window, 'confirm');
        api.deleteLead.mockResolvedValue({ success: true });
        render(<LeadsPage />);
        await screen.findByText('Karim Traders');

        fireEvent.click(screen.getAllByTitle('Delete')[0]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(api.deleteLead).toHaveBeenCalledWith('lead-1'));
        expect(confirmSpy).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});
