import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient } from '@/test-utils/query-client';
import ApprovalsInboxPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getApprovalsInbox: jest.fn(),
        getMe: jest.fn(),
        setCrmActivityApproval: jest.fn(),
        completeCrmActivity: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const ready = {
    id: 'a-ready',
    subject: 'LinkedIn follow-up DRAFT — review before send',
    notes: 'Hello from the draft that is waiting on a reviewer.',
    due_at: '2026-01-02T00:00:00.000Z',
    is_approved: false,
    lead: { id: 'lead-a', name: 'Amina', grade: 'A' },
    history: [{
        id: 'h1',
        subject: 'Connection request sent',
        summary: null,
        outcome: null,
        notes: null,
        channel_code: 'LINKEDIN',
        direction: 'OUTBOUND',
        status: 'DONE',
        completed_at: '2025-12-01T00:00:00.000Z',
    }],
};

const alreadyDmd = {
    id: 'a-dmd',
    subject: 'LinkedIn follow-up DRAFT — review before send',
    notes: 'Second draft body.',
    due_at: '2026-01-03T00:00:00.000Z',
    is_approved: false,
    lead: { id: 'lead-b', name: 'Bashir', grade: 'Grade A' },
    history: [{
        id: 'h2',
        subject: null,
        summary: 'Sent a LinkedIn DM',
        outcome: null,
        notes: null,
        channel_code: 'LINKEDIN',
        direction: 'OUTBOUND',
        status: 'DONE',
        completed_at: '2026-01-01T00:00:00.000Z',
    }],
};

const gradeB = {
    id: 'a-b',
    subject: 'LinkedIn follow-up DRAFT — review before send',
    notes: 'Grade B draft.',
    due_at: '2026-01-04T00:00:00.000Z',
    is_approved: false,
    lead: { id: 'lead-c', name: 'Chitra', grade: 'B' },
    history: [],
};

const asReviewer = () => api.getMe.mockResolvedValue({
    id: 'user-1',
    tenants: [{
        id: 'tenant-1',
        role: 'MANAGER',
        permissions: ['APPROVE_CRM_ACTIVITY', 'CREATE_CRM_INTERACTIONS'],
    }],
});

function cursorRow(): HTMLElement {
    const row = document.querySelector('tr[data-cursor="true"]');
    if (!row) throw new Error('no cursor row');
    return row as HTMLElement;
}

describe('Approvals Inbox', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getApprovalsInbox.mockResolvedValue({ items: [ready, alreadyDmd, gradeB] });
        api.getMe.mockResolvedValue({ id: 'user-1', tenants: [] });
        api.setCrmActivityApproval.mockResolvedValue({ id: 'a-ready', is_approved: true });
        api.completeCrmActivity.mockResolvedValue({ completed: {}, next: null });
    });

    it('starts on Grade A and counts the buckets from title and history', async () => {
        renderWithQueryClient(<ApprovalsInboxPage />);
        expect(await screen.findByText('Amina')).toBeInTheDocument();
        expect(screen.getByText('Bashir')).toBeInTheDocument();
        expect(screen.queryByText('Chitra')).not.toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Grade A only' })).toBeChecked();
        expect(screen.getByRole('button', { name: /Ready to send/ })).toHaveTextContent('1');
        expect(screen.getByRole('button', { name: /Already DMd/ })).toHaveTextContent('1');
        expect(screen.getByText('Connection request sent')).toBeInTheDocument();
        expect(screen.getByText('Sent a LinkedIn DM')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Grade A only' }));
        expect(screen.getByText('Chitra')).toBeInTheDocument();
    });

    it('opens the draft and history without leaving the page', async () => {
        renderWithQueryClient(<ApprovalsInboxPage />);
        fireEvent.click(await screen.findByText('Amina'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Hello from the draft that is waiting on a reviewer.')).toBeInTheDocument();
        expect(within(dialog).getByText('Connection request sent')).toBeInTheDocument();
        const openLead = within(dialog).getByRole('link', { name: /Open lead/ });
        expect(openLead).toHaveAttribute('href', '/crm/leads/lead-a');
        expect(openLead).toHaveAttribute('target', '_blank');
    });

    it('approves through the planned-activity flag', async () => {
        asReviewer();
        renderWithQueryClient(<ApprovalsInboxPage />);
        fireEvent.click(await screen.findByText('Amina'));
        const approve = await screen.findByRole('button', { name: 'Approve' });
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(api.setCrmActivityApproval).toHaveBeenCalledWith('a-ready', true));
    });

    it('completes on the LinkedIn channel with no next activity', async () => {
        asReviewer();
        renderWithQueryClient(<ApprovalsInboxPage />);
        fireEvent.click(await screen.findByText('Amina'));
        fireEvent.change(await screen.findByLabelText('What happened'), {
            target: { value: 'Skipped — invite still pending' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Skip / Complete' }));
        await waitFor(() => expect(api.completeCrmActivity).toHaveBeenCalledWith('a-ready', {
            channel: 'LINKEDIN',
            summary: 'Skipped — invite still pending',
        }));
        expect(api.completeCrmActivity.mock.calls[0][1]).not.toHaveProperty('next');
    });

    it('moves with J and does not fire shortcuts while typing', async () => {
        asReviewer();
        renderWithQueryClient(<ApprovalsInboxPage />);
        await screen.findByText('Amina');
        expect(cursorRow()).toHaveTextContent('Amina');

        fireEvent.keyDown(window, { key: 'j' });
        expect(cursorRow()).toHaveTextContent('Bashir');

        fireEvent.click(screen.getByText('Bashir'));
        const note = await screen.findByLabelText('What happened');
        fireEvent.keyDown(note, { key: 'a' });
        fireEvent.keyDown(note, { key: 'j' });
        expect(api.setCrmActivityApproval).not.toHaveBeenCalled();
        expect(cursorRow()).toHaveTextContent('Bashir');
    });

    it('confirms a shared complete note for the selection, and refuses more than 20', async () => {
        asReviewer();
        const first = renderWithQueryClient(<ApprovalsInboxPage />);
        await screen.findByText('Amina');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Amina' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bashir' }));
        const completeSelected = await screen.findByRole('button', { name: 'Complete selected' });
        await waitFor(() => expect(completeSelected).toBeEnabled());
        fireEvent.click(completeSelected);
        fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Not sending' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        await waitFor(() => expect(api.completeCrmActivity).toHaveBeenCalledTimes(2));
        for (const call of api.completeCrmActivity.mock.calls) {
            expect(call[1]).toEqual({ channel: 'LINKEDIN', summary: 'Not sending' });
            expect(call[1]).not.toHaveProperty('next');
        }
        first.unmount();

        const many = Array.from({ length: 21 }, (_, index) => ({
            ...ready,
            id: `many-${index}`,
            lead: { id: `lead-${index}`, name: `Lead ${index}`, grade: 'A' },
        }));
        api.getApprovalsInbox.mockResolvedValue({ items: many });
        renderWithQueryClient(<ApprovalsInboxPage />);
        await screen.findByText('Lead 0');
        for (let index = 0; index < 21; index += 1) {
            fireEvent.click(screen.getByRole('checkbox', { name: `Select Lead ${index}` }));
        }
        expect(screen.getByText('A batch can include at most 20.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve selected' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Complete selected' })).toBeDisabled();
    });

    it('confirms approve-selected with Enter', async () => {
        asReviewer();
        renderWithQueryClient(<ApprovalsInboxPage />);
        await screen.findByText('Amina');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Amina' }));
        const approveSelected = await screen.findByRole('button', { name: 'Approve selected' });
        await waitFor(() => expect(approveSelected).toBeEnabled());
        fireEvent.click(approveSelected);
        fireEvent.keyDown(document.body, { key: 'Enter' });
        await waitFor(() => expect(api.setCrmActivityApproval).toHaveBeenCalledWith('a-ready', true));
    });
});
