import { parseServerTiming } from './server-timing';

describe('parseServerTiming', () => {
    it('reads the durations', () => {
        expect(parseServerTiming('auth;dur=8, db;dur=20.3, app;dur=6, total;dur=34.3')).toEqual({
            authMs: 8,
            dbMs: 20.3,
            appMs: 6,
            totalMs: 34.3,
            authQueries: undefined,
            dbQueries: undefined,
        });
    });

    it('reads the query counts platform staff get', () => {
        expect(parseServerTiming('auth;dur=8;desc="1 query", db;dur=20;desc="9 queries", app;dur=6, total;dur=34')).toMatchObject({
            authQueries: 1,
            dbQueries: 9,
        });
    });

    it('is null without a total', () => {
        expect(parseServerTiming(null)).toBeNull();
        expect(parseServerTiming('')).toBeNull();
        expect(parseServerTiming('cache;desc="hit"')).toBeNull();
    });
});
