import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SupportPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getSupportThreads: jest.fn(),
        getSupportMessages: jest.fn(),
        sendSupportMessage: jest.fn(),
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

/** The two panes carry the phone layout — one at a time below `md`, both from `md` up. */
const threadListPane = () => screen.getByTestId('thread-list-pane');
const conversationPane = () => screen.getByTestId('conversation-pane');

describe('SupportPage', () => {
    beforeEach(() => {
        // jsdom has no layout, so the scroll-to-latest effect needs a stand-in.
        Element.prototype.scrollIntoView = jest.fn();
        const { api } = require('@/lib/api');
        api.getSupportThreads.mockResolvedValue([thread]);
        api.getSupportMessages.mockResolvedValue({
            thread: { subject: thread.subject, status: 'open', category: 'support', page: '/pos' },
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
        api.sendSupportMessage.mockResolvedValue({});
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
});
