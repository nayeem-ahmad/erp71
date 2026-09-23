'use client';

import type { ReactNode } from 'react';
import { computeSaleTax, resolveTaxRate } from '@erp71/shared-types';
import DocumentEntryLayout from '@/components/document-entry/DocumentEntryLayout';
import ProductSearch from '@/components/document-entry/ProductSearch';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import DocumentMetaBar from '@/components/document-entry/DocumentMetaBar';
import WarehouseMetaFields from '@/components/document-entry/WarehouseMetaFields';
import type { WarehouseOption } from '@/lib/hooks/useWarehouses';
import CustomerSelection, { type NewCustomerDraft } from './CustomerSelection';
import TotalsFooter from './TotalsFooter';
import PaymentSection from './PaymentSection';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import type { VoiceEntryResult } from '@/lib/voice-entry';
import { lineNetTotal, netUnitPrice, type LineItem, type Payment } from '@/lib/hooks/useNewSaleCart';
import { useI18n } from '@/lib/i18n';

/**
 * Which of the two discount figures the user is typing. Shops that negotiate
 * "take ৳500 off" outnumber the ones that think in percentages, so the entry
 * form accepts either and derives the other.
 */
export type DiscountMode = 'PERCENT' | 'AMOUNT';

/** The adjustment figures the entry form layers on top of the line subtotal. */
export interface SaleAdjustments {
    /** The typed percentage. Ignored while `discountMode` is 'AMOUNT'. */
    discountPercent: number;
    /** The typed flat discount. Ignored while `discountMode` is 'PERCENT'. */
    discountAmount: number;
    discountMode: DiscountMode;
    rounding: number;
    transportCost: number;
    laborCost: number;
}

export interface SaleTotals extends SaleAdjustments {
    /** The lines at their net prices — after each line's own "Disc %". */
    subtotal: number;
    /** What the discount actually comes to in taka, however it was entered. */
    discount: number;
    /**
     * `discount` as a share of the subtotal. In 'AMOUNT' mode this is the
     * calculated percentage rather than the (unused) typed one, so the form,
     * the printed invoice and anything else reading totals agree.
     */
    discountPercent: number;
    /**
     * The output VAT the total already contains. Prices are tax-inclusive —
     * the convention the server, POS, the Mushak documents and the sale's
     * own invoice page all share — so this is informational and is never
     * added to `total`; it is the figure the server will store as the sale's
     * `vat_amount`.
     */
    vat: number;
    total: number;
}

export const EMPTY_ADJUSTMENTS: SaleAdjustments = {
    discountPercent: 0,
    discountAmount: 0,
    discountMode: 'PERCENT',
    rounding: 0,
    transportCost: 0,
    laborCost: 0,
};

/**
 * Line subtotal plus the form's adjustments — the same arithmetic the server
 * re-runs before it accepts the sale (`SalesService.prepareSale`). Each line
 * is taken at its net price, the invoice discount comes off that, and the flat
 * costs are added last. VAT is worked out *inside* the result, not on top of
 * it: `vatRate` is the workspace default, used for any line whose product sets
 * no rate of its own.
 */
export function computeSaleTotals(
    items: LineItem[],
    adjustments: SaleAdjustments,
    vatRate: number,
): SaleTotals {
    const subtotal = items.reduce((sum, item) => sum + lineNetTotal(item), 0);
    // A flat discount is taken as typed, a percentage one off the subtotal.
    // Either way it is capped at the subtotal: a discount on its own must
    // never drag the invoice below zero, and an over-typed figure would
    // otherwise be posted as a negative sale.
    const requested = adjustments.discountMode === 'AMOUNT'
        ? adjustments.discountAmount || 0
        : subtotal * ((adjustments.discountPercent || 0) / 100);
    const discount = Math.min(Math.max(requested, 0), subtotal);
    const discountPercent = adjustments.discountMode === 'AMOUNT'
        ? (subtotal > 0 ? (discount / subtotal) * 100 : 0)
        : adjustments.discountPercent || 0;
    const afterDiscount = subtotal - discount;
    const total =
        afterDiscount
        + (adjustments.transportCost || 0)
        + (adjustments.laborCost || 0)
        + (adjustments.rounding || 0);
    // Mirrors the snapshot the server takes: the lines' inclusive prices,
    // with any reduction below them spread back pro rata, and anything above
    // them (transport, labour, rounding up) left untaxed.
    const vat = items.length === 0 ? 0 : computeSaleTax(
        items.map((item, index) => ({
            key: String(index),
            quantity: item.quantity,
            unitPrice: netUnitPrice(item),
            vatRate: resolveTaxRate(item.vatRate ?? null, vatRate),
            sdRate: 0,
        })),
        Math.max(0, total),
    ).vatAmount;

    // Adjustments first: the derived figures below are what callers read, and
    // the typed percentage must not shadow the calculated one.
    return { ...adjustments, subtotal, discount, discountPercent, vat, total };
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
    /**
     * Quick-create state for the customer picker. Passing these turns on the
     * "new customer" button; screens that only view a sale leave them out.
     */
    customerDraft?: NewCustomerDraft | null;
    setCustomerDraft?: (draft: NewCustomerDraft | null) => void;
    customerDraftNameInvalid?: boolean;

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

    /**
     * Show the last few rates each product sold at, beside the price field.
     * Opt-in so the sale detail page — which reads a posted sale rather than
     * pricing a new one — is unaffected.
     */
    showRateHistory?: boolean;

    /**
     * Warehouse controls. Passing fewer than two warehouses leaves the whole
     * thing out, which is the single-warehouse shop's experience — unchanged.
     */
    warehouses?: WarehouseOption[];
    warehouseId?: string;
    setWarehouseId?: (warehouseId: string) => void;
    perLineWarehouse?: boolean;
    setPerLineWarehouse?: (perLine: boolean) => void;

    /** Buttons for the bottom of the end-hand panel. */
    actions: ReactNode;
    /** Document actions for the top strip — printing and the like. */
    headerActions?: ReactNode;
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
    customerDraft = null,
    setCustomerDraft,
    customerDraftNameInvalid = false,
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
    showRateHistory = false,
    warehouses = [],
    warehouseId = '',
    setWarehouseId,
    perLineWarehouse = false,
    setPerLineWarehouse,
    actions,
    headerActions,
    onSubmit,
}: SaleEntryLayoutProps) {
    const { t } = useI18n();
    // Only meaningful while a rate is still being decided, and the customer is
    // what puts their own past rates at the top of the list.
    const history = showRateHistory && !readOnly
        ? {
            historyType: 'sale' as const,
            historyPartyId: customer?.id as string | undefined,
            historyPartyName: customer?.name as string | undefined,
        }
        : {};

    const entryWarehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name;

    return (
        <DocumentEntryLayout
            title={title}
            backHref={backHref}
            banner={banner}
            onSubmit={onSubmit}
            metaBar={
                <DocumentMetaBar
                    refNumber={refNumber}
                    setRefNumber={setRefNumber}
                    currentUser={currentUser}
                    documentDate={saleDate}
                    setDocumentDate={setSaleDate}
                    serialNumber={serialNumber}
                    readOnly={readOnly}
                    refReadOnly={refReadOnly}
                >
                    {setWarehouseId && (
                        <WarehouseMetaFields
                            warehouses={warehouses}
                            value={warehouseId}
                            onChange={setWarehouseId}
                            perLine={perLineWarehouse}
                            onPerLineChange={setPerLineWarehouse ?? (() => {})}
                            readOnly={readOnly}
                        />
                    )}
                </DocumentMetaBar>
            }
            partyPicker={
                <CustomerSelection
                    customer={customer}
                    setCustomer={setCustomer}
                    readOnly={readOnly}
                    draft={customerDraft}
                    setDraft={setCustomerDraft}
                    draftNameInvalid={customerDraftNameInvalid}
                />
            }
            picker={
                readOnly ? undefined : (
                    <>
                        {onVoiceResult ? (
                            <VoiceEntryInput entryType="sale" onResult={onVoiceResult} inline>
                                <ProductSearch onProductSelect={onAddProduct} {...history} />
                            </VoiceEntryInput>
                        ) : (
                            <ProductSearch onProductSelect={onAddProduct} {...history} />
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
                    warehouses={perLineWarehouse ? warehouses : []}
                    entryWarehouseName={entryWarehouseName}
                    {...history}
                />
            }
            note={
                readOnly ? (
                    <p className="w-full rounded border bg-white px-2 py-1.5 text-sm text-gray-600 flex-shrink-0">
                        {description || <span className="text-gray-400">{t.shared.empty.noNote}</span>}
                    </p>
                ) : (
                    <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t.sales.entry.notePlaceholder}
                        aria-label={t.sales.entry.note}
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
            headerActions={headerActions}
        />
    );
}
