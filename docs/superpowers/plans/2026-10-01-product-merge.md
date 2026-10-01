# Product Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner/admin merge a duplicate product into an existing keeper so every `product_id` moves onto the old id, stock and cost combine, and the duplicate is soft-deleted.

**Architecture:** Pure `mergePools` next to `applyToPool`. `planMerge` / `commitMerge` in `products.merge.ts` share one planner: preview returns it, POST re-runs it inside a Prisma transaction, then folds unique children, re-points remaining FKs, overlays `takeFields`, nulls the duplicate SKU, soft-deletes, and retargets `ExternalSyncMapping`. Keeper-first `MergeProductModal` from the products row action.

**Tech Stack:** NestJS, Prisma/`DatabaseService`, Jest; Next.js 15, React Testing Library, existing compact `ModalShell`, Tailwind, i18n message catalog.

**Spec:** `docs/superpowers/specs/2026-10-01-product-merge-design.md`

## Global Constraints

- Branch is `dev`. Never commit to `main`. Do not stage `.vscode/settings.json`.
- Backend tests from repo root: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend` (and `src/database/product-cost.utils.spec.ts`, `src/auth/route-authorization`). Frontend: `npm test --workspace apps/frontend -- <file>`.
- No new tables, no new `StorePermission`, no new inventory movements, no new vouchers, no undo.
- Gate is `MANAGE_USERS` (OWNER bypasses). Do not use `PRODUCT_WRITE` / `EDIT_PRODUCTS` for these two routes.
- `sourceId` is the duplicate (path). `targetId` is the keeper (query/body).
- `takeFields` is a whitelist (`TAKE_FIELDS`). Unknown names 400. Empty array keeps every keeper catalog field.
- Soft-delete the duplicate (`deleted_at`) and always null its SKU. PostgreSQL allows multiple NULL SKUs.
- Message catalog: every locale (`en`, `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur`) must keep the same key paths (`catalog.test.ts`). Real copy in `en` and `bn`; others may copy English.
- One `TODO.md` COMPLETED entry at feature ship, not per task.
- Author: Nayeem Ahmad `<nayeem.ahmad@gmail.com>`. Conventional commits; no Co-Authored-By.

## Review Focus

- A duplicate cost pool with `qtyOnHand > 0` and `avgCost: null` must add quantity without zeroing the keeper’s average. Test in Task 1.
- A sale that already has both products as two lines stays two lines (re-point, no fold). Test in Task 4.
- A second merge of an already-deleted source is `SOURCE_NOT_FOUND` (404). Test in Task 4.
- Legacy Manager (`EDIT_PRODUCTS`, no `MANAGE_USERS`) is kept out of `POST /products/:sourceId/merge`. Test in Task 6.
- A `targetId` that belongs to another tenant is `TARGET_NOT_FOUND`, not a silent no-op. Test in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/database/product-cost.utils.ts` | **modify** — export `mergePools` |
| `apps/backend/src/database/product-cost.utils.spec.ts` | **modify** — blend cases |
| `apps/backend/src/products/products.merge.ts` | **new** — `TAKE_FIELDS`, `planMerge`, `commitMerge`, `throwIfBlocked`, `parseTakeFields` |
| `apps/backend/src/products/products.merge.spec.ts` | **new** — guards, preview, commit, folds, mappings |
| `apps/backend/src/products/product.dto.ts` | **modify** — `MergeProductDto` |
| `apps/backend/src/auth/permission-sets.ts` | **modify** — `PRODUCT_MERGE = [P.MANAGE_USERS]` |
| `apps/backend/src/products/products.service.ts` | **modify** — `previewMerge`, `mergeProduct` |
| `apps/backend/src/products/products.controller.ts` | **modify** — GET preview + POST merge, declared before `GET :id` |
| `apps/backend/src/auth/route-authorization.roles.spec.ts` | **modify** — cashier/manager out, tenant_admin in |
| `apps/frontend/src/lib/api.ts` | **modify** — `previewProductMerge`, `mergeProduct` |
| `apps/frontend/src/lib/localization/messages/*/core.ts` | **modify** — `inventory.merge.*` and `inventory.actions.mergeInto` |
| `apps/frontend/src/app/(app)/inventory/MergeProductModal.tsx` | **new** — keeper-first dialog |
| `apps/frontend/src/app/(app)/inventory/MergeProductModal.test.tsx` | **new** |
| `apps/frontend/src/app/(app)/inventory/products/page.tsx` | **modify** — gated row action |
| `apps/frontend/src/app/(app)/inventory/products/page.test.tsx` | **modify** — action visibility |
| `apps/frontend/src/app/(app)/inventory/AddProductModal.tsx` | **modify** — Merge into… in edit mode |
| `TODO.md` | **modify** — one COMPLETED entry at ship |

---

### Task 1: `mergePools`

**Files:**
- Modify: `apps/backend/src/database/product-cost.utils.ts`
- Test: `apps/backend/src/database/product-cost.utils.spec.ts`

**Interfaces:**
- Consumes: existing `CostPool` (`{ avgCost: number | null; qtyOnHand: number }`) and existing private `round4`
- Produces: `mergePools(keeper: CostPool, duplicate: CostPool | null): CostPool`

Rules (same 4dp as `applyToPool`):

- `duplicate === null` → return `keeper` unchanged.
- Both `qtyOnHand > 0` and both `avgCost !== null` → `avg = round4((q1·c1 + q2·c2) / (q1 + q2))`, `qty = q1 + q2`.
- Only one side `qtyOnHand > 0` with a non-null average → that average, quantities added.
- A side with `qtyOnHand > 0` and `avgCost: null` is quantity-only: add qty, keep the other side’s average (do not treat missing cost as 0).
- Both `qtyOnHand <= 0` → quantities added, keeper’s average kept.
- Both averages null → `avgCost: null`, quantities added.

- [ ] **Step 1: Write the failing tests** (append to `product-cost.utils.spec.ts`)

```ts
import { mergePools, type CostPool } from './product-cost.utils';

describe('mergePools', () => {
    it('blends two positive pools to 4dp', () => {
        const keeper: CostPool = { avgCost: 10, qtyOnHand: 40 };
        const dup: CostPool = { avgCost: 13, qtyOnHand: 8 };
        expect(mergePools(keeper, dup)).toEqual({
            avgCost: 10.5, // (40*10 + 8*13) / 48
            qtyOnHand: 48,
        });
    });

    it('keeps the positive side’s average when the other qty is not positive', () => {
        expect(mergePools({ avgCost: 12, qtyOnHand: 10 }, { avgCost: 99, qtyOnHand: -3 })).toEqual({
            avgCost: 12,
            qtyOnHand: 7,
        });
    });

    it('does not zero the keeper average when the duplicate has qty but no basis', () => {
        expect(mergePools({ avgCost: 20, qtyOnHand: 5 }, { avgCost: null, qtyOnHand: 5 })).toEqual({
            avgCost: 20,
            qtyOnHand: 10,
        });
    });

    it('returns the keeper unchanged when there is no duplicate pool', () => {
        const keeper: CostPool = { avgCost: 7.5, qtyOnHand: 3 };
        expect(mergePools(keeper, null)).toEqual(keeper);
    });

    it('keeps the keeper average when both quantities are not positive', () => {
        expect(mergePools({ avgCost: 11, qtyOnHand: -2 }, { avgCost: 50, qtyOnHand: -1 })).toEqual({
            avgCost: 11,
            qtyOnHand: -3,
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="src/database/product-cost.utils.spec.ts" --workspace apps/backend`
Expected: FAIL with `mergePools is not a function` (or similar).

- [ ] **Step 3: Write minimal implementation**

Export `round4` for use in `mergePools` (keep it file-private if `mergePools` lives in the same file). Add:

```ts
export function mergePools(keeper: CostPool, duplicate: CostPool | null): CostPool {
    if (!duplicate) return { avgCost: keeper.avgCost, qtyOnHand: keeper.qtyOnHand };
    const qty = keeper.qtyOnHand + duplicate.qtyOnHand;
    const keeperHas = keeper.qtyOnHand > 0 && keeper.avgCost !== null;
    const dupHas = duplicate.qtyOnHand > 0 && duplicate.avgCost !== null;
    if (keeperHas && dupHas) {
        const avg = (keeper.qtyOnHand * keeper.avgCost! + duplicate.qtyOnHand * duplicate.avgCost!) / (keeper.qtyOnHand + duplicate.qtyOnHand);
        return { avgCost: round4(avg), qtyOnHand: qty };
    }
    if (dupHas && !keeperHas) return { avgCost: duplicate.avgCost, qtyOnHand: qty };
    return { avgCost: keeper.avgCost, qtyOnHand: qty };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="src/database/product-cost.utils.spec.ts" --workspace apps/backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/database/product-cost.utils.ts apps/backend/src/database/product-cost.utils.spec.ts
git commit -m "feat(inventory): blend two product cost pools for merge"
```

---

### Task 2: `planMerge` guards and types

**Files:**
- Create: `apps/backend/src/products/products.merge.ts`
- Test: `apps/backend/src/products/products.merge.spec.ts`

**Interfaces:**
- Consumes: `mergePools` from Task 1
- Produces:

```ts
export const TAKE_FIELDS = [
    'name', 'sku', 'price', 'compareAtPrice', 'brand', 'category', 'image',
    'gallery', 'description', 'unitType', 'vatRate', 'sdRate', 'warranty',
    'reorder', 'hsCode', 'origin', 'weight',
] as const;
export type TakeField = (typeof TAKE_FIELDS)[number];
export type BlockerCode =
    | 'SOURCE_NOT_FOUND'
    | 'TARGET_NOT_FOUND'
    | 'SAME_PRODUCT'
    | 'TYPE_MISMATCH'
    | 'SERIAL_COLLISION'
    | 'BOM_CONFLICT';

export type MergeBlocker = { code: BlockerCode; message: string };
export type MergePlan = {
    source: any | null;
    target: any | null;
    fields: Array<{ key: TakeField; sourceValue: unknown; targetValue: unknown }>;
    stock: Array<{ warehouseId: string; warehouseName: string; sourceQty: number; targetQty: number; combinedQty: number }>;
    cost: {
        source: { avgCost: number | null; qtyOnHand: number };
        target: { avgCost: number | null; qtyOnHand: number };
        combined: { avgCost: number | null; qtyOnHand: number };
    };
    counts: {
        saleLines: number; purchaseLines: number;
        saleReturnLines: number; purchaseReturnLines: number;
        orderLines: number; quoteLines: number;
        movements: number; serials: number; warranties: number; mappings: number;
    };
    folds: Array<{ kind: string; parentLabel: string; note: string }>;
    blockers: MergeBlocker[];
};

export async function planMerge(db: any, tenantId: string, sourceId: string, targetId: string): Promise<MergePlan>;
export function throwIfBlocked(plan: MergePlan, mode: 'preview' | 'commit'): void;
```

`throwIfBlocked`:
- `SOURCE_NOT_FOUND` → `NotFoundException({ code, message })` in both modes.
- Other blockers: preview returns (no throw); commit → `BadRequestException({ code, message })`.

For this task, `planMerge` only has to load both products (`tenant_id`, `deleted_at: null`) and fill `blockers`. Empty counts/stock/fields/folds are fine until Task 3. Cross-tenant ids fail the `tenant_id` filter and become `*_NOT_FOUND`.

- [ ] **Step 1: Write the failing tests**

```ts
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { planMerge, throwIfBlocked } from './products.merge';

function product(over: Record<string, unknown> = {}) {
    return { id: 'src', tenant_id: 't1', deleted_at: null, type: 'GOODS', name: 'Dup', sku: 'D', price: 16, ...over };
}

function dbWith(source: any, target: any, extra: Record<string, any> = {}) {
    return {
        product: {
            findFirst: jest.fn(async ({ where }: any) => {
                if (where.id === source?.id && where.tenant_id === 't1' && where.deleted_at === null) return source;
                if (where.id === target?.id && where.tenant_id === 't1' && where.deleted_at === null) return target;
                return null;
            }),
        },
        productSerial: { findMany: jest.fn().mockResolvedValue([]) },
        bomRecipe: { findMany: jest.fn().mockResolvedValue([]) },
        ...extra,
    };
}

describe('planMerge guards', () => {
    it('blocks a missing source', async () => {
        const plan = await planMerge(dbWith(null, product({ id: 'tgt' })), 't1', 'src', 'tgt');
        expect(plan.blockers.map((b) => b.code)).toEqual(['SOURCE_NOT_FOUND']);
    });

    it('blocks a target in another tenant', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src' }), product({ id: 'tgt', tenant_id: 'other' })),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toEqual(['TARGET_NOT_FOUND']);
    });

    it('blocks merge into self', async () => {
        const p = product({ id: 'src' });
        const plan = await planMerge(dbWith(p, p), 't1', 'src', 'src');
        expect(plan.blockers.map((b) => b.code)).toContain('SAME_PRODUCT');
    });

    it('blocks GOODS into SERVICE', async () => {
        const plan = await planMerge(
            dbWith(product({ id: 'src', type: 'GOODS' }), product({ id: 'tgt', type: 'SERVICE' })),
            't1',
            'src',
            'tgt',
        );
        expect(plan.blockers.map((b) => b.code)).toContain('TYPE_MISMATCH');
    });
});

describe('throwIfBlocked', () => {
    it('404s SOURCE_NOT_FOUND on preview', () => {
        expect(() => throwIfBlocked({ blockers: [{ code: 'SOURCE_NOT_FOUND', message: 'gone' }] } as any, 'preview'))
            .toThrow(NotFoundException);
    });

    it('400s TARGET_NOT_FOUND on commit and not on preview', () => {
        const plan = { blockers: [{ code: 'TARGET_NOT_FOUND', message: 'gone' }] } as any;
        expect(() => throwIfBlocked(plan, 'preview')).not.toThrow();
        expect(() => throwIfBlocked(plan, 'commit')).toThrow(BadRequestException);
    });
});
```

Add two more cases in the same file: `SERIAL_COLLISION` when `productSerial.findMany` returns the same `serial_number` on both ids; `BOM_CONFLICT` when `bomRecipe.findMany` returns a row for both ids.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `products.merge.ts`**

Load source and target with `findFirst({ where: { id, tenant_id, deleted_at: null } })`. Push blockers in the order of the spec table. For serials: load `{ product_id: { in: [sourceId, targetId] } }`, intersect `serial_number`. For BOM: `bomRecipe.findMany({ where: { productId: { in: [...] } } })` (Prisma field is `productId` on `BomRecipe`). Stub `fields: []`, `stock: []`, empty `counts`, `cost` zeros, `folds: []` for now.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/products/products.merge.ts apps/backend/src/products/products.merge.spec.ts
git commit -m "feat(inventory): refuse product merge on identity and type blockers"
```

---

### Task 3: `planMerge` preview payload (counts, stock, cost, fields, folds)

**Files:**
- Modify: `apps/backend/src/products/products.merge.ts`
- Test: `apps/backend/src/products/products.merge.spec.ts`

**Interfaces:**
- Consumes: `planMerge` from Task 2, `mergePools` from Task 1, `TAKE_FIELDS`
- Produces: a complete `MergePlan` when blockers are empty (and still fills what it can when they are not, except `SOURCE_NOT_FOUND` / `TARGET_NOT_FOUND` where the missing product is `null`)

Catalog field mapping for `fields[]`:

| key | source/target value |
|---|---|
| `name` | `name` |
| `sku` | `sku` |
| `price` | `Number(price)` |
| `compareAtPrice` | `compare_at_price` |
| `brand` | `brand_id` |
| `category` | `{ groupId, subgroupId }` |
| `image` | `image_url` |
| `gallery` | `images_gallery` |
| `description` | `description` |
| `unitType` | `unit_type` |
| `vatRate` | `vat_rate` |
| `sdRate` | `sd_rate` |
| `warranty` | `{ enabled, durationDays }` |
| `reorder` | `{ reorderLevel, safetyStock, leadTimeDays }` |
| `hsCode` | `hs_code` |
| `origin` | `country_of_origin` |
| `weight` | `{ netWeightKg, cbm }` |

Counts: `count({ product_id: sourceId })` on `saleItem`, `purchaseItem`, `salesReturnItem`, `purchaseReturnItem`, `salesOrderItem` + `quotationItem` as `orderLines` / `quoteLines`, `inventoryMovement`, `productSerial`, `warrantyClaim`, and `externalSyncMapping` where `{ entity_type: 'PRODUCT', internal_id: sourceId }`.

Stock: union of both products’ `productStock` rows joined to warehouse name. `combinedQty = sourceQty + targetQty` per warehouse (missing side is 0).

Cost: read both `productCost` rows (`product_id` unique); `combined = mergePools(target, source | null)`. Use `Number(avg_cost)`.

Folds (preview only, no writes): a fold entry when both products appear on the same parent for `warehouseTransferItem` (`kind: 'transfer'`), `inventoryShrinkageItem` (`shrinkage`), `stockTakeCountLine` (`stockTake`), `productDemandItem` (`demand`), `priceListItem` (`priceList`). `parentLabel` is the parent number/name if cheap to load; otherwise the parent id.

- [ ] **Step 1: Write the failing tests**

```ts
it('counts source sale lines and combines stock and cost', async () => {
    const src = product({ id: 'src' });
    const tgt = product({ id: 'tgt', name: 'Napa 500mg', sku: 'NAP-500', price: 15 });
    const db = dbWith(src, tgt, {
        saleItem: { count: jest.fn().mockResolvedValue(12) },
        purchaseItem: { count: jest.fn().mockResolvedValue(3) },
        salesReturnItem: { count: jest.fn().mockResolvedValue(0) },
        purchaseReturnItem: { count: jest.fn().mockResolvedValue(0) },
        salesOrderItem: { count: jest.fn().mockResolvedValue(0) },
        quotationItem: { count: jest.fn().mockResolvedValue(0) },
        inventoryMovement: { count: jest.fn().mockResolvedValue(20) },
        productSerial: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        warrantyClaim: { count: jest.fn().mockResolvedValue(0) },
        externalSyncMapping: { count: jest.fn().mockResolvedValue(1) },
        productStock: {
            findMany: jest.fn().mockResolvedValue([
                { product_id: 'src', warehouse_id: 'wh1', quantity: 8, warehouse: { name: 'Main' } },
                { product_id: 'tgt', warehouse_id: 'wh1', quantity: 40, warehouse: { name: 'Main' } },
            ]),
        },
        productCost: {
            findUnique: jest.fn(async ({ where }: any) =>
                where.product_id === 'src'
                    ? { avg_cost: 13, qty_on_hand: 8 }
                    : { avg_cost: 10, qty_on_hand: 40 },
            ),
        },
        warehouseTransferItem: { findMany: jest.fn().mockResolvedValue([]) },
        inventoryShrinkageItem: { findMany: jest.fn().mockResolvedValue([]) },
        stockTakeCountLine: { findMany: jest.fn().mockResolvedValue([]) },
        productDemandItem: { findMany: jest.fn().mockResolvedValue([]) },
        priceListItem: { findMany: jest.fn().mockResolvedValue([]) },
        bomRecipe: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const plan = await planMerge(db, 't1', 'src', 'tgt');
    expect(plan.blockers).toEqual([]);
    expect(plan.counts.saleLines).toBe(12);
    expect(plan.counts.purchaseLines).toBe(3);
    expect(plan.counts.mappings).toBe(1);
    expect(plan.stock).toEqual([
        { warehouseId: 'wh1', warehouseName: 'Main', sourceQty: 8, targetQty: 40, combinedQty: 48 },
    ]);
    expect(plan.cost.combined).toEqual({ avgCost: 10.5, qtyOnHand: 48 });
    expect(plan.fields.find((f) => f.key === 'name')).toEqual({
        key: 'name', sourceValue: 'Dup', targetValue: 'Napa 500mg',
    });
});

it('lists a transfer fold when both products are on the same transfer', async () => {
    const db = dbWith(product({ id: 'src' }), product({ id: 'tgt' }), {
        warehouseTransferItem: {
            findMany: jest.fn().mockResolvedValue([
                { transfer_id: 'tr1', product_id: 'src', quantity_sent: 2, quantity_received: 2, transfer: { transfer_number: 'TRF-00012' } },
                { transfer_id: 'tr1', product_id: 'tgt', quantity_sent: 3, quantity_received: 3, transfer: { transfer_number: 'TRF-00012' } },
            ]),
        },
    });
    const plan = await planMerge(db, 't1', 'src', 'tgt');
    expect(plan.folds).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'transfer', parentLabel: 'TRF-00012' }),
    ]));
});
```

Extend `dbWith` so every `count` / `findMany` used above defaults to 0 / `[]` — do not make Task 2 tests start throwing.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend`
Expected: FAIL on `counts.saleLines` / empty `stock`.

- [ ] **Step 3: Fill in the rest of `planMerge`**

Issue the counts, stock, cost, field diffs, and fold scans. Keep guard short-circuit: if source or target is missing, return blockers and skip the expensive counts.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend`
Expected: PASS (including Task 2 cases)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/products/products.merge.ts apps/backend/src/products/products.merge.spec.ts
git commit -m "feat(inventory): preview product merge counts, stock, cost, and folds"
```

---

### Task 4: `commitMerge` re-point, stock, cost, soft-delete

**Files:**
- Modify: `apps/backend/src/products/products.merge.ts`
- Modify: `apps/backend/src/products/products.service.ts` (thin wrappers, used in Task 6)
- Test: `apps/backend/src/products/products.merge.spec.ts`

**Interfaces:**
- Consumes: `planMerge`, `throwIfBlocked(plan, 'commit')`, `parseTakeFields`, `mergePools`
- Produces:

```ts
export function parseTakeFields(raw: unknown): TakeField[];
export async function commitMerge(
    db: any,
    redis: { invalidatePattern(pattern: string): Promise<void> },
    tenantId: string,
    sourceId: string,
    dto: { targetId: string; takeFields: TakeField[] },
): Promise<{
    product: any;
    sourceId: string;
    targetId: string;
    counts: MergePlan['counts'];
    combinedStock: number;
    combinedCost: MergePlan['cost']['combined'];
}>;
```

`parseTakeFields`: if `raw` is missing, treat as `[]`. If any element is not in `TAKE_FIELDS`, throw `BadRequestException`. Dedupe.

`commitMerge` runs `db.$transaction(async (tx) => { ... })`:

1. `plan = await planMerge(tx, ...)`; `throwIfBlocked(plan, 'commit')`.
2. Re-point (no unique parent+product): `saleItem`, `salesReturnItem`, `purchaseItem`, `purchaseReturnItem`, `salesOrderItem`, `quotationItem`, `purchaseOrderItem`, `purchaseQuotationItem`, `importShipmentItem`, `storefrontOrderItem` (`productId` camelCase), `warrantyClaim`, `inventoryMovement`, `productionJob` (`productId`), `productionWastage` (`productId`), `productSerial`, `productPrice` (close duplicate open rows in Task 5 — this task may `updateMany` product_id only if tests do not cover store collisions yet).
3. Stock: for each source `productStock` row, if target has the same warehouse, add `quantity` onto target and `delete` source row; else `update` `product_id`.
4. Cost: `mergePools` of both rows; `upsert` keeper; `delete` source pool if present. Then assert `qty_on_hand === sum(productStock.quantity)` for the keeper (compute from the rows just written; if drift, set `qty_on_hand` to that sum — the stock rows are source of on-hand).
5. Skip `takeFields` application in this task (empty only). Task 5 adds it.
6. `tx.product.update({ where: { id: sourceId }, data: { sku: null, deleted_at: new Date() } })`.
7. Skip mappings in this task.
8. After the transaction: `redis.invalidatePattern(\`products:${tenantId}:\`)`.
9. Return keeper via `tx.product.findFirst` with the same `include` as `ProductsService` `productInclude()` if easy; otherwise the raw keeper row plus counts.

Do **not** create inventory movements.

- [ ] **Step 1: Write the failing tests**

```ts
describe('commitMerge', () => {
    it('re-points sale lines, combines same-warehouse stock, soft-deletes source, invalidates cache', async () => {
        const calls: string[] = [];
        const tx = makeCommitTx({
            onSaleUpdateMany: (args) => calls.push(`sale:${args.where.product_id}->${args.data.product_id}`),
            stocks: [
                { id: 'ss', product_id: 'src', warehouse_id: 'wh1', quantity: 8 },
                { id: 'ts', product_id: 'tgt', warehouse_id: 'wh1', quantity: 40 },
            ],
            costs: [
                { product_id: 'src', avg_cost: 13, qty_on_hand: 8 },
                { product_id: 'tgt', avg_cost: 10, qty_on_hand: 40 },
            ],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        const redis = { invalidatePattern: jest.fn() };
        const result = await commitMerge(db, redis, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(calls).toContain('sale:src->tgt');
        expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'src' },
            data: expect.objectContaining({ sku: null, deleted_at: expect.any(Date) }),
        }));
        expect(result.combinedStock).toBe(48);
        expect(result.combinedCost.avgCost).toBe(10.5);
        expect(result.combinedCost.qtyOnHand).toBe(48);
        expect(redis.invalidatePattern).toHaveBeenCalledWith('products:t1:');
    });

    it('keeps two sale lines when a sale already listed both products', async () => {
        const tx = makeCommitTx({});
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.saleItem.updateMany).toHaveBeenCalled();
        expect(tx.saleItem.delete).not.toHaveBeenCalled();
        expect(tx.saleItem.deleteMany).not.toHaveBeenCalled();
    });

    it('moves a warehouse-only-on-source stock row onto the keeper', async () => {
        const tx = makeCommitTx({
            stocks: [{ id: 'ss2', product_id: 'src', warehouse_id: 'wh2', quantity: 5 }],
        });
        const db = { $transaction: (fn: any) => fn(tx) };
        await commitMerge(db, { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] });
        expect(tx.productStock.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'ss2' },
            data: { product_id: 'tgt' },
        }));
        expect(tx.productStock.delete).not.toHaveBeenCalled();
    });

    it('404s a second merge of an already-deleted source', async () => {
        const src = product({ id: 'src', deleted_at: new Date() });
        await expect(commitMerge(dbWith(src, product({ id: 'tgt' })), { invalidatePattern: jest.fn() }, 't1', 'src', { targetId: 'tgt', takeFields: [] }))
            .rejects.toBeInstanceOf(NotFoundException);
    });
});
```

Build `makeCommitTx` so `planMerge`’s reads succeed (reuse `dbWith` fields on `tx`) and so `updateMany` / `update` / `delete` are jest fns.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend`
Expected: FAIL — `commitMerge` not exported.

- [ ] **Step 3: Implement `parseTakeFields` and `commitMerge`** (folds/takeFields/mappings can no-op except stock/cost/re-point/soft-delete)

`ProductsService.previewMerge` / `mergeProduct` can wait for Task 6; only export the functions this task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/products/products.merge.ts apps/backend/src/products/products.merge.spec.ts
git commit -m "feat(inventory): rewrite product ids and combine stock on merge"
```

---

### Task 5: folds, `takeFields`, mappings, open `ProductPrice`

**Files:**
- Modify: `apps/backend/src/products/products.merge.ts`
- Test: `apps/backend/src/products/products.merge.spec.ts`

**Interfaces:**
- Consumes: `commitMerge` from Task 4, `TAKE_FIELDS`
- Produces: the rest of the spec rewrite table. `takeFields` copies columns onto the keeper **after** SKU-null of the source (always null source SKU before writing keeper SKU).

Fold writes, inside the transaction, **before** generic `updateMany`:

| Model | Collision | Write |
|---|---|---|
| `warehouseTransferItem` | same `transfer_id` | add `quantity_sent`, `quantity_received`; delete source line |
| `inventoryShrinkageItem` | same `shrinkage_id` | add `quantity`; if both `unit_cost` numbers, weighted by qty; delete source line |
| `stockTakeCountLine` | same `session_id` | add `expected_quantity`; counted: both numbers → add, one number → keep it, neither → null; `variance_quantity = counted - expected` when counted present else null; delete source line |
| `productDemandItem` | same `demand_id` | add `quantity_requested`; approved: both numbers → add, one number → keep it; delete source line |
| `priceListItem` | same `price_list_id` | **delete source row** (keeper price wins) |
| `bomComponent` | same recipe + both ingredients | add quantity; delete extra row |
| `productPrice` | both open (`effective_to` null) same `store_id` (null store counts as same) | set source-originated row `effective_to = now`, then re-point remaining |

`BomRecipe`: if only source has one, `update` `productId` to target (already refused if both).

`ExternalSyncMapping.updateMany({ where: { tenant_id, entity_type: 'PRODUCT', internal_id: sourceId }, data: { internal_id: targetId } })`.

`takeFields` column map is the spec table. `category` writes both group ids; `warranty` both warranty columns; `reorder` three columns; `weight` both weight columns.

- [ ] **Step 1: Write the failing tests**

```ts
it('folds two transfer lines on the same transfer', async () => {
    // source line qty_sent 2, target line qty_sent 3 → target becomes 5, source line deleted
});

it('drops the duplicate price-list row and keeps the keeper price', async () => {
    // priceListItem: both on list L, keeper selling_price 15, source 16
    // expect delete of source item; keeper unchanged
});

it('copies only name and sku when takeFields says so', async () => {
    const result = await commitMerge(db, redis, 't1', 'src', { targetId: 'tgt', takeFields: ['name', 'sku'] });
    expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'tgt' },
        data: expect.objectContaining({ name: 'Dup', sku: 'D' }),
    }));
    // source SKU nulled in the same transaction, before keeper SKU write
});

it('leaves keeper name unchanged when takeFields is empty', async () => {
    // product.update for tgt must not include name
});

it('400s an unknown takeFields value', async () => {
    await expect(commitMerge(db, redis, 't1', 'src', { targetId: 'tgt', takeFields: ['nope'] as any }))
        .rejects.toBeInstanceOf(BadRequestException);
});

it('retargets ExternalSyncMapping PRODUCT internal_id', async () => {
    expect(tx.externalSyncMapping.updateMany).toHaveBeenCalledWith({
        where: { tenant_id: 't1', entity_type: 'PRODUCT', internal_id: 'src' },
        data: { internal_id: 'tgt' },
    });
});

it('closes the duplicate open ProductPrice when the keeper already has one for that store', async () => {
    // two rows effective_to null, store_id 's1' → source row gets effective_to Date, then product_id retarget of remaining
});
```

Also add one stock-take counted/null case and one shrinkage weighted `unit_cost` case.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend`
Expected: FAIL on fold / takeFields / mapping expectations.

- [ ] **Step 3: Implement the remaining writes in `commitMerge`**

Order: parseTakeFields → transaction → planMerge → throwIfBlocked → folds (including price close) → updateMany leftovers → stock (already in Task 4) → cost → apply takeFields on keeper → null source SKU + deleted_at → mappings → redis.

SKU overlay: `update source { sku: null }` first, then keeper `{ sku: sourceSku }` if `sku` is in `takeFields`. Soft-delete still sets `sku: null` (already null).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --testPathPatterns="src/products/products.merge.spec.ts" --workspace apps/backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/products/products.merge.ts apps/backend/src/products/products.merge.spec.ts
git commit -m "feat(inventory): fold unique rows and overlay fields on product merge"
```

---

### Task 6: HTTP routes, DTO, permission scan

**Files:**
- Modify: `apps/backend/src/auth/permission-sets.ts` — add `export const PRODUCT_MERGE: P[] = [P.MANAGE_USERS];` next to `PRODUCT_WRITE`
- Modify: `apps/backend/src/products/product.dto.ts` — `MergeProductDto`
- Modify: `apps/backend/src/products/products.service.ts` — `previewMerge`, `mergeProduct`
- Modify: `apps/backend/src/products/products.controller.ts` — two routes **above** `@Get(':id')`
- Modify: `apps/backend/src/auth/route-authorization.roles.spec.ts`
- Test: `apps/backend/src/products/products.merge.spec.ts` (service wrappers if useful) plus the roles spec

**Interfaces:**
- Consumes: `planMerge`, `commitMerge`, `throwIfBlocked`, `parseTakeFields`, `TakeField`
- Produces:

```
GET  /products/:sourceId/merge-preview?targetId=
POST /products/:sourceId/merge
body: { targetId: string; takeFields?: string[] }
```

DTO:

```ts
import { TAKE_FIELDS, type TakeField } from './products.merge';

export class MergeProductDto {
    @IsUUID()
    targetId: string;

    @IsOptional()
    @IsArray()
    @IsIn([...TAKE_FIELDS], { each: true })
    takeFields?: TakeField[];
}
```

Controller (import `PRODUCT_MERGE`):

```ts
@RequireAnyStorePermission(...PRODUCT_MERGE)
@Get(':sourceId/merge-preview')
previewMerge(@Tenant() tenant: TenantContext, @Param('sourceId') sourceId: string, @Query('targetId') targetId: string) {
    if (!targetId) throw new BadRequestException('targetId is required');
    return this.productsService.previewMerge(tenant.tenantId, sourceId, targetId);
}

@RequireAnyStorePermission(...PRODUCT_MERGE)
@Post(':sourceId/merge')
mergeProduct(@Tenant() tenant: TenantContext, @Param('sourceId') sourceId: string, @Body() dto: MergeProductDto) {
    return this.productsService.mergeProduct(tenant.tenantId, sourceId, dto);
}
```

Service:

```ts
async previewMerge(tenantId: string, sourceId: string, targetId: string) {
    const plan = await planMerge(this.db, tenantId, sourceId, targetId);
    throwIfBlocked(plan, 'preview');
    return plan;
}

async mergeProduct(tenantId: string, sourceId: string, dto: MergeProductDto) {
    return commitMerge(this.db, this.redis, tenantId, sourceId, {
        targetId: dto.targetId,
        takeFields: parseTakeFields(dto.takeFields ?? []),
    });
}
```

Roles spec: add to the Cashier `cannotReach` list and to a new `describe('product merge')`:

```ts
describe('product merge', () => {
    const mergeRoutes = ['GET /products/:sourceId/merge-preview', 'POST /products/:sourceId/merge'];
    cannotReach('the legacy Cashier', legacy(UserRole.CASHIER), mergeRoutes);
    cannotReach('the legacy Manager', legacy(UserRole.MANAGER), mergeRoutes);
    cannotReach('a Sales User', template('sales_user'), mergeRoutes);
    canReach('a Tenant Admin', template('tenant_admin'), mergeRoutes);
    canReach('a User Manager', template('administration_manager'), mergeRoutes);
    canReach('a role granted only MANAGE_USERS', [StorePermission.MANAGE_USERS], mergeRoutes);
});
```

If `scanRoutes` names the param `:id` instead of `:sourceId`, use whatever `scanRoutes` actually emits (log one failing `no such route` and match it). The handlers must **not** appear in `OPEN_ROUTES`.

- [ ] **Step 1: Write the failing roles-spec assertions** (and a service test that `previewMerge` 404s a missing source)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testPathPatterns="src/auth/route-authorization.roles.spec.ts" --workspace apps/backend`
Expected: FAIL — `no such route: GET /products/:sourceId/merge-preview`

- [ ] **Step 3: Wire DTO, service wrappers, controller routes, `PRODUCT_MERGE`**

Place the new `@Get(':sourceId/merge-preview')` **before** `@Get(':id')`. Run `route-authorization.spec.ts` too so the new handlers do not land in `OPEN_ROUTES`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```
npx jest --testPathPatterns="src/auth/route-authorization" --workspace apps/backend
npx jest --testPathPatterns="src/products/" --workspace apps/backend
```

Expected: PASS. Confirm Cashier still reaches `GET /products` and `POST /products` still uses `PRODUCT_WRITE`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/auth/permission-sets.ts apps/backend/src/products/product.dto.ts apps/backend/src/products/products.service.ts apps/backend/src/products/products.controller.ts apps/backend/src/auth/route-authorization.roles.spec.ts apps/backend/src/products/products.merge.spec.ts
git commit -m "feat(inventory): gate product merge on MANAGE_USERS"
```

---

### Task 7: i18n copy

**Files:**
- Modify: `apps/frontend/src/lib/localization/messages/en/core.ts` — under `inventory.actions` and a new `inventory.merge`
- Modify the same keys in `bn`, `ar`, `de`, `es`, `fr`, `hi`, `ms`, `ur` (`core.ts` in each folder)

**Interfaces:**
- Consumes: none
- Produces: `t.inventory.actions.mergeInto` and `t.inventory.merge.*` (all locales, same paths)

English (`inventory.actions.mergeInto = 'Merge into…'`):

```ts
merge: {
    pickTitle: 'Merge into an existing product',
    pickHelper: 'Pick the product that should remain. Sales, stock, and this product will move onto it.',
    searchPlaceholder: 'Search products…',
    cannotUndo: 'This cannot be undone.',
    copyHeading: 'Copy onto the kept product',
    submit: 'Merge product',
    cancel: 'Cancel',
    absorbing: 'Absorbing {name}',
    warning: '{name} will be removed. {sales} sales and {purchases} purchases will move onto this product.',
    stockLine: 'Stock {target} + {source} → {combined}',
    costLine: 'Avg cost {cost}',
    success: 'Merged into {name}',
    failed: 'Could not merge products',
    fields: {
        name: 'Name',
        sku: 'SKU',
        price: 'Price',
        compareAtPrice: 'Compare-at price',
        brand: 'Brand',
        category: 'Category',
        image: 'Image',
        gallery: 'Gallery',
        description: 'Description',
        unitType: 'Unit',
        vatRate: 'VAT rate',
        sdRate: 'SD rate',
        warranty: 'Warranty',
        reorder: 'Reorder levels',
        hsCode: 'HS code',
        origin: 'Origin',
        weight: 'Weight / CBM',
    },
},
```

Bangla: real translations for the user-visible sentences (`pickHelper`, `warning`, `submit`, `cannotUndo`, `success`). Other locales may copy English. `catalog.test.ts` requires identical key trees.

- [ ] **Step 1: Add the English keys, run the catalog test to see other locales fail**

Run: `npm test --workspace apps/frontend -- src/lib/localization/messages/catalog.test.ts`
Expected: FAIL for every locale missing `inventory.merge`.

- [ ] **Step 2: Mirror keys in the other 8 locales** (`bn` translated, rest English copy)

- [ ] **Step 3: Re-run catalog test**

Run: `npm test --workspace apps/frontend -- src/lib/localization/messages/catalog.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/localization/messages
git commit -m "feat(i18n): copy for merging a duplicate product"
```

---

### Task 8: `MergeProductModal` (keeper-first)

**Files:**
- Create: `apps/frontend/src/app/(app)/inventory/MergeProductModal.tsx`
- Test: `apps/frontend/src/app/(app)/inventory/MergeProductModal.test.tsx`
- Modify: `apps/frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: `t.inventory.merge`, `api.getProductsPaged`, `api.previewProductMerge`, `api.mergeProduct`
- Produces:

```ts
api.previewProductMerge = (sourceId: string, targetId: string) =>
    fetchWithAuth(`/products/${sourceId}/merge-preview?targetId=${encodeURIComponent(targetId)}`);
api.mergeProduct = (sourceId: string, body: { targetId: string; takeFields: string[] }) =>
    fetchWithAuth(`/products/${sourceId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

export default function MergeProductModal(props: {
    isOpen: boolean;
    onClose: () => void;
    source: { id: string; name: string };
    onMerged: (result: { targetId: string; counts: { saleLines: number; purchaseLines: number }; combinedStock: number }) => void;
}): JSX.Element;
```

UX:

1. While no keeper: title `pickTitle`, helper `pickHelper`, search box using existing `getProductsPaged({ search, limit: 10 })`, exclude `source.id`. Clicking a row sets `targetId` and fetches preview.
2. After preview: title is `target.name`. Warning uses `merge.warning` with the duplicate name and counts. `stockLine` / `costLine` from preview. Copy toggles for each `plan.fields` entry, **default off**, label is `merge.fields[key]` plus the duplicate value. Folds listed when `plan.folds.length > 0`. If `plan.blockers.length > 0`, show the first `message` and disable submit.
3. Submit sends `takeFields` = keys whose toggle is on. On success call `onMerged` and `onClose`.

Use `ModalShell` / `ModalHeader` / `ModalFooter`, `Button` variant danger for submit, `min-h-touch`. Keeper-first stack only (no two-column pair).

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MergeProductModal from './MergeProductModal';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getProductsPaged: jest.fn(),
        previewProductMerge: jest.fn(),
        mergeProduct: jest.fn(),
    },
}));
jest.mock('@/lib/i18n', () => ({
    useI18n: () => ({
        t: {
            inventory: {
                merge: {
                    pickTitle: 'Merge into an existing product',
                    pickHelper: 'Pick the product that should remain.',
                    searchPlaceholder: 'Search products…',
                    cannotUndo: 'This cannot be undone.',
                    copyHeading: 'Copy onto the kept product',
                    submit: 'Merge product',
                    cancel: 'Cancel',
                    absorbing: 'Absorbing {name}',
                    warning: '{name} will be removed. {sales} sales and {purchases} purchases will move onto this product.',
                    stockLine: 'Stock {target} + {source} → {combined}',
                    costLine: 'Avg cost {cost}',
                    success: 'Merged into {name}',
                    failed: 'Could not merge products',
                    fields: { name: 'Name', sku: 'SKU', price: 'Price' },
                },
            },
        },
        fmt: (s: string, vars: Record<string, unknown>) =>
            s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')),
    },
}));

it('shows the keeper as the title after a preview and leaves copy toggles off', async () => {
    (api.getProductsPaged as jest.Mock).mockResolvedValue({ data: [{ id: 'tgt', name: 'Napa 500mg' }] });
    (api.previewProductMerge as jest.Mock).mockResolvedValue({
        source: { id: 'src', name: 'Napa Extra 500mg' },
        target: { id: 'tgt', name: 'Napa 500mg' },
        fields: [{ key: 'name', sourceValue: 'Napa Extra 500mg', targetValue: 'Napa 500mg' }],
        stock: [{ warehouseId: 'w', warehouseName: 'Main', sourceQty: 8, targetQty: 40, combinedQty: 48 }],
        cost: { combined: { avgCost: 12.55, qtyOnHand: 48 } },
        counts: { saleLines: 12, purchaseLines: 3 },
        folds: [],
        blockers: [],
    });
    render(<MergeProductModal isOpen source={{ id: 'src', name: 'Napa Extra 500mg' }} onClose={() => {}} onMerged={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search products…'), { target: { value: 'Napa' } });
    await waitFor(() => screen.getByText('Napa 500mg'));
    fireEvent.click(screen.getByText('Napa 500mg'));
    await waitFor(() => screen.getByRole('heading', { name: 'Napa 500mg' }));
    expect(screen.getByText(/Napa Extra 500mg will be removed/)).toBeInTheDocument();
    expect(screen.getByText(/Stock 40 \+ 8 → 48/)).toBeInTheDocument();
    const nameToggle = screen.getByRole('checkbox', { name: /Name/ });
    expect(nameToggle).not.toBeChecked();
});

it('disables Merge product when preview returns a blocker', async () => {
    (api.getProductsPaged as jest.Mock).mockResolvedValue({ data: [{ id: 'tgt', name: 'B' }] });
    (api.previewProductMerge as jest.Mock).mockResolvedValue({
        source: { id: 'src', name: 'A' },
        target: { id: 'tgt', name: 'B' },
        fields: [],
        stock: [],
        cost: { combined: { avgCost: null, qtyOnHand: 0 } },
        counts: { saleLines: 0, purchaseLines: 0 },
        folds: [],
        blockers: [{ code: 'TYPE_MISMATCH', message: 'Cannot merge GOODS into SERVICE' }],
    });
    render(<MergeProductModal isOpen source={{ id: 'src', name: 'A' }} onClose={() => {}} onMerged={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search products…'), { target: { value: 'B' } });
    await waitFor(() => screen.getByText('B'));
    fireEvent.click(screen.getByText('B'));
    await waitFor(() => screen.getByText('Cannot merge GOODS into SERVICE'));
    expect(screen.getByRole('button', { name: 'Merge product' })).toBeDisabled();
});
```

Mock `ModalShell` the same way other inventory tests do if the real one needs extra providers. Debounce search in tests by mocking `getProductsPaged` resolved immediately; if the component debounces, `jest.useFakeTimers()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace apps/frontend -- src/app/\(app\)/inventory/MergeProductModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `api` methods and the modal**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace apps/frontend -- src/app/\(app\)/inventory/MergeProductModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/app/\(app\)/inventory/MergeProductModal.tsx apps/frontend/src/app/\(app\)/inventory/MergeProductModal.test.tsx
git commit -m "feat(inventory): keeper-first dialog to merge a duplicate product"
```

---

### Task 9: Wire the products list and edit modal

**Files:**
- Modify: `apps/frontend/src/app/(app)/inventory/products/page.tsx`
- Modify: `apps/frontend/src/app/(app)/inventory/products/page.test.tsx`
- Modify: `apps/frontend/src/app/(app)/inventory/AddProductModal.tsx`
- Modify: `TODO.md`

**Interfaces:**
- Consumes: `MergeProductModal`, `useTenantPlanFeatures`, `isOwner`, `hasPermission(..., 'MANAGE_USERS')`, `t.inventory.actions.mergeInto`
- Produces: row action + edit-modal entry, gated; on success the source row leaves the list and a toast uses `t.inventory.merge.success`

`canMerge = isOwner(role) || hasPermission(permissions, 'MANAGE_USERS')`.

Row action: a `GitMerge` (or `Merge`) lucide icon button between transfer-history and delete, `title={t.inventory.actions.mergeInto}`, only if `canMerge`. Opens `MergeProductModal` with that row as `source`.

`onMerged`: `setProducts((prev) => prev.filter((p) => p.id !== sourceId))` (or `loadProducts()` if the table is server-paged — prefer reload via the existing `loadProducts` / `useServerList` refresh so pagination stays honest). Toast: `fmt(t.inventory.merge.success, { name: keeperName })`. Use the same toast/alert pattern the page already uses for import summary; if there is no toast helper, `alert` is acceptable only if the page already alerts on delete failure — prefer a small inline status next to the header if import already does that.

Edit modal: when `mode === 'edit'` and `canMerge`, a secondary **Merge into…** in `ModalFooter` that closes the edit modal and opens `MergeProductModal`. Pass `canMerge` as an optional prop `showMerge?: boolean` plus `onMergeClick?: () => void` so AddProductModal stays dumb.

- [ ] **Step 1: Write the failing page test**

Extend `page.test.tsx`:

- Mock `useTenantPlanFeatures` to `{ role: 'CASHIER', permissions: ['EDIT_PRODUCTS'], ready: true }` → no button with title Merge into…
- Mock `{ role: 'OWNER', permissions: [], ready: true }` → button present (after products load). The current DataTable mock does not render actions; extend the mock to render `columns.find(c => c.id === 'actions')?.cell({ row: { original: data[0] } })` so the actions cell is in the document, **or** extract a tiny `ProductRowActions` component and test that instead (preferred if the DataTable mock is too coarse).

If extracting `ProductRowActions`, put it in `products/ProductRowActions.tsx` and test that file. Keep the change on this task.

Also: after `onMerged`, the source id is gone from row-count.

- [ ] **Step 2: Run the page test and confirm it fails**

Run: `npm test --workspace apps/frontend -- src/app/\(app\)/inventory/products/page.test.tsx`
Expected: FAIL — no merge control.

- [ ] **Step 3: Wire the action, modal, edit-modal entry, and a `TODO.md` COMPLETED line dated today**

TODO.md: one line under COMPLETED, e.g. `Product merge — collapse a duplicate into an existing product (2026-10-01). Spec docs/superpowers/specs/2026-10-01-product-merge-design.md.` Do not add a COMPLETED line per prior task.

- [ ] **Step 4: Run frontend tests for the touched files and `npx next lint --quiet --file` from `apps/frontend` on the touched pages**

```
npm test --workspace apps/frontend -- src/app/\(app\)/inventory/products/page.test.tsx src/app/\(app\)/inventory/MergeProductModal.test.tsx src/lib/localization/messages/catalog.test.ts
cd apps/frontend && npx next lint --quiet --file src/app/\(app\)/inventory/products/page.tsx --file src/app/\(app\)/inventory/MergeProductModal.tsx --file src/app/\(app\)/inventory/AddProductModal.tsx
```

Expected: tests PASS, lint quiet.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(app\)/inventory/products/page.tsx apps/frontend/src/app/\(app\)/inventory/products/page.test.tsx apps/frontend/src/app/\(app\)/inventory/AddProductModal.tsx apps/frontend/src/app/\(app\)/inventory/ProductRowActions.tsx TODO.md
git commit -m "feat(inventory): offer Merge into… on a duplicate product"
```

Only `git add` `ProductRowActions.tsx` if you created it.

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| `mergePools` / cost rules / null basis | 1 |
| Guards + HTTP 404 vs 400 | 2, 6 |
| Preview payload, takeable fields, folds listed | 3 |
| Re-point, stock combine, soft-delete, redis, two sale lines, second merge | 4 |
| Unique folds, takeFields, SKU order, mappings, ProductPrice close | 5 |
| Routes, `MANAGE_USERS`, roles scan | 6 |
| i18n 9 locales | 7 |
| Keeper-first modal | 8 |
| Row action + edit modal + TODO | 9 |
| No new tables / movements / undo / finder page | Global Constraints |

**Placeholders:** none of TBD / “similar to Task N” without code.

**Type names:** `TakeField`, `TAKE_FIELDS`, `planMerge`, `commitMerge`, `throwIfBlocked`, `parseTakeFields`, `PRODUCT_MERGE`, `previewProductMerge`, `mergeProduct` are used consistently.

**Review Focus tests:** Task 1 null-basis; Task 4 two sale lines + second merge; Task 6 legacy Manager; Task 2 cross-tenant target.
