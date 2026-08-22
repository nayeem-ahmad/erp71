import { render, screen } from '@testing-library/react';
import { mockUseI18n } from '@/test-utils/i18n';
import MessageThread from './MessageThread';
import type { ChatMessage } from './types';

jest.mock('@/lib/i18n', () => ({
    useI18n: () => mockUseI18n(),
    formatMessage: (template: string) => template,
}));

// jsdom has no layout, so the auto-scroll-to-newest effect has nothing to call.
beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
});

const message = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
    conversationId: 'conv-1',
    kind: 'text',
    body: over.id,
    deleted: false,
    editedAt: null,
    createdAt: '2026-08-22T09:00:00.000Z',
    sender: { id: 'user-1', name: 'Karim', email: 'k@x.com', avatarUrl: null },
    attachments: [],
    ...over,
});

function renderThread(seenMessageId: string | null) {
    return render(
        <MessageThread
            messages={[message({ id: 'older' }), message({ id: 'newer' })]}
            currentUserId="user-1"
            seenMessageId={seenMessageId}
            loading={false}
            hasMore={false}
            loadingMore={false}
            onLoadMore={jest.fn()}
            onEdit={jest.fn()}
            onDelete={jest.fn()}
        />,
    );
}

describe('MessageThread read receipt', () => {
    it('marks only the message it was given, not every own message', () => {
        renderThread('older');
        const labels = screen.getAllByText(/^Seen$/);
        expect(labels).toHaveLength(1);
        // The label belongs to the bubble it was told about — putting it on the
        // newest message regardless would read as "they have seen everything".
        expect(labels[0].closest('li')).toHaveTextContent('older');
    });

    it('shows nothing when the other side has not read anything yet', () => {
        renderThread(null);
        expect(screen.queryByText(/^Seen$/)).not.toBeInTheDocument();
    });
});
