# Auto-promote `dev`→`main` + in-app production deploy

**Date:** 2026-07-11
**Status:** Approved (design)

## Goal

Extend the Feedback Automation pipeline past the `dev` merge so that:

1. When a feedback PR merges to `dev`, the backend **auto-promotes `dev`→`main`** once `dev` is green.
2. A **platform admin triggers the production deploy from inside the ERP71 app** (not SSH, not GitHub UI), with a live status view of what's deployed vs. what's on `main`.

Deploy stays human-gated; `main` becomes "latest green release candidate."

## Current state (baseline)

- **Merge to dev:** admin clicks Merge in the feedback panel → `mergeFeedbackPr()` merges the feedback PR into `dev`, gated on `computePrGreen` (all CI green + mergeable). Feedback status ends at `MERGED`.
- **dev→main:** manual.
- **Deploy:** manual — `ssh root@66.116.236.127 'cd /opt/erp71 && ./scripts/deploy.sh main'`, or the `Deploy to VPS` workflow (`deploy-vps.yml`, `workflow_dispatch` only).
- **CI** (`deploy.yaml`) runs on push/PR to `dev` and `main`.
- `main` has **no branch protection**; repo `allow_auto_merge: false`, `allow_merge_commit: true`.
- Nothing exposes the deployed commit SHA.

## Piece 1 — Auto-promote `dev`→`main` (feedback-triggered)

Lives in the backend, invoked from the `mergeFeedbackPr()` success path (so **only feedback-automation merges trigger a promotion**; manual `dev` commits do not).

Reuses existing `FeedbackGithubService` methods. New `promoteDevToMain()` runs in the background:

1. **Idempotency** — compare `dev` vs `main`; if `dev` is not ahead, no-op. If a `dev`→`main` PR is already open, reuse it instead of opening another.
2. **Open** a `dev`→`main` PR (`openPullRequest`).
3. **Poll** `getPrReadiness(pr)` until green + mergeable, or timeout (~15 min).
4. **Merge** (`mergePullRequest`). On success record the main merge commit + audit log; on timeout/failure record `lastError` and leave `main` untouched.

**Scope decision (approved):** a promotion merges the whole `dev` branch to `main` — the feedback merge is only the trigger. Unrelated experimental `dev` commits ride along. Acceptable because deploy is human-gated and the deploy panel shows the exact diff before shipping. Isolating feedback commits from experimental work would require feedback PRs targeting `main` directly — out of scope.

**Failure isolation:** promotion never force-pushes; it always goes through a PR + green gate, so `main` stays green.

## Piece 2 — In-app production deploy (platform admin)

New `admin/deploy` controller behind `PlatformAdminGuard`:

- **`POST /admin/deploy`** — dispatches the `Deploy to VPS` workflow (`deploy-vps.yml`) for `main` via the GitHub API (`POST /repos/{o}/{r}/actions/workflows/{id}/dispatches`). The external runner runs `deploy.sh` + health checks, so the backend never tears down its own container mid-deploy. Returns the triggered run reference.
- **`GET /admin/deploy/status`** — `{ liveSha, mainSha, aheadBy, lastRun }`:
  - `liveSha` = the running backend's baked-in build SHA (what is actually live),
  - `mainSha` + `aheadBy` from a GitHub compare (`liveSha...main`),
  - `lastRun` = latest `deploy-vps.yml` run (status, conclusion, createdAt, url).

### Supporting changes

- **Build SHA:** bake `GIT_SHA` as a Docker build-arg into backend (and frontend) images; `deploy.sh` passes `--build-arg GIT_SHA=$(git rev-parse HEAD)`. Expose via a small build-info endpoint the panel reads.
- **GitHub token:** reuse `feedback_automation.github_token`. Production deploy adds one scope requirement — **`actions: write`** (for `workflow_dispatch`). Promotion needs only repo/PR write (already present). Surface a clear error if `actions: write` is missing.
- **UI:** `PlatformDeployPanel` in the platform-settings area (index-grid link, matching the add-ons / feedback-automation precedent). Button + live-status card; polls status while a run is in progress.

## Testing

- **Backend:** promotion idempotency (skip when up-to-date, reuse open PR, merge-when-green, error on timeout); deploy dispatch + status mapping (mock GitHub service / fetch).
- **Frontend:** panel renders live/main/ahead, button disabled while a run is active, dispatch on click.

## Out of scope

- Auto-deploy with no human gate.
- Branch protection / GitHub-native auto-merge configuration.
- Isolating feedback commits from other `dev` work (different branching model).
- Rollback automation beyond the existing `git revert` PR flow.
