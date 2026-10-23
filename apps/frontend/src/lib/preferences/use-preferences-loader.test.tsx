import { act, waitFor } from '@testing-library/react';
import { DEFAULT_SECTION_VALUES, type MyPreferencesResponse } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { resetWorkspaceQueries } from '@/lib/query-client';
import { setWorkspaceItem } from '@/lib/session-store';
import { renderHookWithQueryClient } from '@/test-utils/query-client';
import { signInForPreferences } from '@/test-utils/preferences-scope';
import { usePreferencesStore } from './store';
import { usePreferencesLoader } from './use-preferences-loader';

jest.mock('@/lib/api', () => ({
    api: { getMyPreferences: jest.fn(), saveMyPreferenceSection: jest.fn(), resetMyPreferenceSection: jest.fn() },
}));
const getMine = api.getMyPreferences as jest.Mock;

function preferences(groups: string[]): MyPreferencesResponse {
    return {
        profile: null,
        legacy_browser_sections: [],
        sections: {
            invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
            tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
            tableColumns: { value: {}, source: 'default' },
            sidebar: { value: { appShellOpenGroups: groups }, source: 'member' },
            alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
            device: { value: {}, source: 'default' },
        },
    };
}

beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    usePreferencesStore.getState().clear();
    getMine.mockReset();
    signInForPreferences('t1:u1');
    setWorkspaceItem('store_id', 'branch-1');
});
afterEach(() => usePreferencesStore.getState().clear());

describe('usePreferencesLoader', () => {
    it('loads once per workspace session: switching branches does not ask again', async () => {
        getMine.mockResolvedValue(preferences(['sales']));
        const { client, rerender } = renderHookWithQueryClient(() => usePreferencesLoader(true));
        await waitFor(() => expect(usePreferencesStore.getState().scopeKey).toBe('t1:u1'));
        expect(getMine).toHaveBeenCalledTimes(1);

        // What the header's branch picker does: a new x-store-id, and the branch's answers dropped.
        act(() => {
            setWorkspaceItem('store_id', 'branch-2');
            resetWorkspaceQueries(client);
        });
        rerender(undefined);
        await act(async () => {
            await Promise.resolve();
        });

        expect(getMine).toHaveBeenCalledTimes(1);
        expect(usePreferencesStore.getState().ready).toBe(true);
        expect(usePreferencesStore.getState().data?.sections.sidebar.value).toEqual({ appShellOpenGroups: ['sales'] });
    });

    it('asks again for another workspace, and files the answer under it', async () => {
        getMine.mockResolvedValueOnce(preferences(['sales'])).mockResolvedValueOnce(preferences(['hr']));
        const { rerender } = renderHookWithQueryClient(() => usePreferencesLoader(true));
        await waitFor(() => expect(usePreferencesStore.getState().scopeKey).toBe('t1:u1'));

        act(() => {
            signInForPreferences('t2:u1');
        });
        rerender(undefined);

        await waitFor(() => expect(usePreferencesStore.getState().scopeKey).toBe('t2:u1'));
        expect(getMine).toHaveBeenCalledTimes(2);
        expect(usePreferencesStore.getState().data?.sections.sidebar.value).toEqual({ appShellOpenGroups: ['hr'] });
    });
});
