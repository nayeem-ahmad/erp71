# Story 93.1: Feedback Automation Pipeline (Propose → Approve → Implement → PR → Merge → Rollback)

Status: complete

## Story

As a Platform Admin,
I want an LLM coding agent that turns a piece of tenant feedback into a reviewed, CI-gated pull request I can merge (and roll back) from inside the admin console,
so that small bug fixes and features raised by tenants can be triaged, implemented, and shipped without leaving the app or hand-writing the change.

## Acceptance Criteria

1.  A "Feedback Automation" entry appears in the platform-admin sidebar and at `/admin/platform-settings/feedback-automation`; all routes are guarded by `JwtAuthGuard` + `PlatformAdminGuard`. [x]
2.  An admin can save an **instruction** on a feedback item, which moves it `NEW → ADMIN_REVIEWING`. [x]
3.  **Propose Plan** clones the configured repo (read-only tools: `list_dir`/`read_file`/`search_code`), asks the model for a plan, parses a `MIGRATION_REQUIRED` flag, persists a `FeedbackPlan` (v1, `PROPOSED`), and sets status `PLAN_PROPOSED`. Runs in the background (the request returns immediately). [x]
4.  An admin can **Approve** or **Request changes** on a proposed plan. Requesting changes loops back to a new plan version; approving sets `PLAN_APPROVED`. A migration-touching plan cannot be approved without `confirmMigration` when `require_migration_signoff` is on. [x]
5.  **Implement** runs the agent with the write tool, commits the changed files to a `feedback/<id>` branch, pushes, and opens a PR against the base branch, setting `PR_OPENED`. [x]
6.  If the agent produces **no file changes**, the run fails with a clear, actionable message (retry / switch to a stronger model) instead of an opaque `git commit` error, and the item returns to `PLAN_APPROVED` (retryable). [x]
7.  A generated **destructive migration** that was not signed off at approval time aborts implementation without opening a PR. [x]
8.  While `PR_OPENED`, the panel **auto-polls** CI + mergeability and shows live status (e.g. "CI running… (1/3)", "CI failed", "CI passed · mergeable"). [x]
9.  A **Merge PR** button enables only when the PR is green: ≥1 check exists, every check passed, **and** GitHub reports `mergeable = true`. It merges via a **merge commit**, sets `MERGED`, and stores the merge commit SHA. The server re-verifies the gate before merging (the button state is never trusted). [x]
10. Once `MERGED`, an admin can **Generate rollback PR**, which `git revert`s the merge commit onto a `revert/feedback-…` branch and opens a revert PR, setting `ROLLED_BACK`. [x]
11. The LLM call is resilient: a per-request abort timeout, retries on transient failures (connection drop / timeout / 429 / 5xx) with backoff, and a bounded tool-call turn budget that returns a best-effort answer rather than failing outright. [x]
12. Model, turn budget, GitHub token/repo/branch, schedule, and migration sign-off are configurable via the `feedback_automation` platform-settings group (secrets encrypted). [x]

## Data Model Changes

### Feedback (automation fields added to the existing tenant-feedback model)

| Field | Type | Notes |
|---|---|---|
| status | String | State machine, default `NEW`. `NEW`→`ADMIN_REVIEWING`→`PLAN_REQUESTED`→`PLAN_PROPOSED`→`PLAN_APPROVED`/`CHANGES_REQUESTED`→`IN_PROGRESS`→`PR_OPENED`→`MERGED`→`RESOLVED`, plus `ROLLED_BACK` |
| adminInstruction | String? | Admin's directive to the agent |
| prNumber / prUrl | Int? / String? | Opened implementation PR |
| mergeCommitSha | String? | Set when the PR is merged; required for rollback |
| backupSnapshotId | String? | Reserved for pre-deploy snapshot linkage |
| deployedAt | DateTime? | Reserved |
| lastError | String? | Last failure message shown to the admin |
| rollbackPrNumber / rollbackPrUrl | Int? / String? | Opened revert PR |
| updatedAt | DateTime | `@updatedAt` |
| plans | FeedbackPlan[] | Relation |

### FeedbackPlan (`feedback_plans`)

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| feedbackId | FK → Feedback | `onDelete: Cascade` |
| version | Int | Increments on each re-plan |
| planText | String | Model-authored plan |
| hasMigration | Boolean | Parsed `MIGRATION_REQUIRED` flag |
| status | String | `PROPOSED` \| `APPROVED` \| `CHANGES_REQUESTED` \| `SUPERSEDED` |
| adminComment | String? | Review comment |
| reviewedAt / reviewedBy | DateTime? / String? | Review audit |
| createdAt | DateTime | auto; `@@index([feedbackId, version])` |

### Platform settings — `feedback_automation` group (in `SETTINGS_SCHEMA`)

| Key | Secret | Default | Notes |
|---|---|---|---|
| enabled | no | `false` | Feature flag |
| schedule | no | `manual` | `manual` \| `daily` \| `weekly` batch cadence |
| model | no | `anthropic/claude-sonnet-4.6` | OpenRouter model slug — **must be a strong tool-calling model** |
| max_turns | no | `40` | Tool-call turn budget, clamped 5–100 in the runner |
| require_migration_signoff | no | `true` | Blocks approval of migration plans without explicit confirmation |
| github_token | **yes** | — | Fine-grained PAT: **Contents: Read and write** + **Pull requests: Read and write** |
| github_repo | no | `nayeem-ahmad/erp71` | `owner/repo` |
| github_base_branch | no | `dev` | Branch cloned and targeted by PRs |

The `ai.api_key` (OpenRouter key) is reused from the AI settings group; env fallbacks `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY`.

## Tasks / Subtasks

- [x] Task 1: Data model + settings
  - [x] Add automation fields to `Feedback` and the `FeedbackPlan` model (Prisma).
  - [x] Add the `feedback_automation` group (incl. `max_turns`) to `SETTINGS_SCHEMA` with secret encryption for `github_token`.

- [x] Task 2: Agent runner (`feedback-agent-runner.service.ts`)
  - [x] `proposePlan` (read-only tools) and `implementPlan` (adds `write_file`).
  - [x] Tool loop with a configurable `max_turns`; final turn withholds tools to force a best-effort answer instead of throwing.
  - [x] `callOpenRouter` with an abort-based per-request timeout, retries on transient failures with backoff, non-retryable 4xx short-circuit, and `tools` omitted when empty.
  - [x] `listChangedFiles` via `git status --porcelain`.

- [x] Task 3: GitHub integration (`feedback-github.service.ts`)
  - [x] `createWorkspace` (shallow clone via scratch `.netrc`), `commitAndPush`, `revertCommit`, `openPullRequest`, `getPullRequestStatus`.
  - [x] `getPrReadiness` (PR + check-runs + legacy statuses), pure `computePrGreen` gate, `mergePullRequest` (merge commit).

- [x] Task 4: Orchestration service (`feedback-automation.service.ts`)
  - [x] `saveInstruction`, `requestPlan`/`runPlanRequest`, `reviewPlan`, `implementNow`/`runImplementation`, `refreshPrStatus`, `mergeFeedbackPr`, `generateRollbackPr`, `runScheduledBatch` cron.
  - [x] Guard: abort with a clear message when `filesChanged.length === 0`.
  - [x] Guard: abort on destructive generated migration without sign-off.
  - [x] `mergeFeedbackPr` re-verifies `computePrGreen` server-side; audit-logs `feedback_automation.pr_merged`.

- [x] Task 5: API (`feedback-automation.controller.ts`, base `admin/feedback`)
  - [x] `GET :id`, `POST :id/instruction`, `POST :id/propose-plan`, `POST plans/:planId/review`, `POST :id/implement`, `GET :id/pr-status`, `POST :id/merge`, `POST :id/rollback`.

- [x] Task 6: Frontend
  - [x] Settings page `/admin/platform-settings/feedback-automation` (model, max_turns, migration sign-off, GitHub token/repo/branch).
  - [x] `FeedbackAutomationPanel` — instruction, propose/approve/request-changes, implement, PR link, `PR_OPENED` auto-poll with CI/mergeability, gated **Merge PR** button, rollback.
  - [x] Register the page in the platform-admin sidebar nav (`NAV_REGISTRY` + default layout + `Bot` icon + locale labels).

- [x] Task 7: Tests
  - [x] Service specs: instruction/plan/review/implement transitions, destructive-migration abort, empty-change-set abort, `mergeFeedbackPr` (green/not-green/wrong-status/already-merged).
  - [x] `computePrGreen` permutations (all-pass / failure / running / zero-checks / conflict / null).

## Dev Notes

- **Base branch is `dev`.** Merging a feedback PR lands the change on `dev`, not production. Deploying to the VPS still goes through `scripts/deploy.sh main` (no auto-deploy).
- **Public repo caveat:** because the repo is public, the agent's clone succeeds anonymously and does not exercise the token — the **push** is the first authenticated call, so a mis-scoped token first fails there. The token needs **Contents: write** to push (the common trap is granting "Administration" instead of "Contents").
- **Model choice is load-bearing.** The agent depends on reliable function/tool calling; weak tool-callers (e.g. deepseek variants) may return a plan without calling `write_file`, yielding an empty commit. Keep the model on a strong tool-caller (default `anthropic/claude-sonnet-4.6`). AC #6's guard turns that failure mode into an actionable message.
- **Merge gate is strict and server-enforced:** `computePrGreen(checks, mergeable)` = `checks.total ≥ 1 && checks.allPassed && mergeable === true`. `mergeable === null` (GitHub still computing) is treated as not-ready. GitHub Actions reports via check-runs, not legacy statuses; legacy statuses are folded in only when present.
- **Ops:** the production VPS is memory-constrained (1.9 GB RAM); the frontend Docker build needs swap headroom to avoid OOM (exit 137) during deploy.

### References

- [Source: docs/superpowers/specs/2026-07-07-feedback-pr-merge-design.md] — design spec for the in-app Merge PR slice.
- [Source: docs/prd/epic-list.md — Epic 93]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.8 (agent implementation); pipeline runtime model configurable (default `anthropic/claude-sonnet-4.6`).

### Completion Notes List

- ✅ Full state machine `NEW → … → PR_OPENED → MERGED → ROLLED_BACK` implemented and covered by service tests.
- ✅ In-app **Merge PR** added: CI + mergeability polling while `PR_OPENED`, strict green gate, server-side re-verification, audit log.
- ✅ OpenRouter resilience: 180s abort timeout + 3× linear-backoff retry; response body read inside the guarded scope (fixes bare `terminated`).
- ✅ Configurable `max_turns` (default 40, clamped 5–100); final turn withholds tools to force a best-effort answer.
- ✅ No-op implementation now fails with a clear "made no file changes" message instead of an opaque git error.
- ✅ Sidebar nav registration so the settings page is reachable from the menu (previously only via direct URL).
- ⚠️ GitHub token must have **Contents: write** + **Pull requests: write**; Contents:write was previously undocumented.

### File List

- packages/database/prisma/schema.prisma
- apps/backend/src/feedback-automation/feedback-agent-runner.service.ts
- apps/backend/src/feedback-automation/feedback-github.service.ts
- apps/backend/src/feedback-automation/feedback-github.service.spec.ts
- apps/backend/src/feedback-automation/feedback-automation.service.ts
- apps/backend/src/feedback-automation/feedback-automation.service.spec.ts
- apps/backend/src/feedback-automation/feedback-automation.controller.ts
- apps/backend/src/feedback-automation/feedback-automation.module.ts
- apps/backend/src/platform-settings/platform-settings.service.ts
- apps/frontend/src/app/(app)/admin/platform-settings/feedback-automation/page.tsx
- apps/frontend/src/components/admin/FeedbackAutomationPanel.tsx
- apps/frontend/src/lib/api.ts
- packages/shared-types/navigation.ts
- apps/frontend/src/lib/nav-icons.ts

### Change Log

- 2026-07-05: Initial admin-driven feedback automation pipeline (propose → approve → implement → PR → rollback).
- 2026-07-07: Sidebar nav registration; configurable `max_turns` + final-turn finalization; OpenRouter retry/timeout resilience; in-app CI-gated **Merge PR**.
- 2026-07-08: Clear error when the agent makes no file changes; documented GitHub token **Contents: write** requirement; story authored.
