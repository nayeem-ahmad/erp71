# Epic 40: Warehouse to Warehouse Transfer

### Epic Goal
Enable the reliable and documented movement of stock from one warehouse (or storefront) to another within the same tenant — including between branches, where the move needs an approver's sign-off before any stock leaves.

### Epic Description
This epic focuses on the internal logistics of stock movement. It ensures that when products are transferred, the stock is atomically deducted from the source and added to the destination, providing a clear audit trail.

**Key Features:**
*   **Transfer Initiation:** Request a stock movement from Source A to Destination B.
*   **Transit Management:** Optionally track the status (e.g., `Sent`, `Received`) for longer-distance transfers.
*   **Auto-Stock Rebalancing:** Atomically update `ProductStock` records in both locations.

**Stories:**
1. **Story 1: Transfer Creation API** - Record the source, destination, items, and quantities for a move.
2. **Story 2: Transfer Approval Flow** - A "Receive" action at the destination to confirm the stock has arrived.
3. **Story 3: Transit History & Auditing** - View all historical movements for a specific product.
4. **Story 4: Cross-Branch Transfer Approval** - For transfers between different stores/branches (as opposed to warehouses within the same store), require an explicit approval step before the stock moves. Status: **Done** (2026-09-12).

   **How it works.** Cross-branch is **derived**, never supplied by the caller: `create` compares the two warehouses' `store_id` and stamps `is_cross_branch`, `requires_approval`, `source_store_id` and `destination_store_id` on the transfer. A cross-branch transfer cannot reach `SENT` directly — asking for `SENT` parks it at `PENDING_APPROVAL`, and `POST /:id/send` on a draft does the same — so no stock leaves the source branch until `POST /:id/approve` releases it. `POST /:id/reject` ends it at `REJECTED` with the approver's reason; nothing ever moved, so there is nothing to reverse. `receive` is unreachable until a transfer is `SENT`, which the approval now gates.

   **Permissions.** `CREATE_GOODS_TRANSFER` gates create/send/receive and `APPROVE_GOODS_TRANSFER` gates approve/reject — the first time `WarehouseTransfersController` enforced anything. Reads sit on `VIEW_PRODUCT_CATALOG` because the guard ANDs whatever a class names, and an approver need not hold the create half. Self-approval is allowed: the permission is the control, not identity, because the owner of a two-branch shop is both the requester and the approver and refusing it would deadlock them. A `goods-transfers` backfill group in `sync-role-permissions.ts` carries the grants to tenants that predate the guard.

   **Accounting is unchanged.** An approved cross-branch transfer still posts nothing — `POSTING_CONTRACT` keeps both `transfer_scope` values at `expectation: 'skip'`, because under periodic inventory moving your own stock between your own warehouses is not an economic event, and the tenant-wide `ProductCost` pool makes it cost-neutral. Approval is an authorization step, not a journal entry.
