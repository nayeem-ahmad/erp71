# Product merge — collapse a duplicate into an existing product

**Date:** 2026-10-01
**Status:** Draft pending review
**Asked as:** an option to merge a new product into an old one when the new
one is clearly a duplicate; every existing record’s product id becomes the
old product’s id.

---

## Problem

A shop ends up with two catalog rows for the same physical item — a CSV
import, a second Express/Dizi “create as new”, a typo that was later
re-entered. Sales, purchases, and stock split across the two ids. Soft-delete
hides one row and leaves its history stranded. There is no way to put that
history onto the product the shop actually uses.

## Goals

- An owner/admin, starting from the **duplicate**, picks the **keeper** and
  confirms. After commit, every `product_id` that pointed at the duplicate
  points at the keeper.
- Warehouse quantities **add**. Average cost is **rebuilt** from both pools.
- The keeper keeps its id, name, SKU, price, brand, and category unless the
  operator ticks fields to copy from the duplicate.
- The duplicate disappears from pickers (soft-delete, SKU cleared).
- Express/Dizi mappings that named the duplicate now name the keeper, so the
  next import does not recreate it.

## Non-goals (v1)

- Auto-finding duplicates. The operator already knows the pair.
- Undo / un-merge.
- Merging customers or suppliers.
- Posting new inventory movements or vouchers. History already happened.
- Rewriting `InventoryMovement.balance_after` into a continuous series.
- A dedicated Merge products page.
- A new `StorePermission`. OWNER plus `MANAGE_USERS` is enough.

Those stay later work.

---

## Who it is for

OWNER, and any member with `MANAGE_USERS` (the same gate as billing and
team). `EDIT_PRODUCTS` alone is not enough: the write rewrites sales and
stock.

Frontend: `isOwner(role) || hasPermission(permissions, 'MANAGE_USERS')`.
Hide the action otherwise.

---

## Placement

| Surface | Detail |
|---|---|
| Entry | Inventory → Products row action **Merge into…** on the duplicate. Same control in the edit-product modal. |
| Flow | Search for the keeper (live products, source excluded) → keeper-first confirm dialog → `POST` merge. |
| Dialog | Title is the keeper. Duplicate is a warning plus optional copy-toggles (default off). Stock/cost line is always combined. Red **Merge product** disabled when preview returns a blocker. |
| After | Duplicate leaves the list. Toast names the counts (sales, purchases, combined stock). |

No new nav node.

---

## Architecture

No new tables. One transaction on the existing products module.

```
GET  /products/:sourceId/merge-preview?targetId=
POST /products/:sourceId/merge          { targetId, takeFields }

        │
        ▼
planMerge(sourceId, targetId)     ← shared; preview returns it, commit re-runs it
        │
        ├── guards (hard refuse)
        ├── impact counts
        ├── folds (unique parent+product collisions)
        └── catalog field diffs
        │
        ▼  (POST only, same transaction)
commitMerge(plan, takeFields)
        │
        ├── fold unique children
        ├── updateMany remaining FKs source → target
        ├── combine ProductStock; rebuild ProductCost
        ├── apply takeFields onto the keeper
        ├── null source SKU; set deleted_at
        ├── retarget ExternalSyncMapping PRODUCT internal_id
        └── redis invalidate products:{tenantId}:
```

`planMerge` and `commitMerge` live in `apps/backend/src/products/` (a
`products.merge.ts` next to the service, or methods on `ProductsService`).
Cost blending is a pure `mergePools` next to `applyToPool` in
`product-cost.utils.ts`.

Preview and commit share the planner so the dialog cannot show “ok” and then
fail on a blocker the preview missed. POST still re-runs `planMerge` inside
the transaction.

The global audit interceptor records the POST. The service return includes
`sourceId` and `targetId` so the row names both products.

---

## API

Declared on `ProductsController` **before** `GET :id`.

```
GET  /products/:sourceId/merge-preview?targetId=
POST /products/:sourceId/merge
```

- Auth: JWT + tenant interceptor +
  `@RequireAnyStorePermission(StorePermission.MANAGE_USERS)` (OWNER always
  passes). Same gate as billing / team, without implying this is a billing
  route.
- `sourceId` = duplicate (the row the operator started from).
- `targetId` = keeper (the old product that keeps its id).

### Preview response

```ts
{
  source: { id, name, sku, price, type, /* catalog fields */ },
  target: { id, name, sku, price, type, /* catalog fields */ },
  fields: Array<{
    key: TakeField;
    sourceValue: unknown;
    targetValue: unknown;
  }>,
  stock: Array<{
    warehouseId: string;
    warehouseName: string;
    sourceQty: number;
    targetQty: number;
    combinedQty: number;
  }>,
  cost: {
    source: { avgCost: number | null; qtyOnHand: number };
    target: { avgCost: number | null; qtyOnHand: number };
    combined: { avgCost: number | null; qtyOnHand: number };
  },
  counts: {
    saleLines: number;
    purchaseLines: number;
    saleReturnLines: number;
    purchaseReturnLines: number;
    orderLines: number;
    quoteLines: number;
    movements: number;
    serials: number;
    warranties: number;
    mappings: number;
  },
  folds: Array<{ kind: string; parentLabel: string; note: string }>,
  blockers: Array<{ code: BlockerCode; message: string }>;
}
```

`blockers` empty means merge is allowed. Non-empty means the confirm button
is disabled and POST would 400 with the same codes.

### Commit body

```ts
{ targetId: string; takeFields: TakeField[] }
```

`takeFields` is a whitelist. Unknown names → 400. Empty array keeps every
keeper catalog field.

### Commit response

The keeper in the same shape as `GET /products/:id`, plus the applied
`counts`, combined stock total, and combined cost, for the toast.

### Blocker codes

| Code | When |
|---|---|
| `SOURCE_NOT_FOUND` | Source missing, other tenant, or already `deleted_at`. |
| `TARGET_NOT_FOUND` | Target missing, other tenant, or already `deleted_at`. |
| `SAME_PRODUCT` | `sourceId === targetId`. |
| `TYPE_MISMATCH` | One is `GOODS`, the other `SERVICE`. |
| `SERIAL_COLLISION` | The same `serial_number` exists on both products (tenant-scoped). |
| `BOM_CONFLICT` | Both products have a `BomRecipe`. |

HTTP status: `SOURCE_NOT_FOUND` is 404 (the path id is gone). Every other
blocker is 400, including `TARGET_NOT_FOUND` (a query/body argument that
does not resolve).

---

## Takeable fields

`type`, stock, and cost are not takeable. Type is a guard. Stock and cost
always combine.

| `TakeField` | Columns copied when ticked |
|---|---|
| `name` | `name` |
| `sku` | `sku` |
| `price` | `price` |
| `compareAtPrice` | `compare_at_price` |
| `brand` | `brand_id` |
| `category` | `group_id` and `subgroup_id` together |
| `image` | `image_url` |
| `gallery` | `images_gallery` |
| `description` | `description` |
| `unitType` | `unit_type` |
| `vatRate` | `vat_rate` |
| `sdRate` | `sd_rate` |
| `warranty` | `warranty_enabled` and `warranty_duration_days` |
| `reorder` | `reorder_level`, `safety_stock`, `lead_time_days` |
| `hsCode` | `hs_code` |
| `origin` | `country_of_origin` |
| `weight` | `net_weight_kg` and `cbm` |

`is_featured` stays on the keeper.

SKU overlay: null the duplicate’s SKU first, then write the keeper, so
`@@unique([tenant_id, sku])` never collides. Soft-delete **always** nulls
the duplicate SKU, even when `sku` is not in `takeFields`. PostgreSQL allows
multiple NULL SKUs.

---

## Rewrite rules

One Prisma interactive transaction. Failure rolls everything back. No new
inventory movements, no new vouchers.

### Order

1. Re-run `planMerge`. Abort on a blocker.
2. Fold every unique `(parent, product)` child so the duplicate row is gone
   before any `product_id` update would collide.
3. `updateMany` remaining FKs from source → target.
4. Combine `ProductStock` and rebuild `ProductCost`.
5. Apply `takeFields` to the keeper.
6. Null the duplicate SKU, set `deleted_at`.
7. `ExternalSyncMapping` where `entity_type = 'PRODUCT'` and
   `internal_id = sourceId` → `internal_id = targetId`.
8. `redis.invalidatePattern('products:{tenantId}:')`.

### Fold vs re-point

| Table | Rule |
|---|---|
| `SaleItem`, `SalesReturnItem`, `PurchaseItem`, `PurchaseReturnItem`, `SalesOrderItem`, `QuotationItem`, `PurchaseOrderItem`, `PurchaseQuotationItem`, `ImportShipmentItem`, `StorefrontOrderItem`, `WarrantyClaim`, `InventoryMovement`, `ProductionJob`, `ProductionWastage` | Re-point. Two lines of the same product on one invoice stay two lines, each with its original price/qty. |
| `ProductStock` | Per warehouse: add `quantity`, drop the duplicate row. A warehouse only the duplicate used just changes `product_id`. |
| `ProductCost` | See cost rule. Drop the duplicate pool. |
| `WarehouseTransferItem` | Same transfer already has both → add `quantity_sent` and `quantity_received`, drop the duplicate line. |
| `InventoryShrinkageItem` | Add `quantity`. If both have `unit_cost`, weighted by qty. |
| `StockTakeCountLine` | Add `expected_quantity`. Add `counted_quantity` when both are numbers; if only one is counted, keep that number; if neither is counted, leave `counted_quantity` null. Recompute `variance_quantity = counted − expected` when counted is present; otherwise leave variance null. |
| `ProductDemandItem` | Add `quantity_requested`. Add `quantity_approved` when both are numbers; if only one is set, keep that number. |
| `PriceListItem` | Keeper’s list price wins. Duplicate’s row on that list is dropped. Listed as a fold on the preview. |
| `ProductSerial` | Re-point. Collision is already a hard refuse. |
| `BomRecipe` | If only the duplicate has a recipe, re-point `productId` onto the keeper. Both have one → `BOM_CONFLICT`. |
| `BomComponent` | Re-point the ingredient. If the same recipe would then list the keeper twice, add quantity and drop the extra row. |
| `ProductPrice` | Re-point history. If both have an open row (`effective_to` null) for the same `store_id`, close the duplicate’s open row. Catalog `price` still follows `takeFields`. |

### Stock

After folds, keeper `ProductStock` is the per-warehouse sum. No
`INITIAL_STOCK` or adjustment movement is written. On-hand reports read
`ProductStock`.

### Cost pool

`mergePools(keeper, duplicate)` next to `applyToPool`, same 4dp rounding:

- Both `qty_on_hand > 0` → `avg = (q1·c1 + q2·c2) / (q1 + q2)`,
  `qty = q1 + q2`.
- Only one side `qty > 0` → that side’s average, quantities added
  (negatives included).
- Both `qty <= 0` → quantities added, keeper’s average kept.
- Duplicate has no `ProductCost` row → keeper pool unchanged; do not invent
  a row.

After commit, `ProductCost.qty_on_hand` equals the sum of the keeper’s
`ProductStock.quantity`. The test pins that.

A negative `qty_on_hand` is a real pool state (sales booked before receipts
on import) and must survive the merge the same way `applyToPool` does.

### What stays untouched

- Sale/purchase money, tax snapshots (`price_at_sale`, `unit_cost_at_sale`,
  `vat_rate`, `sd_rate`, line tax amounts).
- `InventoryMovement.quantity_delta`, `unit_cost`, and `balance_after`.
  `balance_after` is a point-in-time snapshot and looks disjoint at the
  join. Stock-on-hand and summed `quantity_delta` stay correct.
- Posted GL. Product is not on voucher lines.

### Concurrency

The transaction reads both product rows first. A second merge on the same
source sees `deleted_at` and returns `SOURCE_NOT_FOUND`. A sale posting
mid-merge waits on the stock/cost row locks.

---

## UI

`MergeProductModal` (new), opened from the products table actions and from
`AddProductModal` in edit mode.

1. **Pick keeper.** Existing paged product search, `deleted_at` null, source
   id excluded. Helper: pick the product that should remain.
2. **Confirm (keeper first).** Title is the keeper’s name. A warning names
   the duplicate and the impact counts. Stock line: `40 + 8 → 48` and the
   combined average cost. Copy-toggles for each takeable field, default
   **off**, showing the duplicate’s value. Folds listed when present.
   Blockers replace the confirm button with the reason.
3. **Submit.** `POST /products/:sourceId/merge`. On success, close, drop the
   source row from the list, toast the counts.

Copy-toggles that are on become `takeFields`.

Mobile: the keeper-first stack (no two-column pair) is the only layout.

All new strings go through i18n in all 9 locale files.

---

## Files

| File | Role |
|---|---|
| `apps/backend/src/database/product-cost.utils.ts` | `mergePools` |
| `apps/backend/src/database/product-cost.utils.spec.ts` | Pure blend cases |
| `apps/backend/src/products/products.merge.ts` | `planMerge` + `commitMerge` |
| `apps/backend/src/products/products.merge.spec.ts` | Guards, re-point, folds, takeFields, mappings |
| `apps/backend/src/products/product.dto.ts` | `MergeProductDto`, `TakeField` whitelist |
| `apps/backend/src/products/products.controller.ts` | Preview + merge routes, `MANAGE_USERS` |
| `apps/backend/src/products/products.controller.spec.ts` | New file. Permission: OWNER / `MANAGE_USERS` / `EDIT_PRODUCTS` |
| `apps/backend/src/auth/route-authorization.roles.spec.ts` | Stays green: both handlers carry `@RequireAnyStorePermission(MANAGE_USERS)` and must not be added to `OPEN_ROUTES` |
| `apps/frontend/src/lib/api.ts` | `previewProductMerge`, `mergeProduct` |
| `apps/frontend/src/app/(app)/inventory/MergeProductModal.tsx` | Keeper-first dialog |
| `apps/frontend/src/app/(app)/inventory/MergeProductModal.test.tsx` | Dialog behaviour |
| `apps/frontend/src/app/(app)/inventory/products/page.tsx` | Row action, gated |
| `apps/frontend/src/app/(app)/inventory/AddProductModal.tsx` | Merge into… in edit mode |
| `apps/frontend/src/locales/*.json` | Strings |

`ProductsService.remove` stays as it is (soft-delete only). Merge is a
separate write.

---

## Testing

TDD: failing cases first, then planner/transaction, then the modal.

### Backend (`products.merge.spec.ts` + `mergePools` spec)

- Guards: each blocker code, same payload on preview and commit.
- Happy path: sale, purchase, and movement rows re-point; source
  `deleted_at` set; SKU nulled; Redis invalidated.
- Stock: same warehouse → quantities add, one row; different warehouses →
  both rows on the keeper.
- Cost: both positive → weighted average to 4dp; only one positive → that
  average, qtys added; `qty_on_hand` equals sum of `ProductStock`.
- Folds: transfer, shrinkage, stock-take, demand, price-list already
  containing both. Price-list keeps the keeper’s price.
- `takeFields`: empty → keeper name/SKU/price unchanged; `['name','sku']`
  copies those two only; unknown field → 400.
- Mappings: `internal_id` of a PRODUCT mapping becomes the keeper.
- Permission: OWNER 200, `MANAGE_USERS` 200, `EDIT_PRODUCTS` alone 403.
- Route scan still green.

### Frontend

- Merge action absent without admin permission, present for owner/admin.
- After picking a keeper, title is the keeper, duplicate is in the warning,
  toggles default off, combined stock line visible.
- A blocker from preview disables **Merge product**.
- Successful POST removes the duplicate row and toasts the counts.

### i18n

Every new key exists in all 9 locale files (the existing locale test fails
the build otherwise).

### Out of test scope for v1

Playwright e2e (CI often skips it), customer/supplier merge, undo.

---

## Key decisions

1. **Identity rewrite, not an alias and not a stock adjustment.** The
   operator asked for existing records to carry the old id.
2. **One transaction, shared planner.** Preview is the commit plan without
   writes.
3. **Combine stock and cost.** Duplicate history was real movement.
4. **Keeper-first confirm, copy-toggles default off.** The old product is
   the truth; taking a field is explicit.
5. **OWNER / `MANAGE_USERS`.** Same admin gate as billing. No new
   permission.
6. **Soft-delete + null SKU.** Matches today’s catalog delete and frees the
   SKU unique.
7. **Retarget `ExternalSyncMapping`.** Otherwise the next import recreates
   the duplicate.
8. **Sale/purchase lines do not fold.** Two lines on one invoice stay two
   lines with their snapshot prices.
9. **Serial collision and dual BOM refuse.** Those are two physical
   identities or two recipes; the operator must fix them first.
