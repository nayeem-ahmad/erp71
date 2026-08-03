'use client';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CrmConversationsPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getLeadConversations: jest.fn(),
        getLeadConversationSummary: jest.fn(),
        getTeamMembers: jest.fn(),
        // Channel labels, icons and the type filter all come from the tenant's own
        // list now, so the page is unrenderable without this.
        getLeadTaxonomy: jest.fn(),
    },
}));

// DataTable drops every `hideOnMobile` column when the viewport reports narrow, and the
// global matchMedia mock always reports non-matching. Without this, the Direction,
// Mobile, Outcome and Logged-by columns this suite asserts on never render.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const mockConversations = [
    {
        id: 'conv-1',
        type: 'CALL',
        direction: 'OUTBOUND',
        summary: 'Discussed bulk pricing for rice',
        outcome: 'Wants a quote',
        created_at: '2026-07-20T09:15:00.000Z',
        lead: { id: 'lead-1', name: 'Karim Traders', mobile: '01711111111', status: 'QUALIFIED', assigned_to: 'user-1' },
        creator: { id: 'user-1', name: 'Rahim', email: 'rahim@example.com' },
    },
    {
        id: 'conv-2',
        type: 'VISIT',
        direction: 'INBOUND',
        summary: 'Walked into the Mirpur branch',
        outcome: null,
        created_at: '2026-07-19T04:00:00.000Z',
        lead: { id: 'lead-2', name: 'Sultana Stores', mobile: '01822222222', status: 'NEW', assigned_to: null },
        creator: { id: 'user-2', name: 'Nadia', email: 'nadia@example.com' },
    },
];

/** The tenant's seeded conversation channels, in their configured order. */
const mockChannels = [
    { id: 'ch-call', code: 'CALL', name: 'Call', icon: '📞', sort_order: 1, is_system: true, is_active: true },
    { id: 'ch-sms', code: 'SMS', name: 'SMS', icon: '💬', sort_order: 2, is_system: true, is_active: true },
    { id: 'ch-wa', code: 'WHATSAPP', name: 'WhatsApp', icon: '🟢', sort_order: 3, is_system: true, is_active: true },
    { id: 'ch-visit', code: 'VISIT', name: 'Visit', icon: '🏪', sort_order: 4, is_system: true, is_active: true },
];

const mockSummary = {
    total: 42,
    thisWeek: 9,
    leadsTouched: 17,
    countsByType: { CALL: 20, SMS: 0, WHATSAPP: 5, EMAIL: 0, VISIT: 17, ONLINE_MEETING: 0, NOTE: 0 },
};

/** The filter object handed to the most recent list request. */
function lastListCall() {
    const { api } = require('@/lib/api');
    const calls = (api.getLeadConversations as jest.Mock).mock.calls;
    return calls[calls.length - 1][0];
}

describe('CrmConversationsPage — cross-lead conversations list', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getLeadConversations.mockResolvedValue({
            items: mockConversations,
            total: mockConversations.length,
            page: 1,
            limit: 10,
            pages: 1,
        });
        api.getLeadConversationSummary.mockResolvedValue(mockSummary);
        api.getTeamMembers.mockResolvedValue([
            { userId: 'user-1', name: 'Rahim', email: 'rahim@example.com' },
            { userId: 'user-2', name: 'Nadia', email: 'nadia@example.com' },
        ]);
        api.getLeadTaxonomy.mockResolvedValue(mockChannels);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('renders the Conversations heading', async () => {
        render(<CrmConversationsPage />);
        expect(screen.getByRole('heading', { name: 'Conversations' })).toBeInTheDocument();
        // Let the in-flight list/summary requests settle inside act() before teardown.
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());
    });

    it('lists conversations from every lead, not just one', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => {
            expect(screen.getByText('Karim Traders')).toBeInTheDocument();
            expect(screen.getByText('Sultana Stores')).toBeInTheDocument();
        });
        expect(screen.getByText('Discussed bulk pricing for rice')).toBeInTheDocument();
        expect(screen.getByText('Walked into the Mirpur branch')).toBeInTheDocument();
    });

    it('links each row to its own lead', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());
        expect(screen.getByText('Karim Traders').closest('a')).toHaveAttribute('href', '/crm/leads/lead-1');
        expect(screen.getByText('Sultana Stores').closest('a')).toHaveAttribute('href', '/crm/leads/lead-2');
    });

    it('renders the summary tiles with a per-type breakdown', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => {
            expect(screen.getByText('42')).toBeInTheDocument();
            expect(screen.getByText('9')).toBeInTheDocument();
            expect(screen.getByText('17')).toBeInTheDocument();
        });
        // Zero-count types are omitted from the breakdown line.
        expect(screen.getByText(/Call: 20/)).toBeInTheDocument();
        expect(screen.getByText(/Visit: 17/)).toBeInTheDocument();
        expect(screen.queryByText(/SMS: 0/)).not.toBeInTheDocument();
    });

    it('shows the channel and direction of each conversation', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());
        // Scoped to the table: these same labels also appear in the filter dropdowns.
        const table = within(screen.getByRole('table'));
        expect(table.getByText('Call')).toBeInTheDocument();
        expect(table.getByText('Visit')).toBeInTheDocument();
        expect(table.getByText('Outbound')).toBeInTheDocument();
        expect(table.getByText('Inbound')).toBeInTheDocument();
    });

    it('labels channels from the tenant list, not a built-in one', async () => {
        const { api } = require('@/lib/api');
        api.getLeadTaxonomy.mockResolvedValue([
            { ...mockChannels[0], name: 'Phone Call', icon: '☎️' },
            ...mockChannels.slice(1),
        ]);

        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        const table = within(screen.getByRole('table'));
        expect(table.getByText('Phone Call')).toBeInTheDocument();
        expect(table.queryByText('Call')).not.toBeInTheDocument();
    });

    // A conversation logged against a channel the tenant has since deleted must still
    // render — the stored code is the last resort, not a blank cell.
    it('falls back to the stored code for a channel that no longer exists', async () => {
        const { api } = require('@/lib/api');
        api.getLeadTaxonomy.mockResolvedValue(mockChannels.slice(1));

        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        expect(within(screen.getByRole('table')).getByText('CALL')).toBeInTheDocument();
    });

    it('builds the type filter from the tenant channel list', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        const options = within(screen.getByDisplayValue('All types') as HTMLElement)
            .getAllByRole('option')
            .map((o) => (o as HTMLOptionElement).value);
        expect(options).toEqual(['', 'CALL', 'SMS', 'WHATSAPP', 'VISIT']);
    });

    it('sends the type filter to the server rather than filtering in the browser', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        fireEvent.change(screen.getByDisplayValue('All types'), { target: { value: 'WHATSAPP' } });

        await waitFor(() => expect(lastListCall()).toMatchObject({ type: 'WHATSAPP' }));
    });

    it('sends the lead-status filter, so you can see conversations on qualified leads only', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        fireEvent.change(screen.getByDisplayValue('Any lead status'), { target: { value: 'QUALIFIED' } });

        await waitFor(() => expect(lastListCall()).toMatchObject({ leadStatus: 'QUALIFIED' }));
    });

    it('passes the date range through as dateFrom/dateTo', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        const dateInputs = document.querySelectorAll('input[type="date"]');
        fireEvent.change(dateInputs[0], { target: { value: '2026-07-01' } });
        fireEvent.change(dateInputs[1], { target: { value: '2026-07-20' } });

        await waitFor(() => expect(lastListCall()).toMatchObject({
            dateFrom: '2026-07-01',
            dateTo: '2026-07-20',
        }));
    });

    it('debounces the search box into a single server-side search param', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        fireEvent.change(screen.getByPlaceholderText(/Search summary, outcome/), {
            target: { value: 'rice' },
        });

        await waitFor(() => expect(lastListCall()).toMatchObject({ search: 'rice' }));
    });

    it('"Logged by me" sends mine and lets the server resolve the user id', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /Logged by me/ }));

        await waitFor(() => expect(lastListCall()).toMatchObject({ mine: true }));
        // `mine` and an explicit person are mutually exclusive — the server derives the id.
        expect(lastListCall().createdBy).toBeUndefined();
        expect(screen.getByDisplayValue('Anyone')).toBeDisabled();
    });

    it('keeps the summary tiles in step with the active filters', async () => {
        const { api } = require('@/lib/api');
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        fireEvent.change(screen.getByDisplayValue('All types'), { target: { value: 'CALL' } });

        await waitFor(() => {
            const calls = (api.getLeadConversationSummary as jest.Mock).mock.calls;
            expect(calls[calls.length - 1][0]).toMatchObject({ type: 'CALL' });
        });
    });

    // Every filter is set before clearing: asserting on one would let a clearFilters that
    // resets only that one pass, which is exactly the bug a user hits when the list stays
    // empty after clicking Clear.
    it('clears every filter at once', async () => {
        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('Karim Traders')).toBeInTheDocument());

        fireEvent.change(screen.getByPlaceholderText(/Search summary, outcome/), { target: { value: 'rice' } });
        fireEvent.change(screen.getByDisplayValue('All types'), { target: { value: 'CALL' } });
        fireEvent.change(screen.getByDisplayValue('All directions'), { target: { value: 'INBOUND' } });
        fireEvent.change(screen.getByDisplayValue('Anyone'), { target: { value: 'user-2' } });
        fireEvent.change(screen.getByDisplayValue('Any lead status'), { target: { value: 'QUALIFIED' } });
        fireEvent.change(screen.getByDisplayValue('Any lead owner'), { target: { value: 'user-1' } });
        const dateInputs = document.querySelectorAll('input[type="date"]');
        fireEvent.change(dateInputs[0], { target: { value: '2026-07-01' } });
        fireEvent.change(dateInputs[1], { target: { value: '2026-07-20' } });
        fireEvent.click(screen.getByRole('button', { name: /Logged by me/ }));

        await waitFor(() => expect(lastListCall()).toMatchObject({
            search: 'rice',
            type: 'CALL',
            direction: 'INBOUND',
            leadStatus: 'QUALIFIED',
            leadAssignedTo: 'user-1',
            dateFrom: '2026-07-01',
            dateTo: '2026-07-20',
            mine: true,
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

        // Nothing at all should reach the server: an object with only undefined values.
        await waitFor(() => {
            const call = lastListCall();
            expect(call.search).toBeUndefined();
            expect(call.type).toBeUndefined();
            expect(call.direction).toBeUndefined();
            expect(call.createdBy).toBeUndefined();
            expect(call.mine).toBeUndefined();
            expect(call.leadStatus).toBeUndefined();
            expect(call.leadAssignedTo).toBeUndefined();
            expect(call.dateFrom).toBeUndefined();
            expect(call.dateTo).toBeUndefined();
        });

        // …and every control is visibly back to its placeholder.
        expect(screen.getByDisplayValue('All types')).toBeInTheDocument();
        expect(screen.getByDisplayValue('All directions')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Anyone')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Any lead status')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Any lead owner')).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Search summary, outcome/)).toHaveValue('');
        expect(document.querySelectorAll('input[type="date"]')[0]).toHaveValue('');
        expect(document.querySelectorAll('input[type="date"]')[1]).toHaveValue('');
        // The Clear button itself only exists while something is filtered.
        expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });

    // The refresh button and the filter-change effect both fetch the summary. Without one
    // shared sequence guard, a slow refresh response lands last and the tiles end up
    // describing a different set than the rows below them.
    it('does not let a slow refresh overwrite a newer filtered summary', async () => {
        const { api } = require('@/lib/api');
        let releaseStale: (v: unknown) => void = () => {};
        const stalePromise = new Promise((resolve) => { releaseStale = resolve; });

        render(<CrmConversationsPage />);
        await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());

        // Next summary request (the refresh) hangs; the one after it (the filter) resolves.
        api.getLeadConversationSummary.mockReturnValueOnce(
            stalePromise.then(() => ({ ...mockSummary, total: 999 })),
        );
        // The header refresh control is icon-only (as on the other CRM pages), so it has
        // no accessible name to query by.
        fireEvent.click(screen.getByTestId('refreshcw-icon').closest('button')!);

        api.getLeadConversationSummary.mockResolvedValueOnce({ ...mockSummary, total: 7 });
        fireEvent.change(screen.getByDisplayValue('All types'), { target: { value: 'SMS' } });
        await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());

        // Now let the stale refresh response land. It must be discarded.
        releaseStale(null);
        await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
        expect(screen.queryByText('999')).not.toBeInTheDocument();
    });

    it('shows the empty state when no conversation matches', async () => {
        const { api } = require('@/lib/api');
        api.getLeadConversations.mockResolvedValue({ items: [], total: 0, page: 1, limit: 10, pages: 0 });

        render(<CrmConversationsPage />);

        await waitFor(() => {
            expect(screen.getByText('No conversations match these filters')).toBeInTheDocument();
        });
    });

    it('survives a failed list load without crashing the page', async () => {
        const { api } = require('@/lib/api');
        api.getLeadConversations.mockRejectedValue(new Error('boom'));
        api.getLeadConversationSummary.mockRejectedValue(new Error('boom'));

        render(<CrmConversationsPage />);

        // Wait on the empty state, not the heading — the heading is present on first paint,
        // so asserting on it would pass before the rejected request had settled.
        await waitFor(() => {
            expect(screen.getByText('No conversations match these filters')).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: 'Conversations' })).toBeInTheDocument();
    });
});
