import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminSupportPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getAdminSupportThreads: jest.fn(),
        getAdminSupportFilters: jest.fn(),
        getAdminSupportMessages: jest.fn(),
        sendAdminSupportMessage: jest.fn(),
        resolveThread: jest.fn(),
        reopenThread: jest.fn(),
    },
}));

jest.mock('@/components/admin/FeedbackAutomationPanel', () => {
    const MockPanel = () => null;
    MockPanel.displayName = 'FeedbackAutomationPanel';
    return MockPanel;
});

const thread = {
    id: 'thr-1',
    ticketNumber: 12,
    subject: 'POS will not print',
    status: 'open',
    category: 'support',
    page: '/pos',
    feedbackId: null,
    tenantId: 'ten-1',
    tenant: 'Rahim Store',
    createdBy: { id: 'usr-1', name: 'Rahim', email: 'rahim@example.com' },
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    messageCount: 1,
    lastMessage: { body: 'The printer does nothing', senderRole: 'owner', createdAt: '2026-09-01T10:00:00.000Z' },
};

/** The two panes carry the phone layout — one at a time below `md`, both from `md` up. */
const threadListPane = () => screen.getByTestId('thread-list-pane');
const conversationPane = () => screen.getByTestId('conversation-pane');

describe('AdminSupportPage', () => {
    beforeEach(() => {
        // jsdom has no layout, so the scroll-to-latest effect needs a stand-in.
        Element.prototype.scrollIntoView = jest.fn();
        const { api } = require('@/lib/api');
        api.getAdminSupportThreads.mockResolvedValue({ data: [thread], total: 1 });
        api.getAdminSupportFilters.mockResolvedValue({ tenants: [], users: [] });
        api.getAdminSupportMessages.mockResolvedValue({
            thread: {
                ticketNumber: thread.ticketNumber,
                subject: thread.subject,
                status: 'open',
                tenant: thread.tenant,
                tenantId: thread.tenantId,
                createdBy: thread.createdBy,
                category: 'support',
                page: '/pos',
                feedbackId: null,
            },
            messages: [
                {
                    id: 'msg-1',
                    senderRole: 'owner',
                    senderName: 'Rahim',
                    body: 'The printer does nothing',
                    createdAt: '2026-09-01T10:00:00.000Z',
                },
            ],
        });
        api.sendAdminSupportMessage.mockResolvedValue({});
        window.history.replaceState({}, '', '/admin/support');
    });

    const phoneMatchMedia = window.matchMedia;

    afterEach(() => {
        window.matchMedia = phoneMatchMedia;
        jest.clearAllMocks();
    });

    const openThread = async () => {
        render(<AdminSupportPage />);
        const row = await screen.findByText('POS will not print');
        fireEvent.click(row);
        await screen.findByRole('button', { name: 'Back' });
    };

    it('shows the inbox and keeps the conversation off a phone screen until a thread is picked', async () => {
        render(<AdminSupportPage />);
        await screen.findByText('POS will not print');

        expect(threadListPane()).toHaveClass('flex');
        expect(threadListPane()).not.toHaveClass('hidden');
        // `hidden md:flex` — the empty "pick a thread" pane is desktop-only.
        expect(conversationPane()).toHaveClass('hidden', 'md:flex');
    });

    it('shows each thread by its ticket number, in the list and in the conversation', async () => {
        await openThread();

        expect(within(threadListPane()).getByText('#12')).toBeInTheDocument();
        // The same number the shop owner sees, so a phone call about "ticket 12"
        // lands on the same thread on both screens.
        expect(within(conversationPane()).getByText('Ticket #12')).toBeInTheDocument();
    });

    it('searches by ticket number as well as by subject', async () => {
        const { api } = require('@/lib/api');
        render(<AdminSupportPage />);
        await screen.findByText('POS will not print');

        fireEvent.change(screen.getByPlaceholderText('Search by ticket # or subject…'), {
            target: { value: '#12' },
        });

        await waitFor(() =>
            expect(api.getAdminSupportThreads).toHaveBeenCalledWith(
                expect.objectContaining({ search: '#12' }),
            ),
        );
    });

    it('swaps the inbox for the conversation once a thread is open', async () => {
        await openThread();

        expect(threadListPane()).toHaveClass('hidden', 'md:flex');
        expect(conversationPane()).toHaveClass('flex');
        expect(conversationPane()).not.toHaveClass('hidden');
        expect(within(conversationPane()).getByText('The printer does nothing')).toBeInTheDocument();
    });

    it('puts the inbox back when the phone-only back button is used', async () => {
        await openThread();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        await waitFor(() => expect(threadListPane()).toHaveClass('flex'));
        expect(threadListPane()).not.toHaveClass('hidden');
        expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    });

    it('keeps Enter a newline on a phone, where it is the only one the soft keyboard has', async () => {
        const { api } = require('@/lib/api');
        await openThread();

        const box = screen.getByPlaceholderText('Type your reply…');
        fireEvent.change(box, { target: { value: 'On our way' } });
        fireEvent.keyDown(box, { key: 'Enter' });

        expect(api.sendAdminSupportMessage).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
        await waitFor(() =>
            expect(api.sendAdminSupportMessage).toHaveBeenCalledWith('thr-1', 'On our way'),
        );
    });

    it('still sends on Enter at a keyboard, where Shift+Enter is the newline', async () => {
        const { api } = require('@/lib/api');
        // `useIsMdUp` reads this — the shared setup answers `false` to every query.
        window.matchMedia = jest.fn().mockImplementation((query: string) => ({
            matches: query === '(min-width: 768px)',
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        })) as unknown as typeof window.matchMedia;

        await openThread();

        const box = screen.getByPlaceholderText('Type your reply…');
        fireEvent.change(box, { target: { value: 'On our way' } });
        fireEvent.keyDown(box, { key: 'Enter' });

        await waitFor(() =>
            expect(api.sendAdminSupportMessage).toHaveBeenCalledWith('thr-1', 'On our way'),
        );
    });

    it('hides the dropdowns behind a toggle on a phone and counts what is set', async () => {
        render(<AdminSupportPage />);
        await screen.findByText('POS will not print');

        expect(screen.getByTestId('thread-filters')).toHaveClass('max-md:hidden');

        const toggle = screen.getByRole('button', { name: 'Filters' });
        fireEvent.click(toggle);
        expect(screen.getByTestId('thread-filters')).not.toHaveClass('max-md:hidden');

        // A collapsed filter row is easy to mistake for an empty inbox, so the toggle shows the count.
        const statusSelect = screen.getAllByRole('combobox')[0];
        fireEvent.change(statusSelect, { target: { value: 'resolved' } });
        await waitFor(() => expect(toggle).toHaveTextContent('1'));
    });
});
