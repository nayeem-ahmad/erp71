import { render, screen, waitFor, act } from '@testing-library/react';
import { mockUseI18n } from '@/test-utils/i18n';
import ChatBell from './ChatBell';

jest.mock('@/lib/api', () => ({ api: { getChatUnreadCount: jest.fn() } }));
jest.mock('@/lib/i18n', () => ({ useI18n: () => mockUseI18n() }));

const { api } = jest.requireMock('@/lib/api') as {
    api: { getChatUnreadCount: jest.Mock };
};

describe('ChatBell', () => {
    beforeEach(() => jest.clearAllMocks());

    it('shows the unread count', async () => {
        api.getChatUnreadCount.mockResolvedValue({ count: 3 });
        render(<ChatBell />);
        expect(await screen.findByText('3')).toBeInTheDocument();
    });

    it('caps the badge at 9+', async () => {
        api.getChatUnreadCount.mockResolvedValue({ count: 42 });
        render(<ChatBell />);
        expect(await screen.findByText('9+')).toBeInTheDocument();
    });

    it('shows no badge at zero', async () => {
        api.getChatUnreadCount.mockResolvedValue({ count: 0 });
        render(<ChatBell />);
        await waitFor(() => expect(api.getChatUnreadCount).toHaveBeenCalled());
        expect(screen.queryByText('0')).not.toBeInTheDocument();
        expect(screen.getByRole('link')).toBeInTheDocument();
    });

    it('disappears entirely when the workspace has no chat add-on', async () => {
        // A 403 is the entitlement guard, not a transient failure — there is no
        // badge to show and the link would lead to a dead page.
        api.getChatUnreadCount.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
        render(<ChatBell />);
        await waitFor(() => expect(screen.queryByRole('link')).not.toBeInTheDocument());
    });

    it('stays mounted through a transient failure', async () => {
        api.getChatUnreadCount.mockRejectedValue(Object.assign(new Error('nope'), { status: 500 }));
        render(<ChatBell />);
        await waitFor(() => expect(api.getChatUnreadCount).toHaveBeenCalled());
        expect(screen.getByRole('link')).toBeInTheDocument();
    });

    it('polls on an interval', async () => {
        jest.useFakeTimers();
        api.getChatUnreadCount.mockResolvedValue({ count: 1 });
        render(<ChatBell />);
        await act(async () => {
            jest.advanceTimersByTime(60_000);
        });
        expect(api.getChatUnreadCount.mock.calls.length).toBeGreaterThanOrEqual(2);
        jest.useRealTimers();
    });
});
