'use client';

import { useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { api, type ProjectCostCategoryKey } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button, Field, Input } from '@/components/ui';

export const BUDGET_CATEGORIES: ProjectCostCategoryKey[] = ['LABOUR', 'MATERIAL', 'SERVICES', 'EXPENSE', 'OVERHEAD', 'OTHER'];

/**
 * Split the project's budget by category — project costing, Phase D.
 *
 * The project's budget becomes the total of these lines. A category left
 * empty has no budget of its own; clearing every line hands the budget back
 * to the single figure on the project form.
 */
export default function ProjectBudgetModal({
    projectId,
    current,
    onClose,
    onSaved,
}: {
    projectId: string;
    /** The lines as they stand: category → amount. */
    current: Partial<Record<ProjectCostCategoryKey, number>>;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useI18n();
    const f = t.projects.financials;
    const [values, setValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(BUDGET_CATEGORIES.map((category) => [category, current[category] ? String(current[category]) : ''])),
    );
    const [saving, setSaving] = useState(false);

    const amounts = BUDGET_CATEGORIES.map((category) => ({ category, amount: Number(values[category] || 0) }));
    const invalid = amounts.some((line) => !Number.isFinite(line.amount) || line.amount < 0);
    const total = amounts.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (invalid) return;
        setSaving(true);
        try {
            await api.setProjectBudget(projectId, amounts.filter((line) => line.amount > 0));
            toast.success(f.budgetSaved);
            onSaved();
        } catch (err: any) {
            toast.error(err?.message || f.budgetFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <form onSubmit={save} className="flex max-h-[90vh] flex-col overflow-hidden">
                <ModalHeader title={f.budgetModalTitle} onClose={onClose} />
                <div className="space-y-3 overflow-y-auto p-3 md:p-4">
                    <p className="text-xs text-gray-500">{f.budgetModalHint}</p>
                    {BUDGET_CATEGORIES.map((category) => (
                        <Field key={category} label={f.categories[category]} htmlFor={`budget-${category}`}>
                            <Input
                                id={`budget-${category}`}
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                value={values[category]}
                                onChange={(e) => setValues((prev) => ({ ...prev, [category]: e.target.value }))}
                            />
                        </Field>
                    ))}
                    <p className="flex items-center justify-between border-t border-gray-100 pt-2 text-sm">
                        <span className="text-gray-600">{f.budgetTotal}</span>
                        <span className="font-semibold text-gray-900">{formatBDT(total)}</span>
                    </p>
                </div>
                <ModalFooter>
                    <Button variant="secondary" type="button" onClick={onClose}>{t.common.cancel}</Button>
                    <Button type="submit" loading={saving} disabled={invalid}>{t.common.save}</Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
