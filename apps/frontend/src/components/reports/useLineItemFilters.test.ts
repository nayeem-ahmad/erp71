import { act, renderHook } from '@testing-library/react';
import { setActiveTimeZone } from '@/lib/format';
import { defaultLineItemWindow, useLineItemFilters } from './useLineItemFilters';

const searchParams = new Map<string, string>();

jest.mock('next/navigation', () => ({
    useSearchParams: () => ({ get: (key: string) => searchParams.get(key) ?? null }),
}));

jest.mock('@/lib/api', () => ({
    api: { getStores: jest.fn().mockResolvedValue([]) },
}));

describe('defaultLineItemWindow', () => {
    afterEach(() => setActiveTimeZone(null));

    it('covers the last 30 days ending today in the workspace’s zone', () => {
        setActiveTimeZone('Asia/Dhaka');
        // 20:30 UTC on 30 September is already 1 October in Dhaka.
        expect(defaultLineItemWindow(new Date('2026-09-30T20:30:00Z'))).toEqual({
            from: '2026-09-02',
            to: '2026-10-01',
        });
    });

    it('crosses a month and a leap day correctly', () => {
        setActiveTimeZone('Asia/Dhaka');
        expect(defaultLineItemWindow(new Date('2028-03-10T06:00:00Z'))).toEqual({
            from: '2028-02-10',
            to: '2028-03-10',
        });
    });
});

describe('useLineItemFilters', () => {
    beforeEach(() => searchParams.clear());

    it('opens on the default window with nothing narrowed', () => {
        const { result } = renderHook(() => useLineItemFilters('customerId'));

        expect(result.current.query).toEqual({
            ...defaultLineItemWindow(),
            storeId: undefined,
            productId: undefined,
            customerId: undefined,
            search: undefined,
        });
    });

    it('seeds the filters from a deep link and names them from the first response', () => {
        searchParams.set('supplierId', 'sup-1');
        searchParams.set('productId', 'prod-1');
        searchParams.set('from', '2026-01-01');
        searchParams.set('to', '2026-01-31');

        const { result } = renderHook(() => useLineItemFilters('supplierId'));

        expect(result.current.query).toMatchObject({
            from: '2026-01-01',
            to: '2026-01-31',
            supplierId: 'sup-1',
            productId: 'prod-1',
        });
        expect(result.current.party).toEqual({ id: 'sup-1', name: '' });

        act(() =>
            result.current.nameFromResponse({
                party: { id: 'sup-1', name: 'Rahman Traders', phone: '01811000001' },
                product: { id: 'prod-1', name: 'Miniket Rice 5kg', sku: 'RICE-5' },
            }),
        );

        expect(result.current.party).toEqual({ id: 'sup-1', name: 'Rahman Traders', detail: '01811000001' });
        expect(result.current.product).toEqual({ id: 'prod-1', name: 'Miniket Rice 5kg', detail: 'RICE-5' });
    });

    it('leaves a pick the user made alone when a response names something else', () => {
        const { result } = renderHook(() => useLineItemFilters('customerId'));
        act(() => result.current.setParty({ id: 'c2', name: 'Karim Ahmed' }));

        act(() => result.current.nameFromResponse({ party: { id: 'c1', name: 'Rahim Uddin' } }));

        expect(result.current.party).toEqual({ id: 'c2', name: 'Karim Ahmed' });
    });

    it('resets to the opening window', () => {
        const { result } = renderHook(() => useLineItemFilters('customerId'));
        act(() => {
            result.current.setFrom('2025-01-01');
            result.current.setStoreId('store-1');
            result.current.setParty({ id: 'c1', name: 'Rahim Uddin' });
            result.current.setSearch('rice');
        });

        act(() => result.current.reset());

        expect(result.current.query).toEqual({
            ...defaultLineItemWindow(),
            storeId: undefined,
            productId: undefined,
            customerId: undefined,
            search: undefined,
        });
        expect(result.current.search).toBe('');
    });
});
