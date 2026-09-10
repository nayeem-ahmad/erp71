import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CrmMessageTemplatesPanel from './CrmMessageTemplatesPanel';

jest.mock('@/lib/api', () => ({
    api: {
        getCrmMessageTemplates: jest.fn(),
        createCrmMessageTemplate: jest.fn(),
        updateCrmMessageTemplate: jest.fn(),
        deleteCrmMessageTemplate: jest.fn(),
        getLeadTaxonomy: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const CHANNELS = [{ id: 'ch-wa', code: 'WHATSAPP', name: 'WhatsApp', sort_order: 1, is_system: true, is_active: true }];
const PURPOSES = [{ id: 'p-col', code: 'COLLECTION', name: 'Collection', sort_order: 1, is_system: true, is_active: true }];

const REMINDER = {
    id: 'tpl-1',
    name: 'Payment reminder',
    usage: 'BOTH' as const,
    subject: null,
    body: 'Dear {{name}}, your invoice is outstanding.',
    sort_order: 1,
    is_active: true,
    channel: { id: 'ch-wa', name: 'WhatsApp', icon: null },
    purpose: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    api.getLeadTaxonomy.mockImplementation((kind: string) =>
        Promise.resolve(kind === 'channels' ? CHANNELS : PURPOSES),
    );
    api.getCrmMessageTemplates.mockResolvedValue([REMINDER]);
    api.createCrmMessageTemplate.mockResolvedValue({ id: 'tpl-2' });
    api.updateCrmMessageTemplate.mockResolvedValue({ id: 'tpl-1' });
    api.deleteCrmMessageTemplate.mockResolvedValue({ success: true });
});

describe('CrmMessageTemplatesPanel', () => {
    /** Setup is the one place a retired template still has to be visible. */
    it('asks for the hidden templates too', async () => {
        render(<CrmMessageTemplatesPanel canManage />);

        await waitFor(() =>
            expect(api.getCrmMessageTemplates).toHaveBeenCalledWith({ includeInactive: true }),
        );
    });

    it('shows the whole message body, not a truncation', async () => {
        render(<CrmMessageTemplatesPanel canManage />);

        expect(await screen.findByText('Dear {{name}}, your invoice is outstanding.')).toBeInTheDocument();
    });

    it('offers no editing controls to someone who cannot manage CRM settings', async () => {
        render(<CrmMessageTemplatesPanel canManage={false} />);

        await screen.findByText('Payment reminder');
        expect(screen.queryByRole('button', { name: 'Add template' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    });

    it('will not save a template with no message', async () => {
        render(<CrmMessageTemplatesPanel canManage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add template' }));

        fireEvent.change(screen.getByLabelText(/Template name/), { target: { value: 'Thanks' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Message is required.')).toBeInTheDocument();
        expect(api.createCrmMessageTemplate).not.toHaveBeenCalled();
    });

    /**
     * "Any channel" has to reach the column as null — omitting the key would
     * leave a link the user just cleared standing.
     */
    it('sends an unset channel and purpose as null', async () => {
        render(<CrmMessageTemplatesPanel canManage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add template' }));

        fireEvent.change(screen.getByLabelText(/Template name/), { target: { value: 'Thanks' } });
        fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'Thank you {{name}}.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(api.createCrmMessageTemplate).toHaveBeenCalled());
        expect(api.createCrmMessageTemplate.mock.calls[0][0]).toEqual({
            name: 'Thanks',
            body: 'Thank you {{name}}.',
            subject: '',
            usage: 'BOTH',
            channel_id: null,
            purpose_id: null,
        });
    });

    /** A log-only template has no purpose or subject to set — the plan form has those. */
    it('drops the schedule-only fields when the template is log-only', async () => {
        render(<CrmMessageTemplatesPanel canManage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add template' }));

        expect(screen.getByLabelText(/^Subject/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Offer it in/), { target: { value: 'LOG' } });

        expect(screen.queryByLabelText(/^Subject/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/^Purpose/)).not.toBeInTheDocument();
    });

    it('reports a duplicate name in the field rather than a toast', async () => {
        api.createCrmMessageTemplate.mockRejectedValue(
            new Error('Message template "Payment reminder" already exists.'),
        );
        render(<CrmMessageTemplatesPanel canManage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add template' }));

        fireEvent.change(screen.getByLabelText(/Template name/), { target: { value: 'Payment reminder' } });
        fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'Anything.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    });

    it('hides a template without deleting it', async () => {
        render(<CrmMessageTemplatesPanel canManage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Hide from the picker' }));

        await waitFor(() =>
            expect(api.updateCrmMessageTemplate).toHaveBeenCalledWith('tpl-1', { is_active: false }),
        );
        expect(api.deleteCrmMessageTemplate).not.toHaveBeenCalled();
    });

    it('confirms before deleting one', async () => {
        render(<CrmMessageTemplatesPanel canManage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
        expect(api.deleteCrmMessageTemplate).not.toHaveBeenCalled();

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(api.deleteCrmMessageTemplate).toHaveBeenCalledWith('tpl-1'));
    });
});
