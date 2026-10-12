'use client';

import type { ReactNode } from 'react';
import DocumentEntryLayout from '@/components/document-entry/DocumentEntryLayout';
import ProductSearch from '@/components/document-entry/ProductSearch';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import DocumentMetaBar, { MetaField, metaFieldInputClass } from '@/components/document-entry/DocumentMetaBar';
import WarehouseMetaFields from '@/components/document-entry/WarehouseMetaFields';
import type { WarehouseOption } from '@/lib/hooks/useWarehouses';
import CustomerSelection, { type NewCustomerDraft } from './CustomerSelection';
import TotalsFooter from './TotalsFooter';
import PaymentSection from './PaymentSection';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import type { VoiceEntryResult } from '@/lib/voice-entry';
import type { LineItem, Payment } from '@/lib/hooks/useNewSaleCart';
import type { SalesRepOption } from '@/lib/hooks/useSalesReps';
import { useI18n } from '@/lib/i18n';
import { computeEntryTax, computeSaleTax, resolveTaxRate, type MushakTaxRates } from '@erp71/shared-types';

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
    /** Σ quantity × price, as the prices were entered. */
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
     * The discount to show beside the VAT and the total. Equal to `discount`
     * unless VAT is added on top, where it is worked back from the other
     * figures so the block foots — see `computeEntryTax`.
     */
    discountShown: number;
    /** The VAT in this sale: inside the total, or added to it — see `vatIncluded`. */
    vat: number;
    /** Supplementary duty, likewise. */
    sd: number;
    /** True when the VAT is already inside the prices; false when it was added on top. */
    vatIncluded: boolean;
    /** The VAT rate when every line shares one, for the row label; null when they differ. */
    vatRate: number | null;
    /** Unit prices to post, line for line — always VAT-inclusive. */
    postedUnitPrices: number[];
    /** The discount to post, in the same VAT-inclusive terms as the prices. */
    postedDiscount: number;
    total: number;
}

/**
 * How the shop prices: the VAT rate a product without its own takes, and
 * whether prices are entered with VAT in them or before it.
 */
export interface VatPricing {
    defaultVatRate: number;
    pricesIncludeVat: boolean;
}

/** Prices that include VAT at no stated rate — the entry screens before they read the settings. */
export const NO_VAT_PRICING: VatPricing = { defaultVatRate: 0, pricesIncludeVat: true };

/** The rates a cart line is taxed at: its product's own, else the shop default. */
export function lineTaxRates(item: Pick<LineItem, 'vatRate' | 'sdRate'>, pricing: VatPricing): MushakTaxRates {
    return {
        vatRate: resolveTaxRate(item.vatRate, pricing.defaultVatRate),
        sdRate: resolveTaxRate(item.sdRate, 0),
    };
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
 * Line subtotal plus the form's adjustments. Discount is taken off first, VAT
 * applies to the discounted amount, and the flat costs are added last.
 *
 * Whether the VAT is inside the prices or added on top is the shop's choice
 * (`pricing`); either way the figures come from `computeEntryTax`, the same
 * arithmetic the server snapshots, so the VAT shown is the VAT stored.
 */
export function computeSaleTotals(
    items: LineItem[],
    adjustments: SaleAdjustments,
    pricing: VatPricing,
): SaleTotals {
    const lines = items.map((item) => ({
        key: item.productId,
        quantity: item.quantity,
        unitPrice: item.price,
        ...lineTaxRates(item, pricing),
    }));
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
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

    const entry = computeEntryTax(lines, discount, pricing.pricesIncludeVat);
    const extras =
        (adjustments.transportCost || 0)
        + (adjustments.laborCost || 0)
        + (adjustments.rounding || 0);
    const total = entry.total + extras;

    // An edited sale carries whatever separates its lines from its stored total
    // as one adjustment; the server taxes the edited total, so the VAT inside
    // follows it rather than the lines alone.
    const tax = pricing.pricesIncludeVat && Math.abs(extras) > 0.005
        ? computeSaleTax(lines, total)
        : { vatAmount: entry.vatAmount, sdAmount: entry.sdAmount };

    const rates = new Set(lines.map((line) => line.vatRate));
    const vatRate = lines.length === 0 ? pricing.defaultVatRate : rates.size === 1 ? [...rates][0] : null;

    // Adjustments first: the derived figures below are what callers read, and
    // the typed percentage must not shadow the calculated one.
    return {
        ...adjustments,
        subtotal,
        discount,
        discountPercent,
        discountShown: pricing.pricesIncludeVat ? discount : entry.discountShown,
        vat: tax.vatAmount,
        sd: tax.sdAmount,
        vatIncluded: pricing.pricesIncludeVat,
        vatRate,
        postedUnitPrices: entry.postedUnitPrices,
        postedDiscount: pricing.pricesIncludeVat ? discount : entry.postedDiscount,
        total,
    };
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
    /**
     * What the customer owed before this sale. Left out, it is the picked
     * customer's balance as it stands, which is right while a sale is being
     * entered — and wrong once it is posted, when that balance already
     * includes the sale. A posted sale passes the server's figure instead.
     */
    previousDue?: number | null;

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
    /**
     * Who the sale is credited to ("Sales By"). Passing the setter shows the
     * picker; it defaults to the picked customer's own sales rep.
     */
    salesRepId?: string | null;
    setSalesRepId?: (id: string | null) => void;
    salesReps?: SalesRepOption[];
    /**
     * The current rep's name, for when they are no longer on the list (they
     * have since left) — the sale still shows who made it.
     */
    salesRepName?: string;

    payments: Payment[];
    onPaymentChange: (payments: Payment[]) => void;
    /**
     * Say what becomes of money paid beyond the total. Off on a posted sale's
     * edit form, whose payment edits are not re-posted to the customer's
     * account.
     */
    warnOnOverpayment?: boolean;

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
    previousDue,
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
    warnOnOverpayment = true,
    showRateHistory = false,
    warehouses = [],
    warehouseId = '',
    setWarehouseId,
    perLineWarehouse = false,
    setPerLineWarehouse,
    actions,
    headerActions,
    onSubmit,
    salesRepId = null,
    setSalesRepId,
    salesReps = [],
    salesRepName,
}: SaleEntryLayoutProps) {
    const { t } = useI18n();
    const repOptions = salesRepId && !salesReps.some((rep) => rep.id === salesRepId)
        ? [...salesReps, { id: salesRepId, name: salesRepName ?? salesRepId }]
        : salesReps;
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

    // One figure for both the totals and the tender strip: the dues the footer
    // prints and what an overpayment is said to settle must agree.
    const resolvedPreviousDue = previousDue !== undefined
        ? previousDue
        : customer ? Number(customer.due_balance ?? 0) : null;

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
                    {setSalesRepId && (
                        <MetaField label={t.common.salesRep}>
                            <select
                                aria-label={t.common.salesRep}
                                value={salesRepId ?? ''}
                                onChange={(e) => setSalesRepId(e.target.value || null)}
                                disabled={readOnly}
                                className={metaFieldInputClass}
                            >
                                <option value="">{t.common.noSalesRep}</option>
                                {repOptions.map((rep) => (
                                    <option key={rep.id} value={rep.id}>{rep.name}</option>
                                ))}
                            </select>
                        </MetaField>
                    )}
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
                                <ProductSearch onProductSelect={onAddProduct} warehouseId={warehouseId || undefined} {...history} />
                            </VoiceEntryInput>
                        ) : (
                            <ProductSearch onProductSelect={onAddProduct} warehouseId={warehouseId || undefined} {...history} />
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
                    entryWarehouseId={warehouseId || undefined}
                    {...history}
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
                        previousDue={resolvedPreviousDue}
                        amountPaid={payments.reduce((sum, p) => sum + p.amount, 0)}
                        readOnly={readOnly}
                        roundingLabel={adjustmentLabel}
                    />
                    <div className="border-t pt-3">
                        <PaymentSection
                            payments={payments}
                            total={totals.total}
                            customer={customer}
                            previousDue={resolvedPreviousDue}
                            warnOnOverpayment={warnOnOverpayment}
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
