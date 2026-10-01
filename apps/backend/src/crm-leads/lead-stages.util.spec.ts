import { stageCounts } from './lead-stages.util';

describe('stageCounts()', () => {
    const opt = (id: string, sort_order: number, over: Record<string, unknown> = {}) => ({
        id, code: id.toUpperCase(), name: id, lifecycle: 'QUALIFIED', is_system: false,
        is_active: true, sort_order, ...over,
    });

    it('lists active stages in the tenant\'s order, zero-filled', () => {
        const result = stageCounts(
            [opt('b', 2), opt('a', 1), opt('c', 3)],
            [{ status_id: 'b', _count: { _all: 4 } }],
        );

        expect(result.map((s) => [s.id, s.count])).toEqual([['a', 0], ['b', 4], ['c', 0]]);
        expect(result[1]).toEqual({ id: 'b', code: 'B', name: 'b', lifecycle: 'QUALIFIED', is_system: false, count: 4 });
    });

    it('keeps a hidden stage only while leads still sit on it', () => {
        const result = stageCounts(
            [opt('a', 1), opt('gone', 2, { is_active: false }), opt('held', 3, { is_active: false })],
            [{ status_id: 'held', _count: { _all: 2 } }],
        );

        expect(result.map((s) => s.id)).toEqual(['a', 'held']);
    });

    it('ignores leads not yet given a stage', () => {
        const result = stageCounts([opt('a', 1)], [{ status_id: null, _count: { _all: 9 } }]);
        expect(result).toEqual([expect.objectContaining({ id: 'a', count: 0 })]);
    });
});
