import {
    applyCreatedRangeQuery,
    applyDateRangeQuery,
    applyDueRangeQuery,
    createdRangeFromPreset,
    formatCreatedRangeLabel,
    isCreatedRangeEmpty,
} from './created-range';

/** 19 Aug 2026 10:00 Dhaka = 19 Aug 2026 04:00 UTC. */
const NOW = new Date('2026-08-19T04:00:00.000Z');

describe('createdRangeFromPreset', () => {
    it('resolves Today as the Dhaka calendar day, not UTC', () => {
        // 18 Aug 20:00 UTC is already 19 Aug 02:00 in Dhaka.
        const justAfterDhakaMidnight = new Date('2026-08-18T20:00:00.000Z');
        expect(createdRangeFromPreset('today', justAfterDhakaMidnight)).toEqual({
            from: '2026-08-19',
            to: '2026-08-19',
        });
    });

    it('resolves Yesterday, Last 7 days, and This month from the Dhaka today', () => {
        expect(createdRangeFromPreset('yesterday', NOW)).toEqual({
            from: '2026-08-18',
            to: '2026-08-18',
        });
        expect(createdRangeFromPreset('last7', NOW)).toEqual({
            from: '2026-08-13',
            to: '2026-08-19',
        });
        expect(createdRangeFromPreset('thisMonth', NOW)).toEqual({
            from: '2026-08-01',
            to: '2026-08-19',
        });
    });
});

describe('formatCreatedRangeLabel', () => {
    it('returns the empty-state label when nothing is picked', () => {
        expect(formatCreatedRangeLabel(null, 'Any time')).toBe('Any time');
        expect(formatCreatedRangeLabel({}, 'Any time')).toBe('Any time');
    });

    it('collapses a single day and joins a span', () => {
        expect(formatCreatedRangeLabel({ from: '2026-08-19', to: '2026-08-19' }, 'Any time')).toBe(
            '19 Aug',
        );
        expect(formatCreatedRangeLabel({ from: '2026-08-12', to: '2026-08-19' }, 'Any time')).toBe(
            '12 Aug – 19 Aug',
        );
    });
});

describe('applyCreatedRangeQuery', () => {
    it('omits both keys when the range is empty so the list stays unfiltered', () => {
        expect(applyCreatedRangeQuery(null)).toEqual({});
        expect(isCreatedRangeEmpty({ from: '', to: '' })).toBe(true);
    });

    it('sends createdFrom/createdTo as YYYY-MM-DD', () => {
        expect(applyCreatedRangeQuery({ from: '2026-08-12', to: '2026-08-19' })).toEqual({
            createdFrom: '2026-08-12',
            createdTo: '2026-08-19',
        });
    });
});

describe('applyDueRangeQuery', () => {
    it('sends nothing for an empty range', () => {
        expect(applyDueRangeQuery(null)).toEqual({});
    });

    it('names the bounds dueFrom/dueTo so they filter due_at, not created_at', () => {
        expect(applyDueRangeQuery({ from: '2026-08-01', to: '2026-08-25' })).toEqual({
            dueFrom: '2026-08-01',
            dueTo: '2026-08-25',
        });
    });

    it('omits an absent bound', () => {
        expect(applyDueRangeQuery({ from: '2026-08-01' })).toEqual({ dueFrom: '2026-08-01' });
    });
});

describe('formatCreatedRangeLabel with times', () => {
    it('prints the minute on each timed bound', () => {
        expect(
            formatCreatedRangeLabel({ from: '2026-10-12T18:00', to: '2026-10-13T02:00' }, 'Any time'),
        ).toBe('12 Oct 18:00 – 13 Oct 02:00');
    });

    it('names the day once when both times fall on it', () => {
        expect(
            formatCreatedRangeLabel({ from: '2026-10-12T09:00', to: '2026-10-12T13:00' }, 'Any time'),
        ).toBe('12 Oct 09:00 – 13:00');
    });

    it('keeps an open end readable', () => {
        expect(formatCreatedRangeLabel({ from: '2026-10-12T18:00' }, 'Any time')).toBe('12 Oct 18:00 –');
    });
});

describe('applyDateRangeQuery', () => {
    it('sends dateFrom/dateTo so they filter the transaction date, not created_at', () => {
        expect(applyDateRangeQuery({ from: '2026-10-12T18:00', to: '2026-10-13' })).toEqual({
            dateFrom: '2026-10-12T18:00',
            dateTo: '2026-10-13',
        });
    });

    it('sends nothing for an empty range', () => {
        expect(applyDateRangeQuery(null)).toEqual({});
    });
});
