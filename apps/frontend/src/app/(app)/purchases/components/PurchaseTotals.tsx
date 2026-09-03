'use client';

import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

/** The flat amounts a purchase layers on top of its line subtotal. */
export interface PurchaseAdjustments {
    taxAmount: number;
    discountAmount: number;
    freightAmount: number;
}

export const EMPTY_PURCHASE_ADJUSTMENTS: PurchaseAdjustments = {
    taxAmount: 0,
    discountAmount: 0,
    freightAmount: 0,
};

export interface PurchaseTotalsValues extends PurchaseAdjustments {
    subtotal: number;
    total: number;
}

/** Landed cost of the receipt: lines, plus tax and freight, less any discount. */
export function computePurchaseTotals(
    items: { quantity: number; price: number }[],
    adjustments: PurchaseAdjustments,
): PurchaseTotalsValues {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const total =
        subtotal
        + (adjustments.taxAmount || 0)
        + (adjustments.freightAmount || 0)
        - (adjustments.discountAmount || 0);

    return { subtotal, total, ...adjustments };
}

interface PurchaseTotalsProps {
    totals: PurchaseTotalsValues;
    onChange: (patch: Partial<PurchaseAdjustments>) => void;
    /** Outstanding balance already owed to the selected supplier, if any. */
    previousPayable?: number;
}

// Dense totals summary for the right panel, matching the sale screen: each
// adjustment input sits inline on its own row so every figure stays visible
// without a second grid.
export default function PurchaseTotals({ totals, onChange, previousPayable = 0 }: PurchaseTotalsProps) {
    const { t, locale } = useI18n();
    const inputClass = 'w-24 px-1.5 py-0.5 border rounded text-xs text-end';
    const amount = (value: number) => formatBDT(value, { locale });

    const adjustmentRow = (
        label: string,
        field: keyof PurchaseAdjustments,
        options: { negative?: boolean } = {},
    ) => (
        <div className="flex justify-between items-center gap-2">
            <span className="text-gray-500 whitespace-nowrap">{label}</span>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={totals[field]}
                    aria-label={label}
                    onChange={(e) => onChange({ [field]: Math.max(0, parseFloat(e.target.value) || 0) })}
                    className={inputClass}
                />
                {options.negative && totals[field] > 0 && (
                    <span className="font-medium w-4 text-end text-red-600">−</span>
                )}
            </div>
        </div>
    );

    return (
        <div className="space-y-1.5 text-sm">
            <div className="flex justify-between items-center">
                <span className="text-gray-500">{t.common.subtotal}</span>
                <span className="font-medium">{amount(totals.subtotal)}</span>
            </div>

            {adjustmentRow(t.common.tax, 'taxAmount')}
            {adjustmentRow(t.purchaseShared.freight, 'freightAmount')}
            {adjustmentRow(t.common.discount, 'discountAmount', { negative: true })}

            <div className="border-t pt-2 mt-1 flex justify-between items-center">
                <span className="font-semibold text-gray-900">{t.purchaseShared.purchaseTotal}</span>
                <span className="text-lg font-bold text-blue-600">{amount(totals.total)}</span>
            </div>

            {/* What this supplier was already owed before this receipt —
                informational only; it is never rolled into the purchase total. */}
            {previousPayable > 0.005 && (
                <div className="flex justify-between items-center">
                    <span className="text-gray-500">{t.purchaseShared.previousPayable}</span>
                    <span className="font-medium text-amber-600">{amount(previousPayable)}</span>
                </div>
            )}
        </div>
    );
}
