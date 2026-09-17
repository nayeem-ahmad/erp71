import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SupportPage from './page';
import { useToastStore } from '@/lib/toast';
import type { StreamHandlers } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getSupportThreads: jest.fn(),
        getSupportMessages: jest.fn(),
        sendSupportMessage: jest.fn(),
        createSupportThread: jest.fn(),
        openSupportStream: jest.fn(),
    },
}));

jest.mock('@/contexts/PlatformFeaturesContext', () => ({
    usePlatformFeatures: () => ({ support: true, feedback: true }),
}));

jest.mock('@/components/SupportComposer', () => {
    const MockComposer = () => null;
    MockComposer.displayName = 'SupportComposer';
    return MockComposer;
});

const thread = {
    id: 'thr-1',
    ticketNumber: 12,
    subject: 'POS will not print',
    status: 'open',
    category: 'support',
    page: '/pos',
    feedbackId: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    messageCount: 1,
    lastMessage: { body: 'The printer does nothing', senderRole: 'owner', createdAt: '2026-09-01T10:00:00.000Z' },
};

const messagesPayload = (status: string) => ({
    thread: {
        id: thread.id,
        ticketNumber: thread.ticketNumber,
        subject: thread.subject,
        status,
        category: 'support',
        page: '/pos',
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

/** The two panes carry the phone layout — one at a time below `md`, both from `md` up. */
const threadListPane = () => screen.getByTestId('thread-list-pane');
const conversationPane = () => screen.getByTestId('conversation-pane');

/** The frame pump the page was handed, so a test can act like the backend. */
let stream: StreamHandlers;

describe('SupportPage', () => {
    beforeEach(() => {
        // jsdom has no layout, so the scroll-to-latest effect needs a stand-in.
        Element.prototype.scrollIntoView = jest.fn();
        useToastStore.setState({ toasts: [] });
        const { api } = require('@/lib/api');
        api.getSupportThreads.mockResolvedValue([thread]);
        api.getSupportMessages.mockResolvedValue(messagesPayload('open'));
        api.sendSupportMessage.mockResolvedValue({});
        // Connected from the start, so the fallback poll stays at its slow
        // cadence and cannot fire inside a test that drives fake timers.
        api.openSupportStream.mockImplementation((handlers: StreamHandlers) => {
            stream = handlers;
            handlers.onConnected?.(true);
            handlers.onFrame({ event: 'ready', data: { at: '2026-09-01T10:00:00.000Z' } });
            return jest.fn();
        });
        window.history.replaceState({}, '', '/support');
    });

    const phoneMatchMedia = window.matchMedia;

    afterEach(() => {
        window.matchMedia = phoneMatchMedia;
        jest.clearAllMocks();
    });

    const openThread = async () => {
        render(<SupportPage />);
        const row = await screen.findByText('POS will not print');
        fireEvent.click(row);
        await screen.findByRole('button', { name: 'Back' });
    };

    it('shows the list and keeps the conversation off a phone screen until a thread is picked', async () => {
        render(<SupportPage />);
        await screen.findByText('POS will not print');

        expect(threadListPane()).toHaveClass('flex');
        expect(threadListPane()).not.toHaveClass('hidden');
        // `hidden md:flex` — the empty "pick a conversation" pane is desktop-only.
        expect(conversationPane()).toHaveClass('hidden', 'md:flex');
    });

    it('swaps the list for the conversation once a thread is open, and back again', async () => {
        await openThread();

        expect(threadListPane()).toHaveClass('hidden', 'md:flex');
        expect(conversationPane()).toHaveClass('flex');
        expect(within(conversationPane()).getByText('The printer does nothing')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        await waitFor(() => expect(threadListPane()).toHaveClass('flex'));
        expect(threadListPane()).not.toHaveClass('hidden');
        expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    });

    it('shows each ticket by its number, in the list and in the conversation', async () => {
        await openThread();

        expect(within(threadListPane()).getByText('#12')).toBeInTheDocument();
        // The same number the platform admin sees, so a phone call about
        // "ticket 12" lands on the same thread on both screens.
        expect(within(conversationPane()).getByText('Ticket #12')).toBeInTheDocument();
    });

    it('sends the typed term to the API once typing settles', async () => {
        jest.useFakeTimers();
        try {
            const { api } = require('@/lib/api');
            render(<SupportPage />);
            await waitFor(() => expect(api.getSupportThreads).toHaveBeenCalledTimes(1));

            fireEvent.change(screen.getByPlaceholderText('Search conversations…'), {
                target: { value: 'print' },
            });
            // Debounced — a request per keystroke is exactly what this avoids.
            expect(api.getSupportThreads).toHaveBeenCalledTimes(1);

            await act(async () => {
                jest.advanceTimersByTime(300);
            });
            await waitFor(() =>
                expect(api.getSupportThreads).toHaveBeenLastCalledWith({
                    search: 'print',
                    status: undefined,
                    category: undefined,
                }),
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it('refetches the moment a dropdown changes', async () => {
        const { api } = require('@/lib/api');
        render(<SupportPage />);
        await screen.findByText('POS will not print');

        fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'resolved' } });
        await waitFor(() =>
            expect(api.getSupportThreads).toHaveBeenLastCalledWith({
                search: undefined,
                status: 'resolved',
                category: undefined,
            }),
        );

        fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'bug' } });
        await waitFor(() =>
            expect(api.getSupportThreads).toHaveBeenLastCalledWith({
                search: undefined,
                status: 'resolved',
                category: 'bug',
            }),
        );
    });

    it('hides the dropdowns behind a toggle on a phone and counts what is set', async () => {
        render(<SupportPage />);
        await screen.findByText('POS will not print');

        expect(screen.getByTestId('thread-filters')).toHaveClass('max-md:hidden');

        const toggle = screen.getByRole('button', { name: 'Filters' });
        fireEvent.click(toggle);
        expect(screen.getByTestId('thread-filters')).not.toHaveClass('max-md:hidden');

        // A collapsed filter row is easy to mistake for an empty list, so the toggle shows the count.
        fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'resolved' } });
        await waitFor(() => expect(toggle).toHaveTextContent('1'));
    });

    it('tells a filtered-to-nothing list apart from a shop that has never written in', async () => {
        const { api } = require('@/lib/api');
        render(<SupportPage />);
        await screen.findByText('POS will not print');

        api.getSupportThreads.mockResolvedValue([]);
        fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'resolved' } });

        const clear = await screen.findByRole('button', { name: 'Clear filters' });
        expect(screen.getByText('No conversations match these filters.')).toBeInTheDocument();

        api.getSupportThreads.mockResolvedValue([thread]);
        fireEvent.click(clear);
        await waitFor(() =>
            expect(api.getSupportThreads).toHaveBeenLastCalledWith({
                search: undefined,
                status: undefined,
                category: undefined,
            }),
        );
    });

    it('keeps Enter a newline on a phone, where it is the only one the soft keyboard has', async () => {
        const { api } = require('@/lib/api');
        await openThread();

        const box = screen.getByPlaceholderText('Type a message…');
        fireEvent.change(box, { target: { value: 'Still stuck' } });
        fireEvent.keyDown(box, { key: 'Enter' });

        expect(api.sendSupportMessage).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        await waitFor(() => expect(api.sendSupportMessage).toHaveBeenCalledWith('thr-1', 'Still stuck'));
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

        render(<SupportPage />);
        const row = await screen.findByText('POS will not print');
        fireEvent.click(row);

        const box = await screen.findByPlaceholderText('Type a message… (Enter to send)');
        fireEvent.change(box, { target: { value: 'Still stuck' } });
        fireEvent.keyDown(box, { key: 'Enter' });

        await waitFor(() => expect(api.sendSupportMessage).toHaveBeenCalledWith('thr-1', 'Still stuck'));
    });

    it('shows a thread resolved on the admin side without a refresh', async () => {
        const { api } = require('@/lib/api');
        await openThread();
        expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument();

        // The admin resolves it: the API now answers "resolved", and the stream
        // says so at the same moment.
        api.getSupportMessages.mockResolvedValue(messagesPayload('resolved'));
        api.getSupportThreads.mockResolvedValue([{ ...thread, status: 'resolved' }]);
        await act(async () => {
            stream.onFrame({
                event: 'status',
                data: {
                    kind: 'status',
                    threadId: 'thr-1',
                    ticketNumber: 12,
                    status: 'resolved',
                    actor: 'admin',
                    at: '2026-09-01T10:05:00.000Z',
                },
            });
        });

        await waitFor(() =>
            expect(within(conversationPane()).getByText('Resolved')).toBeInTheDocument(),
        );
        expect(screen.queryByPlaceholderText('Type a message…')).not.toBeInTheDocument();
        expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual([
            'Support marked ticket #12 as resolved.',
        ]);
    });

    it('says which ticket was reopened', async () => {
        await openThread();

        await act(async () => {
            stream.onFrame({
                event: 'status',
                data: {
                    kind: 'status',
                    threadId: 'thr-1',
                    ticketNumber: 12,
                    status: 'open',
                    actor: 'admin',
                    at: '2026-09-01T10:05:00.000Z',
                },
            });
        });

        expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual([
            'Ticket #12 was reopened.',
        ]);
    });

    it('re-reads the open thread when a reply arrives, and does not announce it', async () => {
        const { api } = require('@/lib/api');
        await openThread();
        const readsBefore = api.getSupportMessages.mock.calls.length;

        await act(async () => {
            stream.onFrame({
                event: 'message',
                data: {
                    kind: 'message',
                    threadId: 'thr-1',
                    ticketNumber: 12,
                    status: 'open',
                    actor: 'admin',
                    at: '2026-09-01T10:05:00.000Z',
                },
            });
        });

        // The reply lands in the conversation on screen, which is announcement
        // enough — a toast on top of it would be noise.
        expect(api.getSupportMessages.mock.calls.length).toBeGreaterThan(readsBefore);
        expect(useToastStore.getState().toasts).toEqual([]);
    });

    it('announces a reply on a ticket that is not the one being read', async () => {
        await openThread();

        await act(async () => {
            stream.onFrame({
                event: 'message',
                data: {
                    kind: 'message',
                    threadId: 'thr-2',
                    ticketNumber: 13,
                    status: 'open',
                    actor: 'admin',
                    at: '2026-09-01T10:05:00.000Z',
                },
            });
        });

        expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual([
            'New reply on ticket #13.',
        ]);
    });

    it('ignores the server’s hello frame', async () => {
        render(<SupportPage />);
        await screen.findByText('POS will not print');
        // `ready` carries no thread; treating it as an event would toast on
        // every reconnect.
        expect(useToastStore.getState().toasts).toEqual([]);
    });
});
