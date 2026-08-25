'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ActivitiesPage from './page';
import { dhakaDateOnly } from '@/lib/created-range';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getAllCrmActivities: jest.fn(),
        getCrmActivitySummary: jest.fn(),
        getLeadTaxonomy: jest.fn().mockResolvedValue([]),
        getTeamMembers: jest.fn(),
        getMe: jest.fn(),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const activity = {
    id: 'act-1',
    subject: 'Call about pricing',
    summary: null,
    status: 'PLANNED',
    due_at: '2026-08-25T08:00:00.000Z',
    completed_at: null,
    purpose: null,
    channel: null,
    customer: null,
    lead: { id: 'lead-1', name: 'Karim Traders', mobile: '01700000000' },
    assignee: { id: 'user-2', name: 'Rifat', email: 'rifat@example.com' },
    created_at: '2026-08-20T08:00:00.000Z',
};

/**
 * The filters are unlabelled selects. Both member selects carry the same people,
 * so each is found by the "all" option only it has, never by a member's name.
 */
function selectByOption(optionText: string): HTMLSelectElement {
    const option = screen.getByRole('option', { name: optionText });
    return option.closest('select') as HTMLSelectElement;
}

const optionValues = (select: HTMLSelectElement) =>
    Array.from(select.options).map((o) => o.value);

/** Team members arrive a tick after the first render. */
const withMembersLoaded = (label: string) =>
    waitFor(() => {
        const select = selectByOption(label);
        expect(optionValues(select)).toContain('user-2');
        return select;
    });

const lastCall = () => api.getAllCrmActivities.mock.calls.at(-1)[0];

describe('CrmActivitiesPage — owner and due-date filters', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getAllCrmActivities.mockResolvedValue([activity]);
        api.getCrmActivitySummary.mockResolvedValue({ dueToday: 1, overdue: 0, total: 1 });
        api.getTeamMembers.mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]);
        api.getMe.mockResolvedValue({ id: 'user-1', name: 'Nayeem' });
    });

    it('opens on today, so the list is the day\'s agenda rather than everything ever planned', async () => {
        render(<ActivitiesPage />);
        await screen.findByText('Call about pricing');

        const today = dhakaDateOnly();
        expect(lastCall()).toEqual(
            expect.objectContaining({ dueFrom: today, dueTo: today }),
        );
    });

    it('filters by the owner of the related lead', async () => {
        render(<ActivitiesPage />);
        await screen.findByText('Call about pricing');
        const owners = await withMembersLoaded('All lead owners');

        fireEvent.change(owners, { target: { value: 'user-2' } });

        await waitFor(() => expect(lastCall()).toEqual(
            expect.objectContaining({ leadOwner: 'user-2' }),
        ));
    });

    it('filters to activities on leads nobody owns', async () => {
        render(<ActivitiesPage />);
        await screen.findByText('Call about pricing');

        fireEvent.change(selectByOption('All lead owners'), { target: { value: 'unassigned' } });

        await waitFor(() => expect(lastCall()).toEqual(
            expect.objectContaining({ leadOwner: 'unassigned' }),
        ));
    });

    it('filters by who has to do the activity, separately from who owns the lead', async () => {
        render(<ActivitiesPage />);
        await screen.findByText('Call about pricing');
        const assignees = await withMembersLoaded('All assignees');

        fireEvent.change(assignees, { target: { value: 'user-2' } });

        await waitFor(() => expect(lastCall()).toEqual(
            expect.objectContaining({ assignedTo: 'user-2', leadOwner: undefined }),
        ));
    });

    /**
     * "Me" is the shortcut the whole filter exists for. It is the signed-in user's
     * own entry relabelled rather than a second option carrying the same id — two
     * options with one value make the select pick the wrong one on change.
     */
    it('offers Me first, carrying the signed-in user\'s id and appearing once', async () => {
        render(<ActivitiesPage />);
        await screen.findByText('Call about pricing');

        const owners = await withMembersLoaded('All lead owners');
        const values = optionValues(owners);

        expect(values.filter((v) => v === 'user-1')).toHaveLength(1);
        // The signed-in user is relabelled, not listed twice under their own name.
        expect(Array.from(owners.options).map((o) => o.textContent)).not.toContain('Nayeem');

        const me = Array.from(owners.options).find((o) => o.textContent === 'Me')!;
        expect(me.value).toBe('user-1');
        // Directly after "All lead owners" and "Unassigned", ahead of other members.
        expect(values.indexOf('user-1')).toBeLessThan(values.indexOf('user-2'));
    });

    it('drops the due range when Overdue only is ticked, which would otherwise contradict it', async () => {
        render(<ActivitiesPage />);
        await screen.findByText('Call about pricing');

        fireEvent.click(screen.getByLabelText('Overdue only'));

        await waitFor(() => {
            const call = lastCall();
            expect(call.overdue).toBe(true);
            expect(call.dueFrom).toBeUndefined();
            expect(call.dueTo).toBeUndefined();
        });
    });

    it('unticks Overdue only when a due range is chosen', async () => {
        render(<ActivitiesPage />);
        await screen.findByText('Call about pricing');

        const overdue = screen.getByLabelText('Overdue only') as HTMLInputElement;
        fireEvent.click(overdue);
        await waitFor(() => expect(lastCall().overdue).toBe(true));

        fireEvent.click(screen.getByRole('button', { name: /due · any time/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));

        await waitFor(() => {
            expect(lastCall().overdue).toBeUndefined();
            expect(lastCall().dueFrom).toBeTruthy();
        });
        expect(overdue.checked).toBe(false);
    });

    it('keeps the created-date filter separate from the due-date one', async () => {
        render(<ActivitiesPage />);
        await screen.findByText('Call about pricing');

        expect(screen.getByRole('button', { name: /created · any time/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^due · /i })).toBeInTheDocument();
    });
});
