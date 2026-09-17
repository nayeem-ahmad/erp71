/**
 * Turning an `InventoryMovement`'s `reference_type` + `reference_id` pair into
 * something a shopkeeper recognises.
 *
 * The ledger stores the pair raw, which is right for the write path and useless
 * on a report: `SALE • 4f1c…` tells nobody which sale. Every source document in
 * the system carries its own human number (`INV-1042`, `PO-77`, `TRF-12`), and
 * this resolves the pair to that number plus the party or counterpart warehouse
 * behind it, in one query per reference type present on the page.
 *
 * A type with no loader here — a new workflow, or a movement written before its
 * document model existed — resolves to nothing rather than throwing. The report
 * then prints the type on its own, which is what the ledger already showed.
 */

type DbLike = any;

export interface ResolvedReference {
    /** The document number a person recognises. Null when the source has none. */
    number: string | null;
    /** Customer, supplier or counterpart warehouse behind the document. */
    party: string | null;
}

type Loader = (db: DbLike, tenantId: string, ids: string[]) => Promise<Array<{ id: string } & ResolvedReference>>;

/**
 * One loader per `reference_type` written by `applyInventoryMovement` callers.
 * Each is tenant-scoped in its own `where` rather than trusting the movement row
 * it came from — a report must not be able to read another workspace's document
 * numbers through a mis-stamped reference.
 */
const LOADERS: Record<string, Loader> = {
    SALE: async (db, tenantId, ids) =>
        (
            await db.sale.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: { id: true, serial_number: true, reference_number: true, customer: { select: { name: true } } },
            })
        ).map((row: any) => ({
            id: row.id,
            // The shop's own invoice number when they set one, falling back to
            // the generated serial — that is the order the sale screens print
            // them in, so the card agrees with the document.
            number: row.reference_number || row.serial_number || null,
            party: row.customer?.name ?? null,
        })),

    SALES_RETURN: async (db, tenantId, ids) =>
        (
            await db.salesReturn.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: {
                    id: true,
                    return_number: true,
                    reference_number: true,
                    // A return carries no customer of its own; it belongs to the
                    // sale it reverses, and that is who handed the goods back.
                    sale: { select: { customer: { select: { name: true } } } },
                },
            })
        ).map((row: any) => ({
            id: row.id,
            number: row.reference_number || row.return_number || null,
            party: row.sale?.customer?.name ?? null,
        })),

    SALES_ORDER: async (db, tenantId, ids) =>
        (
            await db.salesOrder.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: { id: true, order_number: true, customer: { select: { name: true } } },
            })
        ).map((row: any) => ({ id: row.id, number: row.order_number ?? null, party: row.customer?.name ?? null })),

    PURCHASE: async (db, tenantId, ids) =>
        (
            await db.purchase.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: { id: true, purchase_number: true, reference_number: true, supplier: { select: { name: true } } },
            })
        ).map((row: any) => ({
            id: row.id,
            // The supplier's own bill number leads here, because that is what a
            // shopkeeper reconciling a delivery has in their hand.
            number: row.reference_number || row.purchase_number || null,
            party: row.supplier?.name ?? null,
        })),

    PURCHASE_RETURN: async (db, tenantId, ids) =>
        (
            await db.purchaseReturn.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: { id: true, return_number: true, supplier: { select: { name: true } } },
            })
        ).map((row: any) => ({ id: row.id, number: row.return_number ?? null, party: row.supplier?.name ?? null })),

    PURCHASE_ORDER: async (db, tenantId, ids) =>
        (
            await db.purchaseOrder.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: { id: true, po_number: true, supplier: { select: { name: true } } },
            })
        ).map((row: any) => ({ id: row.id, number: row.po_number ?? null, party: row.supplier?.name ?? null })),

    WAREHOUSE_TRANSFER: async (db, tenantId, ids) =>
        (
            await db.warehouseTransfer.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: {
                    id: true,
                    transfer_number: true,
                    sourceWarehouse: { select: { name: true } },
                    destinationWarehouse: { select: { name: true } },
                },
            })
        ).map((row: any) => ({
            id: row.id,
            number: row.transfer_number ?? null,
            // Both ends, because a transfer writes one movement at each and the
            // row itself only says which warehouse it hit — the other end is the
            // half the card is missing.
            party:
                row.sourceWarehouse?.name && row.destinationWarehouse?.name
                    ? `${row.sourceWarehouse.name} → ${row.destinationWarehouse.name}`
                    : null,
        })),

    STOCK_TAKE: async (db, tenantId, ids) =>
        (
            await db.stockTakeSession.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: { id: true, session_number: true, warehouse: { select: { name: true } } },
            })
        ).map((row: any) => ({ id: row.id, number: row.session_number ?? null, party: row.warehouse?.name ?? null })),

    INVENTORY_SHRINKAGE: async (db, tenantId, ids) =>
        (
            await db.inventoryShrinkage.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: { id: true, reference_number: true, reason: { select: { label: true } } },
            })
        ).map((row: any) => ({ id: row.id, number: row.reference_number ?? null, party: row.reason?.label ?? null })),

    IMPORT_SHIPMENT: async (db, tenantId, ids) =>
        (
            await db.importShipment.findMany({
                where: { id: { in: ids }, tenant_id: tenantId },
                select: { id: true, reference_number: true, supplier: { select: { name: true } } },
            })
        ).map((row: any) => ({ id: row.id, number: row.reference_number ?? null, party: row.supplier?.name ?? null })),

    PRODUCTION_JOB: async (db, tenantId, ids) =>
        (
            await db.productionJob.findMany({
                // This model is camelCase throughout, unlike every other one here.
                where: { id: { in: ids }, tenantId },
                select: { id: true, recipe: { select: { product: { select: { name: true } } } } },
            })
        ).map((row: any) => ({
            // Production jobs are keyed by cuid and carry no number of their
            // own, so the run is identified by what it was building — which is
            // also what tells a consumption row apart from an output row.
            id: row.id,
            number: null,
            party: row.recipe?.product?.name ?? null,
        })),
};

/** The key a resolved reference is filed under. */
export function referenceKey(type: string | null | undefined, id: string | null | undefined): string {
    return `${type ?? ''}:${id ?? ''}`;
}

/**
 * Resolves every `(reference_type, reference_id)` pair in `movements` at once.
 *
 * One query per distinct type rather than one per row: a stock card page holds
 * a few hundred movements over a handful of document kinds, and the per-row
 * version is the shape that turns a report into a timeout.
 */
export async function resolveMovementReferences(
    db: DbLike,
    tenantId: string,
    movements: Array<{ reference_type?: string | null; reference_id?: string | null }>,
): Promise<Map<string, ResolvedReference>> {
    const idsByType = new Map<string, Set<string>>();
    for (const movement of movements) {
        const type = movement.reference_type;
        const id = movement.reference_id;
        if (!type || !id || !LOADERS[type]) continue;
        const bucket = idsByType.get(type) ?? new Set<string>();
        bucket.add(id);
        idsByType.set(type, bucket);
    }

    const resolved = new Map<string, ResolvedReference>();
    await Promise.all(
        Array.from(idsByType.entries()).map(async ([type, ids]) => {
            const rows = await LOADERS[type](db, tenantId, Array.from(ids));
            for (const row of rows) {
                resolved.set(referenceKey(type, row.id), { number: row.number, party: row.party });
            }
        }),
    );

    return resolved;
}
