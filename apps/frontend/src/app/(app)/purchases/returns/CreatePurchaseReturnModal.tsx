'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Receipt, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import VoiceEntryInput from '@/components/VoiceEntryInput';
import { useI18n, formatMessage } from '@/lib/i18n';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Alert, Button, Field, Input } from '@/components/ui';
import { applyVoiceEntryReturnQuantities, buildVoiceEntryMessages, type VoiceEntryResult } from '@/lib/voice-entry';
import WarehouseSelect from '@/components/document-entry/WarehouseSelect';
import { useWarehouses } from '@/lib/hooks/useWarehouses';
import { useReturnRefund } from '@/lib/hooks/useReturnRefund';
import { returnPaymentsPayload } from '@/lib/return-refund-prefill';
import PurchasePaymentSection from '../components/PurchasePaymentSection';
import {
    filterLines,
    purchaseMatchesQuery,
    remainingQuantity,
    resolveLineEnter,
    returnAllRemaining,
    setSlipQuantity,
    slipTotal,
    type SlipLine,
    type SlipQuantities,
} from '@/lib/purchase-return-slip';

interface PurchaseReturnItem {
    id: string;
    quantity: number;
}

interface PurchaseLine {
    id: string;
    quantity: number;
    unit_cost: string | number;
    product_id: string;
    /** Set only where the line overrode the purchase's own warehouse. */
    warehouse_id?: string | null;
    product?: {
        name: string;
        sku?: string | null;
    };
    returnItems?: PurchaseReturnItem[];
}

interface PurchaseRecord {
    id: string;
    purchase_number: string;
    created_at: string;
    purchase_date?: string | null;
    total_amount: string | number;
    store_id: string;
    status?: string | null;
    warehouse_id?: string | null;
    supplier_id?: string | null;
    supplier?: {
        name: string;
        due_balance?: string | number | null;
    } | null;
    items: PurchaseLine[];
}

interface CreatePurchaseReturnModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    initialPurchaseId?: string | null;
}

/** How many purchases to show before the clerk has typed a search. */
const RECENT_LIMIT = 12;

const SELECT_CLASS =
    'w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white max-md:min-h-touch';

export default function CreatePurchaseReturnModal({
    isOpen,
    onClose,
    onSuccess,
    initialPurchaseId,
}: CreatePurchaseReturnModalProps) {
    const { t, locale, fmt } = useI18n();
    const copy = t.purchaseReturns.modal;
    const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
    const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(initialPurchaseId || null);
    const [searchTerm, setSearchTerm] = useState('');
    const [referenceNumber, setReferenceNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [returnQuantities, setReturnQuantities] = useState<SlipQuantities>({});
    const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
    const [partialDraft, setPartialDraft] = useState<Record<string, string>>({});
    const [lineQuery, setLineQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);
    const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

    // Which warehouse the goods leave. Seeded from the purchase below, so
    // returning a delivery that was unloaded into the annex takes it back out
    // of the annex. `showWarehouse` keys the whole control off there being a
    // genuine choice to make.
    const { warehouses, defaultWarehouseId } = useWarehouses();
    const [warehouseId, setWarehouseId] = useState('');
    const [lineWarehouses, setLineWarehouses] = useState<Record<string, string>>({});
    const showWarehouse = warehouses.length > 1;
    const entryWarehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name;

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setLoading(true);
        setError('');
        api.getPurchases()
            .then((data) => setPurchases(data))
            .catch(() => setPurchases([]))
            .finally(() => setLoading(false));
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setSelectedPurchaseId(initialPurchaseId || null);
        setSearchTerm('');
        setReferenceNumber('');
        setNotes('');
        setReturnQuantities({});
        setQtyDraft({});
        setPartialDraft({});
        setLineQuery('');
        setHighlight(0);
        setLineWarehouses({});
        setSubmitting(false);
        setError('');
        setNotice('');
    }, [initialPurchaseId, isOpen]);

    const filteredPurchases = useMemo(() => {
        return purchases
            .filter((purchase) => purchase.status !== 'CANCELLED')
            .filter((purchase) => {
                const when = purchase.purchase_date || purchase.created_at;
                return purchaseMatchesQuery({
                    purchaseNumber: purchase.purchase_number,
                    supplierName: purchase.supplier?.name || '',
                    productText: purchase.items
                        .map((item) => `${item.product?.name || ''} ${item.product?.sku || ''}`)
                        .join(' '),
                    isoDate: /^\d{4}-\d{2}-\d{2}/.test(when) ? when.slice(0, 10) : '',
                    dateLabel: formatDate(when, locale),
                }, searchTerm);
            })
            .sort((left, right) => Number(new Date(right.created_at)) - Number(new Date(left.created_at)));
    }, [purchases, searchTerm, locale]);

    const visiblePurchases = searchTerm.trim()
        ? filteredPurchases
        : filteredPurchases.slice(0, RECENT_LIMIT);

    const selectedPurchase = useMemo(
        () => purchases.find((purchase) => purchase.id === selectedPurchaseId) || null,
        [purchases, selectedPurchaseId],
    );

    useEffect(() => {
        setReturnQuantities({});
        setQtyDraft({});
        setPartialDraft({});
        setLineQuery('');
        setHighlight(0);
        setNotice('');
    }, [selectedPurchaseId]);

    useEffect(() => {
        if (!selectedPurchase) {
            setLineWarehouses({});
            setWarehouseId(defaultWarehouseId);
            return;
        }

        setWarehouseId(selectedPurchase.warehouse_id || defaultWarehouseId);
        // Only genuine overrides are seeded; a line that followed its purchase
        // keeps following the return, which is what the empty value means.
        setLineWarehouses(Object.fromEntries(
            selectedPurchase.items
                .filter((item) => item.warehouse_id)
                .map((item) => [item.id, item.warehouse_id as string]),
        ));
    }, [selectedPurchase, defaultWarehouseId]);

    const slipLines = useMemo<SlipLine[]>(() => {
        if (!selectedPurchase) return [];
        return selectedPurchase.items.map((item) => {
            const returned = (item.returnItems || []).reduce((sum, returnItem) => sum + returnItem.quantity, 0);
            return {
                id: item.id,
                name: item.product?.name || copy.unknownItem,
                sku: item.product?.sku || '',
                purchased: item.quantity,
                remaining: remainingQuantity(item.quantity, returned),
                unitCost: Number(item.unit_cost || 0),
            };
        });
    }, [selectedPurchase, copy.unknownItem]);

    const lineById = useMemo(
        () => new Map(slipLines.map((line) => [line.id, line])),
        [slipLines],
    );

    const returnable = slipLines.filter((line) => line.remaining > 0);
    const onSlip = slipLines.filter((line) => (returnQuantities[line.id] ?? 0) > 0);
    const offSlip = returnable.filter((line) => !returnQuantities[line.id]);
    const billRows = filterLines(offSlip, lineQuery);
    const queryActive = lineQuery.trim().length > 0;
    const highlightedIndex = billRows.length === 0 ? 0 : Math.min(highlight, billRows.length - 1);
    const totalAmount = slipTotal(slipLines, returnQuantities);
    const allOnSlip = returnable.length > 0 && returnable.every((line) => returnQuantities[line.id] === line.remaining);

    // The supplier's payable takes whatever the return is not paid back in; a
    // purchase with no supplier has none, so the strip must cover all of it.
    const hasSupplier = !!selectedPurchase?.supplier_id || !!selectedPurchase?.supplier;
    const partyDue: number | null = hasSupplier ? Number(selectedPurchase?.supplier?.due_balance ?? 0) : null;
    const refund = useReturnRefund({
        context: 'purchase_return',
        // The modal stays mounted while closed, so the open session is part of
        // the key: reopening the same purchase must not bring back what was
        // typed last time.
        docKey: isOpen ? selectedPurchase?.id ?? null : null,
        total: totalAmount,
        partyDue,
    });
    const received = refund.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const refundBalanced = hasSupplier
        ? received - totalAmount < 0.01
        : Math.abs(totalAmount - received) < 0.01;

    useEffect(() => {
        if (!pendingFocusId) return;
        const input = qtyRefs.current[pendingFocusId];
        if (!input) return;
        input.focus();
        input.select();
        setPendingFocusId(null);
    }, [pendingFocusId, returnQuantities]);

    const putOnSlip = (line: SlipLine, quantity: number, focusQty: boolean) => {
        setReturnQuantities((current) => setSlipQuantity(current, line, quantity));
        setQtyDraft((current) => {
            const next = { ...current };
            delete next[line.id];
            return next;
        });
        setPartialDraft((current) => {
            const next = { ...current };
            delete next[line.id];
            return next;
        });
        if (focusQty && quantity > 0) setPendingFocusId(line.id);
    };

    const handleLineSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (billRows.length === 0) return;
            setHighlight((current) => {
                const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
                return (next + billRows.length) % billRows.length;
            });
            return;
        }

        if (event.key !== 'Enter') return;
        event.preventDefault();

        const action = resolveLineEnter(slipLines, returnQuantities, lineQuery, highlightedIndex);
        if (action.type === 'none') return;

        setLineQuery('');
        setHighlight(0);
        if (action.type === 'scan' || action.type === 'add-full') {
            setReturnQuantities(action.quantities);
            setQtyDraft((current) => {
                const next = { ...current };
                delete next[action.lineId];
                return next;
            });
        }
        if (action.type === 'add-full' || action.type === 'focus') {
            setPendingFocusId(action.lineId);
        } else {
            searchRef.current?.focus();
        }
    };

    const handleVoiceReturn = (result: VoiceEntryResult) => {
        if (!selectedPurchase) return;

        const lines = slipLines.map((line) => ({
            id: line.id,
            productId: selectedPurchase.items.find((item) => item.id === line.id)?.product_id,
            productName: line.name,
        }));

        const { quantities, unmatched } = applyVoiceEntryReturnQuantities(
            result,
            lines,
            (lineId) => lineById.get(lineId)?.remaining ?? 0,
        );

        const applied = Object.keys(quantities).length;
        setReturnQuantities((prev) => {
            let next = { ...prev };
            for (const [lineId, quantity] of Object.entries(quantities)) {
                const line = lineById.get(lineId);
                if (!line) continue;
                next = setSlipQuantity(next, line, quantity);
            }
            return next;
        });
        if (result.note && !notes) setNotes(result.note);

        const messages = buildVoiceEntryMessages(
            { ...result, unmatched },
            applied,
            'Set return qty for',
        );
        setNotice(messages.join(' '));
    };

    const commitQty = (line: SlipLine, raw: string) => {
        setQtyDraft((current) => {
            const next = { ...current };
            delete next[line.id];
            return next;
        });
        if (raw.trim() === '') {
            setReturnQuantities((current) => setSlipQuantity(current, line, 0));
            return;
        }
        setReturnQuantities((current) => setSlipQuantity(current, line, Number(raw)));
    };

    const addPartial = (line: SlipLine) => {
        const raw = partialDraft[line.id];
        const quantity = raw == null || raw.trim() === '' ? line.remaining : Number(raw);
        putOnSlip(line, quantity, true);
    };

    const handleSubmit = async () => {
        if (!selectedPurchase) {
            setError(copy.selectPurchaseError);
            return;
        }

        const items = onSlip.map((line) => ({
            purchaseItemId: line.id,
            quantity: returnQuantities[line.id] || 0,
            warehouseId: showWarehouse ? lineWarehouses[line.id] || undefined : undefined,
        }));

        if (items.length === 0) {
            setError(copy.chooseLineError);
            return;
        }

        if (!refundBalanced) {
            setError(
                !hasSupplier && received < totalAmount
                    ? t.purchaseReturns.refund.needsSupplier
                    : 'The amount received is more than the return total.',
            );
            return;
        }

        setSubmitting(true);
        setError('');

        try {
            await api.createPurchaseReturn({
                storeId: selectedPurchase.store_id,
                purchaseId: selectedPurchase.id,
                referenceNumber: referenceNumber || undefined,
                notes: notes || undefined,
                warehouseId: showWarehouse ? warehouseId || undefined : undefined,
                items,
                payments: returnPaymentsPayload(refund.payments),
            });

            onSuccess();
            onClose();
        } catch (submitError: unknown) {
            const message = submitError instanceof Error ? submitError.message : copy.createFailed;
            setError(message || copy.createFailed);
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) {
        return null;
    }

    const highlightedId = queryActive ? billRows[highlightedIndex]?.id : undefined;

    return (
        <ModalShell size="xl" onBackdropClick={onClose}>
            <ModalHeader
                title={copy.title}
                subtitle={copy.subtitle}
                onClose={onClose}
            />

            <div className="space-y-4 overflow-y-auto p-4">
                {error && <Alert tone="danger">{error}</Alert>}
                {notice && !error && <Alert tone="info">{notice}</Alert>}

                {!selectedPurchase ? (
                    <div className="space-y-3">
                        <Field label={copy.searchPurchases} htmlFor="purchase-return-search">
                            <div className="relative">
                                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                <Input
                                    id="purchase-return-search"
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                    placeholder={copy.searchPlaceholder}
                                    className="w-full ps-8"
                                    autoFocus
                                />
                            </div>
                        </Field>

                        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
                            {loading ? (
                                <p className="p-6 text-center text-sm text-gray-500">{copy.loadingPurchases}</p>
                            ) : visiblePurchases.length === 0 ? (
                                <div className="flex flex-col items-center px-6 py-10 text-center">
                                    <Receipt className="mb-3 h-8 w-8 text-gray-300" />
                                    <p className="text-sm font-medium text-gray-700">
                                        {searchTerm.trim() ? copy.noMatches : copy.choosePurchase}
                                    </p>
                                    {!searchTerm.trim() && (
                                        <p className="mt-1 max-w-md text-sm text-gray-500">{copy.choosePurchaseHint}</p>
                                    )}
                                </div>
                            ) : (
                                <div className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
                                    {visiblePurchases.map((purchase) => (
                                        <button
                                            key={purchase.id}
                                            type="button"
                                            onClick={() => setSelectedPurchaseId(purchase.id)}
                                            className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-start hover:bg-gray-50 max-md:min-h-touch"
                                        >
                                            <span className="min-w-0">
                                                <span className="block text-sm font-semibold text-gray-900">
                                                    {purchase.purchase_number}
                                                </span>
                                                <span className="mt-0.5 block text-xs text-gray-500">
                                                    {purchase.supplier?.name || t.purchaseShared.unlinkedSupplier}
                                                    {' · '}
                                                    {formatDate(purchase.purchase_date || purchase.created_at, locale)}
                                                    {' · '}
                                                    {formatMessage(t.purchaseShared.itemsCount, { count: purchase.items.length }, locale)}
                                                </span>
                                            </span>
                                            <span className="shrink-0 text-sm font-medium text-gray-900">
                                                {formatBDT(Number(purchase.total_amount || 0), { locale })}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {!searchTerm.trim() && filteredPurchases.length > RECENT_LIMIT && (
                            <p className="text-xs text-gray-500">
                                {fmt(copy.showingRecent, { count: RECENT_LIMIT })}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900">
                                    {selectedPurchase.purchase_number}
                                    <span className="font-normal text-gray-500">
                                        {' · '}
                                        {selectedPurchase.supplier?.name || t.purchaseShared.unlinkedSupplier}
                                        {' · '}
                                        {formatDate(selectedPurchase.purchase_date || selectedPurchase.created_at, locale)}
                                        {' · '}
                                        {formatBDT(Number(selectedPurchase.total_amount || 0), { locale })}
                                    </span>
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                    {returnable.length === 0
                                        ? copy.nothingReturnable
                                        : fmt(copy.stillReturnable, {
                                            open: returnable.length,
                                            total: slipLines.length,
                                        })}
                                </p>
                            </div>
                            <Button variant="secondary" onClick={() => setSelectedPurchaseId(null)}>
                                {copy.changePurchase}
                            </Button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label={copy.referenceNumber} htmlFor="purchase-return-reference">
                                <Input
                                    id="purchase-return-reference"
                                    value={referenceNumber}
                                    onChange={(event) => setReferenceNumber(event.target.value)}
                                    placeholder={copy.referencePlaceholder}
                                    className="w-full"
                                />
                            </Field>
                            <Field label={t.common.notes} htmlFor="purchase-return-notes">
                                <Input
                                    id="purchase-return-notes"
                                    value={notes}
                                    onChange={(event) => setNotes(event.target.value)}
                                    placeholder={copy.notesPlaceholder}
                                    className="w-full"
                                />
                            </Field>
                            {showWarehouse && (
                                <Field label={t.common.warehouse}>
                                    <WarehouseSelect
                                        warehouses={warehouses}
                                        value={warehouseId}
                                        onChange={setWarehouseId}
                                        className={SELECT_CLASS}
                                    />
                                </Field>
                            )}
                        </div>

                        {returnable.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative min-w-[16rem] flex-1">
                                    <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                    <Input
                                        ref={searchRef}
                                        value={lineQuery}
                                        onChange={(event) => {
                                            setLineQuery(event.target.value);
                                            setHighlight(0);
                                        }}
                                        onKeyDown={handleLineSearchKey}
                                        placeholder={copy.lineSearchPlaceholder}
                                        aria-label={copy.lineSearchPlaceholder}
                                        className="w-full ps-8"
                                        autoFocus
                                    />
                                </div>
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setReturnQuantities((current) => returnAllRemaining(slipLines, current));
                                        setQtyDraft({});
                                        setLineQuery('');
                                    }}
                                    disabled={allOnSlip}
                                >
                                    {copy.returnAll}
                                </Button>
                                <VoiceEntryInput entryType="purchase_return" onResult={handleVoiceReturn} />
                            </div>
                        )}

                        <div className="overflow-hidden rounded-md border border-gray-200">
                            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
                                <h3 className="text-sm font-semibold text-gray-900">{copy.returning}</h3>
                                <p className="text-sm font-semibold text-gray-900">
                                    {formatBDT(totalAmount, { locale })}
                                </p>
                            </div>
                            {onSlip.length === 0 ? (
                                <p className="px-3 py-6 text-sm text-gray-500">
                                    {returnable.length === 0 ? copy.nothingReturnable : copy.slipEmpty}
                                </p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-gray-100 text-xs text-gray-500">
                                                <th className="p-2 text-start font-medium">{t.common.product}</th>
                                                {showWarehouse && (
                                                    <th className="w-40 p-2 text-start font-medium">{t.common.warehouse}</th>
                                                )}
                                                <th className="w-40 p-2 text-start font-medium">{copy.returnQty}</th>
                                                <th className="w-28 p-2 text-end font-medium">{t.purchaseShared.unitCost}</th>
                                                <th className="w-28 p-2 text-end font-medium">{t.purchaseShared.lineTotal}</th>
                                                <th className="w-12 p-2" />
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {onSlip.map((line) => {
                                                const quantity = returnQuantities[line.id] || 0;
                                                return (
                                                    <tr key={line.id}>
                                                        <td className="p-2">
                                                            <span className="text-sm font-medium text-gray-900">{line.name}</span>
                                                            {line.sku && (
                                                                <span className="ms-2 text-xs text-gray-400">{line.sku}</span>
                                                            )}
                                                        </td>
                                                        {showWarehouse && (
                                                            <td className="p-2">
                                                                <WarehouseSelect
                                                                    warehouses={warehouses}
                                                                    value={lineWarehouses[line.id] ?? ''}
                                                                    onChange={(lineWarehouseId) => setLineWarehouses((current) => ({
                                                                        ...current,
                                                                        [line.id]: lineWarehouseId,
                                                                    }))}
                                                                    perLine
                                                                    entryWarehouseName={entryWarehouseName}
                                                                    aria-label={`${t.common.warehouse} — ${line.name}`}
                                                                    className={SELECT_CLASS}
                                                                />
                                                            </td>
                                                        )}
                                                        <td className="p-2">
                                                            <div className="flex items-center gap-2">
                                                                <Input
                                                                    ref={(node) => {
                                                                        qtyRefs.current[line.id] = node;
                                                                    }}
                                                                    type="number"
                                                                    min={1}
                                                                    max={line.remaining}
                                                                    value={qtyDraft[line.id] ?? String(quantity)}
                                                                    aria-label={`${copy.returnQty} — ${line.name}`}
                                                                    onChange={(event) => {
                                                                        const raw = event.target.value;
                                                                        // An empty box stays on screen until blur, so a
                                                                        // selected quantity can be typed over. Any real
                                                                        // number is clamped onto the slip at once.
                                                                        if (raw.trim() === '' || !Number.isFinite(Number(raw))) {
                                                                            setQtyDraft((current) => ({ ...current, [line.id]: raw }));
                                                                            return;
                                                                        }
                                                                        setQtyDraft((current) => {
                                                                            const next = { ...current };
                                                                            delete next[line.id];
                                                                            return next;
                                                                        });
                                                                        setReturnQuantities((current) => setSlipQuantity(current, line, Number(raw)));
                                                                    }}
                                                                    onBlur={(event) => commitQty(line, event.target.value)}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key !== 'Enter') return;
                                                                        event.preventDefault();
                                                                        commitQty(line, event.currentTarget.value);
                                                                        searchRef.current?.focus();
                                                                    }}
                                                                    className="w-20 text-center"
                                                                />
                                                                <span className="whitespace-nowrap text-xs text-gray-500">
                                                                    {fmt(copy.ofLeft, { count: line.remaining })}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="p-2 text-end text-sm text-gray-700">
                                                            {formatBDT(line.unitCost, { locale })}
                                                        </td>
                                                        <td className="p-2 text-end text-sm font-medium text-gray-900">
                                                            {formatBDT(quantity * line.unitCost, { locale })}
                                                        </td>
                                                        <td className="p-2 text-end">
                                                            <Button
                                                                variant="ghost"
                                                                onClick={() => putOnSlip(line, 0, false)}
                                                                aria-label={fmt(copy.removeLine, { name: line.name })}
                                                            >
                                                                {t.common.remove}
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {(offSlip.length > 0 || queryActive) && returnable.length > 0 && (
                            <div className="space-y-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900">{copy.onThisBill}</h3>
                                    <p className="text-xs text-gray-500">{copy.billHint}</p>
                                </div>
                                {billRows.length === 0 ? (
                                    <p className="text-sm text-gray-500">
                                        {offSlip.length === 0 ? copy.alreadyOnReturn : copy.noLineMatches}
                                    </p>
                                ) : (
                                    <div className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                                        {billRows.map((line) => (
                                            <div
                                                key={line.id}
                                                className={`flex flex-wrap items-center gap-2 px-3 py-2 ${
                                                    highlightedId === line.id ? 'bg-blue-50' : ''
                                                }`}
                                            >
                                                <div className="min-w-[10rem] flex-1">
                                                    <p className="text-sm font-medium text-gray-900">
                                                        {line.name}
                                                        {line.sku && (
                                                            <span className="ms-2 text-xs font-normal text-gray-400">{line.sku}</span>
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {copy.purchased} {line.purchased}
                                                        {' · '}
                                                        {copy.remaining} {line.remaining}
                                                    </p>
                                                </div>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    max={line.remaining}
                                                    value={partialDraft[line.id] ?? ''}
                                                    placeholder={copy.partialQty}
                                                    aria-label={`${copy.partialQty} — ${line.name}`}
                                                    onChange={(event) => setPartialDraft((current) => ({
                                                        ...current,
                                                        [line.id]: event.target.value,
                                                    }))}
                                                    onKeyDown={(event) => {
                                                        if (event.key !== 'Enter') return;
                                                        event.preventDefault();
                                                        addPartial(line);
                                                    }}
                                                    className="w-28"
                                                />
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => addPartial(line)}
                                                    aria-label={`${partialDraft[line.id]?.trim() ? copy.addPartial : copy.addAllLeft} — ${line.name}`}
                                                >
                                                    {partialDraft[line.id]?.trim() ? copy.addPartial : copy.addAllLeft}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <PurchasePaymentSection
                            key={selectedPurchase.id}
                            context="purchase_return"
                            storeId={selectedPurchase.store_id}
                            payments={refund.payments}
                            total={totalAmount}
                            onPaymentChange={refund.onPaymentChange}
                            onLayoutReady={refund.onLayoutReady}
                            blockedReason={hasSupplier ? undefined : t.purchaseReturns.refund.needsSupplier}
                            labels={{
                                title: t.purchaseReturns.refund.title,
                                keepingDue: t.purchaseReturns.refund.keepingDue,
                            }}
                        />
                    </div>
                )}
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button
                    onClick={handleSubmit}
                    disabled={submitting || !selectedPurchase || !refund.ready || !refundBalanced}
                    loading={submitting}
                >
                    {submitting ? copy.creating : copy.createReturn}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
