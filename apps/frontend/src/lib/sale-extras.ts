/**
 * Transport, labour and the free-form adjustment stored on a sale.
 *
 * A sale written before these columns existed has none of them (or zeroes).
 * Callers then keep folding the unexplained gap between the lines and the
 * total into the adjustment, which is the only figure those rows recorded.
 */

function money(value: unknown): number {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export interface StoredInvoiceExtras {
    transportCost: number;
    laborCost: number;
    rounding: number;
}

export function storedInvoiceExtras(sale: {
    transport_cost?: unknown;
    labor_cost?: unknown;
    rounding?: unknown;
} | null | undefined): StoredInvoiceExtras {
    return {
        transportCost: money(sale?.transport_cost),
        laborCost: money(sale?.labor_cost),
        rounding: money(sale?.rounding),
    };
}
