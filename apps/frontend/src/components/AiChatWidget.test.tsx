import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AiChatWidget from './AiChatWidget';

jest.mock('@/lib/api', () => ({
    api: { aiChat: jest.fn() },
}));

const { api } = jest.requireMock('@/lib/api') as { api: { aiChat: jest.Mock } };

function openPanel() {
    render(<AiChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask the business assistant' }));
}

function ask(question: string) {
    fireEvent.change(screen.getByPlaceholderText(/Ask about your sales/i), { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => {
    api.aiChat.mockReset();
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
});
