# Catalog harvest

Local scripts that scrape Star Tech category listings into identity-only
product rows for the computer-hardware catalog template. Fixture tests run in
CI; the live crawl does not.

Never run harvest in production or CI. CI runs `npm run test:catalog-harvest`,
which executes the `*.spec.ts` files against fixtures and an injected `fetchFn`
only.

## Commands

Harvest one category:

```bash
npx tsx scripts/catalog-harvest/harvest.ts --category processor
```

Harvest every allowlist root:

```bash
npx tsx scripts/catalog-harvest/harvest.ts --all
```

Transform `raw/*.jsonl` into
`packages/database/prisma/templates/computer-hardware.json`:

```bash
npx tsx scripts/catalog-harvest/transform.ts
```

## Rate limit and User-Agent

The walker fetches at 1 req/s (`MIN_DELAY_MS = 1000`) and sends:

```
User-Agent: ERP71CatalogHarvest/1.0 (+https://erp71.com)
```

## Output

JSONL and checkpoints land in `scripts/catalog-harvest/raw/`. That directory is
gitignored — do not commit scrape output.

## SKU quota

Starter `maxSkus` 100/500 — the seeder bypasses quota (surgical already does)
but shops on Starter may need a higher plan to *add* SKUs after import.
