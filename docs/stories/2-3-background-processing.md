# Story 2.3: Background Processing (Inngest)

Status: review

## Story

As a Developer,
I want to offload heavy tasks to a background worker,
so that the API remains responsive for the end users.

## Acceptance Criteria

1.  Inngest or similar background job engine integrated. [x]
2.  Retry logic and failure monitoring configured. [x]
3.  A sample background task (e.g., Daily Sales Aggregation) implemented. [x]

## Tasks / Subtasks

- [x] Task 1: Initialize Inngest Client
  - [x] Set up `inngest` package in `apps/web`.
  - [x] Create the `/api/inngest` endpoint to receive events.
- [x] Task 2: Define Background Functions
  - [x] Implement a sample `sales.aggregate` function that runs asynchronously.
  - [x] Configure the function to trigger on a specific event (e.g., `app/sales.created`).
- [x] Task 3: Monitoring & Retries
  - [x] Set up the Inngest Dev Server script for local testing.
  - [x] Verify that failed jobs are retried according to the policy (via Inngest config).

## Dev Notes

- **Engine:** Inngest integrated using version 4 signature (configuration and triggers combined).
- **Events:** Implemented `app/sales.created` trigger for the sample function.
- **Infrastructure:** Created the Next.js API route to expose the webhook endpoint.

### Project Structure Notes

- Background functions live in `apps/web/src/inngest/`.
- The Inngest client is exported from `apps/web/src/lib/inngest.ts`.

### References

- [Source: docs/architecture/security-and-performance.md#AsynchronousProcessing]
- [Source: apps/web/src/app/api/inngest/route.ts]

## Dev Agent Record

### Agent Model Used

Amelia (Developer Agent)

### Debug Log References

- Task 1: Installed `inngest`, created `src/lib/inngest.ts` and `api/inngest/route.ts`.
- Task 2: Created `sales.aggregate.ts` background job with `app/sales.created` event trigger.
- Task 3: Added `inngest:dev` script to `package.json` for local monitoring.

### Completion Notes List

- Successfully set up the event-driven background processing engine.
- Implemented a robust worker pattern without requiring a long-running process, fitting the serverless architecture.
- Adapted to the latest Inngest v4 API specifications for stable integration.

### File List

- `apps/web/package.json`
- `apps/web/src/lib/inngest.ts`
- `apps/web/src/app/api/inngest/route.ts`
- `apps/web/src/inngest/sales.aggregate.ts`
- `apps/web/src/inngest/index.ts`
