'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, type EmployeeCostRates } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button, Field, Input, StatusBadge } from '@/components/ui';

/**
 * What one hour of this employee costs, for pricing their project hours.
 *
 * Shown only where the salary is (VIEW_PAYROLL): an hourly cost is the salary
 * by another name. A rate is optional — without one, hours are priced from
 * the salary — and effective from its date, so adding one never re-prices
 * hours already logged.
 */
export default function EmployeeCostRateCard({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
    const { t, fmt } = useI18n();
    const c = t.employees.detail.costRate;
    const [data, setData] = useState<EmployeeCostRates | null>(null);
    const [hourlyCost, setHourlyCost] = useState('');
    const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        api.getEmployeeCostRates(employeeId).then(setData).catch(() => setData(null));
    }, [employeeId]);
    useEffect(() => { load(); }, [load]);

    const add = async (e: React.FormEvent) => {
        e.preventDefault();
        const amount = Number(hourlyCost);
        if (!(amount > 0) || !effectiveFrom) return;
        setBusy(true);
        try {
            await api.createEmployeeCostRate(employeeId, {
                hourlyCost: amount,
                effectiveFrom,
                ...(note.trim() ? { note: note.trim() } : {}),
            });
            toast.success(c.added);
            setHourlyCost('');
            setNote('');
            load();
        } catch (err: any) {
            toast.error(err?.message || c.failed);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (rateId: string) => {
        setBusy(true);
        try {
            await api.deleteEmployeeCostRate(employeeId, rateId);
            toast.success(c.removed);
            load();
        } catch (err: any) {
            toast.error(err?.message || c.failed);
        } finally {
            setBusy(false);
        }
    };

    if (!data) return null;

    return (
        <div className="space-y-3 rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
            <div>
                <h2 className="text-sm font-semibold text-gray-900">{c.title}</h2>
                <p className="text-xs text-gray-500">{c.hint}</p>
            </div>

            {data.current ? (
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-gray-900">
                        {fmt(c.current, { amount: formatBDT(data.current.hourlyCost) })}
                    </p>
                    <StatusBadge tone={data.current.source === 'RATE' ? 'info' : 'neutral'}>
                        {data.current.source === 'RATE' ? c.fromRate : c.fromSalary}
                    </StatusBadge>
                </div>
            ) : (
                <p className="text-sm text-amber-700">{c.none}</p>
            )}
            {data.current?.source === 'RATE' && data.derivedFromSalary !== null && (
                <p className="text-xs text-gray-500">{fmt(c.derived, { amount: formatBDT(data.derivedFromSalary) })}</p>
            )}

            <div className="space-y-1">
                <p className="text-xs font-medium text-gray-600">{c.history}</p>
                {data.rates.length === 0 ? (
                    <p className="text-xs text-gray-500">{c.noRates}</p>
                ) : (
                    <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                        {data.rates.map((rate) => (
                            <li key={rate.id} className="flex min-h-touch items-center justify-between gap-2 px-3 py-1.5 text-sm">
                                <span className="min-w-0 truncate">
                                    {formatBDT(rate.hourlyCost)}
                                    <span className="ms-2 text-xs text-gray-500">
                                        {c.effectiveFrom} {formatDate(rate.effectiveFrom)}
                                        {rate.note ? ` · ${rate.note}` : ''}
                                    </span>
                                </span>
                                {canEdit && (
                                    <button
                                        type="button"
                                        aria-label={c.remove}
                                        disabled={busy}
                                        onClick={() => remove(rate.id)}
                                        className="min-h-touch px-2 text-red-600 disabled:opacity-40"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {canEdit && (
                <form onSubmit={add} className="space-y-2 border-t border-gray-100 pt-3">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        <Field label={c.hourlyCost} htmlFor="cost-rate-amount">
                            <Input
                                id="cost-rate-amount"
                                type="number"
                                min="0.01"
                                step="0.01"
                                inputMode="decimal"
                                value={hourlyCost}
                                onChange={(e) => setHourlyCost(e.target.value)}
                            />
                        </Field>
                        <Field label={c.effectiveFrom} htmlFor="cost-rate-from">
                            <Input
                                id="cost-rate-from"
                                type="date"
                                value={effectiveFrom}
                                onChange={(e) => setEffectiveFrom(e.target.value)}
                            />
                        </Field>
                        <Field label={c.note} htmlFor="cost-rate-note">
                            <Input id="cost-rate-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                        </Field>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-gray-500">{c.futureOnly}</p>
                        <Button
                            type="submit"
                            variant="secondary"
                            loading={busy}
                            disabled={!(Number(hourlyCost) > 0)}
                            icon={<Plus className="h-4 w-4" />}
                        >
                            {c.add}
                        </Button>
                    </div>
                </form>
            )}
        </div>
    );
}
