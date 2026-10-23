import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_SECTION_VALUES, type MyPreferencesResponse, type TableColumnsPrefs } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { usePreferencesStore } from '@/lib/preferences/store';
import { useTablePreferences } from '@/components/data-table/useTablePreferences';
import { useServerList } from './useServerList';
import { signInForPreferences } from '@/test-utils/preferences-scope';

jest.mock('@/lib/api', () => {
    const actual = jest.requireActual('@/lib/api');
    return {
        ...actual,
        api: { ...actual.api, saveMyPreferenceSection: jest.fn(), resetMyPreferenceSection: jest.fn() },
    };
});

function hydrate(tableColumns: TableColumnsPrefs) {
    act(() =>
        usePreferencesStore.getState().hydrate('t1:user-a', {
            profile: null,
            legacy_browser_sections: [],
            sections: {
                invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
                tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
                tableColumns: { value: tableColumns, source: 'profile' },
                sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
                alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
                device: { value: {}, source: 'default' },
            },
        } as MyPreferencesResponse),
    );
}

const fetch = jest.fn(async ({ page, limit }: { page: number; limit: number }) => ({
    items: [],
    total: 0,
    page,
    limit,
    pages: 0,
}));

beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    signInForPreferences('t1:user-a');
    act(() => usePreferencesStore.getState().clear());
    act(() => useTablePreferences.setState({ tables: {} }));
    fetch.mockClear();
});

afterEach(() => {
    act(() => usePreferencesStore.getState().clear());
});

describe('useServerList page size', () => {
    it('useServerList reads pageSize from the store', async () => {
        hydrate({ 'test-list': { pageSize: 50 } });

        const { result } = renderHook(() => useServerList({ fetch, tableId: 'test-list' }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.pageSize).toBe(50);
        expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }));
        // Reading is all it does: DataTable saves the size, and only when the viewer picks one.
        expect(api.saveMyPreferenceSection).not.toHaveBeenCalled();
    });

    it('takes the stored size when preferences load after the list opened', async () => {
        const { result } = renderHook(() => useServerList({ fetch, tableId: 'test-list' }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.pageSize).toBe(10);

        hydrate({ 'test-list': { pageSize: 50 } });

        await waitFor(() => expect(result.current.pageSize).toBe(50));
        expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, page: 1 }));
    });

    it('keeps a size the viewer picked before preferences loaded', async () => {
        const { result } = renderHook(() => useServerList({ fetch, tableId: 'test-list' }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.serverPagination.onPageSizeChange(100));

        hydrate({ 'test-list': { pageSize: 50 } });

        expect(result.current.pageSize).toBe(100);
    });
});
