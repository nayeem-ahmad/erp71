'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button, Field, Input, Select } from '@/components/ui';

/**
 * How a monthly salary becomes an hourly cost, for employees with no cost rate
 * of their own. Workspace-wide; changing it prices hours logged from then on,
 * never hours already priced.
 */
export default function ProjectCostingSettingsCard({ canEdit }: { canEdit: boolean }) {
    const { t } = useI18n();
    const f = t.projects.financials;
    const [hours, setHours] = useState('');
    const [overhead, setOverhead] = useState('');
    // The service product project invoices bill as (Phase C).
    const [billingProductId, setBillingProductId] = useState('');
    const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getProjectCostingSettings()
            .then((settings) => {
                setHours(String(settings.standardMonthlyHours));
                setOverhead(String(settings.overheadPct));
                setBillingProductId(settings.billingProductId ?? '');
                setLoaded(true);
            })
            .catch(() => setLoaded(false));
        api.getProjectBillingProducts().then((rows) => setProducts(rows ?? [])).catch(() => setProducts([]));
    }, []);

    const hoursValue = Number(hours);
    const overheadValue = Number(overhead);
    const valid = hoursValue >= 1 && hoursValue <= 744 && overheadValue >= 0 && overheadValue <= 500;

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        try {
            const saved = await api.updateProjectCostingSettings({
                standardMonthlyHours: hoursValue,
                overheadPct: overheadValue,
                billingProductId: billingProductId || null,
            });
            setHours(String(saved.standardMonthlyHours));
            setOverhead(String(saved.overheadPct));
            setBillingProductId(saved.billingProductId ?? '');
            toast.success(f.settingsSaved);
        } catch (err: any) {
            toast.error(err?.message || f.settingsFailed);
        } finally {
            setSaving(false);
        }
    };

    if (!loaded) return null;

    return (
        <section className="rounded-md border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-3 py-2">
                <h2 className="text-sm font-medium">{f.settingsTitle}</h2>
                <p className="mt-0.5 text-xs text-gray-500">{f.settingsHint}</p>
            </div>
            <form onSubmit={save} className="space-y-3 p-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label={f.standardHours} htmlFor="costing-hours">
                        <Input
                            id="costing-hours"
                            type="number"
                            min="1"
                            max="744"
                            step="0.5"
                            inputMode="decimal"
                            value={hours}
                            disabled={!canEdit}
                            onChange={(e) => setHours(e.target.value)}
                        />
                    </Field>
                    <Field label={f.overhead} htmlFor="costing-overhead">
                        <Input
                            id="costing-overhead"
                            type="number"
                            min="0"
                            max="500"
                            step="0.5"
                            inputMode="decimal"
                            value={overhead}
                            disabled={!canEdit}
                            onChange={(e) => setOverhead(e.target.value)}
                        />
                    </Field>
                    <Field label={f.billingProduct} htmlFor="costing-billing-product" hint={f.billingProductHint}>
                        <Select
                            id="costing-billing-product"
                            value={billingProductId}
                            disabled={!canEdit}
                            onChange={(e) => setBillingProductId(e.target.value)}
                            className="w-full"
                        >
                            <option value="">—</option>
                            {products.map((product) => (
                                <option key={product.id} value={product.id}>{product.name}</option>
                            ))}
                        </Select>
                    </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-gray-500">{f.snapshotNote}</p>
                    {canEdit && (
                        <Button type="submit" loading={saving} disabled={!valid} className="min-h-touch">
                            {f.save}
                        </Button>
                    )}
                </div>
            </form>
        </section>
    );
}
