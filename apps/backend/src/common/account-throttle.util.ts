import { ExecutionContext, SetMetadata, applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Throttle, type ThrottlerOptions } from '@nestjs/throttler';
import {
    DEFAULT_MOBILE_COUNTRY_CODE,
    looksLikeEmailIdentifier,
    resolveMobileToE164,
} from '@erp71/shared-types';

/**
 * A second rate-limit dimension for sign-in, keyed on the *account* being
 * reached for rather than on the address the request came from.
 *
 * The default throttler keys every bucket off `req.ip`, which is right for
 * ordinary traffic and wrong for sign-in, because this platform's customers sit
 * behind shared egress. A shop's whole floor leaves through one office NAT, and
 * a phone on Grameenphone or Robi shares a carrier-grade NAT address with a
 * large pool of strangers. A per-IP budget of ten login attempts a minute is
 * therefore not ten attempts each — it is ten between everyone on that address,
 * so the eleventh person to open the app at 9am is told
 * `ThrottlerException: Too Many Requests` while holding the right password.
 *
 * Splitting the two dimensions fixes that without loosening anything:
 *
 *  - the tight budget moves onto the account, which is where brute force
 *    actually happens. It now holds across every address an attacker can rent,
 *    where the per-IP version reset with each new one.
 *  - the per-IP budget stays on as a ceiling against one host spraying many
 *    accounts, raised to a number a shared NAT can live inside.
 *
 * Both dimensions must pass, so neither replaces the other.
 */
export const ACCOUNT_THROTTLER = 'account';

/** Marks the routes the account throttler runs on. Every other route skips it. */
const ACCOUNT_THROTTLED = 'erp71:account-throttled';

/** `skipIf` gets no injector, so the guard's own `Reflector` is out of reach. */
const reflector = new Reflector();

/**
 * Longest identifier worth giving a bucket of its own — RFC 5321's maximum
 * address length. Anything longer cannot name an account, so it is left to the
 * per-IP ceiling instead.
 */
const MAX_IDENTIFIER_LENGTH = 320;

/** How long an account's sign-in budget runs for, and how big it is. */
export const ACCOUNT_THROTTLE_TTL_MS = 60_000;
export const ACCOUNT_THROTTLE_LIMIT = 10;

/**
 * Rate-limit this route per account on top of its per-caller budget.
 *
 * The route keeps its own `@Throttle({ default: … })`; this adds the account
 * dimension beside it, and a request has to clear both.
 */
export function ThrottleAccount(options: { ttl: number; limit: number }) {
    return applyDecorators(
        SetMetadata(ACCOUNT_THROTTLED, true),
        Throttle({ [ACCOUNT_THROTTLER]: options }),
    );
}

/** A trimmed string, or `null` for anything that cannot be an identifier. */
function readIdentifier(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_IDENTIFIER_LENGTH) return null;
    return trimmed;
}

/**
 * Which account is this request reaching for?
 *
 * Guards run ahead of the validation pipe, so the body here is whatever the
 * caller posted rather than a `LoginDto` — every read is defensive, and a body
 * that is not an object at all is simply nameless.
 *
 * The lookup mirrors `AuthService.login`: `identifier` first, `email` as the
 * legacy alias the accept-invitation page still posts under, and an `@` as the
 * discriminator between an address and a number. A key that disagreed with the
 * service would hand one account two buckets and halve the limit's effect.
 *
 * Values are normalised so the same account cannot be spelled two ways for two
 * budgets: addresses are lower-cased, numbers go through the same E.164
 * resolution the service performs. A number that does not resolve keeps its own
 * bucket rather than falling back to the address — it belongs to someone who
 * mistyped their number, and pushing them back onto the shared per-IP bucket is
 * the very failure this exists to remove. Minting buckets from junk is what the
 * per-IP ceiling is there to bound.
 */
export function accountFromBody(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const posted = body as Record<string, unknown>;

    // `/auth/2fa/verify` names the account outright — no resolution needed.
    const userId = readIdentifier(posted.userId);
    if (userId) return `user:${userId.toLowerCase()}`;

    const identifier = readIdentifier(posted.identifier) ?? readIdentifier(posted.email);
    if (!identifier) return null;

    if (looksLikeEmailIdentifier(identifier)) return `email:${identifier.toLowerCase()}`;

    const countryCode = readIdentifier(posted.mobile_country_code) ?? DEFAULT_MOBILE_COUNTRY_CODE;
    return `mobile:${resolveMobileToE164(identifier, countryCode) ?? identifier.toLowerCase()}`;
}

/**
 * `getTracker` for the account throttler.
 *
 * Falls back to the caller's address when no account can be read: a body with
 * no identifier in it cannot sign anyone in, so those attempts share one bucket
 * per caller rather than each minting a fresh one.
 */
export const trackAccount = (req: Record<string, any>): string =>
    accountFromBody(req.body) ?? `ip:${req.ip}`;

function isAccountThrottled(context: ExecutionContext): boolean {
    return reflector.getAllAndOverride<boolean>(ACCOUNT_THROTTLED, [
        context.getHandler(),
        context.getClass(),
    ]) === true;
}

/**
 * The account throttler, for `ThrottlerModule.forRoot`.
 *
 * Declared globally because `forRoot` is the only place a throttler can be
 * defined, but `skipIf` keeps it inert everywhere except the routes that opt in
 * with {@link ThrottleAccount} — an unmarked route neither spends a bucket nor
 * allocates one.
 */
export const accountThrottler: ThrottlerOptions = {
    name: ACCOUNT_THROTTLER,
    ttl: ACCOUNT_THROTTLE_TTL_MS,
    limit: ACCOUNT_THROTTLE_LIMIT,
    getTracker: trackAccount,
    skipIf: (context: ExecutionContext) => !isAccountThrottled(context),
};
