/**
 * Distance between two points on the earth, for deciding whether a check-in
 * happened at a store.
 */

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export interface Point {
    latitude: number;
    longitude: number;
}

/**
 * Great-circle distance in metres (haversine).
 *
 * Haversine rather than a flat-earth approximation: the approximation is fine
 * at 200m, but it needs a latitude-dependent correction that is easy to get
 * subtly wrong, and this runs once per check-in — there is no performance
 * argument for the cheaper formula.
 */
export function distanceMetres(a: Point, b: Point): number {
    const dLat = toRadians(b.latitude - a.latitude);
    const dLng = toRadians(b.longitude - a.longitude);
    const lat1 = toRadians(a.latitude);
    const lat2 = toRadians(b.latitude);

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceStore {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
}

export interface GeofenceMatch {
    store: GeofenceStore | null;
    distanceMetres: number | null;
    withinFence: boolean;
}

/**
 * The nearest store with coordinates, and whether the point is inside its fence.
 *
 * Returns the nearest store even when it is out of range, so the caller can say
 * "you are 4km from Gulshan Branch" rather than "rejected" — an employee who
 * genuinely is at work and is being refused needs to know by how much.
 *
 * With no store carrying coordinates there is nothing to measure against, so
 * `withinFence` is **true**: a tenant that switched geofencing on without
 * setting a location must not have every check-in refused. Enforcing a fence
 * that does not exist would read as the feature being broken.
 */
export function matchStore(
    point: Point,
    stores: GeofenceStore[],
    radiusMetres: number,
): GeofenceMatch {
    const located = stores.filter(
        (store): store is GeofenceStore & Point =>
            store.latitude != null && store.longitude != null,
    );
    if (located.length === 0) {
        return { store: null, distanceMetres: null, withinFence: true };
    }

    let nearest = located[0];
    let best = distanceMetres(point, nearest);
    for (const store of located.slice(1)) {
        const distance = distanceMetres(point, store);
        if (distance < best) {
            best = distance;
            nearest = store;
        }
    }

    return {
        store: nearest,
        distanceMetres: Math.round(best),
        withinFence: best <= radiusMetres,
    };
}

/** Whether a coordinate pair is a usable point on earth. */
export function isValidPoint(
    latitude: number | null | undefined,
    longitude: number | null | undefined,
): boolean {
    if (latitude == null || longitude == null) return false;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    // (0, 0) is in the Gulf of Guinea and is overwhelmingly a device returning
    // an unset value rather than a real fix. Rejecting it is the pragmatic call
    // for a Bangladeshi retail app; it would be wrong for a maritime one.
    if (latitude === 0 && longitude === 0) return false;
    return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}
