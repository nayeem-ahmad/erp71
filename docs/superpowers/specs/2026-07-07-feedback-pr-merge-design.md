# Feedback Automation — in-app "Merge PR" — design

**Date:** 2026-07-07
**Status:** Approved

## Problem

After the feedback-automation agent opens a pull request, the feedback item sits
in `PR_OPENED` ("PR opened — awaiting merge"). Today the only in-app actions are a
link out to GitHub and a manual "Refresh status" button; the platform admin must
merge on GitHub, then come back and click Refresh. There is no merge action, no
CI visibility, and `PR_OPENED` does not auto-poll.

## Goal

Let a platform admin merge the feedback PR from within the app — but only once CI
is green and the PR is conflict-free — and reflect the result (`MERGED`) without a
trip to GitHub.

## Decisions

- **CI-green rule (strictest):** enable Merge only when **at least one check run
  exists**, **every check concluded success** (no failures, nothing still
  running), **and** GitHub reports the PR **mergeable = true** (no conflicts with
  the base branch).
- **Merge method:** merge commit (`merge_method: 'merge'`) — preserves the agent's
  commits and matches the repo's dev→main convention.
- **Base branch:** these PRs target `dev` (per `feedback_automation.github_base_branch`),
  so merging lands the change on `dev`, not production. Deploy still goes through
  the existing `deploy.sh` flow.
- **Trust boundary:** the server re-verifies green/mergeable immediately before
  merging; the button's enabled state is never trusted.

## Components

### 1. `apps/backend/src/feedback-automation/feedback-github.service.ts`

- `getPrReadiness(prNumber)` → `{ state, mergeable, headSha, merged, mergeCommitSha, checks: { total, passed, failed, pending, allPassed } }`.
  - `GET /repos/{o}/{r}/pulls/{n}` for `mergeable`, `mergeable_state`, `state`, head SHA, `merged`, `merge_commit_sha`.
  - `GET /repos/{o}/{r}/commits/{headSha}/check-runs` for check runs (GitHub Actions
    reports here, not legacy statuses). Fold in `GET /commits/{headSha}/status`
    only when it has ≥1 status, so legacy status tools aren't ignored.
  - GitHub computes `mergeable` asynchronously; a `null` is treated as "not ready
    yet" (not green), never as a hard failure.
- `computeGreen(checks, mergeable)` — **pure helper**, the single source of the
  enable/disable decision. Green iff `checks.total >= 1 && checks.allPassed &&
  mergeable === true`.
  - `allPassed` = every check run has `status === 'completed'` and `conclusion ∈
    {success, neutral, skipped}`.
  - `failed` = any `conclusion ∈ {failure, cancelled, timed_out, action_required}`.
  - `pending` = any `status !== 'completed'`.
- `mergePullRequest(prNumber)` → `PUT /repos/{o}/{r}/pulls/{n}/merge` with
  `{ merge_method: 'merge' }`; returns `{ merged, sha }`. Surfaces GitHub errors
  (405 not-mergeable, 409 head-SHA-moved, 403 permissions) with descriptive text.

### 2. `apps/backend/src/feedback-automation/feedback-automation.service.ts`

- Extend `refreshPrStatus` to include the `getPrReadiness` payload in its response
  (so the panel can render CI and gate the button), keeping the existing `MERGED`
  detection when GitHub already shows the PR merged.
- New `mergeFeedbackPr(feedbackId, userId)`:
  1. Load feedback; assert `status === 'PR_OPENED'` and a `prNumber` exists (else
     `BadRequestException`).
  2. `getPrReadiness` → `computeGreen`; if not green/mergeable, throw a clear error
     (defense-in-depth).
  3. `mergePullRequest`; on success set `status = 'MERGED'`, store `mergeCommitSha`.
  4. Write an audit-log entry (who merged which PR).

### 3. `apps/backend/src/feedback-automation/feedback-automation.controller.ts`

- `POST admin/feedback/:id/merge` → `mergeFeedbackPr(id, req.user.userId)`. Already
  behind `JwtAuthGuard` + `PlatformAdminGuard`.

### 4. `apps/frontend/src/components/admin/FeedbackAutomationPanel.tsx`

- Auto-poll while `PR_OPENED` (new) via the extended `pr-status` endpoint. Render
  CI/mergeability: e.g. "CI: 3/3 passed · mergeable", "CI running… (1/3)",
  "CI failed", "merge conflict".
- **Merge PR** button, enabled only when green+mergeable; otherwise disabled with
  the blocking reason shown. On success → `MERGED`. Keep the existing PR link and
  "Refresh status" button.
- Extend the frontend api client + types for the new readiness fields and the
  merge call.

## Error handling

- Merge API failures (405/409/403) surface as a descriptive toast; status stays
  `PR_OPENED` so the admin can retry after CI/conflicts resolve.
- `mergeable === null` (still computing) → treated as not-ready; panel shows
  "checking mergeability…", button stays disabled.
- Merging requires the GitHub token's **Pull requests: write** (already configured).

## Testing

- Unit-test `computeGreen`: all-pass, one-failure, still-running, zero-checks,
  `mergeable=false`, `mergeable=null`.
- Extend `feedback-automation.service.spec.ts` for `mergeFeedbackPr`: green→merges
  →`MERGED`; not-green→throws; wrong-status→throws. GitHub service mocked.

## Out of scope

- Auto-merge without a human click.
- Reacting to merges via a background poller (still pull-driven by the panel).
- Post-merge deploy/migration automation (unchanged; migration sign-off stays at
  plan/implement time).
