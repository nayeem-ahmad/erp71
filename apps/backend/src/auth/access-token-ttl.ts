/**
 * How long an app access token lives.
 *
 * Short by design: the frontend renews it silently against a refresh token, so
 * the ceiling no longer decides when someone's working day is interrupted.
 *
 * It is *not* what makes a revoked session stop working — `JwtStrategy` checks
 * `token_version` against the database on every request, so a logout or a
 * password change takes effect immediately regardless of this value. That is
 * why the default is an hour rather than the customary few minutes: shortening
 * it further buys no revocation speed here, and only multiplies the number of
 * refresh round-trips that could go wrong.
 */

const DEFAULT_TTL_SECONDS = 60 * 60;

/** Accepts `900`, `15m`, `2h`, `1d` — the same vocabulary `jsonwebtoken` takes. */
export function parseTtlSeconds(raw: string | undefined): number | null {
    if (!raw) return null;
    const match = /^(\d+)([smhd]?)$/.exec(raw.trim());
    if (!match) return null;

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;

    const multiplier = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 1;
    return value * multiplier;
}

export function accessTokenTtlSeconds(): number {
    return parseTtlSeconds(process.env.JWT_ACCESS_TTL) ?? DEFAULT_TTL_SECONDS;
}

/** The same value in the form `jwtService.sign` wants. */
export function accessTokenTtl(): number {
    return accessTokenTtlSeconds();
}
