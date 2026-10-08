import { act, renderHook, waitFor } from '@testing-library/react';
import { notifyChatUnreadChanged, useChatUnreadCount } from './useChatUnreadCount';

jest.mock('@/lib/api', () => ({ api: { getChatUnreadCount: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as {
    api: { getChatUnreadCount: jest.Mock };
};

describe('useChatUnreadCount', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.useRealTimers());

    it('reads the unread count', async () => {
        api.getChatUnreadCount.mockResolvedValue({ count: 3 });
        const { result } = renderHook(() => useChatUnreadCount(true));

        await waitFor(() => expect(result.current).toBe(3));
    });

    it('sends nothing for a workspace or member without team chat', async () => {
        api.getChatUnreadCount.mockResolvedValue({ count: 3 });
        const { result } = renderHook(() => useChatUnreadCount(false));

        await act(async () => {});
        expect(api.getChatUnreadCount).not.toHaveBeenCalled();
        expect(result.current).toBe(0);
    });

    it('stops asking once the guard answers 403', async () => {
        jest.useFakeTimers();
        // The shell thought chat was on; the API's entitlement or permission
        // guard disagrees. That will not change by asking again every minute.
        api.getChatUnreadCount.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
        const { result } = renderHook(() => useChatUnreadCount(true));

        await act(async () => {});
        await act(async () => {
            jest.advanceTimersByTime(180_000);
        });
        expect(api.getChatUnreadCount).toHaveBeenCalledTimes(1);
        expect(result.current).toBe(0);
    });

    it('keeps its count and keeps polling through a transient failure', async () => {
        jest.useFakeTimers();
        api.getChatUnreadCount.mockResolvedValueOnce({ count: 2 });
        const { result } = renderHook(() => useChatUnreadCount(true));
        await act(async () => {});
        expect(result.current).toBe(2);

        api.getChatUnreadCount.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 500 }));
        await act(async () => {
            jest.advanceTimersByTime(60_000);
        });
        expect(result.current).toBe(2);

        api.getChatUnreadCount.mockResolvedValueOnce({ count: 4 });
        await act(async () => {
            jest.advanceTimersByTime(60_000);
        });
        expect(result.current).toBe(4);
    });

    it('re-reads at once when the chat page marks a conversation read', async () => {
        api.getChatUnreadCount.mockResolvedValueOnce({ count: 5 });
        const { result } = renderHook(() => useChatUnreadCount(true));
        await waitFor(() => expect(result.current).toBe(5));

        api.getChatUnreadCount.mockResolvedValueOnce({ count: 0 });
        act(() => notifyChatUnreadChanged());

        await waitFor(() => expect(result.current).toBe(0));
    });
});
