import { resolveOrderBy, SortableMap } from './sort.util';

const sortable: SortableMap = {
    name: (dir) => ({ name: dir }),
    created_at: (dir) => ({ created_at: dir }),
};
const fallback = [{ next_step_date: 'asc' }, { updated_at: 'desc' }];

describe('resolveOrderBy', () => {
    it('maps an allowlisted key ascending', () => {
        expect(resolveOrderBy('name', 'asc', sortable, fallback)).toEqual({ name: 'asc' });
    });

    it('maps an allowlisted key descending', () => {
        expect(resolveOrderBy('created_at', 'desc', sortable, fallback)).toEqual({ created_at: 'desc' });
    });

    it('defaults direction to asc when sortDir is missing', () => {
        expect(resolveOrderBy('name', undefined, sortable, fallback)).toEqual({ name: 'asc' });
    });

    it('defaults direction to asc when sortDir is invalid', () => {
        expect(resolveOrderBy('name', 'sideways', sortable, fallback)).toEqual({ name: 'asc' });
    });

    it('falls back when sortBy is absent', () => {
        expect(resolveOrderBy(undefined, 'asc', sortable, fallback)).toBe(fallback);
    });

    it('falls back when sortBy is not allowlisted', () => {
        expect(resolveOrderBy('password', 'asc', sortable, fallback)).toBe(fallback);
    });
});
