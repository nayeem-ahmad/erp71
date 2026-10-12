'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { getWorkspaceItem } from '@/lib/session-store';
import { buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import PurchaseEntryLayout from '../components/PurchaseEntryLayout';
import { usePurchaseEntry } from '../components/usePurchaseEntry';

/**
 * Purchase entry, built on the same frame as sale entry: one slim meta strip,
 * a supplier typeahead beside the product search, the compact line table, and
 * a right panel carrying the totals, the tender strip and the post button.
 *
 * `?productId=` seeds the first line, which is how the products list sends a
 * shopkeeper here to restock one item. `?from=products` sends them back there
 * afterwards instead of to the purchases list. `?duplicate=<id>` copies an
 * existing purchase onto a fresh screen.
 */
function NewPurchasePageContent() {
    const { t } = useI18n();
    const router = useRouter();
    const searchParams = useSearchParams();
    const seedProductId = searchParams.get('productId');
    const duplicatePurchaseId = searchParams.get('duplicate');
    const cameFromProducts = searchParams.get('from') === 'products';
    const returnHref = cameFromProducts ? routes.inventory.products : routes.purchases.list;

    const entry = usePurchaseEntry({ seedDefaultWarehouse: true });
    const { addProductAtLastCost, loadPurchase } = entry;
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);
    const [duplicatedFrom, setDuplicatedFrom] = useState('');

    useEffect(() => {
        api.getCurrentUser().then(setCurrentUser).catch(() => {});
    }, []);

    // Seed the first line when the products list linked here to restock one item.
    useEffect(() => {
        if (!seedProductId) return;

        let cancelled = false;
        api.getProduct(seedProductId)
            .then((product: any) => {
                if (!cancelled && product?.id) void addProductAtLastCost(product);
            })
            .catch((error: unknown) => console.error('Failed to load the product to restock', error));

        return () => { cancelled = true; };
    }, [seedProductId, addProductAtLastCost]);

    // Copy an existing purchase: supplier, lines and the three charge fields.
    // The purchase number and the posting it produced are not carried over —
    // saving this screen records a new purchase of its own — and neither is
    // what was paid on the original: the cash for a copy has not moved.
    useEffect(() => {
        if (!duplicatePurchaseId) return;

        let cancelled = false;

        api.getPurchase(duplicatePurchaseId)
            .then((purchase: any) => {
                if (cancelled || !purchase?.id) return;
                loadPurchase(purchase, { withPayments: false });
                setDuplicatedFrom(purchase.purchase_number ?? '');
            })
            .catch((error: unknown) => {
                console.error('Failed to load the purchase to duplicate', error);
                if (!cancelled) toast.error(t.purchases.duplicateLoadFailed);
            });

        return () => { cancelled = true; };
    }, [duplicatePurchaseId, loadPurchase, t.purchases.duplicateLoadFailed]);

    const handleVoicePurchase = (result: VoiceEntryResult) => {
        let added = 0;
        for (const item of result.items) {
            if (item.matched && item.product) {
                void addProductAtLastCost(item.product, { quantity: item.quantity });
                added++;
            }
        }
        if (result.note && !entry.notes) entry.setNotes(result.note);

        for (const message of buildVoiceEntryMessages(result, added)) {
            if (message.startsWith('Could not find')) toast.info(message);
            else toast.success(message);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const problem = entry.validate({
            noLines: t.purchaseShared.addOnePurchasedProduct,
            supplierNameRequired: t.purchaseShared.supplierNameRequiredInline,
            paymentExceedsTotal: t.purchaseShared.paymentExceedsTotal,
        });
        if (problem) {
            toast.error(problem);
            return;
        }

        setSubmitting(true);
        try {
            const purchase = await api.createPurchase({
                // The active branch is persisted per workspace and sent as
                // x-store-id on every request; the body needs the same id.
                storeId: getWorkspaceItem('store_id') || '',
                ...entry.billPayload(),
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
        <PurchaseEntryLayout
            entry={entry}
            title={duplicatedFrom ? `${t.common.duplicate}: ${duplicatedFrom}` : t.purchases.recordPurchase}
            backHref={returnHref}
            backLabel={t.purchases.title}
            banner={duplicatedFrom ? (
                <div className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    <Copy className="h-4 w-4 flex-shrink-0" />
                    <span>{t.purchases.duplicateBanner.replace('{number}', duplicatedFrom)}</span>
                </div>
            ) : undefined}
            onSubmit={handleSubmit}
            currentUser={currentUser}
            onVoiceResult={handleVoicePurchase}
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
                        disabled={submitting || entry.items.length === 0 || entry.totals.total < 0 || entry.overpaid}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
                    >
                        {submitting ? t.purchases.modal.saving : t.purchases.modal.postPurchase}
                    </button>
                </>
            }
        />
    );
}

/**
 * `useSearchParams` bails out of prerendering without a Suspense boundary
 * above it, so the screen itself is a child component.
 */
export default function NewPurchasePage() {
    return (
        <Suspense>
            <NewPurchasePageContent />
        </Suspense>
    );
}
