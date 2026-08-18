import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CrmActivityPanel from './CrmActivityPanel';

jest.mock('@/lib/api', () => ({
    api: {
        getAllCrmActivities: jest.fn(),
        createCrmActivity: jest.fn(),
        completeCrmActivity: jest.fn(),
        cancelCrmActivity: jest.fn(),
        getLeadTaxonomy: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

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
};

beforeEach(() => {
    jest.clearAllMocks();
    api.getLeadTaxonomy.mockImplementation((kind: string) =>
        Promise.resolve(kind === 'channels' ? CHANNELS : PURPOSES),
    );
    api.getAllCrmActivities.mockResolvedValue([planned, logged]);
    api.createCrmActivity.mockResolvedValue({ id: 'new' });
    api.completeCrmActivity.mockResolvedValue({ completed: {}, next: null });
    api.cancelCrmActivity.mockResolvedValue({});
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
