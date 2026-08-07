import { distanceMetres, isValidPoint, matchStore } from './geofence.util';

/** Two points in Dhaka roughly 1.1km apart, for a sanity anchor. */
const GULSHAN = { latitude: 23.7925, longitude: 90.4078 };
const BANANI = { latitude: 23.7937, longitude: 90.4066 };

describe('geofence.util', () => {
    describe('distanceMetres', () => {
        it('is zero for the same point', () => {
            expect(distanceMetres(GULSHAN, GULSHAN)).toBe(0);
        });

        it('is symmetric', () => {
            expect(distanceMetres(GULSHAN, BANANI)).toBeCloseTo(distanceMetres(BANANI, GULSHAN), 6);
        });

        it('measures a known short hop in Dhaka to within a few metres', () => {
            // ~0.0012° lat + ~0.0012° lng at this latitude ≈ 175m.
            expect(distanceMetres(GULSHAN, BANANI)).toBeGreaterThan(150);
            expect(distanceMetres(GULSHAN, BANANI)).toBeLessThan(200);
        });

        it('measures one degree of latitude as about 111km', () => {
            const d = distanceMetres({ latitude: 23, longitude: 90 }, { latitude: 24, longitude: 90 });
            expect(d).toBeGreaterThan(110_000);
            expect(d).toBeLessThan(112_000);
        });

        it('handles antipodal points without NaN', () => {
            // The naive haversine can push the sqrt argument just over 1 through
            // floating-point error; the clamp is what stops asin returning NaN.
            const d = distanceMetres({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
            expect(Number.isNaN(d)).toBe(false);
            expect(d).toBeGreaterThan(20_000_000);
        });
    });

    describe('matchStore', () => {
        const stores = [
            { id: 's1', name: 'Gulshan', latitude: 23.7925, longitude: 90.4078 },
            { id: 's2', name: 'Chittagong', latitude: 22.3569, longitude: 91.7832 },
        ];

        it('picks the nearest store and admits a point inside the fence', () => {
            const match = matchStore(GULSHAN, stores, 200);
            expect(match.store?.id).toBe('s1');
            expect(match.withinFence).toBe(true);
            expect(match.distanceMetres).toBe(0);
        });

        it('picks the nearest store even when out of range', () => {
            // Returning the nearest anyway is what lets the caller say "you are
            // 4km from Gulshan" instead of a bare rejection.
            const match = matchStore({ latitude: 23.83, longitude: 90.41 }, stores, 200);
            expect(match.store?.id).toBe('s1');
            expect(match.withinFence).toBe(false);
            expect(match.distanceMetres).toBeGreaterThan(200);
        });

        it('admits a point exactly on the fence', () => {
            const match = matchStore(GULSHAN, stores, 0);
            expect(match.withinFence).toBe(true);
        });

        it('passes when no store has coordinates', () => {
            // A tenant that switched geofencing on without setting a location
            // must not have every check-in refused — that reads as the feature
            // being broken rather than as a misconfiguration.
            const match = matchStore(GULSHAN, [
                { id: 's1', name: 'Nowhere', latitude: null, longitude: null },
            ], 200);
            expect(match.withinFence).toBe(true);
            expect(match.store).toBeNull();
            expect(match.distanceMetres).toBeNull();
        });

        it('passes with no stores at all', () => {
            expect(matchStore(GULSHAN, [], 200).withinFence).toBe(true);
        });

        it('ignores stores missing one half of the pair', () => {
            const match = matchStore(GULSHAN, [
                { id: 's1', name: 'Half', latitude: 23.79, longitude: null },
                { id: 's2', name: 'Whole', latitude: 23.7925, longitude: 90.4078 },
            ], 200);
            expect(match.store?.id).toBe('s2');
        });
    });

    describe('isValidPoint', () => {
        it('accepts a real fix', () => {
            expect(isValidPoint(23.7925, 90.4078)).toBe(true);
        });

        it('rejects a missing half', () => {
            expect(isValidPoint(23.79, null)).toBe(false);
            expect(isValidPoint(null, 90.4)).toBe(false);
            expect(isValidPoint(undefined, undefined)).toBe(false);
        });

        it('rejects null island', () => {
            // (0,0) is overwhelmingly a device returning an unset value rather
            // than a real fix in the Gulf of Guinea.
            expect(isValidPoint(0, 0)).toBe(false);
        });

        it('accepts a genuine zero on one axis', () => {
            expect(isValidPoint(0, 90.4)).toBe(true);
        });

        it('rejects out-of-range degrees', () => {
            expect(isValidPoint(91, 90)).toBe(false);
            expect(isValidPoint(23, 181)).toBe(false);
        });

        it('rejects NaN and Infinity', () => {
            expect(isValidPoint(NaN, 90)).toBe(false);
            expect(isValidPoint(23, Infinity)).toBe(false);
        });
    });
});
