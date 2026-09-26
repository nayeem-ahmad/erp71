import { invoiceDues } from '@/lib/customer-credit';
import type { DiscountMode } from './SaleEntryLayout';

interface TotalsFooterProps {
    totals: {
        subtotal: number;
        /** The discount in taka, whichever way it was entered. */
        discount: number;
        /** The discount as a share of the subtotal — calculated in 'AMOUNT' mode. */
        discountPercent: number;
        /**
         * The flat figure the user typed, which is what the taka input shows.
         * Left out by documents that render totals without adjustment rows.
         */
        discountAmount?: number;
        discountMode?: DiscountMode;
        rounding: number;
        vat: number;
        transportCost: number;
        laborCost: number;
        total: number;
    };
    onTotalsChange: (newTotals: any) => void;
    tenantVatRate: number;
    /**
     * What the customer owed before this sale. Null or left out when there is
     * no customer to owe anything.
     */
    previousDue?: number | null;
    /**
     * What is being paid against this sale. Given alongside `previousDue`, the
     * total due — the previous due plus whatever this sale leaves unpaid — is
     * shown under it.
     */
    amountPaid?: number;
    readOnly?: boolean;
    /**
     * Document-level discount, VAT, transport, labor and rounding. Off for
     * documents whose API stores only a total (sales orders, quotations) —
     * showing the breakdown there would imply it survives the save.
     */
    showAdjustments?: boolean;
    totalLabel?: string;
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
    previousDue = null,
    amountPaid,
    readOnly = false,
    showAdjustments = true,
    totalLabel = 'Total',
    roundingLabel = 'Rounding',
}: TotalsFooterProps) {
    const inputClass = 'w-16 px-1.5 py-0.5 border rounded text-xs text-end';
    const amount = (value: number) => `৳${value.toFixed(2)}`;
    const percent = (value: number) => `${value.toFixed(2)}%`;
    /** Money and percentages are both typed to the paisa; carry no further. */
    const round2 = (value: number) => Math.round(value * 100) / 100;

    const byAmount = totals.discountMode === 'AMOUNT';
    /**
     * Keep the discount itself across a switch of units: the figure on screen
     * is what was negotiated, whichever box it happens to be typed into.
     */
    const switchDiscountMode = (mode: DiscountMode) => {
        if (mode === totals.discountMode) return;
        onTotalsChange(mode === 'AMOUNT'
            ? { discountMode: mode, discountAmount: round2(totals.discount) }
            : { discountMode: mode, discountPercent: round2(totals.discountPercent) });
    };
    // A flat discount larger than the subtotal is held at the subtotal rather
    // than inverting the invoice, so say so instead of silently ignoring it.
    const discountCapped = byAmount && (totals.discountAmount ?? 0) > totals.discount + 0.005;

    // Only for a customer with a balance already. With nothing owed before, the
    // total due is just what this sale leaves unpaid, and the payment strip
    // right below says that. Without a paid amount the sale is taken as
    // settled, which is how the previous due used to be shown on its own.
    const dues = previousDue != null && Math.abs(previousDue) > 0.005
        ? invoiceDues(totals.total, amountPaid ?? totals.total, previousDue)
        : null;
    const oweTone = (value: number) => (value > 0.005 ? 'text-amber-600' : 'text-gray-700');

    // In read-only mode only the rows that actually carry a value are shown —
    // a column of zeroes reads as data the sale doesn't have.
    const rows: { label: string; value: number; className?: string }[] = [];
    if (readOnly) {
        if (Math.abs(totals.discount) > 0.005) {
            rows.push({
                label: totals.discountPercent > 0.005
                    ? `Discount (${percent(totals.discountPercent)})`
                    : 'Discount',
                value: -totals.discount,
                className: 'text-red-600',
            });
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

            {!showAdjustments ? null : readOnly ? (
                rows.map((row) => (
                    <div key={row.label} className="flex justify-between items-center">
                        <span className="text-gray-500">{row.label}</span>
                        <span className={`font-medium ${row.className ?? ''}`}>{amount(row.value)}</span>
                    </div>
                ))
            ) : (
                <>
                    {/* Discount takes either unit: type a percentage and the
                        taka is worked out, type a taka figure — the way most
                        counter discounts are agreed — and the percentage is.
                        Whichever is not being typed is shown at the end of the
                        row, so both figures are on screen at all times. */}
                    <div>
                        <div className="flex justify-between items-center gap-2">
                            <span className="text-gray-500 whitespace-nowrap">Discount</span>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center rounded border overflow-hidden" role="group" aria-label="Discount unit">
                                    {(['PERCENT', 'AMOUNT'] as const).map((mode) => {
                                        const isActive = mode === (byAmount ? 'AMOUNT' : 'PERCENT');
                                        return (
                                            <button
                                                key={mode}
                                                type="button"
                                                aria-pressed={isActive}
                                                title={mode === 'PERCENT' ? 'Discount by percentage' : 'Discount by amount'}
                                                onClick={() => switchDiscountMode(mode)}
                                                className={`px-2 py-1 text-xs leading-none ${
                                                    isActive ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                                                }`}
                                            >
                                                {mode === 'PERCENT' ? '%' : '৳'}
                                            </button>
                                        );
                                    })}
                                </div>
                                {byAmount ? (
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        aria-label="Discount amount"
                                        value={totals.discountAmount ?? 0}
                                        onChange={(e) => onTotalsChange({ discountAmount: Math.max(0, parseFloat(e.target.value) || 0) })}
                                        className={inputClass}
                                    />
                                ) : (
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        aria-label="Discount percent"
                                        value={totals.discountPercent}
                                        onChange={(e) => onTotalsChange({ discountPercent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                                        className={inputClass}
                                    />
                                )}
                                {byAmount ? (
                                    <span className="w-20 text-end text-xs text-gray-500">{percent(totals.discountPercent)}</span>
                                ) : (
                                    <span className="font-medium w-20 text-end text-red-600">-{amount(totals.discount)}</span>
                                )}
                            </div>
                        </div>
                        {discountCapped && (
                            <p className="mt-1 text-xs text-red-600 text-end">
                                Capped at the {amount(totals.subtotal)} subtotal.
                            </p>
                        )}
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
                <span className="font-semibold text-gray-900">{totalLabel}</span>
                <span className="text-lg font-bold text-blue-600">{amount(totals.total)}</span>
            </div>

            {/* What the customer already owed before this sale, and what they
                will owe with it — informational only; neither is ever rolled
                into the sale total. */}
            {dues && (
                <>
                    <div className="flex justify-between items-center">
                        <span className="text-gray-500">Previous Due</span>
                        <span className={`font-medium ${oweTone(dues.previousDue)}`}>{amount(dues.previousDue)}</span>
                    </div>
                    {amountPaid !== undefined && (
                        <div className="flex justify-between items-center">
                            <span className="text-gray-500">Total Due</span>
                            <span className={`font-semibold ${oweTone(dues.totalDue)}`}>{amount(dues.totalDue)}</span>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
