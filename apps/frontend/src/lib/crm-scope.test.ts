import { act, renderHook } from '@testing-library/react';
import { getCrmMineOnly, persistCrmMineOnly, useCrmMineOnly } from './crm-scope';

describe('CRM "only mine" scope', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to showing everything', () => {
        expect(getCrmMineOnly()).toBe(false);
    });

    /**
     * The whole point of the preference: it is not a per-visit filter, so it has
     * to survive the tab closing. `localStorage`, not the `sessionStorage` the
     * per-page filters use.
     */
    it('remembers the choice across mounts', () => {
        const first = renderHook(() => useCrmMineOnly());
        act(() => first.result.current.setMineOnly(true));
        first.unmount();

        const second = renderHook(() => useCrmMineOnly());
        expect(second.result.current.mineOnly).toBe(true);
        expect(localStorage.getItem('crm_mine_only')).toBe('true');
    });

    it('remembers switching back off, rather than only remembering the on state', () => {
        persistCrmMineOnly(true);

        const { result } = renderHook(() => useCrmMineOnly());
        act(() => result.current.setMineOnly(false));

        expect(getCrmMineOnly()).toBe(false);
        expect(renderHook(() => useCrmMineOnly()).result.current.mineOnly).toBe(false);
    });

    /**
     * Callers hold their first request until this flips, so a return visit does
     * not fetch the whole team's rows and then replace them.
     */
    it('reports ready only once the stored choice has been read', () => {
        const { result } = renderHook(() => useCrmMineOnly());
        expect(result.current.ready).toBe(true);
        expect(result.current.mineOnly).toBe(false);
    });

    it('moves every mounted instance together', () => {
        const a = renderHook(() => useCrmMineOnly());
        const b = renderHook(() => useCrmMineOnly());

        act(() => a.result.current.setMineOnly(true));

        expect(a.result.current.mineOnly).toBe(true);
        expect(b.result.current.mineOnly).toBe(true);
    });

    it('stops listening once unmounted, so a stale setter is never called', () => {
        const a = renderHook(() => useCrmMineOnly());
        const b = renderHook(() => useCrmMineOnly());
        b.unmount();

        // Would warn about setting state on an unmounted hook if the listener
        // outlived it.
        expect(() => act(() => a.result.current.setMineOnly(true))).not.toThrow();
    });

    it('falls back to showing everything when storage is unavailable', () => {
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });

        try {
            expect(getCrmMineOnly()).toBe(false);
            // Not remembering the choice is better than failing to make it.
            expect(() => persistCrmMineOnly(true)).not.toThrow();
        } finally {
            getItem.mockRestore();
            setItem.mockRestore();
        }
    });
});
