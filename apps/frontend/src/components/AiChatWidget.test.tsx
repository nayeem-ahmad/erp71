import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AiChatWidget from './AiChatWidget';

jest.mock('@/lib/api', () => ({
    api: {
        aiChat: jest.fn(),
        getAiConversations: jest.fn(),
        getAiConversation: jest.fn(),
        deleteAiConversation: jest.fn(),
        getAiChatTools: jest.fn(),
    },
}));

const { api } = jest.requireMock('@/lib/api') as {
    api: {
        aiChat: jest.Mock;
        getAiConversations: jest.Mock;
        getAiConversation: jest.Mock;
        deleteAiConversation: jest.Mock;
        getAiChatTools: jest.Mock;
    };
};

/**
 * Opening the panel kicks off the capability probe. Awaiting it here keeps that
 * state update inside act() for every test, not just the ones that assert on it.
 */
async function openPanel() {
    render(<AiChatWidget />);
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Ask the business assistant' }));
    });
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
    api.getAiChatTools.mockReset().mockResolvedValue({ tools: ['sales_summary'] });
    Element.prototype.scrollTo = jest.fn();
});

describe('AiChatWidget', () => {
    it('stays closed until the header button is clicked', async () => {
        render(<AiChatWidget />);
        expect(screen.queryByPlaceholderText(/Ask about your sales/i)).not.toBeInTheDocument();
        // Closed means closed: no capability probe until the user opens it.
        expect(api.getAiChatTools).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Ask the business assistant' }));
        });
        expect(screen.getByPlaceholderText(/Ask about your sales/i)).toBeInTheDocument();
    });

    it('offers starter questions and sends one when picked', async () => {
        api.aiChat.mockResolvedValue({
            conversation_id: 'conv-1',
            credits_used: 3,
            truncated: false,
            message: { id: 'm1', role: 'assistant', content: 'You sold ৳100.', created_at: '2026-07-21T10:00:00Z' },
        });
        await openPanel();

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
        await openPanel();

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
        await openPanel();
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
        await openPanel();
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
        await openPanel();
        ask('our sales on the web?');

        await screen.findByText('Let me check your reports instead.');
        expect(screen.queryByRole('button', { name: /Sources/ })).not.toBeInTheDocument();
    });

    /**
     * The panel describes its own reach, and the backend decides that reach: web
     * tools are withheld unless the platform operator enabled them. Promising web
     * lookups the model was never given is the failure this guards.
     */
    describe('capability wording', () => {
        it('says answers are data-only when web search is not offered', async () => {
            api.getAiChatTools.mockResolvedValue({ tools: ['sales_summary', 'low_stock'] });
            await openPanel();

            expect(await screen.findByText(/Answers come from your own data\./)).toBeInTheDocument();
            // Data + how-to, but no web mention when the web tools are not offered.
            expect(screen.getByText(/explain how to use the app/)).toBeInTheDocument();
            expect(screen.queryByText(/search the web/)).not.toBeInTheDocument();
        });

        it('mentions the web once the web tools are offered', async () => {
            api.getAiChatTools.mockResolvedValue({ tools: ['sales_summary', 'web_search', 'fetch_web_page'] });
            await openPanel();

            expect(await screen.findByText(/and from the web when a question needs it/)).toBeInTheDocument();
            expect(screen.getByText(/search the web/)).toBeInTheDocument();
        });

        /** Wrong in the safe direction: no promise the model might not keep. */
        it('falls back to the data-only wording when the tool list cannot be loaded', async () => {
            api.getAiChatTools.mockRejectedValue(new Error('offline'));
            await openPanel();

            expect(await screen.findByText(/Answers come from your own data\./)).toBeInTheDocument();
        });
    });

    it('shows a failed request inline in the thread rather than as a toast', async () => {
        api.aiChat.mockRejectedValue(new Error('AI credit limit reached'));
        await openPanel();

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
        await openPanel();
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
            await openPanel();
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
            await openPanel();
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
            await openPanel();
            openHistory();
            fireEvent.click(await screen.findByText('How much did we sell in May?'));

            await screen.findByPlaceholderText(/Ask about your sales/i);
            ask('and June?');

            await waitFor(() => expect(api.aiChat).toHaveBeenCalled());
            expect(api.aiChat.mock.calls[0][0].conversationId).toBe('conv-old');
        });

        it('requires a second click before deleting a conversation', async () => {
            api.getAiConversations.mockResolvedValue([SUMMARY]);
            await openPanel();
            openHistory();

            fireEvent.click(await screen.findByRole('button', { name: 'Delete conversation' }));
            expect(api.deleteAiConversation).not.toHaveBeenCalled();

            fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
            await waitFor(() => expect(api.deleteAiConversation).toHaveBeenCalledWith('conv-old'));
            await waitFor(() => expect(screen.queryByText('How much did we sell in May?')).not.toBeInTheDocument());
        });

        it('surfaces a failed history load in the panel', async () => {
            api.getAiConversations.mockRejectedValue(new Error('boom'));
            await openPanel();
            openHistory();

            expect(await screen.findByText('Could not load your conversations.')).toBeInTheDocument();
        });
    });
});
