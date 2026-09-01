import {
    importDate,
    importEnum,
    importList,
    importNumber,
    importText,
    importTimeOfDay,
    lookup,
    nameIndex,
    requiredText,
} from './project-import.util';

describe('project import helpers', () => {
    describe('importText', () => {
        it('trims a cell and reads every empty shape as absent', () => {
            expect(importText('  ACME  ')).toBe('ACME');
            expect(importText('')).toBeNull();
            expect(importText('   ')).toBeNull();
            expect(importText(null)).toBeNull();
            expect(importText(undefined)).toBeNull();
        });

        it('keeps a zero, which is a value rather than a blank', () => {
            expect(importText(0)).toBe('0');
        });
    });

    describe('requiredText', () => {
        it('names the field when the cell is blank', () => {
            expect(() => requiredText('  ', 'Project')).toThrow('Project is required');
        });
    });

    describe('importNumber', () => {
        it('reads a figure and passes a blank through as absent', () => {
            expect(importNumber('3.5', 'Hours')).toBe(3.5);
            expect(importNumber('', 'Hours')).toBeNull();
        });

        it('fails the row naming the cell it could not read', () => {
            expect(() => importNumber('three', 'Hours')).toThrow(
                'Hours must be a number (got "three")',
            );
        });
    });

    describe('importDate', () => {
        /**
         * The load-bearing case: parsing `2026-08-03` through `Date` reads it as
         * UTC midnight, which is 2 August anywhere west of Greenwich. A day-only
         * value has to survive an import unchanged.
         */
        it('keeps a plain YYYY-MM-DD exactly as written', () => {
            expect(importDate('2026-08-03', 'Work date')).toBe('2026-08-03');
        });

        it('reduces a timestamp to its day', () => {
            expect(importDate('2026-08-03T09:30:00.000Z', 'Work date')).toBe('2026-08-03');
        });

        it('fails the row on something that is not a date', () => {
            expect(() => importDate('last tuesday', 'Due date')).toThrow(
                'Due date is not a date (got "last tuesday")',
            );
        });
    });

    describe('importTimeOfDay', () => {
        it('normalises a single-digit hour and drops seconds', () => {
            expect(importTimeOfDay('9:05', 'Start time')).toBe('09:05');
            expect(importTimeOfDay('14:30:00', 'Start time')).toBe('14:30');
        });

        it.each(['9am', '25:00', '10:75', 'noon'])('refuses %s', (value) => {
            expect(() => importTimeOfDay(value, 'Start time')).toThrow('Start time must be a time');
        });
    });

    describe('importEnum', () => {
        it('matches without regard to case', () => {
            expect(importEnum('high', ['LOW', 'HIGH'] as const, 'Priority')).toBe('HIGH');
        });

        it('lists what was allowed when nothing matches', () => {
            expect(() => importEnum('urgent-ish', ['LOW', 'HIGH'] as const, 'Priority')).toThrow(
                'Priority must be one of LOW, HIGH (got "urgent-ish")',
            );
        });
    });

    describe('importList', () => {
        it('splits on commas or semicolons and drops the gaps', () => {
            expect(importList('billable, , review;urgent')).toEqual([
                'billable',
                'review',
                'urgent',
            ]);
            expect(importList('')).toEqual([]);
        });
    });

    describe('nameIndex', () => {
        const projects = [
            { id: 'p1', code: 'ACME', short_name: null, name: 'Shared' },
            { id: 'p2', code: 'BETA', short_name: 'Shared', name: 'Beta rollout' },
        ];
        const index = nameIndex(
            projects,
            (project) => [project.code, project.short_name, project.name],
            (project) => project.id,
        );

        it('finds a record by any of its names, case-insensitively', () => {
            expect(index.get('acme')).toBe('p1');
            expect(index.get('beta rollout')).toBe('p2');
        });

        /**
         * A short name is a stronger claim on a word than another project's full
         * name, so indexing has to run key-position by key-position rather than
         * record by record — otherwise the first project's `name` would take the
         * key before the second project's `short_name` was ever considered.
         */
        it('gives a name to the record holding it in the higher-priority column', () => {
            expect(index.get('shared')).toBe('p2');
        });
    });

    describe('lookup', () => {
        const index = new Map([['acme', 'p1']]);

        it('finds a value however it was cased or padded', () => {
            expect(lookup(index, '  Acme ', 'no project matches')).toBe('p1');
        });

        it('fails the row quoting what was not found', () => {
            expect(() => lookup(index, 'ACME-2', 'no project matches')).toThrow(
                'no project matches "ACME-2"',
            );
        });
    });
});
