import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AiChatWidget from './AiChatWidget';

jest.mock('@/lib/api', () => ({
    api: {
        aiChat: jest.fn(),
        getAiConversations: jest.fn(),
        getAiConversation: jest.fn(),
        deleteAiConversation: jest.fn(),
    },
}));

const { api } = jest.requireMock('@/lib/api') as {
    api: {
        aiChat: jest.Mock;
        getAiConversations: jest.Mock;
        getAiConversation: jest.Mock;
        deleteAiConversation: jest.Mock;
    };
};

function openPanel() {
    render(<AiChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask the business assistant' }));
}

function ask(question: string) {
    fireEvent.change(screen.getByPlaceholderText(/Ask about your sales/i), { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

function openHistory() {
    fireEvent.click(screen.getByRole('button', { name: 'Past conversations' }));
}

beforeEach(() => {
    api.aiChat.mockReset();
    api.getAiConversations.mockReset().mockResolvedValue([]);
    api.getAiConversation.mockReset();
    api.deleteAiConversation.mockReset().mockResolvedValue({ deleted: true });
    Element.prototype.scrollTo = jest.fn();
});

describe('AiChatWidget', () => {
    it('stays closed until the header button is clicked', () => {
        render(<AiChatWidget />);
        expect(screen.queryByPlaceholderText(/Ask about your sales/i)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Ask the business assistant' }));
        expect(screen.getByPlaceholderText(/Ask about your sales/i)).toBeInTheDocument();
    });

    it('offers starter questions and sends one when picked', async () => {
        api.aiChat.mockResolvedValue({
            conversation_id: 'conv-1',
            credits_used: 3,
            truncated: false,
            message: { id: 'm1', role: 'assistant', content: 'You sold ৳100.', created_at: '2026-07-21T10:00:00Z' },
        });
        openPanel();

        fireEvent.click(screen.getByText('How much did we sell last month?'));

        await waitFor(() =>
            expect(api.aiChat).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'How much did we sell last month?' }),
            ),
        );
        expect(await screen.findByText('You sold ৳100.')).toBeInTheDocument();
    });

    it('carries the conversation id into the next question', async () => {
        api.aiChat.mockResolvedValue({
            conversation_id: 'conv-9',
            credits_used: 1,
            truncated: false,
            message: { id: 'm1', role: 'assistant', content: 'ok', created_at: '2026-07-21T10:00:00Z' },
        });
        openPanel();

        ask('first');
        await screen.findByText('ok');
        ask('second');

        await waitFor(() => expect(api.aiChat).toHaveBeenCalledTimes(2));
        expect(api.aiChat.mock.calls[0][0].conversationId).toBeUndefined();
        expect(api.aiChat.mock.calls[1][0].conversationId).toBe('conv-9');
    });

    /** The trust affordance: an answer must show what it was derived from. */
    it('lists the tools behind an answer when the sources line is expanded', async () => {
        api.aiChat.mockResolvedValue({
            conversation_id: 'conv-1',
            credits_used: 5,
            truncated: false,
            message: {
                id: 'm1',
                role: 'assistant',
                content: 'Revenue was ৳12,000.',
                tool_calls: [{ name: 'sales_summary', args: { from: '2026-06-01', to: '2026-06-30' }, rowCount: 12 }],
                created_at: '2026-07-21T10:00:00Z',
            },
        });
        openPanel();
        ask('june revenue?');

        const toggle = await screen.findByRole('button', { name: /Sources \(1\)/ });
        expect(screen.queryByText('sales_summary')).not.toBeInTheDocument();

        fireEvent.click(toggle);
        expect(screen.getByRole('link', { name: 'sales_summary' })).toHaveAttribute(
            'href',
            '/sales/reports/summary',
        );
        expect(screen.getByText(/2026-06-01 → 2026-06-30, 12 rows/)).toBeInTheDocument();
    });

    /**
     * A web claim has no report page to link to, so the source itself is the only
     * thing that makes it auditable. It must reach the panel as a real link.
     */
    it('links the pages a web search actually read', async () => {
        api.aiChat.mockResolvedValue({
            conversation_id: 'conv-1',
            credits_used: 8,
            truncated: false,
            message: {
                id: 'm1',
                role: 'assistant',
                content: 'Coarse rice is about ৳58/kg wholesale.',
                tool_calls: [
                    {
                        name: 'web_search',
                        args: { query: 'wholesale rice price Bangladesh' },
                        urls: ['https://www.tbsnews.net/rice-prices'],
                    },
                ],
                created_at: '2026-07-21T10:00:00Z',
            },
        });
        openPanel();
        ask('what is rice going for wholesale?');

        fireEvent.click(await screen.findByRole('button', { name: /Sources \(1\)/ }));

        expect(screen.getByText(/“wholesale rice price Bangladesh”/)).toBeInTheDocument();
        // Shown by domain — the full URL does not fit a 380px panel.
        const link = screen.getByRole('link', { name: 'tbsnews.net' });
        expect(link).toHaveAttribute('href', 'https://www.tbsnews.net/rice-prices');
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });

    /** A refused search produced no data, so it is not a source. */
    it('leaves a refused tool call out of the sources list', async () => {
        api.aiChat.mockResolvedValue({
            conversation_id: 'conv-1',
            credits_used: 2,
            truncated: false,
            message: {
                id: 'm1',
                role: 'assistant',
                content: 'Let me check your reports instead.',
                tool_calls: [
                    { name: 'web_search', args: { query: 'our sales' }, error: 'use the report tools instead' },
                ],
                created_at: '2026-07-21T10:00:00Z',
            },
        });
        openPanel();
        ask('our sales on the web?');

        await screen.findByText('Let me check your reports instead.');
        expect(screen.queryByRole('button', { name: /Sources/ })).not.toBeInTheDocument();
    });

    it('shows a failed request inline in the thread rather than as a toast', async () => {
        api.aiChat.mockRejectedValue(new Error('AI credit limit reached'));
        openPanel();

        ask('anything');

        expect(await screen.findByText('AI credit limit reached')).toBeInTheDocument();
    });

    it('clears the thread and conversation id on "New chat"', async () => {
        api.aiChat.mockResolvedValue({
            conversation_id: 'conv-1',
            credits_used: 1,
            truncated: false,
            message: { id: 'm1', role: 'assistant', content: 'answer one', created_at: '2026-07-21T10:00:00Z' },
        });
        openPanel();
        ask('first');
        await screen.findByText('answer one');

        fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
        expect(screen.queryByText('answer one')).not.toBeInTheDocument();

        ask('second');
        await waitFor(() => expect(api.aiChat).toHaveBeenCalledTimes(2));
        expect(api.aiChat.mock.calls[1][0].conversationId).toBeUndefined();
    });

    describe('history', () => {
        const SUMMARY = {
            id: 'conv-old',
            title: 'How much did we sell in May?',
            created_at: '2026-06-01T09:00:00Z',
            updated_at: '2026-06-02T09:00:00Z',
            message_count: 4,
        };

        it('tells the user plainly when they have no past conversations', async () => {
            openPanel();
            openHistory();

            expect(await screen.findByText('No past conversations yet.')).toBeInTheDocument();
        });

        /**
         * The whole point of the feature: a thread survives a page reload, which
         * drops all local state. Loading it back must restore the messages.
         */
        it('loads a past conversation back into the thread', async () => {
            api.getAiConversations.mockResolvedValue([SUMMARY]);
            api.getAiConversation.mockResolvedValue({
                ...SUMMARY,
                messages: [
                    { id: 'm1', role: 'user', content: 'How much did we sell in May?', created_at: '2026-06-01T09:00:00Z' },
                    { id: 'm2', role: 'assistant', content: 'May revenue was ৳240,000.', created_at: '2026-06-01T09:00:05Z' },
                ],
            });
            openPanel();
            openHistory();

            fireEvent.click(await screen.findByText('How much did we sell in May?'));

            expect(await screen.findByText('May revenue was ৳240,000.')).toBeInTheDocument();
            // Back on the chat pane, not still in the list.
            expect(screen.getByPlaceholderText(/Ask about your sales/i)).toBeInTheDocument();
        });

        /** Reopening a thread must continue it, not fork a new one. */
        it('continues a reopened conversation instead of starting a fresh one', async () => {
            api.getAiConversations.mockResolvedValue([SUMMARY]);
            api.getAiConversation.mockResolvedValue({ ...SUMMARY, messages: [] });
            api.aiChat.mockResolvedValue({
                conversation_id: 'conv-old',
                credits_used: 1,
                truncated: false,
                message: { id: 'm9', role: 'assistant', content: 'ok', created_at: '2026-07-21T10:00:00Z' },
            });
            openPanel();
            openHistory();
            fireEvent.click(await screen.findByText('How much did we sell in May?'));

            await screen.findByPlaceholderText(/Ask about your sales/i);
            ask('and June?');

            await waitFor(() => expect(api.aiChat).toHaveBeenCalled());
            expect(api.aiChat.mock.calls[0][0].conversationId).toBe('conv-old');
        });

        it('requires a second click before deleting a conversation', async () => {
            api.getAiConversations.mockResolvedValue([SUMMARY]);
            openPanel();
            openHistory();

            fireEvent.click(await screen.findByRole('button', { name: 'Delete conversation' }));
            expect(api.deleteAiConversation).not.toHaveBeenCalled();

            fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
            await waitFor(() => expect(api.deleteAiConversation).toHaveBeenCalledWith('conv-old'));
            await waitFor(() => expect(screen.queryByText('How much did we sell in May?')).not.toBeInTheDocument());
        });

        it('surfaces a failed history load in the panel', async () => {
            api.getAiConversations.mockRejectedValue(new Error('boom'));
            openPanel();
            openHistory();

            expect(await screen.findByText('Could not load your conversations.')).toBeInTheDocument();
        });
    });
});
