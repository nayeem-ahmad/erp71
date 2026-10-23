import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_INVOICE_PRINT_PREFS, DEFAULT_SECTION_VALUES, type MyPreferencesResponse } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { onPreferencesSettled, usePreferencesStore } from '@/lib/preferences/store';
import { signInForPreferences } from '@/test-utils/preferences-scope';
import { clearInvoicePrintPrefsCache, reloadInvoicePrintPrefs, useInvoicePrintPrefs } from './useInvoicePrintPrefs';

jest.mock('@/lib/api', () => ({
    api: { getMyInvoicePrint: jest.fn(), updateMyInvoicePrint: jest.fn(), getMyPreferences: jest.fn() },
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

    it('reload asks the server again and hands the new layout to every subscriber', async () => {
        getMine.mockResolvedValueOnce({ table_style: 'grid' });
        const { result } = renderHook(() => useInvoicePrintPrefs());
        await waitFor(() => expect(result.current.prefs.table_style).toBe('grid'));

        getMine.mockResolvedValueOnce({});
        await act(async () => {
            await expect(reloadInvoicePrintPrefs()).resolves.toEqual(DEFAULT_INVOICE_PRINT_PREFS);
        });

        expect(getMine).toHaveBeenCalledTimes(2);
        expect(result.current.prefs).toEqual(DEFAULT_INVOICE_PRINT_PREFS);
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

    describe('the preferences store', () => {
        const profileLayout = { ...DEFAULT_INVOICE_PRINT_PREFS, layout: 'detailed' as const };
        function loadPreferences(scopeKey = 't1:u1') {
            const data: MyPreferencesResponse = {
                profile: { id: 'p1', name: 'Cashier' },
                legacy_browser_sections: [],
                sections: {
                    invoicePrint: { value: profileLayout, source: 'profile' },
                    tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
                    tableColumns: { value: {}, source: 'default' },
                    sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
                    alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
                    device: { value: {}, source: 'default' },
                },
            };
            act(() => usePreferencesStore.getState().hydrate(scopeKey, data));
        }

        beforeEach(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
            signInForPreferences('t1:u1');
            usePreferencesStore.getState().clear();
        });
        afterEach(() => usePreferencesStore.getState().clear());

        it('takes the saved layout as the member\'s own, without asking the server again', async () => {
            loadPreferences();
            const settled = jest.fn();
            const unsubscribe = onPreferencesSettled(settled);
            getMine.mockResolvedValue(profileLayout);
            const saved = { ...profileLayout, balance: 'never' as const };
            updateMine.mockResolvedValue(saved);
            const { result } = renderHook(() => useInvoicePrintPrefs());
            await waitFor(() => expect(getMine).toHaveBeenCalled());

            await act(() => result.current.save({ balance: 'never' }));

            expect(usePreferencesStore.getState().data?.sections.invoicePrint).toEqual({ value: saved, source: 'member' });
            expect(api.getMyPreferences).not.toHaveBeenCalled();
            // Handed to the first-paint cache and the query, as a save through the store would be.
            expect(settled).toHaveBeenCalledTimes(1);
            unsubscribe();
        });

        it('leaves the store alone when the save fails', async () => {
            loadPreferences();
            getMine.mockResolvedValue(profileLayout);
            updateMine.mockRejectedValue(new Error('network'));
            const { result } = renderHook(() => useInvoicePrintPrefs());

            await expect(act(() => result.current.save({ balance: 'never' }))).rejects.toThrow('network');

            expect(usePreferencesStore.getState().data?.sections.invoicePrint).toEqual({ value: profileLayout, source: 'profile' });
        });

        it("never writes into a store that holds someone else's preferences", async () => {
            loadPreferences('t1:u1');
            signInForPreferences('t1:u2');
            getMine.mockResolvedValue({});
            updateMine.mockResolvedValue({ ...DEFAULT_INVOICE_PRINT_PREFS, balance: 'never' });
            const { result } = renderHook(() => useInvoicePrintPrefs());

            await act(() => result.current.save({ balance: 'never' }));

            expect(usePreferencesStore.getState().data?.sections.invoicePrint.source).toBe('profile');
        });
    });
});
