import { render, screen, fireEvent } from '@testing-library/react';
import { mockUseI18n } from '@/test-utils/i18n';
import ConversationList from './ConversationList';
import type { ChatConversation } from './types';

jest.mock('@/lib/i18n', () => ({
    useI18n: () => mockUseI18n(),
    formatMessage: (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce(
            (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
            template,
        ),
}));

const dm = (over: Partial<ChatConversation> = {}): ChatConversation => ({
    id: 'conv-1',
    kind: 'dm',
    title: 'Karim',
    archived: false,
    lastMessageAt: new Date().toISOString(),
    lastMessagePreview: 'See you at the shop',
    unreadCount: 0,
    participants: [
        { id: 'user-2', name: 'Karim', email: 'k@x.com', avatarUrl: null, role: 'admin' },
    ],
    ...over,
});

describe('ConversationList', () => {
    it('shows an empty state when there is nothing to list', () => {
        render(
            <ConversationList conversations={[]} activeId={null} loading={false} onSelect={jest.fn()} />,
        );
        expect(screen.getByText(/No conversations yet/i)).toBeInTheDocument();
    });

    it('shows the loading state only while the first load is in flight', () => {
        const { rerender } = render(
            <ConversationList conversations={[]} activeId={null} loading onSelect={jest.fn()} />,
        );
        expect(screen.getByText(/Loading conversations/i)).toBeInTheDocument();

        // Once rows exist a background poll must not blank the list.
        rerender(
            <ConversationList conversations={[dm()]} activeId={null} loading onSelect={jest.fn()} />,
        );
        expect(screen.queryByText(/Loading conversations/i)).not.toBeInTheDocument();
        expect(screen.getByText('Karim')).toBeInTheDocument();
    });

    it('renders an unread badge and caps it at 99+', () => {
        render(
            <ConversationList
                conversations={[dm({ unreadCount: 150 })]}
                activeId={null}
                loading={false}
                onSelect={jest.fn()}
            />,
        );
        expect(screen.getByText('99+')).toBeInTheDocument();
    });

    it('omits the badge when everything is read', () => {
        render(
            <ConversationList
                conversations={[dm({ unreadCount: 0 })]}
                activeId={null}
                loading={false}
                onSelect={jest.fn()}
            />,
        );
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('falls back to a placeholder when no message has been sent', () => {
        render(
            <ConversationList
                conversations={[dm({ lastMessagePreview: null, lastMessageAt: null })]}
                activeId={null}
                loading={false}
                onSelect={jest.fn()}
            />,
        );
        expect(screen.getByText(/No messages yet/i)).toBeInTheDocument();
    });

    it('reports the picked conversation', () => {
        const onSelect = jest.fn();
        render(
            <ConversationList
                conversations={[dm()]}
                activeId={null}
                loading={false}
                onSelect={onSelect}
            />,
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onSelect).toHaveBeenCalledWith('conv-1');
    });

    it('marks the open conversation for assistive tech', () => {
        render(
            <ConversationList
                conversations={[dm()]}
                activeId="conv-1"
                loading={false}
                onSelect={jest.fn()}
            />,
        );
        expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true');
    });
});
