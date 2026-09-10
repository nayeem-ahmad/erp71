import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * The platform's rate-limit guard: `ThrottlerGuard` with an answer a person can
 * act on.
 *
 * Out of the box a throttled caller gets `ThrottlerException: Too Many
 * Requests` — the library's own class name, with no indication of how long to
 * wait — and the frontend renders whatever message the server sent, so that
 * string is verbatim what a shopkeeper reads on the sign-in screen. It reads
 * like a crash, not like "wait a moment", and there is nothing in it to wait
 * for.
 *
 * This replaces it with a sentence naming the wait, a stable `code` for callers
 * that would otherwise match on the copy, and the wait itself in both
 * `Retry-After` and the body.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
    protected async throwThrottlingException(
        context: ExecutionContext,
        detail: ThrottlerLimitDetail,
    ): Promise<void> {
        const { res } = this.getRequestResponse(context);
        // Never below one second: a sub-second remainder rounds down to 0, which
        // reads as "retry immediately" and invites a hot loop against a route
        // that is still blocked.
        const retryAfter = Math.max(1, Math.ceil(detail.timeToBlockExpire));
        // The library sets a bare `Retry-After` only for the unnamed default
        // throttler; a named one gets `Retry-After-<name>`, which no HTTP client
        // knows to read. Set the standard header whichever dimension tripped.
        res.header('Retry-After', String(retryAfter));

        throw new HttpException(
            {
                code: 'TOO_MANY_REQUESTS',
                message: `Too many requests. Please wait ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'} and try again.`,
                // Also in the body because the browser cannot read a response
                // header cross-origin unless it is in `Access-Control-Expose-
                // Headers`, and the frontend needs the number to say the wait in
                // the reader's own language.
                retry_after: retryAfter,
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
}
