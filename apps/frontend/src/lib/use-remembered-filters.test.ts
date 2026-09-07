import { renderHook, act, waitFor } from '@testing-library/react';
import { useRememberedFilters } from './use-remembered-filters';

type Filters = { status: string; owner: string; overdue: boolean };

const DEFAULTS: Filters = { status: 'PLANNED', owner: '', overdue: false };

describe('useRememberedFilters', () => {
    beforeEach(() => sessionStorage.clear());

    it('starts at the defaults when nothing has been stored', async () => {
        const { result } = renderHook(() => useRememberedFilters('list', DEFAULTS));
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0]).toEqual(DEFAULTS);
    });

    it('gives back what a previous visit set', async () => {
        const first = renderHook(() => useRememberedFilters('list', DEFAULTS));
        await waitFor(() => expect(first.result.current[2]).toBe(true));
        act(() => first.result.current[1]('owner', 'user-2'));
        first.unmount();

        const { result } = renderHook(() => useRememberedFilters('list', DEFAULTS));
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0].owner).toBe('user-2');
    });

    it('keeps each list\'s filters to itself', async () => {
        const leads = renderHook(() => useRememberedFilters('leads', DEFAULTS));
        await waitFor(() => expect(leads.result.current[2]).toBe(true));
        act(() => leads.result.current[1]('owner', 'user-2'));

        const activities = renderHook(() => useRememberedFilters('activities', DEFAULTS));
        await waitFor(() => expect(activities.result.current[2]).toBe(true));
        expect(activities.result.current[0].owner).toBe('');
    });

    /** A deep link names the exact slice it counted; a leftover filter must not replace it. */
    it('leaves the caller\'s value alone for a key the URL supplied', async () => {
        const first = renderHook(() => useRememberedFilters('list', DEFAULTS));
        await waitFor(() => expect(first.result.current[2]).toBe(true));
        act(() => first.result.current[1]('owner', 'user-2'));
        act(() => first.result.current[1]('status', 'DONE'));
        first.unmount();

        const { result } = renderHook(() =>
            useRememberedFilters('list', { ...DEFAULTS, owner: 'unassigned' }, ['owner']),
        );
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0].owner).toBe('unassigned');
        // The keys the link said nothing about are still remembered.
        expect(result.current[0].status).toBe('DONE');
    });

    /** Adding a filter must not throw away what is already remembered. */
    it('starts a newly added filter at its default without losing the stored ones', async () => {
        const first = renderHook(() => useRememberedFilters('list', { status: 'PLANNED' }));
        await waitFor(() => expect(first.result.current[2]).toBe(true));
        act(() => first.result.current[1]('status', 'DONE'));
        first.unmount();

        const { result } = renderHook(() => useRememberedFilters('list', DEFAULTS));
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0]).toEqual({ status: 'DONE', owner: '', overdue: false });
    });

    /** A filter dropped in a later release must not come back out of an old entry. */
    it('ignores a stored key the page no longer has', async () => {
        sessionStorage.setItem('filters:list', JSON.stringify({ status: 'DONE', retired: 'x' }));
        const { result } = renderHook(() => useRememberedFilters('list', DEFAULTS));
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0]).toEqual({ status: 'DONE', owner: '', overdue: false });
        expect('retired' in result.current[0]).toBe(false);
    });

    it('falls back to the defaults on a corrupt entry rather than throwing', async () => {
        sessionStorage.setItem('filters:list', 'not json');
        const { result } = renderHook(() => useRememberedFilters('list', DEFAULTS));
        await waitFor(() => expect(result.current[2]).toBe(true));
        expect(result.current[0]).toEqual(DEFAULTS);
    });

    it('still filters when storage is blocked', async () => {
        const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        try {
            const { result } = renderHook(() => useRememberedFilters('list', DEFAULTS));
            await waitFor(() => expect(result.current[2]).toBe(true));
            act(() => result.current[1]('owner', 'user-2'));
            expect(result.current[0].owner).toBe('user-2');
        } finally {
            setItem.mockRestore();
        }
    });
});
