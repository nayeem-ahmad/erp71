# Computer hardware starter catalog

**Date:** 2026-11-09
**Status:** Draft pending review
**Asked as:** download product info from startech.com.bd for ERP71 as a
default product catalogue for hardware stores. Plan-only conversation
approved the approach below; this spec is the written form.

---

## Problem

A new computer shop on ERP71 starts with an empty catalog. Onboarding already
offers **Computer Hardware** as a business type (`BusinessType.COMPUTER_HARDWARE`),
but the card is disabled and labelled “Coming soon”. The only starter pack that
loads today is surgical/medical (`surgical-medical.json`, 1,173 SKUs).

The six-month demo generator has a separate ~60-row generic hardware list in
`apps/backend/src/demo-data/generator/catalogs/computer-hardware.ts`. That is
for simulated sales, not a shop’s real POS catalog.

Star Tech (startech.com.bd) is the public catalogue of what a Bangladeshi
computer shop actually sells: brand, model, category tree, in-stock mix.
Their sitemap lists 27,567 URLs. Product pages expose Product Code, Brand,
Price, Regular Price, Status, Key Features, a Specification table, and a
breadcrumb. `robots.txt` allows `/` and names `https://www.startech.com.bd/sitemap.xml`.
Query-param variants (`?product_id=`, `/product/search?*`) are disallowed.

Copying Star Tech’s descriptions, photos, product codes, or retail prices into
ERP71 tenants would ship someone else’s commercial content and go stale on the
next campaign. KH Trading already set the image rule for this product: original
stills, never scraped competitor photos.

---

## Goals

- A tenant that picks **Computer Hardware** at signup (or via Admin › Tenants ›
  Import catalog) receives a starter catalog of real BD-market computer SKUs,
  the same way surgical/medical tenants receive 1,173 products today.
- The committed artifact is identity facts only: name, brand, group, subgroup,
  manufacturer-style SKU. `Product.price` is 0. Stock is 0. `image_url` is empty.
- Harvest is a one-shot local script. Nothing in Nest, no cron, no live price
  sync, no Star Tech CDN URLs stored on `Product`.
- Size lands in the same band as surgical/medical: **1,500–3,000 SKUs**, in-stock
  computer hardware only.
- Re-import is idempotent: existing SKUs on the tenant are skipped
  (`seedBusinessTypeTemplate` already does this).

---

## Non-goals (v1)

- Live scrape or scheduled refresh from startech.com.bd.
- Star Tech descriptions, key-feature copy, photos, or Product Codes in git or
  in a tenant.
- Star Tech cash / regular / EMI prices written to `Product.price` or
  `compare_at_price`.
- Appliances and lifestyle (AC, fridge, TV, mobile phones, air fryer, trimmer,
  drones, solar batteries).
- Extending `seed-template.ts` with warranty, description, or `unit_type`.
  Those wait for v1.1 once the harvest is clean.
- Category-level original stills on Cloudinary (the KH Trading pass). Empty
  `image_url` in v1.
- Replacing the six-month demo-data hardware catalog. Demo stays the ~60 generic
  rows.
- Tenant-facing self-serve catalog import. Platform-admin and signup remain the
  two loaders.
- Rewriting the seeder for speed, or metering `maxSkus` on the seeder path.
  Surgical already bypasses `assertProductQuota`; this pack does the same.
- Pharmacy and grocery templates.

Anti-goals: a production crawler; hotlinking `startech.com.bd/image/…`; using
Star Tech’s numeric Product Code as `Product.sku`.

---

## Who it is for

New computer-hardware tenants at signup, and platform admins importing a
catalog into an existing tenant whose `business_type` is `COMPUTER_HARDWARE`.
Shop staff then set their own prices, stock, and photos.

---

## Placement

| Surface | Detail |
|---|---|
| Signup / onboarding | Computer Hardware card becomes selectable. Description is the committed SKU count (`N products pre-loaded`), matching surgical’s `1,173 products pre-loaded`. |
| Admin › Tenants › Configuration | Import catalog enables for `COMPUTER_HARDWARE` because it joins `BUSINESS_TYPES_WITH_TEMPLATE`. No new card. |
| Inventory › Products | The imported rows appear like any other product. Price 0, stock 0. |
| POS | Name and SKU search work immediately. |

No new nav node, permission, or API route.

---

## Architecture

Reuse the surgical template path. The seeder already resolves

```
packages/database/prisma/templates/${businessType.toLowerCase().replace(/_/g, '-')}.json
```

so `COMPUTER_HARDWARE` loads `computer-hardware.json` with no seeder change.

```
StarTech category tree
        │  local harvest, 1 req/s, robots.txt honoured
        ▼
scripts/catalog-harvest/raw/*.jsonl     (gitignored)
        │  transform: brand+model SKU, map categories, drop copy/images/prices
        ▼
packages/database/prisma/templates/computer-hardware.json
        │  existing seedBusinessTypeTemplate
        ▼
Tenant Brand / ProductGroup / ProductSubgroup / Product
```

Signup still fire-and-forgets `seedBusinessTypeTemplate`. Admin
`POST /admin/tenants/:tenantId/catalog-import` stays synchronous and returns
`{ created, skipped, groups, subgroups, brands }`.

### Template schema (unchanged)

```json
{
  "businessType": "COMPUTER_HARDWARE",
  "groups": [
    {
      "name": "Components",
      "subgroups": [
        {
          "name": "Processors",
          "products": [
            { "sku": "AMD-RYZEN-5-5600", "name": "AMD Ryzen 5 5600 Processor", "purchasePrice": 0, "brand": "AMD" }
          ]
        }
      ]
    }
  ]
}
```

`purchasePrice` is written to `Product.price`. v1 always writes `0`.

---

## Legal and harvest rules

- Run the harvest on a developer machine. The script is committed; the raw
  JSONL is not.
- User-Agent identifies the run (e.g. `ERP71CatalogHarvest/1.0 (+https://erp71.com)`).
- Sleep ≥ 1 second between requests. Stop on HTTP 429 or 403 and resume from
  the category checkpoint.
- Skip robots-disallowed URLs. Walk the category allowlist below, not the
  27k-URL sitemap.
- Product pages are fetched only for URLs discovered on those category listings.
- Sidecar fields kept in the gitignored JSONL for re-runs and dedupe, never
  imported: `url`, `productCode`, `status`, `warrantyText`, Star Tech prices.
- Committed JSON contains only `sku`, `name`, `purchasePrice` (0), `brand`.

---

## Category allowlist and group map

v1 walks these Star Tech category roots and their in-stock paginated listings
(`?page=N` until the last page). Brand-as-leaf categories (e.g. AOC Monitor)
are fetched as sources of product URLs, then folded into the ERP71 subgroup on
the right — the tenant does not get one subgroup per brand.

| Star Tech root (and children) | ERP71 group | ERP71 subgroup |
|---|---|---|
| `/component/processor` | Components | Processors |
| `/component/motherboard` | Components | Motherboards |
| `/component/ram`, `/component/laptop-ram` | Components | Memory |
| `/component/graphics-card` | Components | Graphics Cards |
| `/component/power-supply` | Components | Power Supplies |
| CPU cooler / casing categories under `/component` | Components | Cooling / Casings (from breadcrumb) |
| Desktop / laptop SSD and HDD categories | Storage | Solid State Drives / Hard Drives |
| Pen drive / memory card categories | Storage | Flash Drives / Memory Cards |
| `/laptop-notebook/laptop`, `/gaming-laptop`, `/laptop-notebook/ultrabook` | Laptop | Gaming / Ultrabook / Notebook (from breadcrumb) |
| `/laptop-notebook/laptop-accessories` | Laptop | Accessories |
| `/desktops` (brand PC, gaming PC, mini PC, AIO) | Desktop | Brand PC / Gaming PC / Mini PC / All-in-One |
| `/monitor` | Monitors | Gaming / Office (from title/spec; default Office) |
| Keyboard, mouse, headset, webcam, speaker categories | Peripherals | Input Devices / Audio / Cameras |
| Printer / scanner categories | Peripherals | Printers |
| `/networking` router, switch, adapter, cable | Networking | Routers / Switches / Adapters / Cables |
| UPS categories | Power | UPS |
| HDMI / USB / power cable / hub accessories | Accessories | Cables / Adapters |

**Out of the allowlist:** `/air-conditioner`, `/refrigerator`,
`/television-startech`, `/mobile-phone`, `/air-fryer`, `/trimmer`, `/drone`,
`/lifestyle`, portable power stations, solar batteries, and any breadcrumb
that does not match a row above.

A product whose breadcrumb does not map is dropped, not stuffed into
“Uncategorised”.

The transform owns a `category-map.ts` table. The builder fills missing Star
Tech slugs discovered during the Processor spike, as long as they stay inside
the groups above.

---

## SKU, name, brand, dedupe

- **Name:** the product page `<h1>` (or listing title), trimmed. No “Price in
  Bangladesh” suffix. No rewrite beyond trim and collapsing whitespace.
- **Brand:** the page’s Brand field. Empty → `null`.
- **SKU:** `slug(brand)-slug(model)` uppercased. `slug` keeps `[A-Z0-9]+`
  joined by single hyphens. Model comes from Key Features “Model:” when
  present, otherwise from the title with the brand prefix stripped. Cap at 64
  characters. Collision on the same SKU in one template: append `-2`, `-3`.
  Example: AOC 25G4K → `AOC-25G4K`.
- **Dedupe:** first `(normalised brand, normalised model)`; then normalised
  name. Keep the first in-stock occurrence.
- **Filter:** prefer listing status **In Stock**. Drop Pre Order / Up Coming
  unless dropping them would leave a subgroup empty; then keep them.
- Never use Star Tech Product Code (`50472`) as `sku`.

---

## Second template and existing catalogs

`TODO.md` already flags that `setBusinessType` leaves the previous catalog in
place, and that this is unreachable until a second template ships. It becomes
reachable here.

**Decision:** changing `business_type` does not delete products. Import is
additive and skip-by-SKU, as today.

**Builder-check call (type-change confirm):** the warning is for *any* dirty
business-type save, not Computer Hardware alone. Pharmacy and grocery will
need the same sentence. Tenant detail has `store_count` / `user_count` and no
product count; this spec does not add a `has_products` field (no API PR). The
sentence is true of an empty shop too, so the dialog always runs when
`businessTypeDirty` is set.

Wire it through the existing `PendingConfirm` / `ConfirmDialog` on
`apps/frontend/src/app/(app)/admin/tenants/[tenantId]/page.tsx` (the same
pattern as `importCatalog`). New pending kind `saveBusinessType`. **Save
changes** with `businessTypeDirty` opens that dialog first; confirm then runs
today’s `saveAll` (every dirty section, including the type). Other-section-only
saves stay immediate. Cancel writes nothing.

English source of truth, ICU `{label}` from `BUSINESS_TYPE_LABELS`:

> Saving {label} does not remove this shop’s existing products. Import
> catalog will add that type’s SKUs next to what is already there.
> Duplicates (same SKU) are skipped.

Signup for a brand-new tenant is unchanged: empty catalog, then the seeder.

A surgical tenant that later imports computer hardware ends up with both
ranges. Cleanup is the shop’s product-merge / delete, not this feature.

---

## Harvest script

`scripts/catalog-harvest/` (tsx, same stack as other repo scripts).

| File | Role |
|---|---|
| `harvest.ts` | Walk allowlist, paginate, fetch product pages, checkpoint per category |
| `parse-product.ts` | Extract title, brand, product code, breadcrumb, status, model, warranty text |
| `transform.ts` | JSONL → template JSON |
| `category-map.ts` | Breadcrumb / URL → group + subgroup |
| `sku.ts` | Brand + model → SKU |
| `README.md` | How to run, rate limit, what is gitignored |
| `raw/` | JSONL + checkpoints — gitignored |
| `fixtures/` | Saved HTML for Parser tests (one category listing page, one product page) |

CLI:

```
npx tsx scripts/catalog-harvest/harvest.ts --category processor
npx tsx scripts/catalog-harvest/harvest.ts --all
npx tsx scripts/catalog-harvest/transform.ts
```

`--category processor` is the spike: Star Tech Processor is 139 SKUs / 7 pages.
The spike must produce a tiny valid `computer-hardware.json` fragment and import
into a local tenant before the full harvest runs.

`.gitignore` adds:

```
scripts/catalog-harvest/raw/
```

---

## Wiring (application)

1. Commit `packages/database/prisma/templates/computer-hardware.json`.
2. `BUSINESS_TYPES_WITH_TEMPLATE` becomes
   `[SURGICAL_MEDICAL, COMPUTER_HARDWARE]`.
3. Onboarding `BUSINESS_TYPE_DISPLAY.COMPUTER_HARDWARE.description` becomes
   `'N products pre-loaded'` with the committed count. Pharmacy and grocery
   stay “Coming soon”.
4. Dual `seed-template.js` is untouched. Filename resolution already matches.
5. i18n: `t.admin.tenants.businessTypeControls.typeChangeKeepsProducts` in all
   nine locale files. English source of truth (the `{label}` sentence above);
   other locales get a faithful translation.

No Prisma migration. `business_type` stays a free-form string.

---

## Files

- Create: `docs/superpowers/specs/2026-11-09-computer-hardware-catalog-design.md` (this file)
- Create: `packages/database/prisma/templates/computer-hardware.json`
- Create: `scripts/catalog-harvest/{harvest,parse-product,transform,category-map,sku}.ts`
- Create: `scripts/catalog-harvest/README.md`
- Create: `scripts/catalog-harvest/fixtures/*.html`
- Create: harvest unit tests next to the scripts (or under `scripts/catalog-harvest/*.spec.ts`)
- Modify: `packages/shared-types/index.ts` (`BUSINESS_TYPES_WITH_TEMPLATE`)
- Modify: `apps/frontend/src/app/(app)/dashboard/onboarding/page.tsx` (description)
- Modify: `apps/frontend/src/app/(app)/admin/tenants/[tenantId]/page.tsx`
  (`PendingConfirm` + `saveAll` intercept) plus nine locale files under
  `t.admin.tenants.businessTypeControls.typeChangeKeepsProducts`
- Modify: `.gitignore`
- Test: shared-types or onboarding test that Computer Hardware is available
- Test: admin-tenants import still works for `COMPUTER_HARDWARE` (mock seeder
  path already covers “type with a template”)

`seed-template.ts` / `.js` stay as they are in v1.

---

## Testing

- **SKU:** `AOC` + `25G4K` → `AOC-25G4K`; missing brand → model only;
  collision appends `-2`; output ≤ 64 chars.
- **Dedupe:** two JSONL rows with the same brand+model keep one.
- **Category map:** processor breadcrumb → Components / Processors; an AC
  breadcrumb is dropped.
- **Parser:** fixture HTML for the AOC 25G4K page yields brand `AOC`, model
  `25G4K`, in-stock, breadcrumb Monitor › AOC. Fixture listing page yields
  product URLs and pagination. Tests never hit the live site.
- **Transform:** `purchasePrice` is always 0; no `url`, `productCode`, or
  image fields in the JSON.
- **Allowlist:** `BUSINESS_TYPES_WITH_TEMPLATE` includes `COMPUTER_HARDWARE`.
  Onboarding renders the Computer Hardware card enabled.
- **Seeder (manual, local DB):** import into an empty `COMPUTER_HARDWARE`
  tenant; product count matches JSON; a second import reports `created: 0`.
  Wall-clock reported in the PR. If it exceeds ~30s, stop and batch; do not
  silently switch to fire-and-forget.
- **Type-change confirm:** Save changes with a dirty business type opens
  `ConfirmDialog` with `{label}` filled from `BUSINESS_TYPE_LABELS`; cancel
  leaves drafts unsaved; confirm runs `saveAll`. A save that is not
  business-type-dirty does not open this dialog.

CI does not crawl startech.com.bd.

---

## Risks

| Risk | Handling |
|---|---|
| HTML selectors drift | Checkpointed harvest; committed JSON is what tenants get. Re-run is a new harvest, not a production job. |
| 27k mixed sitemap URLs | Category allowlist only. |
| Starter `maxSkus` 100 / 500 | Seeder already bypasses quota (surgical 1,173 already does). Pack size 1.5–3k. Shops on Starter may need a higher plan to *add* more SKUs after import. Document in the harvest README. |
| Import duration | Measure on the full JSON before calling v1 done. Surgical was “a few seconds” at 1,173. |
| Duplicate models across brand-leaf categories | Dedupe on brand+model before write. |
| Second template mixed into a surgical shop | Additive import + confirm copy. No automatic wipe. |
| Legal complaint | Identity facts only; no copy, images, or prices; crawler off production. |

---

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Delivery path | Committed JSON template + existing seeder | Signup and admin import already work; surgical proved it. |
| Star Tech’s role | One-shot local harvest of identity facts | Public BD-market mix without shipping their content. |
| Prices | Always 0 | Their retail prices are commercial data and go stale. Shops set their own. |
| Images | Empty in v1 | Same rule as KH vs Tynor. Original stills are a later pass. |
| SKU | Manufacturer brand+model | Star Tech Product Codes are theirs and meaningless in another shop. |
| Size | 1,500–3,000 in-stock hardware SKUs | Matches surgical’s proven scale; 20k is too heavy for signup and Starter plans. |
| Scope | Computer hardware, not the whole Star Tech mall | The business type is Computer Hardware. |
| Type change | Keep existing products; confirm on every dirty type save; additive import | Matches the seeder; wiping a live catalog from an admin dropdown is unsafe. Generic `{label}` copy so grocery/pharmacy inherit it. No product-count API — the sentence is true of an empty shop. |
| Demo-data catalog | Unchanged | Demo sales need a small generic set, not 3,000 real models. |
| Seeder fields | Unchanged in v1 | Warranty/description wait until the harvest is trusted. |

Builder-check (2026-11-09) asked two questions that would have forked the plan. Both settled here rather than left open:

1. Confirm copy is generic `{label}`, not Computer Hardware–only.
2. No product-count on `GET /admin/tenants/:id`; the dialog always runs when the type is dirty.

---

## What’s left to the builder

- Exact Star Tech slugs discovered under `/component`, `/monitor`, etc., as
  long as they map into the groups in the table.
- Parser selectors, once the Processor spike’s fixture HTML is saved.
- Faithful translations of `typeChangeKeepsProducts`.
- Whether a subgroup is named “Casings” or “Casing” — pick one and stay
  consistent.
- JSON pretty-print vs compact: pretty-print, one product per block like
  `surgical-medical.json`.

---

## Spike, then full harvest

1. Harvest `--category processor` → JSONL → transform → local import.
   Confirm selectors, SKU rule, and seeder against ~139 rows.
2. Lock `category-map.ts` and `sku.ts`.
3. Harvest `--all` on the allowlist. Transform. Count SKUs; if over 3,000,
   drop Out of Stock first, then long-tail brand-leaf categories, keeping
   every group in the table represented.
4. Commit JSON + allowlist + onboarding copy + type-change confirm.
5. Verify: signup with Computer Hardware; admin re-import skipped count;
   POS search; prices 0; no `startech.com.bd` strings in `Product`.

---

## PR Plan

Independently reviewable slices. Harvest raw files never land in a PR.

1. **`feat(catalog): harvest script and identity transform for computer hardware`**
   - `scripts/catalog-harvest/*`, `.gitignore`, parser/SKU/map tests with
     fixtures. No tenant-facing change.
2. **`feat(catalog): computer-hardware starter template and onboarding`**
   - `computer-hardware.json`, `BUSINESS_TYPES_WITH_TEMPLATE`, onboarding
     description, type-change confirm + i18n. Depends on (1) having produced
     the JSON (the JSON is committed in this PR, not the raw harvest).
3. Docs-only spec (this file) can land first, on its own, before either
   feature PR.

No schema PR. No API PR.
