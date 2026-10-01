import { nextSprintDates, nextSprintName } from './complete-sprint-defaults';

describe('nextSprintName', () => {
    it.each([
        ['Sprint 7', 'Sprint 8'],
        ['Sprint 9', 'Sprint 10'],
        ['Sprint 09', 'Sprint 10'],
        ['Sprint 007', 'Sprint 008'],
        ['Release 2.1', 'Release 2.2'],
        ['2026 W40', '2026 W41'],
        ['Q3 sprint', 'Q3 sprint 2'],
        ['Hardening', 'Hardening 2'],
        ['  Sprint 3  ', 'Sprint 4'],
    ])('%s → %s', (name, next) => {
        expect(nextSprintName(name)).toBe(next);
    });
});

describe('nextSprintDates', () => {
    it('starts the day after the old sprint ends and keeps its length', () => {
        expect(nextSprintDates('2026-08-02', '2026-08-13')).toEqual({
            startDate: '2026-08-14',
            endDate: '2026-08-25',
        });
    });

    it('reads full ISO timestamps the API sends', () => {
        expect(nextSprintDates('2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z')).toEqual({
            startDate: '2026-08-03',
            endDate: '2026-08-03',
        });
    });

    it('crosses a month end', () => {
        expect(nextSprintDates('2026-09-21', '2026-09-30')).toEqual({
            startDate: '2026-10-01',
            endDate: '2026-10-10',
        });
    });
});
