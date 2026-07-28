# Lead sources & categories: enum → tenant-managed master data

`LeadSource` and `LeadCategory` were Postgres enums. They are now rows in
`LeadSourceOption` / `LeadCategoryOption`, one set per tenant, editable from
**CRM → Settings → Lead Sources & Categories**.

This document is the rollout runbook. Read it before touching `Lead.source` or
`Lead.category`.

---

## Why this is staged rather than a single change

Production has no migration runner. `apps/backend/Dockerfile` and
`scripts/deploy-erp71.sh` both reconcile the live schema with:

```
npx prisma db push --skip-generate --accept-data-loss
```

`prisma migrate diff` on an enum → String/FK column change emits
**`DROP COLUMN` + `ADD COLUMN`**, not an in-place cast. Under `--accept-data-loss`
that runs silently on container start and resets every lead's source to `OTHER`
and every category to `NULL`.

So the change is split expand → backfill → contract, and the expand release is
built so that `db push` *cannot* lose data rather than merely being unlikely to.

Note `packages/database/prisma/migrations/` is documentation and the local/ops
apply path only — it is never executed in production. `CLAUDE.md` mentions
`npm run db:migrate`; that script does not exist. The real local command is
`npm run db:push --workspace=@erp71/database`.

---

## Phase 1 — expand (shipped)

Additive only. Verified by diffing the schema before and after:

```
npx prisma migrate diff \
  --from-schema-datamodel <old>.prisma \
  --to-schema-datamodel prisma/schema.prisma --script
```

emits exactly 2 × `CREATE TABLE`, 8 × `CREATE INDEX`, 4 × `ADD FOREIGN KEY` and
1 × `ALTER TABLE ... ADD COLUMN` — **zero** `DROP` or `ALTER COLUMN`. Re-run that
diff if you change the models; the property this phase depends on is that the
statement list stays destruction-free.

What ships:

- `LeadSourceOption`, `LeadCategoryOption` (tenant-scoped, `@@unique([tenant_id, code])`).
- `Lead.source_id`, `Lead.category_id` — nullable, `onDelete: Restrict`.
- The legacy `Lead.source` / `Lead.category` enum columns **stay** and are
  dual-written on every create/update, so rolling back to the previous release
  finds sane data.
- `sync-lead-taxonomy` joins the container start chain.

### Backfill

`packages/database/prisma/sync-lead-taxonomy.ts` runs on every container start,
after `db push`. Per tenant, in a transaction:

1. **Seed defaults** from `DEFAULT_LEAD_SOURCES` / `DEFAULT_LEAD_CATEGORIES`.
2. **Reconcile in-use codes** — create a row for any legacy enum value present on
   a lead that step 1 did not cover (a tenant that deleted a default, say).
3. **Backfill** `source_id` / `category_id` by joining on `code`, never `name`, so
   a tenant renaming "Facebook" to "Meta Ads" mid-migration cannot break the join.
4. **Verify** and report residual unmatched rows.

Step 2 is what makes step 4 meaningful. Without it the backfill would have to
bucket unmatched leads into `OTHER`, which destroys provenance and hides the
exact condition phase 3 must check.

Run it manually against one tenant, or preview without writing:

```
npm run sync:lead-taxonomy --workspace=@erp71/database -- --dry-run
npm run sync:lead-taxonomy --workspace=@erp71/database -- --tenant=<uuid>
```

The script deliberately **warns rather than exiting non-zero** on residual rows:
it sits in the `&&` chain ahead of `node main.js`, and one stale lead must not
keep the backend from booting.

---

## Phase 2 — cut reads over (next)

Nothing to deploy for the app: it already reads `source_id`/`category_id`. This
phase is just the confidence gate. Both must return 0 on production:

```sql
SELECT count(*) FROM "Lead" WHERE source_id IS NULL;
SELECT count(*) FROM "Lead" WHERE category IS NOT NULL AND category_id IS NULL;
```

---

## Phase 3 — contract (do NOT combine with phase 1)

Only once phase 2's gate reads zero:

1. Delete `Lead.source`, `Lead.category` and the `@@index([tenant_id, category])`
   from `schema.prisma`, and drop the `LeadSource` / `LeadCategory` enums.
2. Delete `coerceLegacySource` / `coerceLegacyCategory` and their call sites in
   `crm-leads.service.ts`.
3. Leave `sync-lead-taxonomy.ts` alone — it checks `information_schema` for the
   legacy columns and degrades to seeding-only once they are gone, which is why
   dropping them does not break the boot chain.

**Collapsing phases 1 and 3 into one deploy is the failure mode this whole plan
exists to prevent.** `db push` would drop `source` and add an empty `source_id`
in the same statement batch, and every lead's provenance is gone with no
rollback short of a dump restore.

---

## Things that will bite you

- **`packages/database/index.js` is hand-maintained.** `package.json` sets
  `main: ./index.js` and `types: ./index.ts`, so the backend type-checks against
  the `.ts` and *loads* the CommonJS mirror. A symbol added to one and not the
  other compiles clean and throws "is not a function" in production. Both
  `prisma/lead-taxonomy.seed.ts` and `prisma/lead-taxonomy.seed.js` must be kept
  in sync; `lead-taxonomy-catalogue.spec.ts` fails if they drift.
- **`code` is immutable.** The backfill and the CSV importer both join on it.
  Renames change `name` only.
- **Seeded rows deactivate, they do not delete.** `sync-lead-taxonomy` recreates
  missing defaults on every start, so a hard delete would come back.
- **The `OTHER` source cannot be deleted or deactivated.** Lead creation, CSV
  import and the backfill all fall back to it.
- **Rollback is not free.** Rolling back to the previous image re-runs *its*
  `db push`, which drops the two new tables and both FK columns. Leads created
  against a tenant-added source collapse to `OTHER` in the legacy column. Take a
  dump first if that matters.
- **Locale catalogs are parity-tested.** `messages/catalog.test.ts` compares key
  paths bidirectionally; an English-only addition fails CI. Tenant-entered names
  are shown verbatim and never translated — only the seeded defaults ship with
  English names.
