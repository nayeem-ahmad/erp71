'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Ban, Copy, Pencil, Printer, Save, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { CancelEntryModal } from '@/components/CancelEntryModal';
import { PostingBadge } from '@/components/PostingBadge';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { hasPermission, isOwner } from '@/lib/permissions';
import { usePurchasePrinting } from '@/lib/hooks/usePurchasePrinting';
import PurchaseEntryLayout from '../components/PurchaseEntryLayout';
import { usePurchaseEntry } from '../components/usePurchaseEntry';

const statusBadgeClass: Record<string, string> = {
    RECORDED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    // Grey rather than red: a cancelled entry is void, not an error.
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-300',
};

/**
 * One recorded purchase, on the same screen it was entered on. It opens
 * read-only; `?edit=true` unlocks it, and saving carries the correction
 * through stock, the supplier's account and the vouchers (see
 * `PurchasesService.update`).
 */
function PurchaseDetailPageContent() {
    const { t, locale } = useI18n();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const purchaseId = params.id as string;
    const isEditMode = searchParams.get('edit') === 'true';

    const entry = usePurchaseEntry({ seedDefaultWarehouse: false });
    const { loadPurchase } = entry;
    const [purchase, setPurchase] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);

    // Cancelling reverses stock, the payable and the ledger, so the action is
    // hidden without CANCEL_ENTRY rather than shown and left to 403. OWNER
    // bypasses the guard server-side and may hold no grant rows at all.
    const { permissions, role } = useTenantPlanFeatures();
    const canCancel = isOwner(role) || hasPermission(permissions, 'CANCEL_ENTRY');
    const { paperSize, busyId, printInvoice } = usePurchasePrinting();

    const load = useCallback(async (id: string) => {
        try {
            setPurchase(await api.getPurchase(id));
        } catch (error) {
            console.error('Failed to load purchase', error);
            setPurchase(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (purchaseId) void load(purchaseId);
    }, [purchaseId, load]);

    // Seed the form from the purchase each time it is (re)loaded, and when
    // leaving edit mode, so Cancel throws away whatever was typed.
    useEffect(() => {
        if (purchase) loadPurchase(purchase, { withPayments: true });
    }, [purchase, isEditMode, loadPurchase]);

    const handleSave = async () => {
        if (!purchase) return;

        const problem = entry.validate({
            noLines: t.purchaseShared.addOnePurchasedProduct,
            supplierNameRequired: t.purchaseShared.supplierNameRequiredInline,
            paymentExceedsTotal: t.purchaseShared.paymentExceedsTotal,
        });
        if (problem) {
            toast.error(problem);
            return;
        }

        setSaving(true);
        try {
            await api.updatePurchase(purchase.id, entry.billPayload());
            toast.success(t.purchases.detail.saved);
            await load(purchase.id);
            router.push(routes.purchases.purchaseDetail(purchase.id));
        } catch (error: any) {
            console.error('Failed to save purchase', error);
            toast.error(error?.message || t.purchases.detail.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEntry = async (note: string) => {
        if (!purchase) return;
        await api.cancelPurchase(purchase.id, note);
        setShowCancelModal(false);
        await load(purchase.id);
        toast.success(t.entryCancellation.purchaseCancelled);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-50">
                <p className="text-sm text-gray-400">{t.purchases.detail.loading}</p>
            </div>
        );
    }

    if (!purchase) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-50">
                <p className="text-sm text-gray-400">{t.purchases.detail.notFound}</p>
            </div>
        );
    }

    const status = purchase.status ?? 'RECORDED';
    const isCancelled = status === 'CANCELLED';
    const editing = isEditMode && !isCancelled;
    const laterPaid = Number(purchase.later_paid_amount ?? 0);

    // The supplier's balance today already includes this bill, net of what was
    // paid with it. Shown against the bill's own supplier, that is taken back
    // out; a supplier swapped in on the edit form is shown as they stand.
    const previousPayable = entry.supplier?.id && entry.supplier.id === purchase.supplier_id
        ? Number(purchase.supplier?.due_balance ?? 0)
            - (Number(purchase.total_amount ?? 0) - Number(purchase.entry_paid_amount ?? 0))
        : undefined;

    const banner = (
        <div className="flex flex-wrap items-center gap-3 rounded border bg-white px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {t.common.status}
            </span>
            <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                    statusBadgeClass[status] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
            >
                {t.purchases.statuses[status as keyof typeof t.purchases.statuses] ?? status}
            </span>
            <PostingBadge status={purchase.posting_status} voucherNumber={purchase.voucher_number} />
            {laterPaid > 0.005 && (
                <span className="text-xs text-gray-600">
                    {formatMessage(t.purchases.detail.paidLater, { amount: formatBDT(laterPaid, { locale }) })}
                </span>
            )}
            {/* The reason lives on the document, not only in the audit log —
                this line is what a tenant reads months later. */}
            {isCancelled && (
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-600">
                    <Ban className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                        {formatMessage(t.entryCancellation.cancelledOn, {
                            date: formatDate(purchase.cancelled_at ?? purchase.created_at, locale),
                        })}
                        {purchase.cancellation_note ? ` — ${purchase.cancellation_note}` : ''}
                    </span>
                </span>
            )}
            {editing && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                    <Pencil className="w-3.5 h-3.5" />
                    {t.purchases.detail.editing} — {t.purchases.detail.editHint}
                </span>
            )}
        </div>
    );

    const headerActions = (
        <button
            type="button"
            onClick={() => void printInvoice(purchase.id, paperSize)}
            disabled={busyId === purchase.id}
            className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
        >
            <Printer className="w-3.5 h-3.5" />
            {t.purchases.printInvoice}
        </button>
    );

    const duplicateAction = (
        <Link
            href={`${routes.purchases.newPurchase}?duplicate=${purchase.id}`}
            className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm flex items-center gap-1.5"
            title={t.purchases.duplicate}
        >
            <Copy className="w-4 h-4" />
            {t.common.duplicate}
        </Link>
    );

    const viewActions = (
        <>
            <Link
                href={routes.purchases.list}
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm"
            >
                {t.common.back}
            </Link>
            {duplicateAction}
            {canCancel && !isCancelled && (
                <button
                    type="button"
                    onClick={() => setShowCancelModal(true)}
                    className="px-3 py-2 border border-red-200 rounded text-red-600 hover:bg-red-50 text-sm flex items-center gap-1.5"
                >
                    <Ban className="w-4 h-4" />
                    {t.entryCancellation.action}
                </button>
            )}
            {/* A cancelled entry has had every impact reversed; editing it would
                replay stock and postings against a void document, which the API
                refuses. Print and duplicate are still offered. */}
            {!isCancelled && (
                <button
                    type="button"
                    onClick={() => router.push(`${routes.purchases.purchaseDetail(purchase.id)}?edit=true`)}
                    className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium flex items-center justify-center gap-1.5"
                >
                    <Pencil className="w-4 h-4" />
                    {t.common.edit}
                </button>
            )}
        </>
    );

    const editActions = (
        <>
            <button
                type="button"
                onClick={() => router.push(routes.purchases.purchaseDetail(purchase.id))}
                className="px-3 py-2 border rounded text-gray-700 hover:bg-gray-50 text-sm flex items-center gap-1.5"
            >
                <X className="w-4 h-4" />
                {t.common.cancel}
            </button>
            <button
                type="button"
                onClick={handleSave}
                disabled={saving || entry.items.length === 0 || entry.totals.total < 0 || entry.overpaid}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium flex items-center justify-center gap-1.5"
            >
                <Save className="w-4 h-4" />
                {saving ? t.purchases.detail.saving : t.common.saveChanges}
            </button>
        </>
    );

    return (
        <>
            <PurchaseEntryLayout
                entry={entry}
                title={editing ? `${t.purchases.detail.edit}: ${purchase.purchase_number}` : purchase.purchase_number}
                backHref={routes.purchases.list}
                backLabel={t.purchases.title}
                banner={banner}
                readOnly={!editing}
                purchaseNumber={purchase.purchase_number}
                transactionDate={purchase.purchase_date ?? purchase.created_at}
                createdAt={purchase.created_at}
                // The bill's own branch, which an edit cannot change.
                storeId={purchase.store_id ?? ''}
                previousPayable={previousPayable}
                actions={editing ? editActions : viewActions}
                headerActions={headerActions}
            />
            {showCancelModal && (
                <CancelEntryModal
                    entryLabel={purchase.purchase_number}
                    entryAmount={formatBDT(Number(purchase.total_amount || 0), { locale })}
                    onConfirm={handleCancelEntry}
                    onClose={() => setShowCancelModal(false)}
                />
            )}
        </>
    );
}

/**
 * `useSearchParams` bails out of prerendering without a Suspense boundary
 * above it, so the screen itself is a child component.
 */
export default function PurchaseDetailPage() {
    return (
        <Suspense>
            <PurchaseDetailPageContent />
        </Suspense>
    );
}
