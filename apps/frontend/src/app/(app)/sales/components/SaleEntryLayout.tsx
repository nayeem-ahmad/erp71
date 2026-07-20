'use client';

import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
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
    const handleSubmit = (e: React.FormEvent) => {
        if (onSubmit) onSubmit(e);
        else e.preventDefault();
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-y-auto lg:overflow-hidden bg-gray-50 text-sm">
            {/* Top strip: title + sale meta fields, one slim row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b bg-white flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Link href={backHref} className="text-gray-400 hover:text-gray-700" aria-label="Back to sales">
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <h1 className="text-base font-bold text-gray-900 whitespace-nowrap">{title}</h1>
                </div>
                <div className="h-5 w-px bg-gray-200 hidden sm:block" />
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
            </div>

            {banner && <div className="px-4 pt-2 flex-shrink-0">{banner}</div>}

            {/* Body: left work area + right summary/payment panel. On mobile this
                flows at natural height so the page scrolls; at lg+ it fills the
                viewport and only the item list scrolls. */}
            <div className="flex flex-col lg:flex-1 lg:flex-row lg:overflow-hidden">
                {/* Left work area */}
                <div className="flex flex-col lg:flex-1 lg:overflow-hidden p-3 gap-2 min-w-0">
                    <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                        <div className="sm:w-72 flex-shrink-0">
                            <CustomerSelection customer={customer} setCustomer={setCustomer} readOnly={readOnly} />
                        </div>
                        {!readOnly && (
                            <div className="flex-1 min-w-0">
                                {onVoiceResult ? (
                                    <VoiceEntryInput entryType="sale" onResult={onVoiceResult} inline>
                                        <ProductSearch onProductSelect={onAddProduct} />
                                    </VoiceEntryInput>
                                ) : (
                                    <ProductSearch onProductSelect={onAddProduct} />
                                )}
                            </div>
                        )}
                    </div>

                    {/* Item list — the only scrolling region on desktop */}
                    <div className="min-h-[240px] lg:flex-1 lg:min-h-0 lg:overflow-hidden">
                        <LineItemsTable
                            items={items}
                            onUpdateItem={onUpdateItem}
                            onRemoveItem={onRemoveItem}
                            readOnly={readOnly}
                        />
                    </div>

                    {/* Note */}
                    {readOnly ? (
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
                    )}
                </div>

                {/* Right panel: totals, payment, actions */}
                <div className="w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l bg-white flex flex-col lg:overflow-hidden">
                    <div className="lg:flex-1 lg:overflow-y-auto p-3 space-y-3">
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
                    </div>

                    {/* Actions pinned to panel bottom. Extra bottom padding on desktop
                        keeps the primary button clear of the floating feedback widget. */}
                    <div className="flex flex-wrap items-center gap-2 p-3 pb-20 lg:pb-16 border-t flex-shrink-0">
                        {actions}
                    </div>
                </div>
            </div>
        </form>
    );
}
