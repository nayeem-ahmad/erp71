import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { notifyVoucherApprovalChanged, usePendingVoucherCount } from './usePendingVoucherCount';

jest.mock('@/lib/api', () => ({
    api: { getPendingVoucherCount: jest.fn() },
}));

const getCount = api.getPendingVoucherCount as jest.Mock;

describe('usePendingVoucherCount', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('reports the queue size when the tenant requires approval', async () => {
        getCount.mockResolvedValue({ count: 3, approvalEnabled: true });

        const { result } = renderHook(() => usePendingVoucherCount());

        await waitFor(() => expect(result.current.count).toBe(3));
        expect(result.current.approvalEnabled).toBe(true);
    });

    it('stops polling for a tenant that does not require approval', async () => {
        getCount.mockResolvedValue({ count: 0, approvalEnabled: false });

        renderHook(() => usePendingVoucherCount());

        await waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));

        await act(async () => {
            jest.advanceTimersByTime(5 * 60_000);
        });

        // One request per session, not one per minute.
        expect(getCount).toHaveBeenCalledTimes(1);
    });

    it('refreshes immediately when a voucher is approved elsewhere in the app', async () => {
        getCount.mockResolvedValue({ count: 2, approvalEnabled: true });

        renderHook(() => usePendingVoucherCount());
        await waitFor(() => expect(getCount).toHaveBeenCalledTimes(1));

        getCount.mockResolvedValue({ count: 1, approvalEnabled: true });
        await act(async () => {
            notifyVoucherApprovalChanged();
        });

        await waitFor(() => expect(getCount).toHaveBeenCalledTimes(2));
    });

    it('falls back to zero rather than surfacing an error', async () => {
        getCount.mockRejectedValue(new Error('offline'));

        const { result } = renderHook(() => usePendingVoucherCount());

        await waitFor(() => expect(getCount).toHaveBeenCalled());
        expect(result.current.count).toBe(0);
        expect(result.current.approvalEnabled).toBe(false);
    });
});
