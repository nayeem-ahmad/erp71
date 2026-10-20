/**
 * Whether a return edit's lines are the ones the return already holds.
 *
 * The edit screens send every line back on each save, so a reason- or
 * notes-only edit arrives with `items` too. Taken at face value that unwinds
 * and reposts the return — new voucher numbers, two ledger rows, refused in a
 * closed period or on an import, and a return saved before tenders re-clamped
 * against today's due. Both return services decide this first, and lines that
 * match what is stored are treated exactly as if none had been sent.
 */

/** Below half a paisa two amounts are the same money. */
const EPSILON = 0.005;

/** A stored return line, in the terms the comparison reads. */
export interface StoredReturnLine {
    /**
     * What the edit matches a line on: the sale or purchase line it came back
     * against, or the product on a return with no parent document.
     */
    key: string | null;
    productId: string;
    quantity: number;
    /** The line's own warehouse; null when it follows the return's. */
    warehouseId: string | null;
    /** What the line is worth as stored. */
    amount: number;
}

/** A line as an edit sends it. A field left out restates nothing. */
export interface SentReturnLine {
    key?: string | null;
    /** Only where the edit would write the sent product; left out, not compared. */
    productId?: string;
    quantity: number;
    /** Left out, the line was not steered and stays where it is. */
    warehouseId?: string | null;
    /** Only where the edit prices the line from what is sent; left out, not compared. */
    amount?: number;
}

/**
 * True when every stored line has its own sent line with the same key and
 * quantity — and the same warehouse, product and amount wherever the sent line
 * names one — and no sent line is left over. Order does not matter.
 * `documentWarehouseId` is the return's own warehouse, where a stored line
 * with none of its own sits.
 */
export function sameReturnLines(
    stored: StoredReturnLine[],
    sent: SentReturnLine[],
    documentWarehouseId: string | null,
): boolean {
    if (sent.length !== stored.length) return false;
    const unmatched = [...sent];
    for (const line of stored) {
        const index = unmatched.findIndex((candidate) => sameLine(line, candidate, documentWarehouseId));
        if (index === -1) return false;
        unmatched.splice(index, 1);
    }
    return true;
}

function sameLine(stored: StoredReturnLine, sent: SentReturnLine, documentWarehouseId: string | null): boolean {
    if (!sent.key || sent.key !== stored.key) return false;
    if (sent.quantity !== stored.quantity) return false;
    if (sent.productId !== undefined && sent.productId !== stored.productId) return false;
    if (sent.warehouseId && sent.warehouseId !== (stored.warehouseId ?? documentWarehouseId)) return false;
    if (sent.amount !== undefined && Math.abs(sent.amount - stored.amount) > EPSILON) return false;
    return true;
}
