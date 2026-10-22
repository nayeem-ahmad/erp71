import { act, renderHook } from '@testing-library/react';
import { DEFAULT_SECTION_VALUES, type MyPreferencesResponse } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { useToastStore } from '@/lib/toast';
import { SAVE_DEBOUNCE_MS, usePreferencesStore } from './store';
import { usePreferenceSection } from './use-preference-section';

jest.mock('@/lib/api', () => ({
    api: {
        saveMyPreferenceSection: jest.fn(),
        resetMyPreferenceSection: jest.fn(),
    },
}));

const saveApi = api.saveMyPreferenceSection as jest.Mock;
const resetApi = api.resetMyPreferenceSection as jest.Mock;

function response(overrides: Partial<MyPreferencesResponse> = {}): MyPreferencesResponse {
    return {
        profile: { id: 'p1', name: 'Cashier' },
        legacy_browser_sections: [],
        sections: {
            invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
            tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
            tableColumns: { value: { orders: { hidden: ['notes'] } }, source: 'profile' },
            sidebar: { value: { appShellOpenGroups: ['sales'] }, source: 'profile' },
            alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
            device: { value: {}, source: 'default' },
        },
        ...overrides,
    };
}

const state = () => usePreferencesStore.getState();

beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    usePreferencesStore.getState().clear();
    useToastStore.setState({ toasts: [] });
    saveApi.mockReset();
    resetApi.mockReset();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('preferences store', () => {
    it('hydrate marks ready', () => {
        expect(state().ready).toBe(false);
        state().hydrate('t1:u1', response());
        expect(state().ready).toBe(true);
        expect(state().scopeKey).toBe('t1:u1');
        expect(state().data?.profile?.name).toBe('Cashier');
    });

    it('usePreferenceSection applies the legacy value only for a listed section', () => {
        window.localStorage.setItem('app-shell-open-groups', JSON.stringify({ stock: true, hr: true }));
        state().hydrate('t1:u1', response({ legacy_browser_sections: ['sidebar'] }));

        const { result } = renderHook(() => usePreferenceSection('sidebar'));

        expect(result.current.ready).toBe(true);
        expect(result.current.value).toEqual({ appShellOpenGroups: ['stock', 'hr'] });
        expect(result.current.source).toBe('browser');
    });

    it('ignores legacy keys for an unlisted section', () => {
        window.localStorage.setItem('app-shell-open-groups', JSON.stringify({ stock: true }));
        window.localStorage.setItem('data-table-preferences', JSON.stringify({ orders: { columnVisibility: { a: false } } }));
        state().hydrate('t1:u1', response({ legacy_browser_sections: [] }));

        const sidebar = renderHook(() => usePreferenceSection('sidebar'));
        const columns = renderHook(() => usePreferenceSection('tableColumns'));

        expect(sidebar.result.current).toEqual({ ready: true, value: { appShellOpenGroups: ['sales'] }, source: 'profile' });
        expect(columns.result.current.value).toEqual({ orders: { hidden: ['notes'] } });
        expect(columns.result.current.source).toBe('profile');
    });

    it('ignores the legacy value when the member already answered', () => {
        window.localStorage.setItem('app-shell-open-groups', JSON.stringify({ stock: true }));
        const base = response({ legacy_browser_sections: ['sidebar'] });
        base.sections.sidebar = { value: { appShellOpenGroups: ['hr'] }, source: 'member' };
        state().hydrate('t1:u1', base);

        const { result } = renderHook(() => usePreferenceSection('sidebar'));

        expect(result.current.value).toEqual({ appShellOpenGroups: ['hr'] });
        expect(result.current.source).toBe('member');
    });

    it('falls back to the built-in value before preferences load', () => {
        const { result } = renderHook(() => usePreferenceSection('alerts'));
        expect(result.current).toEqual({ ready: false, value: DEFAULT_SECTION_VALUES.alerts, source: 'default' });
    });

    it('save is optimistic and PATCHes once after the debounce', async () => {
        saveApi.mockResolvedValue({ value: { appShellOpenGroups: ['hr'] }, source: 'member' });
        state().hydrate('t1:u1', response({ legacy_browser_sections: ['sidebar'] }));

        state().save('sidebar', { appShellOpenGroups: ['stock'] }, { appShellOpenGroups: ['stock'] });
        state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });

        expect(state().data?.sections.sidebar).toEqual({ value: { appShellOpenGroups: ['hr'] }, source: 'member' });
        expect(saveApi).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
        });

        expect(saveApi).toHaveBeenCalledTimes(1);
        expect(saveApi).toHaveBeenCalledWith('sidebar', { appShellOpenGroups: ['hr'] });
        // The server's answer replaces the section, and it no longer reads the browser's leftovers.
        expect(state().data?.sections.sidebar).toEqual({ value: { appShellOpenGroups: ['hr'] }, source: 'member' });
        expect(state().data?.legacy_browser_sections).toEqual([]);
    });

    it('merges the bodies of saves that land in one debounce window', async () => {
        saveApi.mockResolvedValue({ value: {}, source: 'member' });
        state().hydrate('t1:u1', response());

        state().save('tableColumns', { orders: { hidden: ['a'] } }, { orders: { hidden: ['a'] } });
        state().save('tableColumns', { invoices: null }, { orders: { hidden: ['a'] } });
        await act(async () => {
            jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
        });

        expect(saveApi).toHaveBeenCalledTimes(1);
        expect(saveApi).toHaveBeenCalledWith('tableColumns', { orders: { hidden: ['a'] }, invoices: null });
    });

    describe('the first save of a section still shown from the browser', () => {
        const entryA = { hidden: ['x'] };
        const entryA2 = { hidden: ['x', 'y'] };
        const entryB = { order: ['b', 'a'] };

        function legacyColumns(source: 'profile' | 'member') {
            const base = response({ legacy_browser_sections: ['tableColumns'] });
            base.sections.tableColumns = { value: { a: entryA }, source };
            state().hydrate('t1:u1', base);
        }

        it('first save of a legacy section sends the whole section as seen', async () => {
            saveApi.mockResolvedValue({ value: { a: entryA2, b: entryB }, source: 'member' });
            legacyColumns('profile');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB });
            await act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });

            expect(saveApi).toHaveBeenCalledTimes(1);
            expect(saveApi).toHaveBeenCalledWith('tableColumns', { a: entryA2, b: entryB });
        });

        it('sends the latest whole section when several edits land in one window', async () => {
            saveApi.mockResolvedValue({ value: {}, source: 'member' });
            legacyColumns('profile');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB });
            state().save('tableColumns', { c: entryB }, { a: entryA2, b: entryB, c: entryB });
            await act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });

            expect(saveApi).toHaveBeenCalledTimes(1);
            expect(saveApi).toHaveBeenCalledWith('tableColumns', { a: entryA2, b: entryB, c: entryB });
        });

        it('sends tableView as global and tables', async () => {
            saveApi.mockResolvedValue({ value: {}, source: 'member' });
            const base = response({ legacy_browser_sections: ['tableView'] });
            state().hydrate('t1:u1', base);
            const optimistic = {
                global: { ...DEFAULT_SECTION_VALUES.tableView.global, density: 'compact' as const },
                tables: {},
            };

            state().save('tableView', { global: { density: 'compact' } }, optimistic);
            await act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });

            expect(saveApi).toHaveBeenCalledWith('tableView', { global: optimistic.global, tables: optimistic.tables });
        });

        it('after that, saves send only the partial body', async () => {
            saveApi.mockResolvedValue({ value: { a: entryA2, b: entryB }, source: 'member' });
            legacyColumns('profile');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB });
            await act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });
            saveApi.mockClear();

            state().save('tableColumns', { b: null }, { a: entryA2 });
            await act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });

            expect(saveApi).toHaveBeenCalledWith('tableColumns', { b: null });
        });

        it('a member-sourced section never sends the full body even if listed', async () => {
            saveApi.mockResolvedValue({ value: {}, source: 'member' });
            legacyColumns('member');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB });
            await act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });

            expect(saveApi).toHaveBeenCalledWith('tableColumns', { a: entryA2 });
        });
    });

    it('a failed save rolls back and raises a toast through the global store', async () => {
        saveApi.mockRejectedValue(new Error('boom'));
        state().hydrate('t1:u1', response({ legacy_browser_sections: ['sidebar'] }));

        state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });
        expect(state().data?.sections.sidebar.source).toBe('member');

        await act(async () => {
            jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
        });

        expect(state().data?.sections.sidebar).toEqual({ value: { appShellOpenGroups: ['sales'] }, source: 'profile' });
        expect(state().data?.legacy_browser_sections).toEqual(['sidebar']);
        const toasts = useToastStore.getState().toasts;
        expect(toasts).toHaveLength(1);
        expect(toasts[0].type).toBe('error');
    });

    it('reset calls DELETE, replaces the section and drops it from legacy_browser_sections', async () => {
        resetApi.mockResolvedValue({ value: { appShellOpenGroups: ['sales'] }, source: 'profile' });
        const base = response({ legacy_browser_sections: ['sidebar', 'tableView'] });
        base.sections.sidebar = { value: { appShellOpenGroups: ['hr'] }, source: 'member' };
        state().hydrate('t1:u1', base);

        await act(async () => {
            await state().reset('sidebar');
        });

        expect(resetApi).toHaveBeenCalledWith('sidebar');
        expect(state().data?.sections.sidebar).toEqual({ value: { appShellOpenGroups: ['sales'] }, source: 'profile' });
        expect(state().data?.legacy_browser_sections).toEqual(['tableView']);
    });

    it('reset cancels a save still waiting on its debounce', async () => {
        resetApi.mockResolvedValue({ value: {}, source: 'default' });
        state().hydrate('t1:u1', response());

        state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });
        await act(async () => {
            await state().reset('sidebar');
            jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
        });

        expect(saveApi).not.toHaveBeenCalled();
    });

    it('a failed reset leaves the section alone and raises a toast', async () => {
        resetApi.mockRejectedValue(new Error('boom'));
        state().hydrate('t1:u1', response());

        await act(async () => {
            await state().reset('sidebar');
        });

        expect(state().data?.sections.sidebar.source).toBe('profile');
        expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('a refetch that lands mid-edit keeps the unsaved section', () => {
        state().hydrate('t1:u1', response());
        state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });

        state().hydrate('t1:u1', response());

        expect(state().data?.sections.sidebar).toEqual({ value: { appShellOpenGroups: ['hr'] }, source: 'member' });
    });

    it('clear on workspace change', async () => {
        state().hydrate('t1:u1', response());
        state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });

        state().clear();

        expect(state().ready).toBe(false);
        expect(state().data).toBeNull();
        expect(state().scopeKey).toBeNull();
        await act(async () => {
            jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
        });
        // An edit made in the workspace we left is never sent to the one we entered.
        expect(saveApi).not.toHaveBeenCalled();
    });

    it('hydrating another scope drops the previous scope', () => {
        state().hydrate('t1:u1', response());
        state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });

        state().hydrate('t2:u1', response());

        expect(state().scopeKey).toBe('t2:u1');
        expect(state().data?.sections.sidebar.source).toBe('profile');
    });

    it('does nothing when saving before preferences are loaded', async () => {
        state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });
        await act(async () => {
            jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
        });
        expect(saveApi).not.toHaveBeenCalled();
    });
});
