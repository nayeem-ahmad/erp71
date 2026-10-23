import { act } from '@testing-library/react';
import {
    DEFAULT_SECTION_VALUES,
    type LegacyBrowserSection,
    type MyPreferencesResponse,
    type PreferenceSource,
    type TableColumnsPrefs,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { SAVE_DEBOUNCE_MS, usePreferencesStore } from '@/lib/preferences/store';
import { useTablePreferences } from './useTablePreferences';
import { signInForPreferences } from '@/test-utils/preferences-scope';

jest.mock('@/lib/api', () => ({
    api: { saveMyPreferenceSection: jest.fn(), resetMyPreferenceSection: jest.fn() },
}));
const saveApi = api.saveMyPreferenceSection as jest.Mock;

const STORAGE_KEY = 'data-table-preferences';
const store = () => useTablePreferences.getState();
const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');

function hydrate(
    tableColumns: TableColumnsPrefs,
    { source = 'member', legacy = [] }: { source?: PreferenceSource; legacy?: LegacyBrowserSection[] } = {},
) {
    usePreferencesStore.getState().hydrate('t1:user-a', {
        profile: null,
        legacy_browser_sections: legacy,
        sections: {
            invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
            tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
            tableColumns: { value: tableColumns, source },
            sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
            alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
            device: { value: {}, source: 'default' },
        },
    } as MyPreferencesResponse);
}

const flush = () => act(async () => void jest.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1));

beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    signInForPreferences('t1:user-a');
    usePreferencesStore.getState().clear();
    useTablePreferences.setState({ tables: {} });
    saveApi.mockReset();
    // The server answers with the section as saved, which here is what the store already shows.
    saveApi.mockImplementation(async () => ({
        value: usePreferencesStore.getState().data?.sections.tableColumns.value,
        source: 'member',
    }));
});

afterEach(() => {
    jest.useRealTimers();
    usePreferencesStore.getState().clear();
});

describe('useTablePreferences before preferences load', () => {
    it('keeps every choice in this browser, as before', async () => {
        store().setColumnVisibility('orders', { notes: false });
        store().setColumnOrder('orders', ['b', 'a']);
        store().setPageSize('orders', 50);
        store().setColumnWidth('orders', 'a', 120);
        await flush();

        expect(stored()).toEqual({
            orders: { columnVisibility: { notes: false }, columnOrder: ['b', 'a'], pageSize: 50, columnWidths: { a: 120 } },
        });
        expect(store().getPreferences('orders')).toEqual(stored().orders);
        expect(saveApi).not.toHaveBeenCalled();
    });
});

describe('useTablePreferences with preferences loaded', () => {
    it('reads the person’s columns, and the widths from this browser', () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ orders: { columnVisibility: { a: false }, pageSize: 100, columnWidths: { a: 90 } } }),
        );
        useTablePreferences.setState({ tables: stored() });
        hydrate({ orders: { hidden: ['notes'], order: ['b', 'a'], pageSize: 20 } });

        expect(store().getPreferences('orders')).toEqual({
            columnVisibility: { notes: false },
            columnOrder: ['b', 'a'],
            pageSize: 20,
            columnWidths: { a: 90 },
        });
        expect(store().getPreferences('customers')).toBeUndefined();
    });

    it('ignores columns the store holds for someone else, and keeps changes in this browser', async () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ orders: { pageSize: 100 } }));
        useTablePreferences.setState({ tables: stored() });
        signInForPreferences('t1:user-b');
        hydrate({ orders: { hidden: ['notes'], pageSize: 20 } });

        expect(store().getPreferences('orders')).toEqual({ pageSize: 100 });

        store().setColumnVisibility('orders', { a: false });
        await flush();

        expect(saveApi).not.toHaveBeenCalled();
        expect(stored().orders.columnVisibility).toEqual({ a: false });
    });

    it('still shows this browser’s old columns while the section is legacy-listed', () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ orders: { columnVisibility: { a: false } } }));
        hydrate({ customers: { pageSize: 50 } }, { source: 'profile', legacy: ['tableColumns'] });

        expect(store().getPreferences('orders')?.columnVisibility).toEqual({ a: false });
        expect(store().getPreferences('customers')?.pageSize).toBe(50);
    });

    it('keeps a column named after its header from this browser’s old answers', () => {
        // A column with no `id` or `accessorKey` takes its header text as its id.
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ orders: { columnVisibility: { 'Customer Name': false }, columnOrder: ['Customer Name', 'total'] } }),
        );
        hydrate({}, { source: 'default', legacy: ['tableColumns'] });

        expect(store().getPreferences('orders')).toEqual({
            columnVisibility: { 'Customer Name': false },
            columnOrder: ['Customer Name', 'total'],
        });
    });

    it('saves a change to the list’s whole entry and writes nothing to this browser', async () => {
        hydrate({ orders: { order: ['b', 'a'], pageSize: 20 }, customers: { hidden: ['x'] } });

        store().setColumnVisibility('orders', { a: false, b: true });
        await flush();

        expect(saveApi).toHaveBeenCalledWith('tableColumns', { orders: { hidden: ['a'], order: ['b', 'a'], pageSize: 20 } });
        expect(store().getPreferences('orders')?.columnVisibility).toEqual({ a: false });
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('two changes in one tick both land', async () => {
        hydrate({});

        store().setColumnOrder('orders', ['b', 'a']);
        store().setPageSize('orders', 50);
        await flush();

        expect(saveApi).toHaveBeenCalledTimes(1);
        expect(saveApi).toHaveBeenCalledWith('tableColumns', { orders: { order: ['b', 'a'], pageSize: 50 } });
    });

    it('sends every list the member sees on the first save of a legacy section', async () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ orders: { columnVisibility: { a: false } } }));
        hydrate({ customers: { pageSize: 50 } }, { source: 'profile', legacy: ['tableColumns'] });

        store().setPageSize('invoices', 20);
        await flush();

        expect(saveApi).toHaveBeenCalledWith('tableColumns', {
            orders: { hidden: ['a'] },
            customers: { pageSize: 50 },
            invoices: { pageSize: 20 },
        });
    });

    it('keeps widths in this browser only', async () => {
        hydrate({ orders: { hidden: ['a'] } });

        store().setColumnWidth('orders', 'b', 140);
        await flush();

        expect(saveApi).not.toHaveBeenCalled();
        expect(stored()).toEqual({ orders: { columnWidths: { b: 140 } } });
    });

    it('a direct width edit leaves the person’s columns alone', () => {
        hydrate({ orders: { hidden: ['a'] } });

        useTablePreferences.setState((state) => ({
            tables: { ...state.tables, orders: { columnWidths: { b: 80 } } },
        }));

        expect(store().getPreferences('orders')).toEqual({ columnVisibility: { a: false }, columnWidths: { b: 80 } });
    });

    it('goes back to this browser once preferences are cleared', () => {
        hydrate({ orders: { hidden: ['a'] } });
        usePreferencesStore.getState().clear();

        expect(store().getPreferences('orders')).toBeUndefined();
    });
});
