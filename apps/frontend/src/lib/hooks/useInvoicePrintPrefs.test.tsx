import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_INVOICE_PRINT_PREFS } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { clearInvoicePrintPrefsCache, useInvoicePrintPrefs } from './useInvoicePrintPrefs';

jest.mock('@/lib/api', () => ({
    api: { getMyInvoicePrint: jest.fn(), updateMyInvoicePrint: jest.fn() },
}));

const getMine = api.getMyInvoicePrint as jest.Mock;
const updateMine = api.updateMyInvoicePrint as jest.Mock;

describe('useInvoicePrintPrefs', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearInvoicePrintPrefsCache();
    });

    it("loads the member's saved layout", async () => {
        getMine.mockResolvedValue({ version: 1, table_style: 'grid' });
        const { result } = renderHook(() => useInvoicePrintPrefs());

        expect(result.current.prefs).toEqual(DEFAULT_INVOICE_PRINT_PREFS);
        await waitFor(() => expect(result.current.prefs.table_style).toBe('grid'));
    });

    it('prints with the built-in layout when the request fails', async () => {
        getMine.mockRejectedValue(new Error('403'));
        const { result } = renderHook(() => useInvoicePrintPrefs());

        await expect(result.current.resolve()).resolves.toEqual(DEFAULT_INVOICE_PRINT_PREFS);
        expect(result.current.prefs).toEqual(DEFAULT_INVOICE_PRINT_PREFS);
    });

    it('shares one request between every component that prints', async () => {
        getMine.mockResolvedValue({ padding: 'wide' });
        const a = renderHook(() => useInvoicePrintPrefs());
        const b = renderHook(() => useInvoicePrintPrefs());

        await waitFor(() => expect(b.result.current.prefs.padding).toBe('wide'));
        expect(a.result.current.prefs.padding).toBe('wide');
        expect(getMine).toHaveBeenCalledTimes(1);
    });

    it('waits for the saved layout when asked at print time', async () => {
        getMine.mockResolvedValue({ serial_column: true });
        const { result } = renderHook(() => useInvoicePrintPrefs());

        await expect(result.current.resolve()).resolves.toMatchObject({ serial_column: true });
    });

    it('saves a change and hands it to every subscriber at once', async () => {
        getMine.mockResolvedValue({});
        updateMine.mockResolvedValue({ ...DEFAULT_INVOICE_PRINT_PREFS, balance: 'never' });
        const settings = renderHook(() => useInvoicePrintPrefs());
        const printer = renderHook(() => useInvoicePrintPrefs());
        await waitFor(() => expect(getMine).toHaveBeenCalled());

        await act(() => settings.result.current.save({ balance: 'never' }));

        expect(updateMine).toHaveBeenCalledWith({ balance: 'never' });
        expect(printer.result.current.prefs.balance).toBe('never');
        await expect(printer.result.current.resolve()).resolves.toMatchObject({ balance: 'never' });
    });

    it('lets a failed save reach the caller, keeping the previous answers', async () => {
        getMine.mockResolvedValue({ padding: 'narrow' });
        updateMine.mockRejectedValue(new Error('network'));
        const { result } = renderHook(() => useInvoicePrintPrefs());
        await waitFor(() => expect(result.current.prefs.padding).toBe('narrow'));

        await expect(act(() => result.current.save({ padding: 'wide' }))).rejects.toThrow('network');
        expect(result.current.prefs.padding).toBe('narrow');
    });
});
