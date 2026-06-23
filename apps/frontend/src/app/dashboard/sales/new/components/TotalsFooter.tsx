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
}

// Dense totals summary for the right panel. Adjustment inputs (discount %,
// transport, labor, rounding) sit inline on the same row as their value so
// every field stays visible without a separate grid.
export default function TotalsFooter({ totals, onTotalsChange, tenantVatRate }: TotalsFooterProps) {
    const inputClass = 'w-16 px-1.5 py-0.5 border rounded text-xs text-right';

    return (
        <div className="space-y-1.5 text-sm">
            <div className="flex justify-between items-center">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium">৳{totals.subtotal.toFixed(2)}</span>
            </div>

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
                    <span className="font-medium w-20 text-right text-red-600">-৳{totals.discount.toFixed(2)}</span>
                </div>
            </div>

            <div className="flex justify-between items-center">
                <span className="text-gray-500">VAT ({tenantVatRate}%)</span>
                <span className="font-medium">৳{totals.vat.toFixed(2)}</span>
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
                <span className="text-gray-500 whitespace-nowrap">Rounding</span>
                <input
                    type="number"
                    step="0.01"
                    value={totals.rounding}
                    onChange={(e) => onTotalsChange({ rounding: parseFloat(e.target.value) || 0 })}
                    className={inputClass}
                />
            </div>

            <div className="border-t pt-2 mt-1 flex justify-between items-center">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="text-lg font-bold text-blue-600">৳{totals.total.toFixed(2)}</span>
            </div>
        </div>
    );
}
