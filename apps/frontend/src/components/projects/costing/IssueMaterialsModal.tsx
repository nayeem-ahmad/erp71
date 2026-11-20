'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { availableQtyOf } from '@/components/document-entry/ProductSearch';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Alert, Button, Field, Input, Select } from '@/components/ui';

type Line = { productId: string; name: string; quantity: string; product: any };

/**
 * Take goods out of a warehouse for the project.
 *
 * They leave at the average they were held at, which the server reads and
 * stores. Nothing posts to the ledger — stock was expensed when it was bought
 * — so this only moves stock and prices the project. Services hold no stock
 * and are left out of the search; they are added as a cost from their bill.
 */
export default function IssueMaterialsModal({
    projectId,
    onClose,
    onSaved,
}: {
    projectId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useI18n();
    const f = t.projects.financials;
    const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; is_active?: boolean }>>([]);
    const [warehouseId, setWarehouseId] = useState('');
    const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [note, setNote] = useState('');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [lines, setLines] = useState<Line[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getInventoryWarehouses()
            .then((rows: any) => {
                const list = (Array.isArray(rows) ? rows : rows?.items ?? []).filter((row: any) => row.is_active !== false);
                setWarehouses(list);
                if (list.length === 1) setWarehouseId(list[0].id);
            })
            .catch(() => setWarehouses([]));
    }, []);

    useEffect(() => {
        const term = query.trim();
        if (!term) {
            setResults([]);
            return;
        }
        const timer = setTimeout(() => {
            api.searchProductsByQuantity(term, 20)
                .then((rows: any[]) => setResults((rows ?? []).filter((row) => row.type !== 'SERVICE')))
                .catch(() => setResults([]));
        }, 300);
        return () => clearTimeout(timer);
    }, [query]);

    const addProduct = (product: any) => {
        setLines((prev) =>
            prev.some((line) => line.productId === product.id)
                ? prev
                : [...prev, { productId: product.id, name: product.name, quantity: '1', product }],
        );
        setQuery('');
        setResults([]);
    };

    const valid =
        Boolean(warehouseId)
        && Boolean(issueDate)
        && lines.length > 0
        && lines.every((line) => Number.isInteger(Number(line.quantity)) && Number(line.quantity) >= 1);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        try {
            await api.issueProjectMaterials(projectId, {
                warehouseId,
                issueDate,
                ...(note.trim() ? { note: note.trim() } : {}),
                items: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
            });
            toast.success(f.issued);
            onSaved();
        } catch (err: any) {
            toast.error(err?.message || f.issueFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <form onSubmit={save} className="flex max-h-[90vh] flex-col overflow-hidden">
                <ModalHeader title={f.issueMaterials} onClose={onClose} />
                <div className="space-y-3 overflow-y-auto p-3 md:p-4">
                    <Alert tone="info">{f.materialsNoPost}</Alert>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <Field label={f.warehouse} htmlFor="issue-warehouse">
                            <Select id="issue-warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full">
                                <option value="">—</option>
                                {warehouses.map((row) => (
                                    <option key={row.id} value={row.id}>{row.name}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={f.date} htmlFor="issue-date">
                            <Input id="issue-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                        </Field>
                    </div>

                    <Field label={f.addProduct} htmlFor="issue-search">
                        <Input
                            id="issue-search"
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoComplete="off"
                        />
                    </Field>
                    {results.length > 0 && (
                        <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-100">
                            {results.map((product) => (
                                <li key={product.id}>
                                    <button
                                        type="button"
                                        onClick={() => addProduct(product)}
                                        className="flex min-h-touch w-full items-center justify-between gap-2 px-3 py-1.5 text-start text-sm hover:bg-gray-50"
                                    >
                                        <span className="truncate">{product.name}</span>
                                        <span className="shrink-0 text-xs text-gray-500">{availableQtyOf(product, warehouseId || undefined)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {lines.length === 0 ? (
                        <p className="text-xs text-gray-500">{f.noLines}</p>
                    ) : (
                        <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                            {lines.map((line) => (
                                <li key={line.productId} className="flex min-h-touch items-center gap-2 px-3 py-1.5">
                                    <span className="min-w-0 flex-1 truncate text-sm">{line.name}</span>
                                    <span className="hidden text-xs text-gray-500 md:inline">
                                        {availableQtyOf(line.product, warehouseId || undefined)}
                                    </span>
                                    <Input
                                        type="number"
                                        min="1"
                                        step="1"
                                        inputMode="numeric"
                                        aria-label={`${f.quantity} — ${line.name}`}
                                        value={line.quantity}
                                        onChange={(e) =>
                                            setLines((prev) =>
                                                prev.map((row) => (row.productId === line.productId ? { ...row, quantity: e.target.value } : row)),
                                            )
                                        }
                                        className="w-20"
                                    />
                                    <button
                                        type="button"
                                        aria-label={t.common.delete}
                                        onClick={() => setLines((prev) => prev.filter((row) => row.productId !== line.productId))}
                                        className="min-h-touch px-2 text-red-600"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    <Field label={f.note} htmlFor="issue-note">
                        <Input id="issue-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                </div>
                <ModalFooter>
                    <Button variant="secondary" type="button" onClick={onClose}>{t.common.cancel}</Button>
                    <Button type="submit" loading={saving} disabled={!valid}>{f.issueMaterials}</Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
