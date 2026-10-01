'use client';

import { useEffect, useState } from 'react';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Alert, Button, Checkbox, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const SEARCH_DEBOUNCE_MS = 300;

type ProductHit = { id: string; name: string; sku?: string | null };

type MergePreview = {
    source: { id: string; name: string };
    target: { id: string; name: string };
    fields: Array<{ key: string; sourceValue: unknown; targetValue: unknown }>;
    stock: Array<{
        warehouseId: string;
        warehouseName: string;
        sourceQty: number;
        targetQty: number;
        combinedQty: number;
    }>;
    cost: { combined: { avgCost: number | null; qtyOnHand: number } };
    counts: { saleLines: number; purchaseLines: number };
    folds: Array<{ kind: string; parentLabel: string; note: string }>;
    blockers: Array<{ code: string; message: string }>;
};

type MergeProductModalProps = {
    isOpen: boolean;
    onClose: () => void;
    source: { id: string; name: string };
    onMerged: (result: {
        targetId: string;
        counts: { saleLines: number; purchaseLines: number };
        combinedStock: number;
    }) => void;
};

function formatFieldValue(value: unknown): string {
    if (value == null || value === '') return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map(formatFieldValue).filter(Boolean).join(', ');
    }
    try {
        return JSON.stringify(value);
    } catch {
        return '';
    }
}

export default function MergeProductModal({ isOpen, onClose, source, onMerged }: MergeProductModalProps) {
    const { t, fmt } = useI18n();
    const m = t.inventory.merge;

    const [search, setSearch] = useState('');
    const [hits, setHits] = useState<ProductHit[]>([]);
    const [preview, setPreview] = useState<MergePreview | null>(null);
    const [takeOn, setTakeOn] = useState<Record<string, boolean>>({});
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setSearch('');
        setHits([]);
        setPreview(null);
        setTakeOn({});
        setError('');
        setSubmitting(false);
    }, [isOpen, source.id]);

    useEffect(() => {
        if (!isOpen || preview) return;
        const term = search.trim();
        if (!term) {
            setHits([]);
            return;
        }
        let cancelled = false;
        const handle = setTimeout(async () => {
            try {
                const result = await api.getProductsPaged({ search: term, limit: 10 });
                if (cancelled) return;
                const items = (result.items ?? []).filter((p: ProductHit) => p.id !== source.id);
                setHits(items);
            } catch {
                if (!cancelled) setHits([]);
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [isOpen, search, source.id, preview]);

    if (!isOpen) return null;

    const fieldLabel = (key: string) =>
        (m.fields as Record<string, string | undefined>)[key] ?? key;

    const pickKeeper = async (targetId: string) => {
        setError('');
        try {
            const plan = (await api.previewProductMerge(source.id, targetId)) as MergePreview;
            setPreview(plan);
            setTakeOn(Object.fromEntries((plan.fields ?? []).map((field) => [field.key, false])));
            setHits([]);
            setSearch('');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.failed);
        }
    };

    const handleSubmit = async () => {
        if (!preview || preview.blockers.length > 0) return;
        const takeFields = Object.entries(takeOn)
            .filter(([, on]) => on)
            .map(([key]) => key);
        setSubmitting(true);
        setError('');
        try {
            const result = await api.mergeProduct(source.id, {
                targetId: preview.target.id,
                takeFields,
            });
            onMerged({
                targetId: result.targetId,
                counts: {
                    saleLines: result.counts.saleLines,
                    purchaseLines: result.counts.purchaseLines,
                },
                combinedStock: result.combinedStock,
            });
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.failed);
        } finally {
            setSubmitting(false);
        }
    };

    const blocked = (preview?.blockers.length ?? 0) > 0;
    const title = preview ? preview.target.name : m.pickTitle;
    const subtitle = preview
        ? fmt(m.absorbing, { name: preview.source.name })
        : m.pickHelper;

    return (
        <ModalShell size="md" onBackdropClick={submitting ? undefined : onClose}>
            <ModalHeader title={title} subtitle={subtitle} onClose={submitting ? undefined : onClose} />

            <div className="space-y-4 overflow-y-auto p-4">
                {error && (
                    <Alert tone="danger">{error}</Alert>
                )}

                {!preview && (
                    <>
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={m.searchPlaceholder}
                            className="w-full min-h-touch"
                            autoFocus
                        />
                        <div className="max-h-72 space-y-1 overflow-y-auto">
                            {hits.map((hit) => (
                                <button
                                    key={hit.id}
                                    type="button"
                                    onClick={() => void pickKeeper(hit.id)}
                                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-start hover:bg-gray-50 min-h-touch"
                                >
                                    <span className="block truncate text-sm font-semibold text-gray-900">{hit.name}</span>
                                    {hit.sku ? <span className="block truncate text-xs text-gray-500">{hit.sku}</span> : null}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {preview && (
                    <>
                        <Alert tone="warning">
                            {fmt(m.warning, {
                                name: preview.source.name,
                                sales: preview.counts.saleLines,
                                purchases: preview.counts.purchaseLines,
                            })}
                        </Alert>
                        <p className="text-xs text-gray-500">{m.cannotUndo}</p>
                        {preview.stock.map((row) => (
                            <p key={row.warehouseId} className="text-sm text-gray-800">
                                {fmt(m.stockLine, {
                                    target: row.targetQty,
                                    source: row.sourceQty,
                                    combined: row.combinedQty,
                                })}
                            </p>
                        ))}
                        <p className="text-sm text-gray-800">
                            {fmt(m.costLine, {
                                cost: preview.cost.combined.avgCost ?? '—',
                            })}
                        </p>
                        {preview.fields.length > 0 && (
                            <fieldset className="space-y-1.5">
                                <legend className="text-xs font-semibold text-gray-500">{m.copyHeading}</legend>
                                {preview.fields.map((field) => {
                                    const duplicateValue = formatFieldValue(field.sourceValue);
                                    return (
                                        <label
                                            key={field.key}
                                            className="flex items-center gap-2 text-sm text-gray-700 min-h-touch"
                                        >
                                            <Checkbox
                                                checked={!!takeOn[field.key]}
                                                onChange={(event) =>
                                                    setTakeOn((prev) => ({
                                                        ...prev,
                                                        [field.key]: event.target.checked,
                                                    }))
                                                }
                                            />
                                            <span>
                                                {fieldLabel(field.key)}
                                                {duplicateValue ? ` · ${duplicateValue}` : ''}
                                            </span>
                                        </label>
                                    );
                                })}
                            </fieldset>
                        )}
                        {preview.folds.length > 0 && (
                            <ul className="space-y-1 text-sm text-gray-600">
                                {preview.folds.map((fold, index) => (
                                    <li key={`${fold.kind}-${fold.parentLabel}-${index}`}>
                                        {fold.parentLabel}
                                        {fold.note ? ` — ${fold.note}` : ''}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {blocked && (
                            <Alert tone="danger">{preview.blockers[0].message}</Alert>
                        )}
                    </>
                )}
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>
                    {m.cancel}
                </Button>
                <Button
                    variant="danger"
                    size="md"
                    onClick={() => void handleSubmit()}
                    disabled={!preview || blocked || submitting}
                    loading={submitting}
                    className="min-h-touch"
                >
                    {m.submit}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
