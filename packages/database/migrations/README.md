# Legacy hand-written migrations — superseded, do not run

These `NN_*.sql` files predate Prisma Migrate. The schema is defined by
`packages/database/prisma/schema.prisma` and applied with
`prisma migrate deploy` (or `prisma db push` for a scratch database). Every
table these files create is owned by the Prisma schema now.

They are kept for history only. **Do not execute them against any database.**

## Why this warning exists

`06_posting_rules_events.sql` begins with:

```sql
DROP TYPE IF EXISTS "PostingRuleEventType";
CREATE TYPE "PostingRuleEventType" AS ENUM (... ten values ...);
```

The Prisma enum is at 24 values and still growing. Running this file silently
drops every value added since it was written, after which any query touching
`posting_rules` fails with `22P02 invalid input value for enum` — and the
damage is to the whole database, not to one connection.

Three integration suites did exactly this in `beforeAll` and cost the project
months of a "the integration tests need a database" baseline of 69 failing
tests; the real cause was these files. See the 2026-08-23 entry in `TODO.md`.
