'use client';

import type { ReactNode } from 'react';
import DocumentEntryLayout from '@/components/document-entry/DocumentEntryLayout';
import DocumentMetaBar, { MetaField, metaFieldInputClass } from '@/components/document-entry/DocumentMetaBar';
import { formatDateTime } from '@/lib/format';
import WarehouseMetaFields from '@/components/document-entry/WarehouseMetaFields';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import ProductSearch from '@/components/document-entry/ProductSearch';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import type { VoiceEntryResult } from '@/lib/voice-entry';
import { useI18n } from '@/lib/i18n';
import SupplierSelection from './SupplierSelection';
import PurchasePaymentSection from './PurchasePaymentSection';
import PurchaseTotals from './PurchaseTotals';
import type { usePurchaseEntry } from './usePurchaseEntry';

interface PurchaseEntryLayoutProps {
    entry: ReturnType<typeof usePurchaseEntry>;
    title: string;
    backHref: string;
    backLabel?: string;
    banner?: ReactNode;
    /** Freeze every field without changing the layout — the View screen. */
    readOnly?: boolean;
    /** Assigned number of a recorded purchase; a new one reads "Auto". */
    purchaseNumber?: string;
    /**
     * When the purchase happened. A `datetime-local` value while
     * `transactionDateEditable` is set; an ISO instant on a saved bill.
     */
    transactionDate?: string;
    setTransactionDate?: (value: string) => void;
    /** Record Purchase only. A saved bill shows the time and does not edit it. */
    transactionDateEditable?: boolean;
    /** When the row was written. Empty on a new bill, which reads "Auto". */
    createdAt?: string | null;
    currentUser?: any;
    /**
     * The branch the bill belongs to: the header branch on a new bill, the
     * bill's own when editing. The payment strip offers that branch's methods.
     */
    storeId: string;
    /**
     * What the supplier was owed apart from this bill. A recorded bill is
     * already in the supplier's balance, so its screens work this out; a new
     * one reads the picked supplier's balance.
     */
    previousPayable?: number;
    onVoiceResult?: (result: VoiceEntryResult) => void;
    actions: ReactNode;
    headerActions?: ReactNode;
    onSubmit?: (e: React.FormEvent) => void;
}

/**
 * The purchase entry screen — meta strip, supplier and product pickers, the
 * line table, and a right panel with the totals, the tender strip and the
 * actions. Shared by Record Purchase and the purchase detail page, so viewing
 * or editing a purchase looks and behaves exactly like recording one, the way
 * `SaleEntryLayout` serves the sales side.
 */
export default function PurchaseEntryLayout({
    entry,
    title,
    backHref,
    backLabel,
    banner,
    readOnly = false,
    purchaseNumber,
    transactionDate = '',
    setTransactionDate,
    transactionDateEditable = false,
    createdAt,
    currentUser = null,
    storeId,
    previousPayable,
    onVoiceResult,
    actions,
    headerActions,
    onSubmit,
}: PurchaseEntryLayoutProps) {
    const { t } = useI18n();
    const { supplier, warehouses, warehouseId, perLineWarehouse } = entry;
    const entryWarehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name;
    // Only meaningful while a cost is still being decided, and the supplier is
    // what puts their own past rates at the top of the list.
    const history = readOnly
        ? {}
        : {
              historyType: 'purchase' as const,
              historyPartyId: supplier?.id,
              historyPartyName: supplier?.name,
          };

    const productSearch = (
        <ProductSearch
            onProductSelect={entry.addProduct}
            priceLabel={t.purchaseShared.unitCost}
            placeholder={t.purchaseShared.searchProducts}
            historyType="purchase"
            // A line starts at what the stock last cost (this supplier's rate
            // first), never at its selling price, and stays empty when there is
            // no purchase history.
            initialPriceOf={() => null}
            seedPriceFromHistory
            historyPartyId={supplier?.id}
            historyPartyName={supplier?.name}
            warehouseId={warehouseId || undefined}
            // Goods are coming in: buying more than is held is normal.
            warnOverStock={false}
        />
    );

    return (
        <DocumentEntryLayout
            title={title}
            backHref={backHref}
            backLabel={backLabel}
            banner={banner}
            onSubmit={onSubmit}
            metaBar={
                <DocumentMetaBar
                    docLabel={t.purchases.columns.purchaseNumber}
                    serialNumber={purchaseNumber}
                    currentUser={currentUser}
                    showRefNumber={false}
                    showDate={false}
                    readOnly
                >
                    <MetaField label={t.purchases.columns.transactionDate}>
                        {transactionDateEditable && setTransactionDate ? (
                            <input
                                type="datetime-local"
                                aria-label={t.purchases.columns.transactionDate}
                                value={transactionDate}
                                onChange={(e) => setTransactionDate(e.target.value)}
                                className={metaFieldInputClass}
                            />
                        ) : (
                            <output className="font-medium text-gray-700">
                                {transactionDate ? formatDateTime(transactionDate) : '—'}
                            </output>
                        )}
                    </MetaField>
                    <MetaField label={t.common.createdAt}>
                        <output className="font-medium text-gray-700">
                            {createdAt ? formatDateTime(createdAt) : <span className="italic text-gray-400">Auto</span>}
                        </output>
                    </MetaField>
                    <WarehouseMetaFields
                        warehouses={warehouses}
                        value={warehouseId}
                        onChange={entry.setWarehouseId}
                        perLine={perLineWarehouse}
                        onPerLineChange={entry.setPerLineWarehouse}
                        readOnly={readOnly}
                    />
                </DocumentMetaBar>
            }
            partyPicker={
                <SupplierSelection
                    supplier={supplier}
                    setSupplier={entry.setSupplier}
                    draft={entry.supplierDraft}
                    setDraft={entry.setSupplierDraft}
                    draftNameInvalid={entry.draftNameInvalid}
                    readOnly={readOnly}
                />
            }
            picker={
                readOnly ? undefined : onVoiceResult ? (
                    <VoiceEntryInput entryType="purchase" onResult={onVoiceResult} inline>
                        {productSearch}
                    </VoiceEntryInput>
                ) : productSearch
            }
            table={
                <LineItemsTable
                    items={entry.items}
                    onUpdateItem={entry.updateItem}
                    onRemoveItem={entry.removeItem}
                    readOnly={readOnly}
                    showDiscount={false}
                    showCompoundUnits
                    priceLabel={t.purchaseShared.unitCost}
                    availableLabel={t.purchaseShared.inStock}
                    emptyMessage={t.purchaseShared.noPurchaseLinesYet}
                    warehouses={perLineWarehouse ? warehouses : []}
                    entryWarehouseName={entryWarehouseName}
                    entryWarehouseId={warehouseId || undefined}
                    warehouseLabel={t.common.warehouse}
                    warnOverStock={false}
                    {...history}
                />
            }
            note={
                readOnly ? (
                    <p className="w-full rounded border bg-white px-2 py-1.5 text-sm text-gray-600 flex-shrink-0">
                        {entry.notes || <span className="text-gray-400">{t.purchaseShared.purchaseNotes}</span>}
                    </p>
                ) : (
                    <input
                        type="text"
                        value={entry.notes}
                        onChange={(e) => entry.setNotes(e.target.value)}
                        placeholder={t.purchaseShared.purchaseNotes}
                        aria-label={t.common.notes}
                        className="w-full border rounded px-2 py-1.5 text-sm flex-shrink-0"
                    />
                )
            }
            panel={
                <>
                    <PurchaseTotals
                        totals={entry.totals}
                        onChange={(patch) => entry.setAdjustments((prev) => ({ ...prev, ...patch }))}
                        previousPayable={previousPayable ?? Number(supplier?.due_balance ?? 0)}
                        readOnly={readOnly}
                    />
                    <div className="border-t pt-3">
                        <PurchasePaymentSection
                            context="purchase"
                            storeId={storeId}
                            payments={entry.payments}
                            total={entry.totals.total}
                            onPaymentChange={entry.setPayments}
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
