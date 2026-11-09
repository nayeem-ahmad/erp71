# Computer Hardware Starter Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Computer Hardware starter catalog (1,500–3,000 BD-market identity SKUs, price 0) loaded by the existing seeder, plus a type-change confirm on Admin › Tenants.

**Architecture:** A one-shot local harvest walks Star Tech category listings (1 req/s, robots honoured), writes gitignored JSONL, then transforms identity facts into `packages/database/prisma/templates/computer-hardware.json`. Signup and `POST /admin/tenants/:id/catalog-import` already resolve that filename. `COMPUTER_HARDWARE` joins `BUSINESS_TYPES_WITH_TEMPLATE`. Changing business type stays additive; Save changes with a dirty type opens `ConfirmDialog` first.

**Tech Stack:** Node 22 + `tsx` + `node:test`, `node-html-parser`, existing Nest/Next/Prisma seeder path, Jest + Testing Library for onboarding and tenant detail, nine-locale message catalog.

**Spec:** `docs/superpowers/specs/2026-11-09-computer-hardware-catalog-design.md`

## Global Constraints

- Branch from `dev`. Never commit to `main`. Author: Nayeem Ahmad `<nayeem.ahmad@gmail.com>`. Conventional commits; no Co-Authored-By. Do not stage `.vscode/settings.json` or `.worktrees/`.
- Two PRs, in order: (1) harvest script + tests + fixtures, no tenant-facing change; (2) committed JSON + allowlist + onboarding + type-change confirm.
- Harvest runs on a developer machine only. CI never fetches `startech.com.bd`. User-Agent is exactly `ERP71CatalogHarvest/1.0 (+https://erp71.com)`. Sleep ≥ 1000 ms between requests. Stop on HTTP 429 or 403 and resume from the category checkpoint.
- Committed JSON contains only `sku`, `name`, `purchasePrice` (always `0`), `brand`. No Star Tech descriptions, photos, Product Codes, URLs, or retail prices. Never use a numeric Product Code as `sku`.
- SKU is `slug(brand)-slug(model)` uppercased, cap 64, collisions `-2`/`-3`. Example: AOC + `25G4K` → `AOC-25G4K`.
- Size 1,500–3,000 in-stock hardware SKUs. Out of allowlist: AC, fridge, TV, phones, lifestyle, drones, solar, portable power stations. Unmapped breadcrumbs are dropped, not stuffed into Uncategorised.
- `seed-template.ts` / `seed-template.js` and the demo-data hardware catalog stay untouched. No Prisma migration. No new API route.
- i18n: add `typeChangeKeepsProducts` to all nine locales (`en`, `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur`). English is the source of truth. `catalog.test.ts` enforces key parity.
- Type-change copy is generic `{label}` from `BUSINESS_TYPE_LABELS`, shown on every dirty business-type save. No `has_products` / `product_count` API.
- One `TODO.md` COMPLETED entry at feature ship (end of PR 2), not per task.
- Harvest unit tests use `node:test` via `npx tsx --test`. Frontend tests: `cd apps/frontend && npx jest --testPathPatterns='…' --no-coverage`. Backend: `cd apps/backend && npx jest --testPathPatterns=… --no-coverage`. After `shared-types` edits: `npm run build --workspace packages/shared-types`.

## Review Focus

- A brand-leaf Monitor breadcrumb (`Monitor › AOC`) folds into Monitors / Office (or Gaming if the title matches `/gaming/i`), never a subgroup named `AOC`. Test in Task 2.
- A 70-character base SKU still yields ≤ 64 characters after a `-2` collision suffix. Test in Task 1.
- Transform output has no `url`, `productCode`, or image field even when the harvest row carries them. Test in Task 4.
- Save changes with both `businessTypeDirty` and `subscriptionDirty` opens the type-change dialog once; confirm then writes both sections. Test in Task 10.
- A subgroup whose only rows are Pre Order is kept; a subgroup that has any In Stock row drops Pre Order / Up Coming / Out Of Stock. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/catalog-harvest/sku.ts` | `slug`, `productSku`, `uniqueSku` |
| `scripts/catalog-harvest/category-map.ts` | breadcrumb/URL/title → group+subgroup or `null` |
| `scripts/catalog-harvest/parse-product.ts` | listing + product HTML → `HarvestProduct` |
| `scripts/catalog-harvest/transform.ts` | JSONL/`HarvestProduct[]` → template JSON |
| `scripts/catalog-harvest/harvest.ts` | allowlist walk, robots, delay, checkpoint, CLI |
| `scripts/catalog-harvest/types.ts` | shared `HarvestProduct` / `TemplateData` |
| `scripts/catalog-harvest/*.spec.ts` | `node:test` suites next to the modules |
| `scripts/catalog-harvest/fixtures/*.html` | saved listing + product HTML; never live in CI |
| `scripts/catalog-harvest/raw/` | JSONL + checkpoints; gitignored |
| `scripts/catalog-harvest/README.md` | how to run, rate limit, quota note |
| `.gitignore` | `scripts/catalog-harvest/raw/` |
| `package.json` (root) | `test:catalog-harvest` script; `node-html-parser` + `tsx` as root `devDependencies` |
| `.github/workflows/deploy.yaml` | CI step running harvest unit tests (fixtures only) |
| `packages/database/prisma/templates/computer-hardware.json` | committed starter pack (PR 2) |
| `packages/shared-types/index.ts` | `BUSINESS_TYPES_WITH_TEMPLATE` adds `COMPUTER_HARDWARE` |
| `apps/frontend/src/app/(app)/dashboard/onboarding/page.tsx` | Computer Hardware description + card enabled |
| `apps/frontend/src/app/(app)/admin/tenants/[tenantId]/page.tsx` | `saveBusinessType` pending kind |
| `apps/frontend/src/lib/localization/messages/{en,bn,ar,de,es,fr,hi,ms,ur}/admin.ts` | `typeChangeKeepsProducts` |
| `apps/backend/src/admin-tenants/admin-tenants.service.spec.ts` | import accepts `COMPUTER_HARDWARE` |

Do not create or modify: `seed-template.ts`/`.js`, demo-data `computer-hardware.ts`, Prisma schema, admin-tenants service/controller (allowlist change is enough).

---

### Task 1: SKU helper

**Files:**
- Create: `scripts/catalog-harvest/sku.ts`
- Test: `scripts/catalog-harvest/sku.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `slug(input: string): string` — uppercase `[A-Z0-9]+` tokens joined by single hyphens; empty input → `''`
  - `productSku(brand: string | null | undefined, model: string): string` — `slug(brand)-slug(model)` with no leading hyphen when brand is missing/empty
  - `uniqueSku(base: string, taken: Set<string>, maxLength = 64): string` — clip to `maxLength`; on collision append `-2`, `-3`, …, clipping the stem so the whole string stays ≤ `maxLength`; add the winner to `taken`

- [ ] **Step 1: Write the failing tests** in `sku.spec.ts` using `node:test` / `node:assert/strict`

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slug, productSku, uniqueSku } from './sku';

describe('productSku', () => {
  it('AOC + 25G4K → AOC-25G4K', () => {
    assert.equal(productSku('AOC', '25G4K'), 'AOC-25G4K');
  });
  it('missing brand → model only', () => {
    assert.equal(productSku(null, '25G4K'), '25G4K');
    assert.equal(productSku('', 'Ryzen 5 5600'), 'RYZEN-5-5600');
  });
  it('collapses punctuation and spaces', () => {
    assert.equal(slug('Ryzen 5 5600'), 'RYZEN-5-5600');
    assert.equal(slug('  aoc--25g4k  '), 'AOC-25G4K');
  });
});

describe('uniqueSku', () => {
  it('appends -2 then -3 on collision', () => {
    const taken = new Set<string>();
    assert.equal(uniqueSku('AOC-25G4K', taken), 'AOC-25G4K');
    assert.equal(uniqueSku('AOC-25G4K', taken), 'AOC-25G4K-2');
    assert.equal(uniqueSku('AOC-25G4K', taken), 'AOC-25G4K-3');
  });
  it('keeps output at or under 64 characters including a collision suffix', () => {
    const taken = new Set<string>();
    const long = 'A'.repeat(70);
    const first = uniqueSku(long, taken);
    assert.ok(first.length <= 64);
    const second = uniqueSku(long, taken);
    assert.ok(second.length <= 64);
    assert.match(second, /-\d+$/);
    assert.notEqual(first, second);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test scripts/catalog-harvest/sku.spec.ts`
Expected: FAIL with `Cannot find module './sku'` (or `productSku is not a function`).

- [ ] **Step 3: Implement `slug`, `productSku`, `uniqueSku` in `scripts/catalog-harvest/sku.ts`**

`uniqueSku` clips `base` to `maxLength` first. On collision, `stem = clipped.slice(0, maxLength - suffix.length)` then `stem + '-' + n`. Never emit a string longer than `maxLength`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test scripts/catalog-harvest/sku.spec.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/catalog-harvest/sku.ts scripts/catalog-harvest/sku.spec.ts
git commit -m "feat(catalog): SKU helper for hardware harvest"
```

---

### Task 2: Category map

**Files:**
- Create: `scripts/catalog-harvest/category-map.ts`
- Test: `scripts/catalog-harvest/category-map.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `mapCategory(input: { breadcrumbs: string[]; url?: string; title?: string }): { group: string; subgroup: string } | null`
  - First matching rule wins. `null` means drop. Brand-leaf crumbs (a breadcrumb whose last segment is a brand sitting under a mapped parent) inherit the parent’s group/subgroup, never a subgroup named after the brand.
  - Subgroup for casings is `Casings` (plural). Monitor default subgroup is `Office`; title or breadcrumb matching `/gaming/i` → `Gaming`.

Lock these hits (breadcrumb arrays are leaf-last, as Star Tech renders them):

| breadcrumbs / url | group | subgroup |
|---|---|---|
| `['Component', 'Processor']` | Components | Processors |
| `['Component', 'Motherboard']` | Components | Motherboards |
| `['Component', 'RAM']` or url contains `/component/laptop-ram` | Components | Memory |
| `['Component', 'Graphics Card']` | Components | Graphics Cards |
| `['Component', 'Power Supply']` | Components | Power Supplies |
| `['Component', 'CPU Cooler']` | Components | Cooling |
| `['Component', 'Casing']` | Components | Casings |
| url `/component/ssd` or breadcrumb `SSD` | Storage | Solid State Drives |
| breadcrumb `HDD` / `Hard Disk` | Storage | Hard Drives |
| breadcrumb `Pen Drive` | Storage | Flash Drives |
| breadcrumb `Memory Card` | Storage | Memory Cards |
| `['Laptop', 'Gaming Laptop']` | Laptop | Gaming |
| `['Laptop', 'Ultrabook']` | Laptop | Ultrabook |
| `['Laptop', 'Laptop']` / `Notebook` | Laptop | Notebook |
| `['Laptop', 'Laptop Accessories']` | Laptop | Accessories |
| `['Desktop', 'Brand PC']` | Desktop | Brand PC |
| `['Desktop', 'Gaming PC']` | Desktop | Gaming PC |
| `['Desktop', 'Mini PC']` | Desktop | Mini PC |
| `['Desktop', 'All in One']` / `AIO` | Desktop | All-in-One |
| `['Monitor', 'AOC']` | Monitors | Office |
| `['Monitor', 'AOC']` + title `AOC 25G4K Gaming Monitor` | Monitors | Gaming |
| keyboard / mouse | Peripherals | Input Devices |
| headset / speaker | Peripherals | Audio |
| webcam | Peripherals | Cameras |
| printer / scanner | Peripherals | Printers |
| router / switch / LAN adapter | Networking | Routers / Switches / Adapters (match the device) |
| networking cable | Networking | Cables |
| UPS | Power | UPS |
| HDMI / USB / power cable / hub under accessories | Accessories | Cables or Adapters |
| `['Home Appliance', 'Air Conditioner']` or url `/air-conditioner` | `null` | |
| refrigerator, television, mobile phone, air fryer, trimmer, drone, lifestyle, solar, portable power | `null` | |

Builder may add slugs discovered in the Processor spike as long as they land in a group already in this table.

- [ ] **Step 1: Write the failing tests**

Cover at least: processor → Components/Processors; `['Monitor', 'AOC']` → Monitors/Office; same + gaming title → Monitors/Gaming; AC breadcrumb → `null`; unknown breadcrumb `['Something', 'Else']` → `null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test scripts/catalog-harvest/category-map.spec.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `mapCategory` in `category-map.ts`**

Encode the table as an ordered list of `{ test: (input) => boolean; group; subgroup }` plus an `OUT` list that returns `null`. Matching may use normalised (lowercase, collapsed space) breadcrumb segments and/or URL path prefixes. Do not create an `Uncategorised` group.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test scripts/catalog-harvest/category-map.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/catalog-harvest/category-map.ts scripts/catalog-harvest/category-map.spec.ts
git commit -m "feat(catalog): map Star Tech breadcrumbs to ERP71 groups"
```

---

### Task 3: HTML parser and fixtures

**Files:**
- Create: `scripts/catalog-harvest/types.ts`
- Create: `scripts/catalog-harvest/parse-product.ts`
- Create: `scripts/catalog-harvest/fixtures/product-aoc-25g4k.html`
- Create: `scripts/catalog-harvest/fixtures/listing-processor.html`
- Test: `scripts/catalog-harvest/parse-product.spec.ts`
- Modify: root `package.json` — add `node-html-parser` and `tsx` to `devDependencies` (run `npm install -D node-html-parser tsx` from repo root)

**Interfaces:**
- Consumes: nothing from Tasks 1–2
- Produces:

```ts
export type HarvestProduct = {
  url: string;
  productCode: string | null;
  title: string;
  brand: string | null;
  model: string | null;
  status: string | null;
  warrantyText: string | null;
  breadcrumbs: string[];
  inStock: boolean;
};

export function parseProductPage(html: string, url: string): HarvestProduct;
export function parseListingPage(html: string, pageUrl: string): {
  productUrls: string[];
  nextPage: string | null;
};
```

Name rules: `title` is the `<h1>` text, trimmed, whitespace collapsed, with a trailing `Price in Bangladesh` (any case) stripped. Brand empty → `null`. Model from a Key Features line `Model:` when present, otherwise the title with a leading brand token stripped. `inStock` is true only when status matches `/in stock/i`. `productCode` is parsed into the sidecar type and never becomes `sku`.

- [ ] **Step 1: Add `node-html-parser` and write synthetic fixtures**

`product-aoc-25g4k.html` is a small OpenCart-like page (not a live dump yet) containing: `<h1>AOC 25G4K Gaming Monitor</h1>`, Brand `AOC`, Product Code `50472`, Status `In Stock`, a Key Features `Model: 25G4K`, warranty text `3 years`, breadcrumb `Monitor > AOC`.

`listing-processor.html` contains at least two product links (`/amd-ryzen-5-5600`, `/aoc-25g4k`) and a pagination link `?page=2`.

- [ ] **Step 2: Write the failing tests** in `parse-product.spec.ts`

Read fixtures with `fs.readFileSync`. Assert `parseProductPage` yields `brand: 'AOC'`, `model: '25G4K'`, `inStock: true`, `breadcrumbs` including `Monitor` and `AOC`, `productCode: '50472'`, `title` without `Price in Bangladesh`. Assert `parseListingPage` returns those product URLs (absolute or site-relative) and `nextPage` containing `page=2`. Tests import only local files — no `fetch`, no `startech.com.bd`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test scripts/catalog-harvest/parse-product.spec.ts`
Expected: FAIL, module missing.

- [ ] **Step 4: Implement `parseProductPage` and `parseListingPage`**

Use `parse` from `node-html-parser`. Selectors are the builder’s once they match the fixtures; keep them in one place at the top of `parse-product.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test scripts/catalog-harvest/parse-product.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/catalog-harvest/types.ts \
  scripts/catalog-harvest/parse-product.ts scripts/catalog-harvest/parse-product.spec.ts \
  scripts/catalog-harvest/fixtures
git commit -m "feat(catalog): parse Star Tech listing and product HTML"
```

---

### Task 4: Transform harvest rows into template JSON

**Files:**
- Create: `scripts/catalog-harvest/transform.ts`
- Test: `scripts/catalog-harvest/transform.spec.ts`

**Interfaces:**
- Consumes: `HarvestProduct` (Task 3), `productSku` + `uniqueSku` (Task 1), `mapCategory` (Task 2)
- Produces:

```ts
export type TemplateProduct = {
  sku: string;
  name: string;
  purchasePrice: number;
  brand: string | null;
};
export type TemplateData = {
  businessType: 'COMPUTER_HARDWARE';
  groups: Array<{
    name: string;
    subgroups: Array<{ name: string; products: TemplateProduct[] }>;
  }>;
};

export function transformHarvest(rows: HarvestProduct[]): TemplateData;
export function writeTemplate(template: TemplateData, outPath: string): void;
```

Algorithm (pin this; tests depend on it):

1. Drop a row when `mapCategory({ breadcrumbs, url, title })` is `null`.
2. Dedupe: key = normalised `(brand ?? '', model ?? title)`; if that key is empty, fall back to normalised `title`. When two rows share a key, keep the in-stock one; if both in-stock (or both not), keep the first.
3. Assign group/subgroup from `mapCategory`.
4. Per subgroup: if any remaining row is `inStock`, drop the rest; if none are, keep Pre Order / Up Coming and drop Out Of Stock.
5. SKU = `uniqueSku(productSku(brand, model ?? title), taken)`.
6. Every `purchasePrice` is `0`. Output objects have exactly the four product keys. `businessType` is `'COMPUTER_HARDWARE'`.
7. Group order follows the spec table (Components, Storage, Laptop, Desktop, Monitors, Peripherals, Networking, Power, Accessories); omit empty groups. Subgroups and products: first-seen order.
8. `writeTemplate` pretty-prints with `JSON.stringify(template, null, 2)` plus a trailing newline (same as `surgical-medical.json`).

CLI (when `transform.ts` is the entrypoint): read every `scripts/catalog-harvest/raw/*.jsonl` (ignore missing dir), `transformHarvest`, write `packages/database/prisma/templates/computer-hardware.json`.

- [ ] **Step 1: Write the failing tests**

Include: two rows same brand+model keep one; AC breadcrumb dropped; `purchasePrice === 0`; `JSON.stringify` of a product has no `url`, `productCode`, or `image`; subgroup with mixed stock keeps only In Stock; subgroup with only Pre Order keeps those rows; SKU for AOC/25G4K is `AOC-25G4K`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test scripts/catalog-harvest/transform.spec.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `transformHarvest` and `writeTemplate`**

JSONL sidecar fields stay on `HarvestProduct` and are omitted when mapping to `TemplateProduct`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test scripts/catalog-harvest/transform.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/catalog-harvest/transform.ts scripts/catalog-harvest/transform.spec.ts
git commit -m "feat(catalog): transform harvest rows into identity-only JSON"
```

---

### Task 5: Harvest walker (mocked network)

**Files:**
- Create: `scripts/catalog-harvest/harvest.ts`
- Test: `scripts/catalog-harvest/harvest.spec.ts`

**Interfaces:**
- Consumes: `parseListingPage`, `parseProductPage` (Task 3)
- Produces:

```ts
export const USER_AGENT = 'ERP71CatalogHarvest/1.0 (+https://erp71.com)';
export const MIN_DELAY_MS = 1000;
export const BASE_URL = 'https://www.startech.com.bd';

export const CATEGORY_ALIASES: Record<string, string> = {
  processor: '/component/processor',
  // builder fills the rest from the spec table; --all uses ALLOWLIST_ROOTS
};
export const ALLOWLIST_ROOTS: string[]; // paths from the spec category table

export type HarvestOptions = {
  category: string; // alias key or 'all'
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  rawDir?: string; // default scripts/catalog-harvest/raw
  stdout?: { write(s: string): void };
};

export async function runHarvest(opts: HarvestOptions): Promise<{
  fetched: number;
  stoppedReason: 'done' | '429' | '403';
}>;
```

Behaviour:

- `User-Agent` header is `USER_AGENT` on every request.
- Fetch `BASE_URL + '/robots.txt'` first. Skip any later URL whose path+query matches a `Disallow` (`?product_id=`, `/product/search?*` are the known ones).
- Walk allowlist roots (one alias, or all). Paginate `?page=N` until `nextPage` is null.
- Product pages only for URLs discovered on those listings.
- `await sleepFn(MIN_DELAY_MS)` (default `setTimeout`) before every request except robots.txt.
- Append one JSON object per product to `rawDir/<alias>.jsonl`. Write `rawDir/checkpoint.json` after each category page (`{ completedRoots, currentRoot, currentPage, fetchedProductUrls }`). On restart, skip completed roots and already-fetched product URLs.
- HTTP 429 or 403: write checkpoint, return that `stoppedReason`, process exit code 1 when run as CLI.
- Do not fetch outside `ALLOWLIST_ROOTS`.

- [ ] **Step 1: Write the failing tests** with an in-memory `fetchFn`

Cover: listing then product uses the fixture HTML; `User-Agent` header equals `USER_AGENT`; `sleepFn` called with `1000` between requests; robots-disallowed URL is not fetched; 429 returns `stoppedReason: '429'` and writes `checkpoint.json`; a second run with that checkpoint does not re-fetch completed product URLs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test scripts/catalog-harvest/harvest.spec.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `runHarvest` and a CLI `main`**

CLI: `npx tsx scripts/catalog-harvest/harvest.ts --category processor` and `--all`. Parse argv in `main`; if `import.meta.url` is the entrypoint, call `runHarvest` and `process.exit(1)` on 429/403.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test scripts/catalog-harvest/harvest.spec.ts`
Expected: PASS. Confirm no test opened a real socket (no `startech.com.bd` hostname in the mock).

- [ ] **Step 5: Commit**

```bash
git add scripts/catalog-harvest/harvest.ts scripts/catalog-harvest/harvest.spec.ts
git commit -m "feat(catalog): rate-limited harvest walker with checkpoints"
```

---

### Task 6: Ignore, README, npm script, CI

**Files:**
- Modify: `.gitignore` — add `scripts/catalog-harvest/raw/`
- Create: `scripts/catalog-harvest/README.md`
- Modify: root `package.json` — `"test:catalog-harvest": "tsx --test scripts/catalog-harvest/*.spec.ts"`
- Modify: `.github/workflows/deploy.yaml` — after backend unit tests, a step `Run catalog-harvest unit tests` running `npm run test:catalog-harvest` from the repo root (no Postgres needed; keep it in `test-backend` or a 20-second sibling job — sibling job is fine if adding Postgres-less work to `test-backend` feels wrong; pick the sibling job named `Test (Catalog harvest)` on `ubuntu-latest` with checkout + setup-node + `npm install` + `npm run test:catalog-harvest`)

**Interfaces:**
- Consumes: CLI from Tasks 4–5
- Produces: documented commands; CI runs fixture tests only

README must include: the three CLI commands from the spec; 1 req/s; User-Agent; `raw/` is gitignored; Starter `maxSkus` 100/500 — the seeder bypasses quota (surgical already does) but shops on Starter may need a higher plan to *add* SKUs after import; never run harvest in production or CI.

- [ ] **Step 1: Add the gitignore line, README, npm script, and CI job**

- [ ] **Step 2: Run the npm script locally**

Run: `npm run test:catalog-harvest`
Expected: all harvest `*.spec.ts` files PASS.

- [ ] **Step 3: Commit**

```bash
git add .gitignore scripts/catalog-harvest/README.md package.json \
  .github/workflows/deploy.yaml
git commit -m "chore(catalog): ignore harvest raw files and run parser tests in CI"
```

This is the last commit of **PR 1**. Open `feat(catalog): harvest script and identity transform for computer hardware` into `dev`. Do not add `computer-hardware.json` yet.

---

### Task 7: Processor spike (local machine only)

**Files:**
- Modify: `scripts/catalog-harvest/fixtures/*.html` if live HTML differs from the synthetic fixtures
- Modify: `parse-product.ts` selectors only as needed to keep Task 3 tests green against the new fixtures
- Create (gitignored): `scripts/catalog-harvest/raw/processor.jsonl`

**Interfaces:**
- Consumes: CLI from Tasks 5–6
- Produces: a processor-only JSONL; optional local seeder check

- [ ] **Step 1: Run the live processor harvest**

Run: `npx tsx scripts/catalog-harvest/harvest.ts --category processor`
Expected: finishes with `stoppedReason: 'done'`; ~7 listing pages; on the order of 139 product rows in `raw/processor.jsonl`. If 429/403, wait and re-run (checkpoint resumes). Do not commit `raw/`.

- [ ] **Step 2: Save real HTML into fixtures and re-run parser tests**

Save one live product page (AOC 25G4K if still listed, otherwise any in-stock processor) and one listing page. Redact nothing required for the parser (no need to strip prices from the fixture — fixtures are not imported). Re-run `npx tsx --test scripts/catalog-harvest/parse-product.spec.ts`. Adjust selectors until PASS.

- [ ] **Step 3: Transform the processor JSONL**

Run: `npx tsx scripts/catalog-harvest/transform.ts`
Expected: `computer-hardware.json` exists, `businessType` is `COMPUTER_HARDWARE`, every `purchasePrice` is `0`, SKUs look like `AMD-RYZEN-…`, no `startech.com.bd` string in the file. This JSON is a spike fragment — **do not commit it yet**. Delete or overwrite it in Task 8.

- [ ] **Step 4: Optional local import**

Against a local `COMPUTER_HARDWARE` tenant, call the existing admin import (or `seedBusinessTypeTemplate` via a one-off `npx tsx`). Expect `created` ≈ JSON product count, `skipped` 0 the first time. Do not point this at production.

- [ ] **Step 5: Commit fixture/selector updates only**

```bash
git add scripts/catalog-harvest/fixtures scripts/catalog-harvest/parse-product.ts \
  scripts/catalog-harvest/parse-product.spec.ts scripts/catalog-harvest/category-map.ts
git commit -m "fix(catalog): lock harvest selectors against live Star Tech HTML"
```

Skip the commit if fixtures did not change.

---

### Task 8: Full harvest and committed JSON (PR 2 starts here)

**Files:**
- Create: `packages/database/prisma/templates/computer-hardware.json`

**Interfaces:**
- Consumes: `runHarvest({ category: 'all' })`, `transformHarvest`
- Produces: the committed starter pack, 1,500–3,000 SKUs

- [ ] **Step 1: Harvest `--all` on a developer machine**

Run: `npx tsx scripts/catalog-harvest/harvest.ts --all`
Expected: 30–90 minutes at 1 req/s. Resume from checkpoint on 429. Do not run in CI. Do not commit `raw/`.

- [ ] **Step 2: Transform and count**

Run: `npx tsx scripts/catalog-harvest/transform.ts`
Then count products (a one-liner is fine):

```bash
node -e "const t=require('./packages/database/prisma/templates/computer-hardware.json'); let n=0; for (const g of t.groups) for (const s of g.subgroups) n+=s.products.length; console.log(n, t.groups.map(g=>g.name).join(','))"
```

Expected: `n` in **1500–3000**. Every spec group that had in-stock source rows is present. If `n > 3000`, drop remaining Out of Stock (should already be gone), then drop long-tail brand-leaf listing roots, keeping every group in the spec table represented, and re-transform.

- [ ] **Step 3: Sanity-check the JSON**

- `businessType === "COMPUTER_HARDWARE"`
- every product: keys `sku`, `name`, `purchasePrice`, `brand` only; `purchasePrice === 0`
- no string `startech.com.bd` / `productCode` / `http` in the file
- pretty-printed, one product per block, 2-space indent
- SKUs are brand-model, not integers like `50472`

- [ ] **Step 4: Commit** (first commit of PR 2)

```bash
git add packages/database/prisma/templates/computer-hardware.json
git commit -m "feat(catalog): add computer-hardware starter template JSON"
```

---

### Task 9: Allowlist + onboarding copy

**Files:**
- Modify: `packages/shared-types/index.ts` — `BUSINESS_TYPES_WITH_TEMPLATE`
- Modify: `apps/frontend/src/app/(app)/dashboard/onboarding/page.tsx` — `BUSINESS_TYPE_DISPLAY.COMPUTER_HARDWARE.description`
- Modify: `apps/frontend/src/app/(app)/dashboard/onboarding/page.test.tsx`
- Modify: `apps/backend/src/admin-tenants/admin-tenants.service.spec.ts`

**Interfaces:**
- Consumes: committed product count `N` from Task 8
- Produces: Computer Hardware is a selectable onboarding type; admin import accepts it because the allowlist includes it (no service code change)

```ts
export const BUSINESS_TYPES_WITH_TEMPLATE: BusinessType[] = [
  BusinessType.SURGICAL_MEDICAL,
  BusinessType.COMPUTER_HARDWARE,
];
```

Onboarding description, matching surgical’s pattern:

```ts
COMPUTER_HARDWARE: { icon: Computer, description: '<N with comma> products pre-loaded' },
```

Example: 2417 → `'2,417 products pre-loaded'`. Pharmacy and grocery stay `'Coming soon'`.

- [ ] **Step 1: Write the failing onboarding test**

In `page.test.tsx`, add a case that uses `getMe` with `tenants: []` (the create-store step). Assert a button named `/computer hardware/i` is enabled and shows the committed `N products pre-loaded` string, and that `/pharmacy/i` stays disabled.

- [ ] **Step 2: Run the onboarding test to verify it fails**

Run: `cd apps/frontend && npx jest --testPathPatterns='dashboard/onboarding/page.test' --no-coverage`
Expected: FAIL — Computer Hardware still disabled / still “Coming soon”.

- [ ] **Step 3: Add the importCatalog backend case**

In `admin-tenants.service.spec.ts` `describe('importCatalog')`, add: tenant `business_type: 'COMPUTER_HARDWARE'` → `seedBusinessTypeTemplate` called with `'COMPUTER_HARDWARE'`. The existing PHARMACY rejection stays.

- [ ] **Step 4: Flip the allowlist and onboarding description; rebuild shared-types**

Run: `npm run build --workspace packages/shared-types`

- [ ] **Step 5: Re-run tests**

Run:

```
cd apps/frontend && npx jest --testPathPatterns='dashboard/onboarding/page.test' --no-coverage
cd apps/backend && npx jest --testPathPatterns=src/admin-tenants/admin-tenants.service.spec.ts --no-coverage
```

Expected: PASS. Pharmacy still “Coming soon”.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/index.ts \
  apps/frontend/src/app/\(app\)/dashboard/onboarding/page.tsx \
  apps/frontend/src/app/\(app\)/dashboard/onboarding/page.test.tsx \
  apps/backend/src/admin-tenants/admin-tenants.service.spec.ts
git commit -m "feat(catalog): enable Computer Hardware starter catalog at signup"
```

---

### Task 10: Type-change ConfirmDialog

**Files:**
- Modify: `apps/frontend/src/app/(app)/admin/tenants/[tenantId]/page.tsx`
- Modify: `apps/frontend/src/app/(app)/admin/tenants/[tenantId]/page.test.tsx`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ar,de,es,fr,hi,ms,ur}/admin.ts`

**Interfaces:**
- Consumes: existing `PendingConfirm`, `saveAll`, `businessTypeDirty`, `ConfirmDialog`, `formatMessage`, `BUSINESS_TYPE_LABELS`
- Produces: pending kind `saveBusinessType`; Save changes with a dirty type opens the dialog; confirm runs today’s `saveAll`; cancel writes nothing

English key `t.admin.tenants.businessTypeControls.typeChangeKeepsProducts`:

> Saving {label} does not remove this shop’s existing products. Import catalog will add that type’s SKUs next to what is already there. Duplicates (same SKU) are skipped.

Bengali (`bn/admin.ts`):

> {label} সংরক্ষণ করলে এই দোকানের বিদ্যমান পণ্য মুছে যাবে না। ক্যাটালগ আমদানি সেই ধরনের SKUগুলো ইতিমধ্যে যা আছে তার পাশে যোগ করবে। একই SKU থাকলে সেগুলো বাদ পড়বে।

`ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur`: faithful translation if straightforward, otherwise the English sentence (structure must match; `catalog.test.ts` checks keys, not wording).

Wiring:

- Extend `PendingConfirm` with `| { kind: 'saveBusinessType' }`.
- Sticky bar Save button: if `detail.businessTypeDirty`, `setPending({ kind: 'saveBusinessType' })`; else `void saveAll()`.
- `runPending` case `'saveBusinessType': return void saveAll();`
- `confirmProps` case `'saveBusinessType'`: `title` = `bt.save`, `prompt` = `formatMessage(bt.typeChangeKeepsProducts, { label: BUSINESS_TYPE_LABELS[detail.businessType as BusinessType] ?? detail.businessType })`, `confirmLabel` = `dp.saveChanges`, `loading` = `isSaving`. Not `danger`.
- Other-section-only saves stay immediate. Import catalog is unchanged.

- [ ] **Step 1: Write the failing tests** in `page.test.tsx`

Setup: `tabParam = 'configuration'`; tenant `business_type: 'GROCERY'`.

1. Change the Business type select to `Computer Hardware`, click Save changes. Dialog is open with prompt matching `/does not remove this shop/i` and `/Computer Hardware/`. `setAdminTenantBusinessType` has not been called.
2. Click Cancel. Dialog closes. `setAdminTenantBusinessType` still not called. Unsaved bar still shows.
3. Save changes again, confirm. `setAdminTenantBusinessType` called with `('tenant1', 'COMPUTER_HARDWARE')`.
4. Subscription-only edit (existing pattern): Save changes does **not** open this dialog; `setAdminTenantBusinessType` not called.
5. Dirty type **and** dirty plan: Save changes opens this dialog; after confirm, both `updateAdminTenantSubscription` and `setAdminTenantBusinessType` are called.

- [ ] **Step 2: Run the tenant page tests to verify the new cases fail**

Run: `cd apps/frontend && npx jest --testPathPatterns='admin/tenants/\[tenantId\]/page.test' --no-coverage`
Expected: FAIL — Save changes with a dirty type writes immediately / no dialog.

- [ ] **Step 3: Add the i18n key to all nine `admin.ts` files, then implement the pending kind**

Import `BUSINESS_TYPE_LABELS` and `BusinessType` from `@erp71/shared-types` in the page if not already imported.

- [ ] **Step 4: Re-run page tests and catalog parity**

Run:

```
cd apps/frontend && npx jest --testPathPatterns='admin/tenants/\[tenantId\]/page.test' --no-coverage
cd apps/frontend && npx jest --runInBand src/lib/localization/messages/catalog.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Lint the touched Next files**

Run: `cd apps/frontend && npx next lint --quiet --file src/app/\(app\)/admin/tenants/\[tenantId\]/page.tsx --file src/app/\(app\)/dashboard/onboarding/page.tsx`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/frontend/src/app/\(app\)/admin/tenants/\[tenantId\]/page.tsx \
  apps/frontend/src/app/\(app\)/admin/tenants/\[tenantId\]/page.test.tsx \
  apps/frontend/src/lib/localization/messages/*/admin.ts
git commit -m "feat(admin): confirm business-type change keeps existing products"
```

---

### Task 11: Local seeder verification (manual)

**Files:** none committed unless a bug is found

- [ ] **Step 1: Import into an empty local `COMPUTER_HARDWARE` tenant**

Use Admin › Tenants › Import catalog (or `seedBusinessTypeTemplate`). Record wall-clock in the PR body.

Expected: `created` equals the JSON product count; `skipped` 0; groups/subgroups/brands > 0. If wall-clock exceeds ~30s, **stop** and open a follow-up to batch the seeder — do not silently switch signup to fire-and-forget beyond what it already does.

- [ ] **Step 2: Import a second time**

Expected: `created: 0`, `skipped` equals the JSON product count.

- [ ] **Step 3: Spot-check Inventory › Products**

Prices 0, stock 0, empty images, POS name/SKU search finds a known row (e.g. an AMD processor). No `startech.com.bd` on `Product`.

- [ ] **Step 4: No commit unless a seeder bug is found** (v1 does not change the seeder)

---

### Task 12: TODO.md at ship

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Check off the Computer Hardware starter catalog item and the `setBusinessType` mixed-catalog item; move both to COMPLETED with date `YYYY-MM-DD` of the merge**

One COMPLETED bullet covering JSON + onboarding + confirm. Do not add a COMPLETED line per harvest task.

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs(todo): record computer-hardware starter catalog"
```

Open **PR 2** into `dev`: `feat(catalog): computer-hardware starter template and onboarding`. PR body includes the Task 11 wall-clock and SKU count.

---

## Self-review notes (author)

Spec coverage: harvest CLI, robots/rate-limit/checkpoint, identity-only JSON, category allowlist, SKU rules, dedupe, in-stock filter, seeder reuse, onboarding count, `BUSINESS_TYPES_WITH_TEMPLATE`, type-change `{label}` confirm, nine locales, no API/Prisma/seeder rewrite, demo-data left alone, two PRs, CI does not crawl. Review Focus items each have a test in Tasks 1, 2, 4, and 10.
