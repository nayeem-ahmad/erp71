'use client';

import { useEffect, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { api, type ProjectCostCategoryKey, type ProjectCostSource } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button, Field, Input, Select } from '@/components/ui';

type DirectCategory = Exclude<ProjectCostCategoryKey, 'LABOUR'>;
const CATEGORIES: DirectCategory[] = ['SERVICES', 'MATERIAL', 'EXPENSE', 'OVERHEAD', 'OTHER'];

/**
 * A cost on the project beyond its hours: a share of a service bill — a
 * subcontractor's, a transporter's — or a cost with no document elsewhere.
 *
 * A bill line caps every share drawn from it, across projects and production
 * jobs, so the amount is checked against what is left on the line.
 */
export default function AddProjectCostModal({
    projectId,
    onClose,
    onSaved,
}: {
    projectId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t, fmt } = useI18n();
    const f = t.projects.financials;
    const [sources, setSources] = useState<ProjectCostSource[]>([]);
    const [sourceId, setSourceId] = useState('');
    const [category, setCategory] = useState<DirectCategory>('SERVICES');
    const [amount, setAmount] = useState('');
    const [costDate, setCostDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getProjectCostSources().then((rows) => setSources(rows ?? [])).catch(() => setSources([]));
    }, []);

    const source = sources.find((row) => row.id === sourceId) ?? null;
    const amountValue = Number(amount);
    const overdraws = source !== null && amountValue - source.remainingAmount > 0.005;
    const valid = amountValue > 0 && description.trim().length > 0 && Boolean(costDate) && !overdraws;

    const chooseSource = (id: string) => {
        setSourceId(id);
        const chosen = sources.find((row) => row.id === id);
        if (!chosen) return;
        // A bill line is bought-in services; offer what is left, the usual answer.
        setCategory('SERVICES');
        setAmount(String(chosen.remainingAmount));
        if (!description.trim()) setDescription([chosen.productName, chosen.supplierName].filter(Boolean).join(' · '));
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        try {
            await api.addProjectCost(projectId, {
                category,
                amount: amountValue,
                costDate,
                description: description.trim(),
                ...(sourceId ? { sourcePurchaseItemId: sourceId } : {}),
            });
            toast.success(f.costAdded);
            onSaved();
        } catch (err: any) {
            toast.error(err?.message || f.costFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <form onSubmit={save} className="flex max-h-[90vh] flex-col overflow-hidden">
                <ModalHeader title={f.addCost} onClose={onClose} />
                <div className="space-y-3 overflow-y-auto p-3 md:p-4">
                    {sources.length > 0 && (
                        <Field label={f.fromBill} htmlFor="cost-source">
                            <Select id="cost-source" value={sourceId} onChange={(e) => chooseSource(e.target.value)} className="w-full">
                                <option value="">{f.fromBillNone}</option>
                                {sources.map((row) => (
                                    <option key={row.id} value={row.id}>
                                        {[row.purchaseNumber, row.supplierName, row.productName].filter(Boolean).join(' · ')} — {formatBDT(row.remainingAmount)}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    )}
                    <Field label={f.category} htmlFor="cost-category">
                        <Select
                            id="cost-category"
                            value={category}
                            onChange={(e) => setCategory(e.target.value as DirectCategory)}
                            className="w-full"
                        >
                            {CATEGORIES.map((key) => (
                                <option key={key} value={key}>{f.categories[key]}</option>
                            ))}
                        </Select>
                    </Field>
                    <Field
                        label={f.amount}
                        htmlFor="cost-amount"
                        error={overdraws ? fmt(f.billRemaining, { amount: formatBDT(source!.remainingAmount) }) : undefined}
                        hint={source && !overdraws ? fmt(f.billRemaining, { amount: formatBDT(source.remainingAmount) }) : undefined}
                    >
                        <Input
                            id="cost-amount"
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                        />
                    </Field>
                    <Field label={f.date} htmlFor="cost-date">
                        <Input id="cost-date" type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} />
                    </Field>
                    <Field label={f.description} htmlFor="cost-description">
                        <Input
                            id="cost-description"
                            value={description}
                            maxLength={200}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </Field>
                </div>
                <ModalFooter>
                    <Button variant="secondary" type="button" onClick={onClose}>{t.common.cancel}</Button>
                    <Button type="submit" loading={saving} disabled={!valid}>{t.common.save}</Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
