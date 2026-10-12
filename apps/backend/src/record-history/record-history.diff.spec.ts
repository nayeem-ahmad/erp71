import { Prisma } from '@prisma/client';
import { diffSnapshots, normalizeSnapshot } from './record-history.diff';

describe('normalizeSnapshot', () => {
    it('turns decimals into numbers and dates into ISO strings, recursively', () => {
        const out = normalizeSnapshot({
            price: new Prisma.Decimal('1500.50'),
            sold_at: new Date('2026-10-12T04:00:00.000Z'),
            items: [{ qty: new Prisma.Decimal('2') }],
            missing: undefined,
        });
        expect(out).toEqual({
            price: 1500.5,
            sold_at: '2026-10-12T04:00:00.000Z',
            items: [{ qty: 2 }],
        });
    });

    it('stringifies bigints rather than throwing', () => {
        expect(normalizeSnapshot({ big: BigInt(12) })).toEqual({ big: '12' });
    });
});

describe('diffSnapshots', () => {
    it('reports changed scalar fields only', () => {
        expect(
            diffSnapshots(
                { name: 'Rahim', phone: '017', due_balance: 0 },
                { name: 'Rahim Store', phone: '017', due_balance: 0 },
            ),
        ).toEqual([{ path: 'name', from: 'Rahim', to: 'Rahim Store' }]);
    });

    it('treats null and a missing key as the same value', () => {
        expect(diffSnapshots({ email: null }, {})).toEqual([]);
        expect(diffSnapshots({}, { email: 'a@b.c' })).toEqual([{ path: 'email', from: null, to: 'a@b.c' }]);
    });

    it('ignores underscore-prefixed bookkeeping keys', () => {
        expect(diffSnapshots({ _key: 'a', name: 'x' }, { _key: 'b', name: 'x' })).toEqual([]);
    });

    it('walks nested objects with dotted paths', () => {
        expect(diffSnapshots({ customer: { name: 'A' } }, { customer: { name: 'B' } })).toEqual([
            { path: 'customer.name', from: 'A', to: 'B' },
        ]);
    });

    it('matches keyed array items by key and names them by label', () => {
        const before = {
            items: [
                { _key: 'p1', _label: 'Rice 5kg', quantity: 2, price: 500 },
                { _key: 'p2', _label: 'Oil 1L', quantity: 1, price: 200 },
            ],
        };
        const after = {
            items: [
                // Re-ordered and re-created with new row ids: still the same line.
                { _key: 'p2', _label: 'Oil 1L', quantity: 1, price: 200 },
                { _key: 'p1', _label: 'Rice 5kg', quantity: 3, price: 500 },
                { _key: 'p3', _label: 'Sugar', quantity: 1, price: 120 },
            ],
        };
        expect(diffSnapshots(before, after)).toEqual([
            { path: 'items[Rice 5kg].quantity', from: 2, to: 3 },
            { path: 'items[Sugar]', from: null, to: { quantity: 1, price: 120 } },
        ]);
    });

    it('reports a removed keyed item with its old values', () => {
        expect(
            diffSnapshots(
                { items: [{ _key: 'p1', _label: 'Rice', quantity: 2 }] },
                { items: [] },
            ),
        ).toEqual([{ path: 'items[Rice]', from: { quantity: 2 }, to: null }]);
    });

    it('compares unkeyed arrays as whole values', () => {
        expect(diffSnapshots({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([]);
        expect(diffSnapshots({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual([
            { path: 'tags', from: ['a'], to: ['a', 'b'] },
        ]);
    });

    it('falls back to the key when an item has no label', () => {
        expect(
            diffSnapshots({ rows: [{ _key: 'k1', amount: 1 }] }, { rows: [{ _key: 'k1', amount: 2 }] }),
        ).toEqual([{ path: 'rows[k1].amount', from: 1, to: 2 }]);
    });
});
