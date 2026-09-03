'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { getWorkspaceItem } from '@/lib/session-store';
import DocumentEntryLayout from '@/components/document-entry/DocumentEntryLayout';
import DocumentMetaBar from '@/components/document-entry/DocumentMetaBar';
import LineItemsTable from '@/components/document-entry/LineItemsTable';
import ProductSearch, { availableQtyOf } from '@/components/document-entry/ProductSearch';
import type { PartyOption } from '@/components/document-entry/PartySearchSelect';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import type { LineItem } from '@/lib/hooks/useNewSaleCart';
import SupplierSelection, { type NewSupplierDraft } from '../components/SupplierSelection';
import PurchaseTotals, {
    computePurchaseTotals,
    EMPTY_PURCHASE_ADJUSTMENTS,
    type PurchaseAdjustments,
} from '../components/PurchaseTotals';

/**
 * Purchase entry, built on the same frame as sale entry: one slim meta strip,
 * a supplier typeahead beside the product search, the compact line table, and
 * a right panel carrying the totals and the post button.
 *
 * `?productId=` seeds the first line, which is how the products list sends a
 * shopkeeper here to restock one item. `?from=products` sends them back there
 * afterwards instead of to the purchases list.
 */
export default function NewPurchasePage() {
    const { t } = useI18n();
    const router = useRouter();
    const searchParams = useSearchParams();
    const seedProductId = searchParams.get('productId');
    const cameFromProducts = searchParams.get('from') === 'products';
    const returnHref = cameFromProducts ? routes.inventory.products : routes.purchases.list;

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [items, setItems] = useState<LineItem[]>([]);
    const [supplier, setSupplier] = useState<PartyOption | null>(null);
    const [supplierDraft, setSupplierDraft] = useState<NewSupplierDraft | null>(null);
    const [draftNameInvalid, setDraftNameInvalid] = useState(false);
    const [adjustments, setAdjustments] = useState<PurchaseAdjustments>(EMPTY_PURCHASE_ADJUSTMENTS);
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const totals = useMemo(() => computePurchaseTotals(items, adjustments), [items, adjustments]);

    useEffect(() => {
        api.getCurrentUser().then(setCurrentUser).catch(() => {});
    }, []);

    const addProduct = useCallback(
        (
            product: any,
            options?: { quantity?: number; price?: number; availableQty?: number },
        ) => {
            const unitCost = options?.price ?? Number(product.price) ?? 0;
            setItems((prev) => {
                const existing = prev.find((item) => item.productId === product.id);
                if (existing) {
                    return prev.map((item) =>
                        item.productId === product.id
                            ? { ...item, quantity: item.quantity + (options?.quantity ?? 1) }
                            : item,
                    );
                }
                return [
                    ...prev,
                    {
                        productId: product.id,
                        name: product.name,
                        // The API serializes Decimal as a string; coerce so the
                        // line maths and the posted payload are both numbers.
                        price: Number.isFinite(unitCost) ? unitCost : 0,
                        group: product.group?.name,
                        subgroup: product.subgroup?.name,
                        quantity: options?.quantity ?? 1,
                        discount: 0,
                        unitType: product.unit_type ?? 'none',
                        // Voice-matched products come without stock rows — leave
                        // availableQty undefined rather than claiming zero stock.
                        availableQty: options?.availableQty
                            ?? (Array.isArray(product.stocks) ? availableQtyOf(product) : undefined),
                    },
                ];
            });
        },
        [],
    );

    // Seed the first line when the products list linked here to restock one item.
    useEffect(() => {
        if (!seedProductId) return;

        let cancelled = false;
        api.getProduct(seedProductId)
            .then((product: any) => {
                if (!cancelled && product?.id) addProduct(product);
            })
            .catch((error: unknown) => console.error('Failed to load the product to restock', error));

        return () => { cancelled = true; };
    }, [seedProductId, addProduct]);

    const updateItem = (productId: string, updates: Partial<LineItem>) =>
        setItems((prev) =>
            prev.map((item) => (item.productId === productId ? { ...item, ...updates } : item)),
        );

    const removeItem = (productId: string) =>
        setItems((prev) => prev.filter((item) => item.productId !== productId));

    const handleVoicePurchase = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                addProduct(item.product, { quantity: item.quantity });
                added++;
            }
        }
        if (result.note && !notes) setNotes(result.note);

        for (const message of buildVoiceEntryMessages(result, added)) {
            if (message.startsWith('Could not find')) toast.info(message);
            else toast.success(message);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (items.length === 0) {
            toast.error(t.purchaseShared.addOnePurchasedProduct);
            return;
        }

        if (supplierDraft && !supplierDraft.name.trim()) {
            setDraftNameInvalid(true);
            toast.error(t.purchaseShared.supplierNameRequiredInline);
            return;
        }
        setDraftNameInvalid(false);

        setSubmitting(true);
        try {
            const purchase = await api.createPurchase({
                // The active branch is persisted per workspace and sent as
                // x-store-id on every request; the body needs the same id.
                storeId: getWorkspaceItem('store_id') || '',
                supplierId: supplierDraft ? undefined : supplier?.id,
                newSupplier: supplierDraft
                    ? {
                          name: supplierDraft.name,
                          phone: supplierDraft.phone || undefined,
                          email: supplierDraft.email || undefined,
                          address: supplierDraft.address || undefined,
                      }
                    : undefined,
                items: items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitCost: item.price,
                })),
                taxAmount: totals.taxAmount,
                discountAmount: totals.discountAmount,
                freightAmount: totals.freightAmount,
                notes: notes || undefined,
            });

            toast.success(
                purchase?.purchase_number
                    ? `${t.purchases.purchaseRecorded}\n${purchase.purchase_number}`
                    : t.purchases.purchaseRecorded,
            );
            router.push(returnHref);
        } catch (error: any) {
            console.error('Purchase creation error:', error);
            toast.error(error.message || t.purchaseShared.failedRecordPurchase);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <DocumentEntryLayout
            title={t.purchases.recordPurchase}
            backHref={returnHref}
            backLabel={t.purchases.title}
            onSubmit={handleSubmit}
            metaBar={
                <DocumentMetaBar
                    docLabel={t.purchases.columns.purchaseNumber}
                    currentUser={currentUser}
                    showRefNumber={false}
                    showDate={false}
                />
            }
            partyPicker={
                <SupplierSelection
                    supplier={supplier}
                    setSupplier={setSupplier}
                    draft={supplierDraft}
                    setDraft={setSupplierDraft}
                    draftNameInvalid={draftNameInvalid}
                />
            }
            picker={
                <VoiceEntryInput entryType="purchase" onResult={handleVoicePurchase} inline>
                    <ProductSearch
                        onProductSelect={addProduct}
                        priceLabel={t.purchaseShared.unitCost}
                        placeholder={t.purchaseShared.searchProducts}
                        historyType="purchase"
                        historyPartyId={supplier?.id}
                        historyPartyName={supplier?.name}
                    />
                </VoiceEntryInput>
            }
            table={
                <LineItemsTable
                    items={items}
                    onUpdateItem={updateItem}
                    onRemoveItem={removeItem}
                    showDiscount={false}
                    showCompoundUnits
                    priceLabel={t.purchaseShared.unitCost}
                    availableLabel={t.purchaseShared.inStock}
                    emptyMessage={t.purchaseShared.noPurchaseLinesYet}
                    historyType="purchase"
                    historyPartyId={supplier?.id}
                    historyPartyName={supplier?.name}
                />
            }
            note={
                <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t.purchaseShared.purchaseNotes}
                    aria-label={t.common.notes}
                    className="w-full border rounded px-2 py-1.5 text-sm flex-shrink-0"
                />
            }
            panel={
                <PurchaseTotals
                    totals={totals}
                    onChange={(patch) => setAdjustments((prev) => ({ ...prev, ...patch }))}
                    previousPayable={Number(supplier?.due_balance ?? 0)}
                />
            }
            actions={
                <>
                    <Link
                        href={returnHref}
                        className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
                    >
                        {t.common.cancel}
                    </Link>
                    <button
                        type="submit"
                        disabled={submitting || items.length === 0 || totals.total < 0}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? t.purchases.modal.saving : t.purchases.modal.postPurchase}
                    </button>
                </>
            }
        />
    );
}
