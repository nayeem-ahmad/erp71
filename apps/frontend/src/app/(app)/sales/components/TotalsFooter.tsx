interface TotalsFooterProps {
    totals: {
        subtotal: number;
        discount: number;
        discountPercent: number;
        rounding: number;
        vat: number;
        transportCost: number;
        laborCost: number;
        total: number;
    };
    onTotalsChange: (newTotals: any) => void;
    tenantVatRate: number;
    /** Outstanding balance the selected customer already owes, if any. */
    previousDue?: number;
    readOnly?: boolean;
    /**
     * Label for the free-form adjustment row. An existing sale stores only its
     * final total, so the gap between the line subtotal and that total is
     * carried here as one "Adjustment" rather than a fake rounding figure.
     */
    roundingLabel?: string;
}

// Dense totals summary for the right panel. Adjustment inputs (discount %,
// transport, labor, rounding) sit inline on the same row as their value so
// every field stays visible without a separate grid.
export default function TotalsFooter({
    totals,
    onTotalsChange,
    tenantVatRate,
    previousDue = 0,
    readOnly = false,
    roundingLabel = 'Rounding',
}: TotalsFooterProps) {
    const inputClass = 'w-16 px-1.5 py-0.5 border rounded text-xs text-right';
    const amount = (value: number) => `৳${value.toFixed(2)}`;

    // In read-only mode only the rows that actually carry a value are shown —
    // a column of zeroes reads as data the sale doesn't have.
    const rows: { label: string; value: number; className?: string }[] = [];
    if (readOnly) {
        if (Math.abs(totals.discount) > 0.005) {
            rows.push({ label: 'Discount', value: -totals.discount, className: 'text-red-600' });
        }
        if (Math.abs(totals.vat) > 0.005) rows.push({ label: `VAT (${tenantVatRate}%)`, value: totals.vat });
        if (Math.abs(totals.transportCost) > 0.005) rows.push({ label: 'Transport', value: totals.transportCost });
        if (Math.abs(totals.laborCost) > 0.005) rows.push({ label: 'Labor', value: totals.laborCost });
        if (Math.abs(totals.rounding) > 0.005) rows.push({ label: roundingLabel, value: totals.rounding });
    }

    return (
        <div className="space-y-1.5 text-sm">
            <div className="flex justify-between items-center">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium">{amount(totals.subtotal)}</span>
            </div>

            {readOnly ? (
                rows.map((row) => (
                    <div key={row.label} className="flex justify-between items-center">
                        <span className="text-gray-500">{row.label}</span>
                        <span className={`font-medium ${row.className ?? ''}`}>{amount(row.value)}</span>
                    </div>
                ))
            ) : (
                <>
                    <div className="flex justify-between items-center gap-2">
                        <span className="text-gray-500 whitespace-nowrap">Discount</span>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={totals.discountPercent}
                                onChange={(e) => onTotalsChange({ discountPercent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                                className={inputClass}
                            />
                            <span className="text-xs text-gray-400">%</span>
                            <span className="font-medium w-20 text-right text-red-600">-{amount(totals.discount)}</span>
                        </div>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-gray-500">VAT ({tenantVatRate}%)</span>
                        <span className="font-medium">{amount(totals.vat)}</span>
                    </div>

                    <div className="flex justify-between items-center gap-2">
                        <span className="text-gray-500 whitespace-nowrap">Transport</span>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={totals.transportCost}
                            onChange={(e) => onTotalsChange({ transportCost: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className={inputClass}
                        />
                    </div>

                    <div className="flex justify-between items-center gap-2">
                        <span className="text-gray-500 whitespace-nowrap">Labor</span>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={totals.laborCost}
                            onChange={(e) => onTotalsChange({ laborCost: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className={inputClass}
                        />
                    </div>

                    <div className="flex justify-between items-center gap-2">
                        <span className="text-gray-500 whitespace-nowrap">{roundingLabel}</span>
                        <input
                            type="number"
                            step="0.01"
                            value={totals.rounding}
                            onChange={(e) => onTotalsChange({ rounding: parseFloat(e.target.value) || 0 })}
                            className={inputClass}
                        />
                    </div>
                </>
            )}

            <div className="border-t pt-2 mt-1 flex justify-between items-center">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="text-lg font-bold text-blue-600">{amount(totals.total)}</span>
            </div>

            {/* What the customer already owed before this sale — informational
                only; it is never rolled into the sale total. */}
            {previousDue > 0.005 && (
                <div className="flex justify-between items-center">
                    <span className="text-gray-500">Previous Due</span>
                    <span className="font-medium text-amber-600">{amount(previousDue)}</span>
                </div>
            )}
        </div>
    );
}
