# Story 2.1: Implement API Rate Limiting

Status: review

## Story

As a System Administrator,
I want to implement rate limiting for our API,
so that we can protect our infrastructure from abuse and ensure fair usage for all tenants.

## Acceptance Criteria

1.  Rate limiting middleware implemented using Upstash Redis or Vercel KV. [x]
2.  Customizable rate limits per store (e.g., 100 req/min). [x]
3.  Automated 429 Too Many Requests response with "Retry-After" header. [x]

## Tasks / Subtasks

- [x] Task 1: Initialize Redis/KV Client
  - [x] Set up `@upstash/redis` or `@vercel/kv`.
  - [x] Configure environment variables for local and production.
- [x] Task 2: Implement Rate Limit Middleware
  - [x] Update `src/proxy.ts` to include rate limiting logic.
  - [x] Use `user.id` or IP from the request as the key for rate limiting.
- [x] Task 3: Standardize 429 Responses
  - [x] Ensure the response body follows the `ApiError` format.
  - [x] Set the `Retry-After` header correctly.

## Dev Notes

- **Redis Provider:** Upstash integrated via `@upstash/redis`.
- **Ratelimit Logic:** Used `@upstash/ratelimit` with a sliding window of 100 req/min.
- **Security:** IP extraction handles proxies via `x-forwarded-for`.

### Project Structure Notes

- Rate limiting centralized in `apps/web/src/proxy.ts`.
- Redis client exported from `apps/web/src/lib/redis.ts`.

### References

- [Source: docs/architecture/security-and-performance.md#TrafficManagement]
- [Source: apps/web/src/proxy.ts]

## Dev Agent Record

### Agent Model Used

Amelia (Developer Agent)

### Debug Log References

- Task 1: Installed `@upstash/redis` and created `src/lib/redis.ts`.
- Task 2: Integrated `@upstash/ratelimit` into `src/proxy.ts` middleware.
- Task 3: Implemented standardized JSON error response for status 429.

### Completion Notes List

- Successfully implemented per-user/IP rate limiting for all `/api` routes.
- Provided clear "Retry-After" headers and standardized error bodies.
- Verified that build and linting pass with the new middleware logic.

### File List

- `apps/web/src/lib/redis.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/lib/api-utils.ts`
- `apps/web/package.json`
- `.env.example`
