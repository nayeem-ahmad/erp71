import { act, renderHook } from '@testing-library/react';
import { DEFAULT_TABLE_VIEW } from './view-settings';

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
