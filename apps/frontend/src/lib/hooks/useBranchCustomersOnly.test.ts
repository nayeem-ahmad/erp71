import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { useBranchCustomersOnly } from './useBranchCustomersOnly';

jest.mock('@/lib/api', () => ({
    api: { getSalesSettings: jest.fn() },
}));

const getSalesSettings = api.getSalesSettings as jest.Mock;

describe('useBranchCustomersOnly', () => {
    beforeEach(() => getSalesSettings.mockReset());

    it('is on before the settings arrive, matching the server default', () => {
        getSalesSettings.mockReturnValue(new Promise(() => {}));

        const { result } = renderHook(() => useBranchCustomersOnly());

        expect(result.current).toBe(true);
    });

    it('turns off once the shop has turned the rule off', async () => {
        getSalesSettings.mockResolvedValue({ branch_customers_only: false });

        const { result } = renderHook(() => useBranchCustomersOnly());

        await waitFor(() => expect(result.current).toBe(false));
    });

    it('stays on for a shop that never set it, or when the settings cannot be read', async () => {
        getSalesSettings.mockResolvedValue({ paper_size: 'A4' });
        const unset = renderHook(() => useBranchCustomersOnly());
        await waitFor(() => expect(getSalesSettings).toHaveBeenCalledTimes(1));
        expect(unset.result.current).toBe(true);

        getSalesSettings.mockRejectedValue(new Error('offline'));
        const failed = renderHook(() => useBranchCustomersOnly());
        await waitFor(() => expect(getSalesSettings).toHaveBeenCalledTimes(2));
        expect(failed.result.current).toBe(true);
    });

    it('asks for nothing while disabled', () => {
        renderHook(() => useBranchCustomersOnly(false));

        expect(getSalesSettings).not.toHaveBeenCalled();
    });
});
