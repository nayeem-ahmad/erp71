# PgBouncer Configuration Guide (#55)

Supabase provides PgBouncer automatically. Verify it is correctly configured:

## Checklist

- [ ] `DATABASE_URL` uses port **6543** (PgBouncer pooled)
- [ ] `DIRECT_URL` uses port **5432** (direct — Prisma CLI only)
- [ ] `?pgbouncer=true` query param is appended to `DATABASE_URL`
- [ ] Connection mode is **Transaction** (default in Supabase — correct for a multi-tenant API)

## Correct format

```
# Runtime (PgBouncer)
DATABASE_URL="postgres://postgres:PASSWORD@db.PROJECT.supabase.co:6543/postgres?pgbouncer=true"

# Prisma CLI / migrations only
DIRECT_URL="postgres://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres"
```

## Prisma schema requirement

Both URLs must be declared in `schema.prisma`:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

> The `directUrl` field tells Prisma CLI to bypass PgBouncer when running `prisma db push` / `prisma migrate`.

## Verify under load

After your first real traffic load, run in Supabase SQL editor:
```sql
SELECT * FROM pg_stat_activity WHERE state = 'active' ORDER BY query_start;
```
If you see connection counts near the pool limit, increase pool size in Supabase Dashboard →
Database → Connection Pooling → Pool Size.

## Current schema.prisma status

The `schema.prisma` file currently only declares `url`. Add `directUrl` before running any migrations:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")   # add this line
}
```
