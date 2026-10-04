#!/bin/sh
# Brings the database in line with this image's commit: the schema sync, the
# platform catalog, and every sync:* back-fill, in the one order that works.
# This chain used to be the backend's start command (apps/backend/Dockerfile);
# it moved here so it can run *before* the container swap instead of inside it.
#
#   sh apps/backend/scripts/db-prepare.sh              always prepare
#   sh apps/backend/scripts/db-prepare.sh --if-needed  skip if already prepared
#
# Two callers:
#
# - scripts/deploy.sh runs it with no flag in a one-off container
#   (`docker compose run --rm --no-deps backend ...`) after building the new
#   images and before `up -d`, so the old backend keeps serving while it runs.
#   Measured on the #766 deploy, this chain was most of the 19-24 s of 502s each
#   deploy caused when it ran at container start.
# - The image's CMD runs it with --if-needed before starting Nest, so a plain
#   `docker compose up -d` without deploy.sh still prepares — only slower.
#
# Prepared-once marker
# --------------------
# A successful prepare writes $STATE_DIR/db-prepared-<GIT_SHA>, on the
# backend_state volume in docker-compose.prod.yml, and removes every other
# marker: only the most recent prepare describes what the database looks like
# now. --if-needed skips the chain only when the marker for this image's own
# GIT_SHA is there and was written against the same DATABASE_URL (by hash, so
# the password never reaches the volume). So:
#
# - the container deploy.sh starts skips straight to `node main.js`;
# - restarts of the same commit (a crash, a host reboot) skip it too;
# - an image built from another commit — a rollback, a hand-run
#   `up -d --build` — finds no marker for itself and prepares, exactly as
#   every start did before;
# - GIT_SHA=unknown (an image built without the build arg) names no
#   particular schema, so it never trusts a marker and never writes one.
#
# Re-running on every start was never what the steps needed. Each brings rows
# that predate the deployed code up to what that code expects, and the code
# writes its own new rows correctly. The partial exception is
# sync:crm-activities, which also mirrors rows the legacy CRM endpoints still
# write; those now reach CrmActivity at the next deploy rather than at the
# next restart, which was never a schedule anyone relied on.
#
# The marker cannot see a database changed behind its back: after restoring a
# backup, or editing the schema by hand, run this script with no flag
# (docs/ops/deployment-runbook.md).
#
# Running while the old code serves
# ---------------------------------
# Every sync:* step and every `db push` so far has been additive and
# idempotent, so the old backend keeps working against the new schema for the
# seconds between this prepare and the swap. `--accept-data-loss` below is
# where that assumption is made explicit: if a release ever drops or renames a
# column the old code still reads, the old container errors on it during that
# window — the same as the old code would have at its first request after a
# swap, and still shorter than the outage this replaces.
#
# Failure
# -------
# Every step is fatal, as it was in the old `&&` chain: the first non-zero exit
# stops the chain, no marker is written, and this script exits non-zero. Under
# deploy.sh that aborts the deploy before any container is swapped; at
# container start it means the new backend never boots.
set -eu

# The image's WORKDIR (/app): every path below is relative to the repo root.
cd "$(dirname "$0")/../../.."

STATE_DIR="${ERP71_STATE_DIR:-/var/lib/erp71/state}"
COMMIT="${GIT_SHA:-unknown}"
MARKER="$STATE_DIR/db-prepared-$COMMIT"

log() {
    echo "db-prepare: $*"
}

# "unknown", empty, or anything else that is not a hex commit names no
# particular schema (and must not become part of a path).
commit_is_known() {
    case "$COMMIT" in
        '' | *[!0-9a-f]*) return 1 ;;
    esac
    [ "${#COMMIT}" -ge 7 ]
}

database_fingerprint() {
    printf '%s' "$DATABASE_URL" | sha256sum | cut -d ' ' -f 1
}

marker_is_valid() {
    commit_is_known || return 1
    [ -f "$MARKER" ] || return 1
    fingerprint="$(database_fingerprint)"
    [ -n "$fingerprint" ] || return 1
    grep -qx "database=$fingerprint" "$MARKER"
}

# Records a successful prepare. Not fatal if it cannot: the database is
# prepared either way, and a missing marker only means the next start
# prepares again. Called as an `if` condition, where `set -e` does not apply,
# hence the explicit `|| return 1`s.
record_prepared() {
    mkdir -p "$STATE_DIR" || return 1
    # Other commits' markers go first: whatever happens next, the database no
    # longer looks the way they promised.
    for other in "$STATE_DIR"/db-prepared-*; do
        if [ "$other" != "$MARKER" ]; then
            rm -f "$other" || return 1
        fi
    done
    if ! commit_is_known; then
        log "GIT_SHA is '$COMMIT', so no marker is written; this image prepares on every start"
        return 0
    fi
    # Written aside and renamed, so a reader never sees half a marker.
    tmp="$STATE_DIR/.db-prepared-$COMMIT.tmp"
    {
        echo "commit=$COMMIT"
        echo "database=$(database_fingerprint)"
        echo "prepared_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >"$tmp" || return 1
    mv -f "$tmp" "$MARKER" || return 1
}

# step <label> <command...>
# The label is what gets logged, never the command: the pre-push steps carry
# DATABASE_URL, password and all, in their arguments.
step() {
    label="$1"
    shift
    step_started="$(date +%s)"
    if "$@"; then
        log "ok   $label ($(($(date +%s) - step_started))s)"
    else
        status=$?
        echo "db-prepare: FAILED $label (exit $status, after $(($(date +%s) - step_started))s)" >&2
        echo "db-prepare: nothing after $label ran, and no marker was written" >&2
        exit "$status"
    fi
}

case "${1:-}" in
    '') if_needed=false ;;
    --if-needed) if_needed=true ;;
    *)
        echo "usage: $0 [--if-needed]" >&2
        exit 2
        ;;
esac

if [ -z "${DATABASE_URL:-}" ]; then
    echo "db-prepare: DATABASE_URL is not set" >&2
    exit 1
fi

if [ "$if_needed" = true ]; then
    if marker_is_valid; then
        log "database already prepared for $COMMIT ($(sed -n 's/^prepared_at=//p' "$MARKER")); skipping"
        exit 0
    fi
    log "no marker for $COMMIT on this database; preparing before start"
fi

log "preparing the database for $COMMIT"
prepare_started="$(date +%s)"

# DIRECT_URL is overridden with DATABASE_URL for the steps up to and including
# `db push` so prisma db push uses the internal hostname — originally Render's,
# bypassing the IP allowlist that blocked external connections during
# preDeployCommand. Render is retired; the override is kept so the CLI never
# depends on what DIRECT_URL in the env file happens to name.

# ---- Before db push: make the new constraints a formality ------------------

# sync:user-mobile-unique is the first step that runs BEFORE db push, not after.
# db push creates the unique index on User.mobile, and unlike every other index
# here that column is already populated — duplicates were deliberately allowed
# between 2026-07-10 and 2026-09-07. Postgres refuses to build a unique index
# over them, db push exits non-zero, and at the head of this chain that means
# the prepare fails (see Failure above). Clearing the collisions first makes the
# index a formality. It is idempotent and degrades to a no-op on a fresh
# database that has no User table yet. See prisma/sync-user-mobile-unique.ts.
step sync:user-mobile-unique \
    env DIRECT_URL="$DATABASE_URL" npm run sync:user-mobile-unique --workspace=@erp71/database

# sync:store-name-unique runs BEFORE db push for exactly the same reason, and
# before sync:warehouse-name-unique below. db push creates the unique index on
# (Store.tenant_id, name), over a column that is already populated and was never
# constrained: `@MinLength(1)` with no trim let a whitespace-only branch name
# through as '', and rename checked neither blank nor duplicate. It has to lead
# the warehouse repair because a nameless warehouse is renamed after the branch
# holding it, so a branch fixed first hands it a real name rather than the
# "Branch Warehouse" fallback. See prisma/sync-store-name-unique.ts.
step sync:store-name-unique \
    env DIRECT_URL="$DATABASE_URL" npm run sync:store-name-unique --workspace=@erp71/database

# sync:warehouse-name-unique runs BEFORE db push for exactly the same reason.
# db push creates the unique index on (Warehouse.tenant_id, store_id, name),
# over a column that is already populated and was never constrained: a warehouse
# could be saved with a blank name, or with a name another warehouse in the same
# branch already had. Postgres refuses to build the index over those, db push
# exits non-zero, and the prepare fails. Repairing the names first — blank
# ones take the branch's name, repeats are suffixed with their code — makes the
# index a formality. Idempotent, and a no-op on a fresh database with no
# Warehouse table yet. See prisma/sync-warehouse-name-unique.ts.
step sync:warehouse-name-unique \
    env DIRECT_URL="$DATABASE_URL" npm run sync:warehouse-name-unique --workspace=@erp71/database

# sync:board-slug and sync:task-reference run BEFORE db push for the same
# reason, and are REQUIRED for the readable-project-URL work to deploy at all.
# Both add a NOT NULL column with no default to a table that already has rows
# (boards.slug, project_tasks.reference). Migrations 20260922120000 and
# 20260922130000 do this safely — add nullable, backfill, then set NOT NULL —
# but production never runs `prisma migrate deploy`, so that sequencing never
# happens here. db push would go straight to NOT NULL, Postgres would refuse,
# and the prepare would fail. Filling the columns first makes the NOT NULL
# and its unique index a formality. Both are idempotent (they fill NULLs only,
# never rewriting a slug an owner has since edited) and no-ops on a fresh
# database with no boards/project_tasks table yet. They also create the two
# history tables the same migrations add. See prisma/sync-board-slug.ts and
# prisma/sync-task-reference.ts.
step sync:board-slug \
    env DIRECT_URL="$DATABASE_URL" npm run sync:board-slug --workspace=@erp71/database
step sync:task-reference \
    env DIRECT_URL="$DATABASE_URL" npm run sync:task-reference --workspace=@erp71/database

# sync:story-code runs BEFORE db push for the same reason as
# sync:task-reference: it fills project_user_stories.code so db push can make
# it NOT NULL and build the (project_id, code) unique index, which migration
# 20260923120000_add_story_code would have done and production never runs.
# Idempotent; tolerates a fresh database. See prisma/sync-story-code.ts.
step sync:story-code \
    env DIRECT_URL="$DATABASE_URL" npm run sync:story-code --workspace=@erp71/database

# ---- The schema itself -----------------------------------------------------

# --accept-data-loss: see "Running while the old code serves" above.
step "prisma db push" \
    env DIRECT_URL="$DATABASE_URL" npx prisma db push --skip-generate --accept-data-loss --schema=packages/database/prisma/schema.prisma

# ---- After db push: fill what the schema just gained -----------------------

# db:seed:platform — NOT db:seed. This runs unattended — before every deploy's
# swap, and at any container start that finds no marker for its commit,
# including unattended restarts — so it may only touch platform reference data
# (subscription plans + addon modules), which the app reads at runtime and
# which must track the deployed code. prisma/seed.ts is dev/demo fixtures: it
# writes business data and resets known passwords, and must never run here.
step db:seed:platform \
    npm run db:seed:platform --workspace=@erp71/database

# sync:accounting runs on every prepare, after db:seed:platform so it also
# covers anything the seed just created. It is idempotent and additive-only (see
# prisma/sync-accounting.ts), and it is the ONLY thing that carries new default
# accounts/posting rules to tenants that already exist — the bootstrap itself
# runs only at tenant creation. Without it, adding a rule silently posts nothing
# on every existing tenant. It is fatal deliberately: a failure here means
# tenants would post to a stale rule set, which must be loud, not skipped.
step sync:accounting \
    npm run sync:accounting --workspace=@erp71/database

# sync:lead-taxonomy plays the same role for CRM lead sources/categories, and
# additionally backfills Lead.source_id / Lead.category_id from the legacy enum
# columns. It is idempotent and additive-only, and it degrades to "seed defaults
# only" once those columns are dropped (it checks information_schema rather than
# assuming they exist) — so it cannot become the reason the backend stops booting.
step sync:lead-taxonomy \
    npm run sync:lead-taxonomy --workspace=@erp71/database

# sync:crm-activities mirrors LeadConversation / CustomerInteraction / CrmFollowUp
# into the unified CrmActivity table and materialises Lead.next_step as a planned
# activity where it is not already a duplicate. It runs AFTER sync:lead-taxonomy
# because it resolves legacy type strings against the activity purposes that
# script seeds. Idempotent via @@unique([tenant_id, legacy_source, legacy_id]) +
# skipDuplicates, guarded on information_schema so it degrades to a no-op once
# R3 drops the legacy tables, and it catches its own errors rather than exiting
# non-zero — a failed backfill must not be a full outage.
step sync:crm-activities \
    npm run sync:crm-activities --workspace=@erp71/database

# sync:lead-identity backfills Lead.mobile_norm/email_norm/linkedin_norm, the
# normalized columns carrying the per-tenant unique indexes that stop duplicate
# leads. It is REQUIRED, not a nicety: production applies schema with `db push`
# above, never `prisma migrate deploy`, so the migration that backfills these
# columns never runs here. Without this step the columns stay NULL on every
# existing lead, the indexes guard nothing, and the old raw-mobile unique that
# db push drops is not replaced. Only the oldest lead claiming a value is filled
# in, so pre-existing duplicates cannot make it throw. See
# prisma/sync-lead-identity.ts.
step sync:lead-identity \
    npm run sync:lead-identity --workspace=@erp71/database

# sync:role-permissions is the same idea for the permission matrix:
# ROLE_DEFAULT_PERMISSIONS is read only at tenant creation and role assignment,
# so a permission added later reaches nobody who already exists — and the OWNER
# bypass in StorePermissionGuard hides that from whoever tests the new module.
# It grants by explicit group and skips a role that already holds part of one, so
# re-running never undoes an owner's later edit (see prisma/sync-role-permissions.ts).
step sync:role-permissions \
    npm run sync:role-permissions --workspace=@erp71/database

# sync:tenant-role-templates creates the per-module role templates (Sales
# Manager, Sales User, ... plus Tenant Admin) for tenants that predate them, and
# gives existing members and pending invitations their TenantUserRole /
# UserInvitationRole rows. Without it an existing workspace sees no new roles to
# assign and multi-role reads find an empty role set. See
# prisma/sync-tenant-role-templates.ts.
step sync:tenant-role-templates \
    npm run sync:tenant-role-templates --workspace=@erp71/database

# sync:cancel-entry-permission grants CANCEL_ENTRY to the Tenant Admin role of
# tenants that predate entry cancellation, and to the members holding it.
# REQUIRED and it cannot ride on sync:role-permissions, which deliberately skips
# template roles (`template_key: null`) — CANCEL_ENTRY belongs to exactly one
# template role and to none of the three legacy ones, so without this every
# existing Tenant Admin sees the Cancel action 403 while the owner, who bypasses
# permission checks, sees it work. Must run AFTER sync:tenant-role-templates,
# which is what creates the Tenant Admin role it grants onto. See
# prisma/sync-cancel-entry-permission.ts.
step sync:cancel-entry-permission \
    npm run sync:cancel-entry-permission --workspace=@erp71/database

# sync:work-schedules gives every tenant a default work schedule and every
# employee an assignment to it (HRIS Phase 2). Attendance still works without it
# — resolveScheduleDays falls back to an in-code default — but the tenant would
# have no row to edit, so their hours would be whatever the code assumed. Skips
# any tenant that already has a schedule and any employee that already has an
# assignment, so it never overrides a deliberate change.
step sync:work-schedules \
    npm run sync:work-schedules --workspace=@erp71/database

# sync:salary-components seeds the standard Bangladeshi salary split (HRIS
# Phase 5) for tenants that have none, so the structure screen opens with
# something recognisable rather than blank. It deliberately does NOT backfill
# per-employee structures — resolveStructure already falls back to
# Employee.basic_salary, and stamping a structure nobody chose would silently
# stop that field affecting pay. See prisma/sync-salary-components.ts.
step sync:salary-components \
    npm run sync:salary-components --workspace=@erp71/database

# sync:support-thread-creators backfills SupportThread.createdById, the shop user
# who opened each inbox thread. REQUIRED for the same reason as sync:lead-identity:
# db push adds the column but never runs the migration that fills it, so without
# this every pre-existing thread reads as "Unknown user" in Admin > Inbox and the
# per-user filter finds only threads opened after the deploy. The opener is taken
# from the thread's earliest message. See prisma/sync-support-thread-creators.ts.
step sync:support-thread-creators \
    npm run sync:support-thread-creators --workspace=@erp71/database

# sync:lead-activity backfills Lead.last_activity_at, "when did anyone last work
# this lead" — the column behind the CRM dashboard's 14-day neglected-leads tile
# and GET /crm/leads?staleDays=N. REQUIRED for the same reason as
# sync:lead-identity and sync:support-thread-creators: db push adds the column,
# never the migration that fills it, so without this the column is NULL
# everywhere and the tile counts the whole back catalogue as neglected until
# each lead is next touched. See prisma/sync-lead-activity.ts.
step sync:lead-activity \
    npm run sync:lead-activity --workspace=@erp71/database

# sync:found-reasons gives tenants that predate the FOUND direction their FOUND
# reason catalogue. REQUIRED, and it is the half `db push` cannot reach: the
# release that added `InventoryShrinkage.direction` seeded the four defaults in
# its migration's INSERT, but production applies schema with `db push` and never
# runs migration files — so the column and its index arrived and the catalogue
# did not. The entry screen filters reasons by type and the service refuses a
# reason that is not an active FOUND one, so without this an existing workspace
# opens the Found picker to an empty list and cannot record a surplus at all.
# Only ever fills an EMPTY catalogue, so nothing is relabelled and a reason
# switched off on purpose stays off. See prisma/sync-found-reasons.ts.
step sync:found-reasons \
    npm run sync:found-reasons --workspace=@erp71/database

# sync:project-members puts each project's manager and creator on its team.
# REQUIRED for any workspace that created a project before this ran: the task
# Assignee picker offers a project's roster and nothing else, and projects used
# to be seeded with members only when they were PRIVATE — while PUBLIC is the
# default. So every ordinary project had an empty roster and its tasks could not
# be assigned to anybody, with nothing on screen saying why. `create` now seeds
# both people; this is the half a code change cannot reach. Never rewrites an
# existing row, so a deliberate removal is not undone on the next run. See
# prisma/sync-project-members.ts.
step sync:project-members \
    npm run sync:project-members --workspace=@erp71/database

# sync:crm-activity-approval marks every DONE and CANCELLED CrmActivity approved.
# REQUIRED for the same reason as sync:lead-activity above: db push adds
# `is_approved` at its default of false and never runs the migration that fills
# it. Without this, the Activities page's "Awaiting approval" filter opens on the
# tenant's entire logged history — years of finished conversations — instead of
# the handful of plans a reviewer actually needs to read. PLANNED rows are left
# unapproved on purpose: that backlog is the review queue. See
# prisma/sync-crm-activity-approval.ts.
step sync:crm-activity-approval \
    npm run sync:crm-activity-approval --workspace=@erp71/database

# sync:setup-fee-paid stamps TenantSubscription.setup_fee_paid_at on every
# subscription that predates the one-time setup fee. Same reason as
# sync:lead-identity above: db push carries the column but never the migration's
# backfill, so the stamp lands NULL on every existing row. BillingService reads
# NULL as "never paid", so the day an admin sets a non-zero setup_fee on a plan,
# every tenant already on it is billed an onboarding fee at their next checkout —
# for onboarding they had years ago. The stamp must exist before any fee does.
step sync:setup-fee-paid \
    npm run sync:setup-fee-paid --workspace=@erp71/database

if ! record_prepared; then
    log "WARNING: could not write the marker in $STATE_DIR; the database IS prepared, but the next start will prepare again"
fi
log "database prepared for $COMMIT in $(($(date +%s) - prepare_started))s"
