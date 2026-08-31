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
