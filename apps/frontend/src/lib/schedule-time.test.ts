import { dhakaLocalToIso, isoToDhakaLocal } from './schedule-time';

describe('dhakaLocalToIso', () => {
    it('stamps a datetime-local value as Dhaka time', () => {
        expect(dhakaLocalToIso('2026-08-10T14:30')).toBe('2026-08-10T14:30:00+06:00');
    });

    it('keeps seconds when the picker supplies them', () => {
        expect(dhakaLocalToIso('2026-08-10T14:30:45')).toBe('2026-08-10T14:30:45+06:00');
    });

    it('returns null for an empty value', () => {
        expect(dhakaLocalToIso('')).toBeNull();
    });

    it('resolves to the right instant', () => {
        expect(new Date(dhakaLocalToIso('2026-08-10T14:30')!).toISOString()).toBe(
            '2026-08-10T08:30:00.000Z',
        );
    });
});

describe('isoToDhakaLocal', () => {
    it('renders an instant as a Dhaka datetime-local value', () => {
        expect(isoToDhakaLocal('2026-08-10T08:30:00.000Z')).toBe('2026-08-10T14:30');
    });

    it('rolls over the date when Dhaka is already tomorrow', () => {
        expect(isoToDhakaLocal('2026-08-10T20:00:00.000Z')).toBe('2026-08-11T02:00');
    });

    it('returns an empty string for null', () => {
        expect(isoToDhakaLocal(null)).toBe('');
    });

    it.each(['not a date', '2026-13-45T99:99', ''])(
        'returns an empty string rather than throwing on %p',
        (bad) => {
            expect(() => isoToDhakaLocal(bad)).not.toThrow();
            expect(isoToDhakaLocal(bad)).toBe('');
        },
    );
});
