import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { notifyMeetingActionsChanged, useOverdueMeetingActionsCount } from './useOverdueMeetingActionsCount';

jest.mock('@/lib/api', () => ({
    api: { getMeetingActionsOverdueCount: jest.fn() },
}));

const getCount = api.getMeetingActionsOverdueCount as jest.Mock;

describe('useOverdueMeetingActionsCount', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('reports the overdue count for the signed-in member', async () => {
        getCount.mockResolvedValue({ count: 4 });

        const { result } = renderHook(() => useOverdueMeetingActionsCount());

        await waitFor(() => expect(result.current.count).toBe(4));
    });

    it('refreshes when an action is marked done elsewhere in the app', async () => {
        getCount.mockResolvedValue({ count: 2 });

        renderHook(() => useOverdueMeetingActionsCount());
        await waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));

        getCount.mockResolvedValue({ count: 1 });
        await act(async () => {
            notifyMeetingActionsChanged();
        });

        await waitFor(() => expect(getCount).toHaveBeenCalledTimes(2));
    });

    it('falls back to zero rather than surfacing an error', async () => {
        getCount.mockRejectedValue(new Error('offline'));

        const { result } = renderHook(() => useOverdueMeetingActionsCount());

        await waitFor(() => expect(getCount).toHaveBeenCalled());
        expect(result.current.count).toBe(0);
    });
});
