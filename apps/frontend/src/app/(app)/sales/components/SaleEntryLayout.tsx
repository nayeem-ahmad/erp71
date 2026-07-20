'use client';

import type { ReactNode } from 'react';
import DocumentEntryLayout from './DocumentEntryLayout';
import CustomerSelection from './CustomerSelection';
import ProductSearch from './ProductSearch';
import LineItemsTable from './LineItemsTable';
import TotalsFooter from './TotalsFooter';
import PaymentSection from './PaymentSection';
import SalesHeader from './SalesHeader';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import type { VoiceEntryResult } from '@/lib/voice-entry';
import type { LineItem, Payment } from '@/lib/hooks/useNewSaleCart';

/** The adjustment figures the entry form layers on top of the line subtotal. */
export interface SaleAdjustments {
    discountPercent: number;
    rounding: number;
    transportCost: number;
    laborCost: number;
}

export interface SaleTotals extends SaleAdjustments {
    subtotal: number;
    discount: number;
    vat: number;
    total: number;
}

export const EMPTY_ADJUSTMENTS: SaleAdjustments = {
    discountPercent: 0,
    rounding: 0,
    transportCost: 0,
    laborCost: 0,
};

/**
 * Line subtotal plus the form's adjustments. Discount is taken off first, VAT
 * applies to the discounted amount, and the flat costs are added last.
 */
export function computeSaleTotals(
    items: LineItem[],
    adjustments: SaleAdjustments,
    vatRate: number,
): SaleTotals {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const discount = subtotal * (adjustments.discountPercent / 100);
    const afterDiscount = subtotal - discount;
    const vat = afterDiscount * (vatRate / 100);
    const total =
        afterDiscount
        + vat
        + (adjustments.transportCost || 0)
        + (adjustments.laborCost || 0)
        + (adjustments.rounding || 0);

    return { subtotal, discount, vat, total, ...adjustments };
}

interface SaleEntryLayoutProps {
    title: string;
    /** Where the back chevron and any Cancel action lead. */
    backHref: string;
    readOnly?: boolean;
    /** Full-width notice above the form (draft warning, edit-mode banner…). */
    banner?: ReactNode;

    serialNumber?: string;
    refNumber: string;
    setRefNumber: (value: string) => void;
    /** Freeze the reference field alone (an existing sale's reference is fixed). */
    refReadOnly?: boolean;
    currentUser: any;
    saleDate: string;
    setSaleDate: (value: string) => void;

    customer: any;
    setCustomer: (customer: any) => void;

    items: LineItem[];
    onUpdateItem: (productId: string, updates: Partial<LineItem>) => void;
    onRemoveItem: (productId: string) => void;
    onAddProduct: (product: any, options?: { quantity?: number; price?: number; availableQty?: number }) => void;
    onVoiceResult?: (result: VoiceEntryResult) => void;

    description: string;
    setDescription: (value: string) => void;

    totals: SaleTotals;
    onTotalsChange: (patch: Partial<SaleAdjustments>) => void;
    tenantVatRate: number;
    adjustmentLabel?: string;

    payments: Payment[];
    onPaymentChange: (payments: Payment[]) => void;

    /** Buttons for the bottom of the right-hand panel. */
    actions: ReactNode;
    onSubmit?: (e: React.FormEvent) => void;
}

/**
 * The sales entry screen: meta strip, customer + product picker, line items,
 * and a right panel with totals, payment and actions. Shared verbatim by New
 * Sale and the sale detail page so viewing or editing a sale looks and behaves
 * exactly like creating one — `readOnly` freezes every field without changing
 * the layout.
 */
export default function SaleEntryLayout({
    title,
    backHref,
    readOnly = false,
    banner,
    serialNumber,
    refNumber,
    setRefNumber,
    refReadOnly = false,
    currentUser,
    saleDate,
    setSaleDate,
    customer,
    setCustomer,
    items,
    onUpdateItem,
    onRemoveItem,
    onAddProduct,
    onVoiceResult,
    description,
    setDescription,
    totals,
    onTotalsChange,
    tenantVatRate,
    adjustmentLabel,
    payments,
    onPaymentChange,
    actions,
    onSubmit,
}: SaleEntryLayoutProps) {
    return (
        <DocumentEntryLayout
            title={title}
            backHref={backHref}
            banner={banner}
            onSubmit={onSubmit}
            metaBar={
                <SalesHeader
                    refNumber={refNumber}
                    setRefNumber={setRefNumber}
                    currentUser={currentUser}
                    saleDate={saleDate}
                    setSaleDate={setSaleDate}
                    serialNumber={serialNumber}
                    readOnly={readOnly}
                    refReadOnly={refReadOnly}
                />
            }
            customerPicker={
                <CustomerSelection customer={customer} setCustomer={setCustomer} readOnly={readOnly} />
            }
            picker={
                readOnly ? undefined : (
                    <>
                        {onVoiceResult ? (
                            <VoiceEntryInput entryType="sale" onResult={onVoiceResult} inline>
                                <ProductSearch onProductSelect={onAddProduct} />
                            </VoiceEntryInput>
                        ) : (
                            <ProductSearch onProductSelect={onAddProduct} />
                        )}
                    </>
                )
            }
            table={
                <LineItemsTable
                    items={items}
                    onUpdateItem={onUpdateItem}
                    onRemoveItem={onRemoveItem}
                    readOnly={readOnly}
                />
            }
            note={
                readOnly ? (
                    <p className="w-full rounded border bg-white px-2 py-1.5 text-sm text-gray-600 flex-shrink-0">
                        {description || <span className="text-gray-400">No note added</span>}
                    </p>
                ) : (
                    <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Note (optional)…"
                        aria-label="Note"
                        className="w-full border rounded px-2 py-1.5 text-sm flex-shrink-0"
                    />
                )
            }
            panel={
                <>
                    <TotalsFooter
                        totals={totals}
                        onTotalsChange={onTotalsChange}
                        tenantVatRate={tenantVatRate}
                        previousDue={Number(customer?.due_balance ?? 0)}
                        readOnly={readOnly}
                        roundingLabel={adjustmentLabel}
                    />
                    <div className="border-t pt-3">
                        <PaymentSection
                            payments={payments}
                            total={totals.total}
                            customer={customer}
                            onPaymentChange={onPaymentChange}
                            readOnly={readOnly}
                        />
                    </div>
                </>
            }
            actions={actions}
        />
    );
}
