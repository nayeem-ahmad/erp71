import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CrmActivityPanel from './CrmActivityPanel';

jest.mock('@/lib/api', () => ({
    api: {
        getAllCrmActivities: jest.fn(),
        createCrmActivity: jest.fn(),
        completeCrmActivity: jest.fn(),
        cancelCrmActivity: jest.fn(),
        updateCrmActivity: jest.fn(),
        setCrmActivityApproval: jest.fn(),
        getLeadTaxonomy: jest.fn(),
        getCrmMessageTemplates: jest.fn().mockResolvedValue([]),
        getTeamMembers: jest.fn(),
        getMe: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toast } = require('@/lib/toast');

const CHANNELS = [{ id: 'ch-call', code: 'CALL', name: 'Call', sort_order: 1, is_system: true, is_active: true }];
const PURPOSES = [{ id: 'p-col', code: 'COLLECTION', name: 'Collection', sort_order: 1, is_system: true, is_active: true }];

const planned = {
    id: 'a1',
    subject: 'Chase the invoice',
    status: 'PLANNED',
    due_at: '2020-01-01T10:00:00.000Z',
    completed_at: null,
    summary: null,
    outcome: null,
    notes: null,
    purpose: { id: 'p-col', name: 'Collection', icon: '💰' },
    channel: null,
    assignee: null,
    is_approved: false,
    approver: null,
};

const logged = {
    ...planned,
    id: 'a2',
    subject: null,
    status: 'DONE',
    due_at: null,
    completed_at: '2026-02-02T10:00:00.000Z',
    summary: 'Sent the catalogue',
    purpose: null,
    channel: { id: 'ch-call', name: 'Call', icon: '📞' },
    // A call logged as already made lands approved: there is nothing left to hold back.
    is_approved: true,
};

const RIFAT = { id: 'user-2', name: 'Rifat', email: 'rifat@example.com' };

beforeEach(() => {
    jest.clearAllMocks();
    api.getLeadTaxonomy.mockImplementation((kind: string) =>
        Promise.resolve(kind === 'channels' ? CHANNELS : PURPOSES),
    );
    api.getAllCrmActivities.mockResolvedValue([planned, logged]);
    api.createCrmActivity.mockResolvedValue({ id: 'new' });
    api.completeCrmActivity.mockResolvedValue({ completed: {}, next: null });
    api.cancelCrmActivity.mockResolvedValue({});
    api.updateCrmActivity.mockResolvedValue({});
    api.getTeamMembers.mockResolvedValue([
        { userId: 'user-1', name: 'Nayeem' },
        { userId: 'user-2', name: 'Rifat' },
    ]);
    api.getMe.mockResolvedValue({ id: 'user-1' });
});

describe('CrmActivityPanel', () => {
    it('splits planned work from logged history', async () => {
        render(<CrmActivityPanel leadId="l1" />);

        expect(await screen.findByText('Chase the invoice')).toBeInTheDocument();
        expect(screen.getByText('Sent the catalogue')).toBeInTheDocument();
        // A past due date on a PLANNED row is the overdue signal.
        expect(screen.getByText('Overdue')).toBeInTheDocument();
    });

    it('scopes the load to the lead it was given', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        await waitFor(() => expect(api.getAllCrmActivities).toHaveBeenCalledWith({ leadId: 'l1' }));
    });

    it('scopes the load to the customer it was given', async () => {
        render(<CrmActivityPanel customerId="c1" />);
        await waitFor(() => expect(api.getAllCrmActivities).toHaveBeenCalledWith({ customerId: 'c1' }));
    });

    // The closed loop is the whole reason the two tables were merged: completing
    // a call and scheduling the next one is one action, not two.
    it('sends the next activity along with the completion', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        fireEvent.click(await screen.findByRole('button', { name: /complete/i }));

        fireEvent.change(await screen.findByPlaceholderText(/Spoke to Karim/), {
            target: { value: 'Spoke to him' },
        });
        fireEvent.click(screen.getByLabelText(/Schedule the next one/i, { selector: 'input' }));
        fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'x' } });

        await waitFor(() => expect(screen.getByText(/Inherits the purpose/)).toBeInTheDocument());
    });

    it('omits the next block entirely when it is left half-filled', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        fireEvent.click(await screen.findByRole('button', { name: /complete/i }));
        fireEvent.change(await screen.findByPlaceholderText(/Spoke to Karim/), {
            target: { value: 'Spoke to him' },
        });

        const dialog = screen.getByText('Complete activity').closest('div');
        expect(dialog).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: /^Complete$/ }).slice(-1)[0]);

        await waitFor(() => expect(api.completeCrmActivity).toHaveBeenCalled());
        // `next` must be absent, not an empty object — the API validates the
        // nested shape and a half-filled one is a 400.
        expect(api.completeCrmActivity.mock.calls[0][1]).not.toHaveProperty('next');
    });

    it('cancels a planned activity rather than deleting it', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        fireEvent.click(await screen.findByRole('button', { name: /Cancel activity/i }));
        await waitFor(() => expect(api.cancelCrmActivity).toHaveBeenCalledWith('a1'));
    });

    it('opens the log dialog pre-filled when handed a draft', async () => {
        const onConsumed = jest.fn();
        render(
            <CrmActivityPanel
                leadId="l1"
                draft={{ channelCode: 'CALL', summary: 'Drafted by AI' }}
                onDraftConsumed={onConsumed}
            />,
        );

        expect(await screen.findByDisplayValue('Drafted by AI')).toBeInTheDocument();
        expect(onConsumed).toHaveBeenCalled();
    });
});

/**
 * The three `next_step*` columns on a lead are a read-only rollup of its earliest
 * PLANNED activity, so editing that activity is the only way to change them —
 * `PATCH /crm/activities/:id` is what the lead DTO points at, and until now
 * nothing in the app called it.
 */
describe('CrmActivityPanel — editing a planned activity', () => {
    const openEdit = async () => {
        const subject = await screen.findByText('Chase the invoice');
        const row = subject.closest('div')!.parentElement!;
        fireEvent.click(within(row).getByRole('button', { name: /edit/i }));
    };

    it('offers Edit on planned work', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        await screen.findByText('Chase the invoice');

        expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    });

    it('does not offer Edit on history, which the API refuses to edit', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        await screen.findByText('Sent the catalogue');

        expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(1);
    });

    it('prefills the form from the activity it is editing', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        await openEdit();

        expect(await screen.findByDisplayValue('Chase the invoice')).toBeInTheDocument();
    });

    it('patches the activity rather than creating a second one', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        await openEdit();

        fireEvent.change(await screen.findByDisplayValue('Chase the invoice'), {
            target: { value: 'Chase it again' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.updateCrmActivity).toHaveBeenCalled());
        expect(api.updateCrmActivity.mock.calls[0][0]).toBe('a1');
        expect(api.updateCrmActivity.mock.calls[0][1]).toEqual(
            expect.objectContaining({ subject: 'Chase it again' }),
        );
        expect(api.createCrmActivity).not.toHaveBeenCalled();
    });

    it('reassigns through the same form', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        await openEdit();

        const assignee = await screen.findByLabelText('Assigned to');
        fireEvent.change(assignee, { target: { value: 'user-2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.updateCrmActivity).toHaveBeenCalled());
        expect(api.updateCrmActivity.mock.calls[0][1]).toEqual(
            expect.objectContaining({ assigned_to: 'user-2' }),
        );
    });

    it('can hand an activity back to nobody', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        await openEdit();

        fireEvent.change(await screen.findByLabelText('Assigned to'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.updateCrmActivity).toHaveBeenCalled());
        // '' rather than an omitted key: the DTO's emptyToNull turns it into an
        // explicit null, where omitting it would leave the old assignee in place.
        expect(api.updateCrmActivity.mock.calls[0][1].assigned_to).toBe('');
    });
});

describe('CrmActivityPanel — naming an assignee on new work', () => {
    it('defaults a scheduled activity to the person scheduling it', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Schedule' }));

        await waitFor(() =>
            expect((screen.getByLabelText('Assigned to') as HTMLSelectElement).value).toBe('user-1'),
        );
    });

    it('sends the chosen assignee when scheduling', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Schedule' }));

        fireEvent.change(await screen.findByPlaceholderText(/Call about the outstanding/), {
            target: { value: 'Call Karim' },
        });
        await waitFor(() => expect(screen.getByLabelText('Assigned to')).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'user-2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createCrmActivity).toHaveBeenCalled());
        expect(api.createCrmActivity.mock.calls[0][0]).toEqual(
            expect.objectContaining({ subject: 'Call Karim', assigned_to: 'user-2' }),
        );
    });

    it('carries an assignee on the follow-up scheduled at completion', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        fireEvent.click(await screen.findByRole('button', { name: /^Complete$/ }));

        fireEvent.change(await screen.findByPlaceholderText(/Spoke to Karim/), {
            target: { value: 'Spoke to him' },
        });
        fireEvent.click(screen.getByLabelText(/Schedule the next one/i, { selector: 'input' }));

        // Regexes, not exact strings: a `required` Field appends " *" to its label.
        fireEvent.change(await screen.findByLabelText(/^What needs doing/), {
            target: { value: 'Call again' },
        });
        fireEvent.change(screen.getByLabelText(/^Due/), { target: { value: '2026-09-01T10:00' } });
        fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'user-2' } });
        fireEvent.click(screen.getAllByRole('button', { name: /^Complete$/ }).slice(-1)[0]);

        await waitFor(() => expect(api.completeCrmActivity).toHaveBeenCalled());
        expect(api.completeCrmActivity.mock.calls[0][1].next).toEqual(
            expect.objectContaining({ subject: 'Call again', assigned_to: 'user-2' }),
        );
    });
});

/**
 * The reviewer's sign-off, on the lead's own page — the same switch the Activities
 * list carries, so approving a lead's next call does not mean leaving the lead to
 * hunt for it in the tenant-wide list.
 */
describe('CrmActivityPanel — approving planned work', () => {
    const asReviewer = () =>
        api.getMe.mockResolvedValue({
            id: 'user-1',
            tenants: [{ id: 'tenant-1', role: 'MANAGER', permissions: ['APPROVE_CRM_ACTIVITY'] }],
        });

    /** Disabled until `/auth/me` has said this member may approve. */
    const enabledSwitch = () =>
        waitFor(() => {
            const el = screen.getByRole('switch', { name: 'Approve this activity' });
            expect(el).not.toBeDisabled();
            return el;
        });

    beforeEach(() => {
        window.sessionStorage.clear();
        api.setCrmActivityApproval.mockResolvedValue({
            ...planned,
            is_approved: true,
            approver: { id: 'user-1', name: 'Nayeem', email: 'nayeem@example.com' },
        });
    });

    it('approves a planned activity in place', async () => {
        asReviewer();
        render(<CrmActivityPanel leadId="l1" />);
        const toggle = await enabledSwitch();
        expect(toggle).toHaveAttribute('aria-checked', 'false');

        const loadsBefore = api.getAllCrmActivities.mock.calls.length;
        fireEvent.click(toggle);

        await waitFor(() => expect(api.setCrmActivityApproval).toHaveBeenCalledWith('a1', true));
        expect(api.setCrmActivityApproval).toHaveBeenCalledTimes(1);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        // Not reloaded: a reload swaps the whole panel for "Loading…" and pulls
        // the switch out from under the reviewer's finger.
        expect(api.getAllCrmActivities.mock.calls.length).toBe(loadsBefore);
    });

    it('names the reviewer once the server has stamped the approval', async () => {
        asReviewer();
        render(<CrmActivityPanel leadId="l1" />);
        fireEvent.click(await enabledSwitch());

        expect(await screen.findByText(/Nayeem/)).toBeInTheDocument();
    });

    // Printed rather than left to a tooltip: a phone has no hover.
    it('names who approved an activity that arrives approved', async () => {
        api.getAllCrmActivities.mockResolvedValue([{ ...planned, is_approved: true, approver: RIFAT }, logged]);
        render(<CrmActivityPanel leadId="l1" />);

        expect(await screen.findByText(/Rifat/)).toBeInTheDocument();
    });

    it('withdraws an approval, and stops naming the reviewer', async () => {
        asReviewer();
        api.getAllCrmActivities.mockResolvedValue([{ ...planned, is_approved: true, approver: RIFAT }, logged]);
        api.setCrmActivityApproval.mockResolvedValue({ ...planned, is_approved: false, approver: null });
        render(<CrmActivityPanel leadId="l1" />);
        const toggle = await enabledSwitch();
        expect(toggle).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(toggle);

        await waitFor(() => expect(api.setCrmActivityApproval).toHaveBeenCalledWith('a1', false));
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByText(/Rifat/)).not.toBeInTheDocument();
    });

    // A switch left on after the server refused is the failure that matters: the
    // reviewer walks away believing they signed the call off.
    it('puts the switch back and says so when the server refuses', async () => {
        asReviewer();
        api.setCrmActivityApproval.mockRejectedValue(new Error('nope'));
        render(<CrmActivityPanel leadId="l1" />);
        const toggle = await enabledSwitch();

        fireEvent.click(toggle);

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update approval.'));
        expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    /**
     * What `CrmActivityDrawer` hangs the activities list's refresh on. It has to
     * be a write rather than the drawer closing: a list that reloads because
     * somebody looked swaps itself for "Loading…" for nothing.
     */
    it('reports a write to the caller, and stays quiet on a plain load', async () => {
        const onChanged = jest.fn();
        render(<CrmActivityPanel leadId="l1" onChanged={onChanged} />);
        await screen.findByText('Chase the invoice');

        expect(onChanged).not.toHaveBeenCalled();

        fireEvent.click(await screen.findByRole('button', { name: /Cancel activity/i }));

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    });

    it('does not report a write the server refused', async () => {
        const onChanged = jest.fn();
        api.cancelCrmActivity.mockRejectedValue(new Error('nope'));
        render(<CrmActivityPanel leadId="l1" onChanged={onChanged} />);
        await screen.findByText('Chase the invoice');

        fireEvent.click(await screen.findByRole('button', { name: /Cancel activity/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(onChanged).not.toHaveBeenCalled();
    });

    it('shows the switch disabled to someone who cannot approve', async () => {
        render(<CrmActivityPanel leadId="l1" />);
        await screen.findByText('Chase the invoice');

        expect(screen.getByRole('switch', { name: 'Approve this activity' })).toBeDisabled();
    });

    // Only a plan can be approved; a switch on a call already made would offer a
    // decision that changes nothing.
    it('offers the switch on planned work only, not on history', async () => {
        asReviewer();
        render(<CrmActivityPanel leadId="l1" />);
        await screen.findByText('Sent the catalogue');

        expect(screen.getAllByRole('switch')).toHaveLength(1);
    });
});
