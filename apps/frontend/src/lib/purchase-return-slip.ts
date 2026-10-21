/**
 * How a purchase return is filled in.
 *
 * The slip holds only lines that are going back. A typed search adds one line
 * at whatever is still left. A scanner sends a whole SKU and Enter, and each
 * scan counts one piece. "Return all" is the rejected delivery: every open
 * line at its remaining quantity, ready to trim.
 */

export interface SlipLine {
    id: string;
    name: string;
    sku: string;
    purchased: number;
    remaining: number;
    unitCost: number;
}

/** Line id → quantity on the return. Absent means the line is not on the slip. */
export type SlipQuantities = Record<string, number>;

export interface PurchaseSearchRow {
    purchaseNumber: string;
    supplierName: string;
    productText: string;
    /** `YYYY-MM-DD`, so a date typed from a bill matches without locale formatting. */
    isoDate: string;
    dateLabel: string;
}

export type LineEnterAction =
    | { type: 'scan'; lineId: string; quantities: SlipQuantities }
    | { type: 'add-full'; lineId: string; quantities: SlipQuantities }
    | { type: 'focus'; lineId: string }
    | { type: 'none' };

export function remainingQuantity(purchased: number, alreadyReturned: number): number {
    return Math.max(0, purchased - alreadyReturned);
}

/** Empty query keeps every line. A query keeps name or SKU matches. */
export function filterLines(lines: SlipLine[], query: string): SlipLine[] {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((line) =>
        line.name.toLowerCase().includes(q) || line.sku.toLowerCase().includes(q),
    );
}

/**
 * One line whose SKU is the whole query. Two lines sharing a SKU are not a
 * scan — the clerk has to pick which row the pieces came from.
 */
export function exactSkuMatch(lines: SlipLine[], query: string): SlipLine | null {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hits = lines.filter((line) => line.sku.trim().toLowerCase() === q && line.remaining > 0);
    return hits.length === 1 ? hits[0] : null;
}

/** First scan puts 1 on the slip. Each further scan adds 1, and never past what is left. */
export function applyScan(quantities: SlipQuantities, line: SlipLine): SlipQuantities {
    if (line.remaining <= 0) return quantities;
    const next = Math.min(line.remaining, (quantities[line.id] ?? 0) + 1);
    return { ...quantities, [line.id]: next };
}

/**
 * Put `quantity` on the slip, clamped to what is left. Zero, or anything that
 * is not a number, takes the line off the slip. A fractional count is cut to
 * a whole unit — purchase lines are stored as integers.
 */
export function setSlipQuantity(quantities: SlipQuantities, line: SlipLine, quantity: number): SlipQuantities {
    const next = { ...quantities };
    if (!Number.isFinite(quantity)) {
        delete next[line.id];
        return next;
    }
    const clamped = Math.max(0, Math.min(line.remaining, Math.trunc(quantity)));
    if (clamped <= 0) {
        delete next[line.id];
        return next;
    }
    next[line.id] = clamped;
    return next;
}

/** Every still-returnable line at its full remaining quantity. A partial already typed is raised to that. */
export function returnAllRemaining(lines: SlipLine[], quantities: SlipQuantities): SlipQuantities {
    const next = { ...quantities };
    for (const line of lines) {
        if (line.remaining > 0) next[line.id] = line.remaining;
    }
    return next;
}

export function slipTotal(lines: SlipLine[], quantities: SlipQuantities): number {
    return lines.reduce((sum, line) => sum + (quantities[line.id] ?? 0) * line.unitCost, 0);
}

/**
 * Enter in the line search.
 *
 * An exact SKU is a scan. Anything else that matches a line not yet on the
 * slip adds that line at whatever is still left (the highlighted row, or the
 * first). A query that only matches lines already on the slip moves to that
 * quantity. An empty query does nothing, so Enter never dumps the bill.
 */
export function resolveLineEnter(
    lines: SlipLine[],
    quantities: SlipQuantities,
    query: string,
    highlightIndex: number,
): LineEnterAction {
    if (!query.trim()) return { type: 'none' };

    const returnable = lines.filter((line) => line.remaining > 0);
    const scanned = exactSkuMatch(returnable, query);
    if (scanned) {
        return { type: 'scan', lineId: scanned.id, quantities: applyScan(quantities, scanned) };
    }

    const offSlip = returnable.filter((line) => !quantities[line.id]);
    const matches = filterLines(offSlip, query);
    if (matches.length > 0) {
        const line = matches[clampIndex(highlightIndex, matches.length)];
        return {
            type: 'add-full',
            lineId: line.id,
            quantities: setSlipQuantity(quantities, line, line.remaining),
        };
    }

    const onSlip = returnable.filter((line) => quantities[line.id]);
    const slipMatches = filterLines(onSlip, query);
    if (slipMatches.length > 0) {
        return { type: 'focus', lineId: slipMatches[clampIndex(highlightIndex, slipMatches.length)].id };
    }

    return { type: 'none' };
}

export function purchaseMatchesQuery(row: PurchaseSearchRow, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.purchaseNumber, row.supplierName, row.productText, row.isoDate, row.dateLabel]
        .join(' ')
        .toLowerCase()
        .includes(q);
}

function clampIndex(index: number, length: number): number {
    if (length <= 0) return 0;
    const whole = Number.isFinite(index) ? Math.trunc(index) : 0;
    return Math.min(length - 1, Math.max(0, whole));
}
