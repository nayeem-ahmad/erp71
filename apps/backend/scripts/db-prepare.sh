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

# sync:party-branch runs BEFORE db push for the same reason as sync:board-slug,
# and is REQUIRED for the branch-attached-parties release to deploy at all. It
# gives every Customer, Supplier, customer/supplier credit row and storefront
# order a branch (creating each storefront tenant's "Online Store" branch on the
# way) and sets those store_id columns NOT NULL inside its own transaction, so a
# row the old backend writes between this step and the push cannot slip in
# without one. Idempotent (fills NULLs only); tolerates a fresh database; fails
# — and rolls back — on a tenant that has rows but no branch. Preview it on
# production first: scripts/ops/party-branch-report.sh. See
# prisma/sync-party-branch.ts.
step sync:party-branch \
    env DIRECT_URL="$DATABASE_URL" npm run sync:party-branch --workspace=@erp71/database

# sync:purchase-date runs BEFORE db push, and is REQUIRED for the purchase
# transaction-date release. Migration 20261014120000 adds purchase_date NOT NULL
# DEFAULT CURRENT_TIMESTAMP and then copies created_at over it. Production never
# runs that file. db push would keep the default, so every bill already in the
# database would be dated at the deploy clock — reports, stock and the supplier
# statement would all read that instant as when the purchase happened. This adds
# the column nullable, copies created_at onto NULL rows only, and sets NOT NULL
# before the push. A date an operator has since chosen is left alone. See
# prisma/sync-purchase-date.ts.
step sync:purchase-date \
    env DIRECT_URL="$DATABASE_URL" npm run sync:purchase-date --workspace=@erp71/database

# sync:payment-method-account-fk runs BEFORE db push. PaymentMethod.account_id was
# a bare string with no foreign key; db push now adds one to accounts, and
# Postgres refuses while a method names an account that has been deleted. This
# nulls only those dangling values (they already pointed nowhere; posting falls
# back to the type's default account) and is a no-op on a fresh database. See
# prisma/sync-payment-method-account-fk.ts.
step sync:payment-method-account-fk \
    env DIRECT_URL="$DATABASE_URL" npm run sync:payment-method-account-fk --workspace=@erp71/database

# ---- The schema itself -----------------------------------------------------

# --accept-data-loss: see "Running while the old code serves" above.
step "prisma db push" \
    env DIRECT_URL="$DATABASE_URL" npx prisma db push --skip-generate --accept-data-loss --schema=packages/database/prisma/schema.prisma

# sync:branch-constraints runs AFTER db push. The push drops indexes the schema
# does not describe, and the one-drawer-per-branch unique, the shared-name
# unique, and the cash-only check are raw SQL. This puts them back on every
# boot. It does not stamp drawers, move lines, or place employees. That fold
# stays a reviewed `sync:branch-books` run and is not hooked in here.
step sync:branch-constraints \
    npm run sync:branch-constraints --workspace=@erp71/database

# sync:expense-heads runs AFTER db push. The push adds ExpenseHead and a
# nullable ExpenseEntry.head_id and copies nothing, so every expense recorded
# before this release would have no head. This creates one head per category
# that still has such a row — named the same as the category — and points the
# row at it. Nullable on purpose: the previous app is still inserting expenses
# (category only) while prepare runs, and a required column would reject them.
# A later prepare fills any row that landed in that gap. Idempotent. See
# prisma/sync-expense-heads.ts.
step sync:expense-heads \
    npm run sync:expense-heads --workspace=@erp71/database

# sync:expense-categories runs AFTER db push, and after expense heads exist.
# New tenants get Salary, Rent, Utilities, Refreshments, Conveyance and
# Miscellaneous at signup. This is what gives the same list to tenants that
# already exist. Each category also gets a head of the same name when it has
# none, so an expense can be recorded. A category the tenant already has is
# left alone, including the account they connected. Idempotent. See
# prisma/sync-expense-categories.ts.
step sync:expense-categories \
    npm run sync:expense-categories --workspace=@erp71/database

# KH Tradind recorded some categories as if they were heads. Person names
# become heads under Personal Expenses. Trust Care Company, Vat Return and
# Family Cost become heads under Other Expenses. Other shops are ignored.
# Idempotent. See prisma/sync-expense-reparent.ts.
step sync:expense-reparent \
    npm run sync:expense-reparent --workspace=@erp71/database

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

# sync:payment-method-accounts links each existing tenant's default payment
# methods (Cash, Bank, bKash, Nagad, Card) to the default account they post to,
# now that a tender posts to its method's own account. After sync:accounting so
# every default account exists. Runs ONCE per database: the first successful run
# stores a marker in platform_settings and later deploys skip it. New tenants are
# linked at signup; a link an owner clears stays cleared (--force re-runs it by
# hand). See prisma/sync-payment-method-accounts.ts.
step sync:payment-method-accounts \
    npm run sync:payment-method-accounts --workspace=@erp71/database

# sync:store-code gives every branch without one a code (S1, S2, ...), which a
# document number format prints for {STORE}. Store.code is nullable, so db push
# adds it without help; this fills what the migration's backfill would have.
# Idempotent (fills NULLs only, never an owner's own code), and not load-bearing:
# the numbering engine assigns a missing code on first use. See
# prisma/sync-store-code.ts.
step sync:store-code \
    npm run sync:store-code --workspace=@erp71/database

# sync:supplier-code gives every supplier without one a code (SUP-00001, ...),
# as every customer has a CUST- code. Supplier.supplier_code is nullable, so db
# push adds it without help; this fills what the migration's backfill would
# have, and on later prepares any supplier the old backend created during a
# deploy's swap. Idempotent (fills NULLs only, never a typed code), and not
# load-bearing: a supplier without one just shows a blank code. See
# prisma/sync-supplier-code.ts.
step sync:supplier-code \
    npm run sync:supplier-code --workspace=@erp71/database

# sync:document-sequences starts each running document series (PUR-, PRET-, PO-,
# RFQ-, TRF-, STK-, SHR-, FND-) past the numbers already in use. Those types
# were numbered count(rows) + 1 and now draw from document_sequences, whose
# counters would otherwise start at 1 and spend the engine's few skips on
# numbers that exist. Idempotent (a counter only moves up; only tenants still
# on the default format), and on later prepares it also covers numbers the old
# backend issued during a deploy's swap. See prisma/sync-document-sequences.ts.
step sync:document-sequences \
    npm run sync:document-sequences --workspace=@erp71/database

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

# sync:lead-identity fills Lead.mobile_norm/email_norm/linkedin_norm from the
# raw columns, including when several leads share one mobile, email, or LinkedIn
# profile. The unique indexes on those columns are gone. Leaving a shared norm
# null would hide an email the user can already see. It writes only the norm
# columns — never email, mobile, or linkedin_url — and a lead whose norms are
# already set is left alone. REQUIRED, and it must stay AFTER `prisma db push`
# above: production never runs `prisma migrate deploy`, and filling a second
# lead's email_norm before that drop would throw on the old unique index and
# abort boot. See prisma/sync-lead-identity.ts.
step sync:lead-identity \
    npm run sync:lead-identity --workspace=@erp71/database

# sync:contact-identity inserts or fills null columns only. It fills
# CrmContact.mobile_norm, email_norm, and linkedin_norm where they are still
# null, and it does not insert rows. A contested mobile or LinkedIn stays null
# on every contact after the oldest; email_norm is filled wherever there is an
# email. It must stay before sync:lead-contacts, which reads mobile_norm.
# See prisma/sync-contact-identity.ts.
step sync:contact-identity \
    npm run sync:contact-identity --workspace=@erp71/database

# sync:crm-organizations inserts or fills null columns only. It inserts
# Organization rows and sets CrmContact.organization_id where that column is
# still null. The company string is left as stored, and a name_norm that
# already exists is not inserted again. It must stay before sync:lead-contacts,
# which reads organization_id. See prisma/sync-crm-organizations.ts.
step sync:crm-organizations \
    npm run sync:crm-organizations --workspace=@erp71/database

# sync:lead-contacts inserts or fills null columns only. It inserts a
# CrmContact when a lead matches no contact by mobile or LinkedIn, and fills
# null Lead.contact_id, Lead.organization_id, and CrmContact.customer_id. It
# must stay after sync:contact-identity and sync:crm-organizations because it
# reads mobile_norm and organization_id. See prisma/sync-lead-contacts.ts.
step sync:lead-contacts \
    npm run sync:lead-contacts --workspace=@erp71/database

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

# sync:adjust-product-cost-permission is the same reconciler for
# ADJUST_PRODUCT_COST (Inventory -> Product Costs), which likewise belongs to
# Tenant Admin alone among the seeded roles. Without it an existing workspace's
# Tenant Admins see the page read-only while the owner can set costs. Same
# ordering constraint as above, and needs the enum value `prisma db push` adds.
step sync:adjust-product-cost-permission \
    npm run sync:adjust-product-cost-permission --workspace=@erp71/database

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

# sync:member-prefs-legacy is ONE-SHOT, and must stay so. It gives every member
# who exists today all three legacy browser sections (table views, table columns,
# sidebar) so they keep the layout they set up in their browser, and it fills out
# every stored invoice print layout so a profile cannot change one the member
# never touched. db push adds the columns empty and never runs migration data
# steps. Re-running would hand members back to old browser leftovers and give a
# member who joined after release the same, so the first live run stores a
# platform_settings marker (sync / member_prefs_legacy) in the same transaction as
# the work and later deploys skip. See prisma/sync-member-prefs-legacy.ts.
step sync:member-prefs-legacy \
    npm run sync:member-prefs-legacy --workspace=@erp71/database

if ! record_prepared; then
    log "WARNING: could not write the marker in $STATE_DIR; the database IS prepared, but the next start will prepare again"
fi
log "database prepared for $COMMIT in $(($(date +%s) - prepare_started))s"
