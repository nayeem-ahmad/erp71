import { act, renderHook } from '@testing-library/react';
import { DEFAULT_SECTION_VALUES, type MyPreferencesResponse } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { useToastStore } from '@/lib/toast';
import { signInForPreferences } from '@/test-utils/preferences-scope';
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
    window.sessionStorage.clear();
    signInForPreferences('t1:u1');
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

    describe('a store that holds another scope', () => {
        it('is not ready for someone else signed in on this tab', () => {
            state().hydrate('t1:u1', response());
            signInForPreferences('t1:u2');

            const { result } = renderHook(() => usePreferenceSection('sidebar'));

            expect(result.current).toEqual({ ready: false, value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' });
        });

        it('is not ready once the tab is in another workspace', () => {
            state().hydrate('t1:u1', response());
            signInForPreferences('t2:u1');

            const { result } = renderHook(() => usePreferenceSection('tableColumns'));

            expect(result.current.ready).toBe(false);
            expect(result.current.value).toEqual(DEFAULT_SECTION_VALUES.tableColumns);
        });

        it('is not ready when nobody is signed in', () => {
            state().hydrate('t1:u1', response());
            window.localStorage.removeItem('access_token');

            const { result } = renderHook(() => usePreferenceSection('sidebar'));

            expect(result.current.ready).toBe(false);
        });

        it('never sends a save for the previous scope under the next one', async () => {
            state().hydrate('t1:u1', response());
            signInForPreferences('t1:u2');

            state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });
            await act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });

            expect(saveApi).not.toHaveBeenCalled();
            expect(state().data?.sections.sidebar.source).toBe('profile');
        });

        it('drops a save still waiting when the tab changes hands before it is sent', async () => {
            state().hydrate('t1:u1', response());
            state().save('sidebar', { appShellOpenGroups: ['hr'] }, { appShellOpenGroups: ['hr'] });
            signInForPreferences('t1:u2');

            await act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });

            expect(saveApi).not.toHaveBeenCalled();
        });
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

    describe('the first save of a section still shown from the browser (Ruling R11)', () => {
        const entryA2 = { hidden: ['x', 'y'] };
        const entryB = { order: ['b', 'a'] };
        const entryC = { pageSize: 50 };
        const send = () =>
            act(async () => {
                jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
            });

        /** This browser's old columns: list a hides x, list b is reordered. */
        function browserColumns() {
            window.localStorage.setItem(
                'data-table-preferences',
                JSON.stringify({ a: { columnVisibility: { x: false, z: true } }, b: { columnOrder: ['b', 'a'] } }),
            );
        }

        /** Listed as legacy; the server's own value is the profile's list c. */
        function legacyColumns(source: 'profile' | 'member' | 'default' = 'profile') {
            const base = response({ legacy_browser_sections: ['tableColumns'] });
            base.sections.tableColumns = { value: source === 'default' ? {} : { c: entryC }, source };
            state().hydrate('t1:u1', base);
        }

        it('sends only the change when this browser holds nothing for the section', async () => {
            saveApi.mockResolvedValue({ value: { a: entryA2, c: entryC }, source: 'member' });
            legacyColumns('profile');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, c: entryC });
            await send();

            expect(saveApi).toHaveBeenCalledTimes(1);
            expect(saveApi).toHaveBeenCalledWith('tableColumns', { a: entryA2 });
        });

        it("sends this browser's answers with the change, and none of the profile's", async () => {
            saveApi.mockResolvedValue({ value: {}, source: 'member' });
            browserColumns();
            legacyColumns('profile');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB, c: entryC });
            await send();

            expect(saveApi).toHaveBeenCalledTimes(1);
            // b is the browser's own answer and survives; c is only the profile's and is not frozen in.
            expect(saveApi).toHaveBeenCalledWith('tableColumns', { a: entryA2, b: entryB });
        });

        it("sends the browser's answers with every edit made in one window", async () => {
            saveApi.mockResolvedValue({ value: {}, source: 'member' });
            browserColumns();
            legacyColumns('default');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB });
            state().save('tableColumns', { d: entryB }, { a: entryA2, b: entryB, d: entryB });
            await send();

            expect(saveApi).toHaveBeenCalledTimes(1);
            expect(saveApi).toHaveBeenCalledWith('tableColumns', { a: entryA2, b: entryB, d: entryB });
        });

        it("sends tableView as this browser's global and tables, with the change on top", async () => {
            saveApi.mockResolvedValue({ value: {}, source: 'member' });
            window.localStorage.setItem(
                'erp71:table-view:u1',
                JSON.stringify({ global: { density: 'compact' }, tables: { orders: { fontSize: 'lg' } } }),
            );
            const base = response({ legacy_browser_sections: ['tableView'] });
            // The profile turns striping off; this browser never touched it.
            base.sections.tableView = {
                value: { global: { ...DEFAULT_SECTION_VALUES.tableView.global, striped: false }, tables: {} },
                source: 'profile',
            };
            state().hydrate('t1:u1', base);
            const shownGlobal = { ...DEFAULT_SECTION_VALUES.tableView.global, striped: false, density: 'compact' as const };

            state().save('tableView', { global: { fontSize: 'xl' } }, {
                global: { ...shownGlobal, fontSize: 'xl' as const },
                tables: { orders: { ...shownGlobal, fontSize: 'lg' as const } },
            });
            await send();

            expect(saveApi).toHaveBeenCalledWith('tableView', {
                global: { density: 'compact', fontSize: 'xl' },
                tables: { orders: { fontSize: 'lg' } },
            });
        });

        it("sends the sidebar's whole list as the caller gave it", async () => {
            saveApi.mockResolvedValue({ value: {}, source: 'member' });
            window.localStorage.setItem('app-shell-open-groups', JSON.stringify({ stock: true, hr: true }));
            state().hydrate('t1:u1', response({ legacy_browser_sections: ['sidebar'] }));

            state().save('sidebar', { appShellOpenGroups: ['stock'] }, { appShellOpenGroups: ['stock'] });
            await send();

            expect(saveApi).toHaveBeenCalledWith('sidebar', { appShellOpenGroups: ['stock'] });
        });

        it('after that, saves send only the partial body', async () => {
            saveApi.mockResolvedValue({ value: { a: entryA2, b: entryB }, source: 'member' });
            browserColumns();
            legacyColumns('profile');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB, c: entryC });
            await send();
            saveApi.mockClear();

            state().save('tableColumns', { b: null }, { a: entryA2 });
            await send();

            expect(saveApi).toHaveBeenCalledWith('tableColumns', { b: null });
        });

        it('a member-sourced section never sends the browser answers even if listed', async () => {
            saveApi.mockResolvedValue({ value: {}, source: 'member' });
            browserColumns();
            legacyColumns('member');

            state().save('tableColumns', { a: entryA2 }, { a: entryA2, c: entryC });
            await send();

            expect(saveApi).toHaveBeenCalledWith('tableColumns', { a: entryA2 });
        });

        describe('when that first save fails (I2)', () => {
            function deferred() {
                let reject!: (error: Error) => void;
                const promise = new Promise((_resolve, rej) => {
                    reject = rej;
                });
                return { promise, reject };
            }

            it('failed whole save, then a queued edit → the queued PATCH carries the whole section', async () => {
                browserColumns();
                legacyColumns('profile');
                const first = deferred();
                saveApi.mockReturnValueOnce(first.promise).mockResolvedValue({ value: {}, source: 'member' });

                state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB, c: entryC });
                await send();
                // While the first request is out, the member makes another change.
                state().save('tableColumns', { d: entryB }, { a: entryA2, b: entryB, c: entryC, d: entryB });
                await act(async () => {
                    first.reject(new Error('offline'));
                });
                await send();

                expect(saveApi).toHaveBeenCalledTimes(2);
                expect(saveApi.mock.calls[1]).toEqual(['tableColumns', { a: entryA2, b: entryB, d: entryB }]);
            });

            it('the same when the queued edit was already sent off behind the failing one', async () => {
                browserColumns();
                legacyColumns('profile');
                const first = deferred();
                saveApi.mockReturnValueOnce(first.promise).mockResolvedValue({ value: {}, source: 'member' });

                state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB, c: entryC });
                await send();
                state().save('tableColumns', { d: entryB }, { a: entryA2, b: entryB, c: entryC, d: entryB });
                // The second edit's pause runs out while the first request is still out: it waits in line.
                await send();
                expect(saveApi).toHaveBeenCalledTimes(1);

                await act(async () => {
                    first.reject(new Error('offline'));
                });

                expect(saveApi).toHaveBeenCalledTimes(2);
                expect(saveApi.mock.calls[1]).toEqual(['tableColumns', { a: entryA2, b: entryB, d: entryB }]);
            });

            it('a queued edit that then fails too goes back to before the first edit', async () => {
                browserColumns();
                legacyColumns('profile');
                const before = state().data?.sections.tableColumns;
                saveApi.mockRejectedValue(new Error('offline'));

                state().save('tableColumns', { a: entryA2 }, { a: entryA2, b: entryB, c: entryC });
                await send();
                state().save('tableColumns', { d: entryB }, { a: entryA2, b: entryB, c: entryC, d: entryB });
                await send();
                await send();

                expect(state().data?.sections.tableColumns).toEqual(before);
                expect(state().data?.legacy_browser_sections).toEqual(['tableColumns']);
            });
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
