import { act, renderHook } from '@testing-library/react';
import { DEFAULT_SECTION_VALUES, type MyPreferencesResponse } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { SAVE_DEBOUNCE_MS, usePreferencesStore } from '@/lib/preferences/store';
import { DEFAULT_TABLE_VIEW } from './view-settings';
import { signInForPreferences } from '@/test-utils/preferences-scope';

jest.mock('@/lib/api', () => ({
    api: {
        saveMyPreferenceSection: jest.fn(),
        resetMyPreferenceSection: jest.fn(),
    },
}));
const saveApi = api.saveMyPreferenceSection as jest.Mock;

let mockSubject: string | null = 'user-a';
jest.mock('@/lib/session-store', () => ({
    ...jest.requireActual('@/lib/session-store'),
    getAccessToken: () => (mockSubject ? 'token' : null),
}));
jest.mock('@/lib/query-client', () => ({
    ...jest.requireActual('@/lib/query-client'),
    tokenSubject: (token: string | null) => (token ? mockSubject : null),
}));

// Imported after the mocks so the store reads the mocked user.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useTableViewSettings, useTableViewStore } = require('./useTableViewSettings');

function signIn(subject: string) {
    mockSubject = subject;
    act(() => useTableViewStore.getState().load(subject));
}

describe('useTableViewSettings', () => {
    beforeEach(() => {
        window.localStorage.clear();
        signIn('user-a');
    });

    it('starts on the defaults', () => {
        const { result } = renderHook(() => useTableViewSettings('orders'));
        expect(result.current.settings).toEqual(DEFAULT_TABLE_VIEW);
        expect(result.current.isOverridden).toBe(false);
    });

    it('applies a change to every list', () => {
        const { result } = renderHook(() => useTableViewSettings('orders'));
        act(() => result.current.update({ density: 'compact' }));
        const other = renderHook(() => useTableViewSettings('customers'));
        expect(other.result.current.settings.density).toBe('compact');
    });

    it('keeps a change to a list set apart on that list only', () => {
        const { result } = renderHook(() => useTableViewSettings('orders'));
        act(() => result.current.setOverride(true));
        act(() => result.current.update({ fontSize: 'xl' }));
        expect(result.current.settings.fontSize).toBe('xl');
        expect(renderHook(() => useTableViewSettings('customers')).result.current.settings.fontSize).toBe('md');
    });

    it('returns a list to the shared settings when it is no longer set apart', () => {
        act(() => useTableViewStore.getState().update('any', { striped: false }));
        const { result } = renderHook(() => useTableViewSettings('orders'));
        act(() => result.current.setOverride(true));
        act(() => result.current.update({ striped: true }));
        act(() => result.current.setOverride(false));
        expect(result.current.settings.striped).toBe(false);
    });

    it('resets to the defaults', () => {
        const { result } = renderHook(() => useTableViewSettings('orders'));
        act(() => result.current.update({ density: 'cozy', fitWidth: true }));
        act(() => result.current.reset());
        expect(result.current.settings).toEqual(DEFAULT_TABLE_VIEW);
    });

    it('remembers each person’s settings apart on a shared browser', () => {
        act(() => useTableViewStore.getState().update('orders', { fontSize: 'lg' }));
        signIn('user-b');
        expect(useTableViewStore.getState().global.fontSize).toBe('md');
        signIn('user-a');
        expect(useTableViewStore.getState().global.fontSize).toBe('lg');
    });

    it('ignores a stored value that is not a setting', () => {
        window.localStorage.setItem(
            'erp71:table-view:user-c',
            JSON.stringify({ global: { density: 'huge', fontSize: 'xl', striped: 'yes' }, tables: {} }),
        );
        signIn('user-c');
        expect(useTableViewStore.getState().global).toEqual({ ...DEFAULT_TABLE_VIEW, fontSize: 'xl' });
    });
});

describe('useTableViewSettings with preferences loaded', () => {
    const hydrate = (tableView: unknown, legacy: MyPreferencesResponse['legacy_browser_sections'] = []) =>
        act(() =>
            usePreferencesStore.getState().hydrate('t1:user-a', {
                profile: null,
                legacy_browser_sections: legacy,
                sections: {
                    invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
                    tableView: { value: tableView, source: 'member' },
                    tableColumns: { value: {}, source: 'default' },
                    sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
                    alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
                    device: { value: {}, source: 'default' },
                },
            } as MyPreferencesResponse),
        );
    const compact = { ...DEFAULT_TABLE_VIEW, density: 'compact' };
    const flush = () => act(async () => void jest.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1));

    beforeEach(() => {
        jest.useFakeTimers();
        window.localStorage.clear();
        window.sessionStorage.clear();
        // The token is mocked (`signIn` below names the user); this puts the tab in workspace t1.
        signInForPreferences('t1:user-a');
        act(() => usePreferencesStore.getState().clear());
        saveApi.mockReset();
        saveApi.mockResolvedValue({ value: DEFAULT_SECTION_VALUES.tableView, source: 'member' });
        signIn('user-a');
    });
    afterEach(() => {
        jest.useRealTimers();
        act(() => usePreferencesStore.getState().clear());
    });

    it('reads global and per-list values from the store when ready', async () => {
        hydrate({ global: compact, tables: { orders: { ...compact, fontSize: 'xl' } } });
        const orders = renderHook(() => useTableViewSettings('orders')).result.current;
        expect(orders.settings.fontSize).toBe('xl');
        expect(orders.isOverridden).toBe(true);
        const other = renderHook(() => useTableViewSettings('customers')).result.current;
        expect(other.settings).toEqual(compact);
        expect(other.isOverridden).toBe(false);
    });

    it('update with no override saves { global: patch }', async () => {
        hydrate({ global: compact, tables: {} });
        const { result } = renderHook(() => useTableViewSettings('orders'));
        act(() => result.current.update({ striped: false }));
        expect(result.current.settings).toEqual({ ...compact, striped: false });
        await flush();
        expect(saveApi).toHaveBeenCalledWith('tableView', { global: { striped: false } });
        expect(window.localStorage.getItem('erp71:table-view:user-a')).toBeNull();
    });

    it('update while overridden saves only that list', async () => {
        hydrate({ global: compact, tables: { orders: compact } });
        const { result } = renderHook(() => useTableViewSettings('orders'));
        act(() => result.current.update({ fontSize: 'lg' }));
        await flush();
        expect(saveApi).toHaveBeenCalledWith('tableView', { tables: { orders: { ...compact, fontSize: 'lg' } } });
    });

    it('setOverride(true) saves { tables: { [id]: global } } and setOverride(false) saves { tables: { [id]: null } }', async () => {
        hydrate({ global: compact, tables: {} });
        const { result } = renderHook(() => useTableViewSettings('orders'));
        saveApi.mockResolvedValueOnce({ value: { global: compact, tables: { orders: compact } }, source: 'member' });
        act(() => result.current.setOverride(true));
        await flush();
        expect(saveApi).toHaveBeenLastCalledWith('tableView', { tables: { orders: compact } });
        expect(result.current.isOverridden).toBe(true);
        act(() => result.current.setOverride(false));
        await flush();
        expect(saveApi).toHaveBeenLastCalledWith('tableView', { tables: { orders: null } });
        expect(result.current.isOverridden).toBe(false);
    });

    it('reset returns the list, or else the shared set, to the built-in settings', async () => {
        hydrate({ global: compact, tables: { orders: compact } });
        const orders = renderHook(() => useTableViewSettings('orders'));
        act(() => orders.result.current.reset());
        await flush();
        expect(saveApi).toHaveBeenLastCalledWith('tableView', { tables: { orders: DEFAULT_TABLE_VIEW } });
        const customers = renderHook(() => useTableViewSettings('customers'));
        act(() => customers.result.current.reset());
        await flush();
        expect(saveApi).toHaveBeenLastCalledWith('tableView', { global: DEFAULT_TABLE_VIEW });
    });

    it('two changes in one tick both land', async () => {
        hydrate({ global: DEFAULT_TABLE_VIEW, tables: {} });
        const { result } = renderHook(() => useTableViewSettings('orders'));
        act(() => {
            result.current.update({ density: 'cozy' });
            result.current.update({ striped: false });
        });
        expect(result.current.settings).toEqual({ ...DEFAULT_TABLE_VIEW, density: 'cozy', striped: false });
    });

    it('does not save on mount', async () => {
        hydrate({ global: compact, tables: {} });
        renderHook(() => useTableViewSettings('orders'));
        await flush();
        expect(saveApi).not.toHaveBeenCalled();
    });

    it('falls back to erp71:table-view:<userKey> when the store is not loaded', async () => {
        const { result } = renderHook(() => useTableViewSettings('orders'));
        act(() => result.current.update({ density: 'compact' }));
        expect(result.current.settings.density).toBe('compact');
        expect(JSON.parse(window.localStorage.getItem('erp71:table-view:user-a') as string).global.density).toBe('compact');
        await flush();
        expect(saveApi).not.toHaveBeenCalled();
    });

    it('shows this browser’s old answers while the section is still legacy-listed', async () => {
        window.localStorage.setItem(
            'erp71:table-view:user-a',
            JSON.stringify({ global: { density: 'cozy' }, tables: {} }),
        );
        act(() =>
            usePreferencesStore.getState().hydrate('t1:user-a', {
                profile: null,
                legacy_browser_sections: ['tableView'],
                sections: {
                    invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
                    tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
                    tableColumns: { value: {}, source: 'default' },
                    sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
                    alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
                    device: { value: {}, source: 'default' },
                },
            } as MyPreferencesResponse),
        );
        const { result } = renderHook(() => useTableViewSettings('orders'));
        expect(result.current.settings.density).toBe('cozy');
    });
});
