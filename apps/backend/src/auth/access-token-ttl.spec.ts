import { parseTtlSeconds, accessTokenTtlSeconds } from './access-token-ttl';

describe('parseTtlSeconds', () => {
    it.each([
        ['900', 900],
        ['45s', 45],
        ['15m', 900],
        ['2h', 7200],
        ['1d', 86400],
        ['  30m  ', 1800],
    ])('reads %s as %i seconds', (raw, expected) => {
        expect(parseTtlSeconds(raw)).toBe(expected);
    });

    it.each(['', undefined, '0', '-5m', 'forever', '10w', '1.5h'])(
        'rejects %s so the caller falls back to the default',
        (raw) => {
            expect(parseTtlSeconds(raw as any)).toBeNull();
        },
    );
});

describe('accessTokenTtlSeconds', () => {
    const original = process.env.JWT_ACCESS_TTL;
    afterEach(() => {
        if (original === undefined) delete process.env.JWT_ACCESS_TTL;
        else process.env.JWT_ACCESS_TTL = original;
    });

    it('defaults to an hour', () => {
        delete process.env.JWT_ACCESS_TTL;
        expect(accessTokenTtlSeconds()).toBe(3600);
    });

    it('honours the environment override', () => {
        process.env.JWT_ACCESS_TTL = '15m';
        expect(accessTokenTtlSeconds()).toBe(900);
    });

    it('ignores an unparseable override rather than issuing a token that never expires', () => {
        process.env.JWT_ACCESS_TTL = 'soon';
        expect(accessTokenTtlSeconds()).toBe(3600);
    });
});
