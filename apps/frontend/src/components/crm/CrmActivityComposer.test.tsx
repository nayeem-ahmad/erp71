import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CrmActivityComposer from './CrmActivityComposer';

jest.mock('@/lib/api', () => ({
    api: {
        getLeads: jest.fn(),
        searchCustomers: jest.fn(),
        createCrmActivity: jest.fn(),
        getLeadTaxonomy: jest.fn(),
        getCrmMessageTemplates: jest.fn(),
        getTeamMembers: jest.fn(),
        getMe: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const CHANNELS = [{ id: 'ch-call', code: 'CALL', name: 'Call', sort_order: 1, is_system: true, is_active: true }];
const PURPOSES = [{ id: 'p-col', code: 'COLLECTION', name: 'Collection', sort_order: 1, is_system: true, is_active: true }];

const REMINDER = {
    id: 'tpl-1',
    name: 'Payment reminder',
    usage: 'BOTH' as const,
    subject: 'Chase {{name}} on the invoice',
    body: 'Dear {{name}}, your invoice is outstanding. — {{user}}, {{business}}',
    sort_order: 1,
    is_active: true,
    channel: { id: 'ch-wa', name: 'WhatsApp', icon: null },
    purpose: { id: 'p-col', name: 'Collection', icon: null },
};

beforeEach(() => {
    jest.clearAllMocks();
    api.getLeadTaxonomy.mockImplementation((kind: string) =>
        Promise.resolve(kind === 'channels' ? CHANNELS : PURPOSES),
    );
    api.getLeads.mockResolvedValue({ items: [{ id: 'lead-1', name: 'Karim Traders', mobile: '01700000000' }] });
    api.searchCustomers.mockResolvedValue([{ id: 'cust-1', name: 'Karim Store', phone: '01800000000' }]);
    api.createCrmActivity.mockResolvedValue({ id: 'new' });
    api.getTeamMembers.mockResolvedValue([{ userId: 'user-1', name: 'Nayeem' }]);
    api.getMe.mockResolvedValue({ id: 'user-1', name: 'Nayeem', tenants: [{ id: 'tenant-1', name: 'Dhaka Electronics' }] });
    // No templates by default: every pre-existing case here asserts against a
    // dialog with no picker in it.
    api.getCrmMessageTemplates.mockResolvedValue([]);
});

/** Types into the picker and waits out the 300ms debounce. */
async function searchFor(text: string) {
    fireEvent.change(screen.getByPlaceholderText('Search by name or phone'), { target: { value: text } });
    await waitFor(() => expect(api.getLeads).toHaveBeenCalled());
}

describe('CrmActivityComposer — picking the target here instead of on the lead page', () => {
    it('will not save until a lead or customer is named', async () => {
        render(<CrmActivityComposer mode="schedule" onClose={jest.fn()} onSaved={jest.fn()} />);

        fireEvent.change(await screen.findByPlaceholderText(/Call about the outstanding/), {
            target: { value: 'Call Karim' },
        });

        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    /**
     * Leads and customers are two lists behind two endpoints; a salesperson knows
     * the name, not which table it is in, so both are searched and each hit says
     * which it came from.
     */
    it('searches leads and customers together, labelling which is which', async () => {
        render(<CrmActivityComposer mode="schedule" onClose={jest.fn()} onSaved={jest.fn()} />);
        await searchFor('Karim');

        const lead = await screen.findByRole('button', { name: /Karim Traders/ });
        const customer = screen.getByRole('button', { name: /Karim Store/ });
        expect(lead).toHaveTextContent('Lead');
        expect(customer).toHaveTextContent('Customer');
    });

    it('does not search on a single character, which would match most of the book', async () => {
        render(<CrmActivityComposer mode="schedule" onClose={jest.fn()} onSaved={jest.fn()} />);

        fireEvent.change(screen.getByPlaceholderText('Search by name or phone'), { target: { value: 'K' } });

        expect(screen.getByText('Type at least 2 characters.')).toBeInTheDocument();
        await waitFor(() => expect(api.getLeads).not.toHaveBeenCalled());
    });

    it('files a scheduled activity against the chosen lead', async () => {
        const onSaved = jest.fn();
        render(<CrmActivityComposer mode="schedule" onClose={jest.fn()} onSaved={onSaved} />);
        await searchFor('Karim');

        fireEvent.click(await screen.findByRole('button', { name: /Karim Traders/ }));
        fireEvent.change(screen.getByPlaceholderText(/Call about the outstanding/), {
            target: { value: 'Call Karim' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createCrmActivity).toHaveBeenCalled());
        expect(api.createCrmActivity.mock.calls[0][0]).toEqual(
            expect.objectContaining({ lead_id: 'lead-1', subject: 'Call Karim' }),
        );
        expect(api.createCrmActivity.mock.calls[0][0]).not.toHaveProperty('customer_id');
        expect(onSaved).toHaveBeenCalled();
    });

    it('files a logged activity against the chosen customer, already done', async () => {
        render(<CrmActivityComposer mode="log" onClose={jest.fn()} onSaved={jest.fn()} />);
        await searchFor('Karim');

        fireEvent.click(await screen.findByRole('button', { name: /Karim Store/ }));
        fireEvent.change(screen.getByPlaceholderText(/Spoke to Karim/), {
            target: { value: 'Rang about the invoice' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createCrmActivity).toHaveBeenCalled());
        expect(api.createCrmActivity.mock.calls[0][0]).toEqual(
            expect.objectContaining({ customer_id: 'cust-1', status: 'DONE', channel: 'ch-call' }),
        );
    });

    it('lets the chosen target be swapped back out', async () => {
        render(<CrmActivityComposer mode="schedule" onClose={jest.fn()} onSaved={jest.fn()} />);
        await searchFor('Karim');
        fireEvent.click(await screen.findByRole('button', { name: /Karim Traders/ }));

        fireEvent.click(screen.getByRole('button', { name: 'Change' }));

        expect(screen.getByPlaceholderText('Search by name or phone')).toHaveValue('');
    });
});

describe('CrmActivityComposer — opened from a record that already knows its target', () => {
    it('shows no picker and posts straight against the given lead', async () => {
        render(
            <CrmActivityComposer
                mode="schedule"
                target={{ lead_id: 'lead-9' }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        expect(screen.queryByPlaceholderText('Search by name or phone')).not.toBeInTheDocument();

        fireEvent.change(await screen.findByPlaceholderText(/Call about the outstanding/), {
            target: { value: 'Call Karim' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createCrmActivity).toHaveBeenCalled());
        expect(api.createCrmActivity.mock.calls[0][0]).toEqual(
            expect.objectContaining({ lead_id: 'lead-9' }),
        );
    });

    it('opens the log form on the channel the AI drafter used', async () => {
        render(
            <CrmActivityComposer
                mode="log"
                target={{ lead_id: 'lead-9' }}
                draft={{ channelCode: 'CALL', summary: 'Drafted by AI' }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        expect(await screen.findByDisplayValue('Drafted by AI')).toBeInTheDocument();
    });
});

describe('CrmActivityComposer — picking a message template', () => {
    beforeEach(() => {
        api.getCrmMessageTemplates.mockResolvedValue([REMINDER]);
    });

    /** No templates configured means no picker — not an empty select to squint at. */
    it('shows no picker when the tenant has no templates', async () => {
        api.getCrmMessageTemplates.mockResolvedValue([]);
        render(
            <CrmActivityComposer
                mode="log"
                target={{ lead_id: 'lead-9' }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await screen.findByPlaceholderText(/Spoke to Karim/);
        expect(screen.queryByLabelText('Message template')).not.toBeInTheDocument();
    });

    it('fills the log summary, resolving the placeholders against the target', async () => {
        render(
            <CrmActivityComposer
                mode="log"
                target={{ lead_id: 'lead-9' }}
                targetLabel={{ name: 'Karim Traders', phone: '01700000000' }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        fireEvent.change(await screen.findByLabelText('Message template'), {
            target: { value: 'tpl-1' },
        });

        expect(await screen.findByDisplayValue(
            'Dear Karim Traders, your invoice is outstanding. — Nayeem, Dhaka Electronics',
        )).toBeInTheDocument();
    });

    /**
     * The channel is the rep's assertion about what actually happened; the
     * template list narrows to it, not the other way round.
     */
    it('leaves the channel alone and re-narrows the list when it changes', async () => {
        api.getLeadTaxonomy.mockImplementation((kind: string) =>
            Promise.resolve(
                kind === 'channels'
                    ? [...CHANNELS, { id: 'ch-wa', code: 'WHATSAPP', name: 'WhatsApp', sort_order: 2, is_system: true, is_active: true }]
                    : PURPOSES,
            ),
        );
        render(
            <CrmActivityComposer
                mode="log"
                target={{ lead_id: 'lead-9' }}
                targetLabel={{ name: 'Karim Traders' }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        fireEvent.change(await screen.findByLabelText('Message template'), {
            target: { value: 'tpl-1' },
        });
        fireEvent.change(screen.getByLabelText(/^Channel/), { target: { value: 'ch-wa' } });

        await waitFor(() =>
            expect(api.getCrmMessageTemplates).toHaveBeenCalledWith({
                usage: 'LOG',
                channelId: 'ch-wa',
            }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.createCrmActivity).toHaveBeenCalled());
        expect(api.createCrmActivity.mock.calls[0][0]).toEqual(
            expect.objectContaining({ channel: 'ch-wa', status: 'DONE' }),
        );
    });

    it('fills subject, notes and purpose when scheduling', async () => {
        render(
            <CrmActivityComposer
                mode="schedule"
                target={{ lead_id: 'lead-9' }}
                targetLabel={{ name: 'Karim Traders' }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        fireEvent.change(await screen.findByLabelText('Message template'), {
            target: { value: 'tpl-1' },
        });
        await screen.findByDisplayValue('Chase Karim Traders on the invoice');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createCrmActivity).toHaveBeenCalled());
        expect(api.createCrmActivity.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                subject: 'Chase Karim Traders on the invoice',
                purpose: 'p-col',
                notes: 'Dear Karim Traders, your invoice is outstanding. — Nayeem, Dhaka Electronics',
            }),
        );
    });

    /**
     * `subject` is what the activity is listed under, so a template that carries
     * only a body still has to leave a title behind.
     */
    it('falls back to the template name when it has no subject of its own', async () => {
        api.getCrmMessageTemplates.mockResolvedValue([{ ...REMINDER, subject: null }]);
        render(
            <CrmActivityComposer
                mode="schedule"
                target={{ lead_id: 'lead-9' }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        fireEvent.change(await screen.findByLabelText('Message template'), {
            target: { value: 'tpl-1' },
        });

        expect(await screen.findByDisplayValue('Payment reminder')).toBeInTheDocument();
    });

    /** The log dialog asks only for what the channel it is on offers. */
    it('asks the server for the channel the log form is on', async () => {
        render(
            <CrmActivityComposer
                mode="log"
                target={{ lead_id: 'lead-9' }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await waitFor(() =>
            expect(api.getCrmMessageTemplates).toHaveBeenCalledWith({
                usage: 'LOG',
                channelId: 'ch-call',
            }),
        );
    });
});
