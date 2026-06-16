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

export default function TotalsFooter({ totals, onTotalsChange, tenantVatRate }: TotalsFooterProps) {
    const handleDiscountChange = (percent: number) => {
        onTotalsChange({ discountPercent: Math.max(0, Math.min(100, percent)) });
    };

    const handleRoundingChange = (amount: number) => {
        onTotalsChange({ rounding: amount });
    };

    const handleTransportChange = (amount: number) => {
        onTotalsChange({ transportCost: Math.max(0, amount) });
    };

    const handleLaborChange = (amount: number) => {
        onTotalsChange({ laborCost: Math.max(0, amount) });
    };

    return (
        <div className="bg-white rounded-lg border p-6">
            <div className="space-y-4">
                {/* Summary View */}
                <div className="bg-gray-50 rounded p-4 space-y-2 border">
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Subtotal:</span>
                        <span className="font-medium">৳{totals.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Overall Discount ({totals.discountPercent}%):</span>
                        <span className="font-medium">-৳{totals.discount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Rounding:</span>
                        <span className="font-medium">{totals.rounding > 0 ? '+' : ''}৳{totals.rounding.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600">VAT ({tenantVatRate}%):</span>
                        <span className="font-medium">৳{totals.vat.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Transport/Labor Cost:</span>
                        <span className="font-medium">৳{(totals.transportCost + totals.laborCost).toFixed(2)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between text-lg font-bold">
                        <span>Total:</span>
                        <span className="text-blue-600">৳{totals.total.toFixed(2)}</span>
                    </div>
                </div>

                {/* Adjustments */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                            Overall Discount %
                        </label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={totals.discountPercent}
                            onChange={(e) => handleDiscountChange(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 border rounded text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                            Rounding (Amount)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={totals.rounding}
                            onChange={(e) => handleRoundingChange(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 border rounded text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                            Transport Cost
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={totals.transportCost}
                            onChange={(e) => handleTransportChange(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 border rounded text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                            Labor Cost
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={totals.laborCost}
                            onChange={(e) => handleLaborChange(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 border rounded text-sm"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
