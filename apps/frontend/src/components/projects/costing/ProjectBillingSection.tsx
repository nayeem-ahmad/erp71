'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { api, type ProjectBilling } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { Alert, Button, Input, StatusBadge } from '@/components/ui';
import ProjectInvoiceModal, { type InvoiceRequest } from './ProjectInvoiceModal';

/**
 * Billing the customer, on the project's Financials.
 *
 * Fixed price bills by milestone (the milestones double as the billing plan
 * here, since they have no other screen) or by amount; time and materials
 * bills the unbilled billable hours at each person's rate. Every invoice is an
 * ordinary credit sale, listed below with a link to it.
 */
export default function ProjectBillingSection({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
    const { t, fmt } = useI18n();
    const f = t.projects.financials;
    const [data, setData] = useState<ProjectBilling | null>(null);
    const [upTo, setUpTo] = useState(() => new Date().toISOString().slice(0, 10));
    const [request, setRequest] = useState<InvoiceRequest | null>(null);
    const [milestone, setMilestone] = useState({ name: '', amount: '', targetDate: '' });
    const [rates, setRates] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await api.getProjectBilling(projectId, upTo));
        } catch {
            setData(null);
        }
    }, [projectId, upTo]);
    useEffect(() => { void load(); }, [load]);

    const changed = async () => {
        setRequest(null);
        await load();
        onChanged();
    };

    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await action();
            await changed();
        } catch (err: any) {
            toast.error(err?.message || f.invoiceFailed);
        } finally {
            setBusy(false);
        }
    };

    if (!data) return null;
    const { project } = data;

    return (
        <section className="overflow-hidden rounded-lg border border-gray-100 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-3 py-2">
                <div>
                    <h2 className="text-sm font-semibold text-gray-900">{f.billingTitle}</h2>
                    <p className="text-xs text-gray-500">
                        {f.billingTypes[project.billingType]}
                        {project.customer ? ` · ${project.customer.name}` : ''}
                        {project.billingType === 'FIXED_PRICE' && project.contractValue !== null
                            ? ` · ${fmt(f.contractOf, { amount: formatBDT(project.contractValue) })}`
                            : ''}
                        {project.billingType === 'TIME_AND_MATERIALS' && project.billRate !== null
                            ? ` · ${fmt(f.ratePerHour, { amount: formatBDT(project.billRate) })}`
                            : ''}
                    </p>
                </div>
                {project.billingType !== 'INTERNAL' && project.customer && (
                    <Button type="button" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => setRequest({ kind: 'AMOUNT' })}>
                        {f.invoiceAmount}
                    </Button>
                )}
            </div>

            <div className="space-y-4 p-3">
                {project.billingType === 'INTERNAL' && (
                    <p className="text-sm text-gray-500">
                        {f.notBilled}{' '}
                        <Link href={routes.projects.edit(projectId)} className="font-medium text-blue-600 hover:underline">
                            {t.projects.editProject}
                        </Link>
                    </p>
                )}
                {project.billingType !== 'INTERNAL' && !project.customer && (
                    <Alert tone="warning">
                        {f.needsCustomer}{' '}
                        <Link href={routes.projects.edit(projectId)} className="font-medium text-blue-600 hover:underline">
                            {t.projects.editProject}
                        </Link>
                    </Alert>
                )}

                {project.billingType === 'FIXED_PRICE' && (
                    <div className="space-y-2">
                        <h3 className="text-xs font-medium text-gray-600">{f.milestonesTitle}</h3>
                        {data.milestones.length === 0 ? (
                            <p className="text-sm text-gray-500">{f.noMilestones}</p>
                        ) : (
                            <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                                {data.milestones.map((row) => (
                                    <li key={row.id} className="flex min-h-touch flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                                        <span className="min-w-0 flex-1 truncate">
                                            {row.name}
                                            {row.targetDate && <span className="ms-2 text-xs text-gray-500">{row.targetDate}</span>}
                                        </span>
                                        <span className="w-28 text-end">{row.amount === null ? '—' : formatBDT(row.amount)}</span>
                                        {row.invoice ? (
                                            <Link href={routes.sales.detail(row.invoice.id)} className="text-xs font-medium text-blue-600 hover:underline">
                                                {row.invoice.serialNumber}
                                            </Link>
                                        ) : (
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                disabled={!project.customer || !row.amount}
                                                onClick={() => setRequest({ kind: 'MILESTONE', milestoneId: row.id, label: row.name, amount: row.amount ?? 0 })}
                                            >
                                                {f.invoice}
                                            </Button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <form
                            className="flex flex-col gap-2 md:flex-row"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!milestone.name.trim() || !(Number(milestone.amount) > 0)) return;
                                void run(async () => {
                                    await api.createProjectMilestone(projectId, {
                                        name: milestone.name.trim(),
                                        amount: Number(milestone.amount),
                                        ...(milestone.targetDate ? { targetDate: milestone.targetDate } : {}),
                                    });
                                    setMilestone({ name: '', amount: '', targetDate: '' });
                                });
                            }}
                        >
                            <Input
                                aria-label={f.milestoneName}
                                placeholder={f.milestoneName}
                                value={milestone.name}
                                maxLength={200}
                                onChange={(e) => setMilestone((prev) => ({ ...prev, name: e.target.value }))}
                            />
                            <Input
                                aria-label={f.amount}
                                placeholder={f.amount}
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={milestone.amount}
                                onChange={(e) => setMilestone((prev) => ({ ...prev, amount: e.target.value }))}
                                className="md:w-36"
                            />
                            <Input
                                aria-label={f.date}
                                type="date"
                                value={milestone.targetDate}
                                onChange={(e) => setMilestone((prev) => ({ ...prev, targetDate: e.target.value }))}
                                className="md:w-40"
                            />
                            <Button type="submit" variant="secondary" disabled={busy} icon={<Plus className="h-4 w-4" />}>
                                {f.addMilestone}
                            </Button>
                        </form>
                    </div>
                )}

                {project.billingType === 'TIME_AND_MATERIALS' && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <h3 className="text-xs font-medium text-gray-600">{f.unbilledTitle}</h3>
                            <label className="flex items-center gap-2 text-xs text-gray-600">
                                {f.upTo}
                                <Input type="date" value={upTo} onChange={(e) => setUpTo(e.target.value)} className="w-40" />
                            </label>
                        </div>
                        {data.unbilledHours.people.length === 0 ? (
                            <p className="text-sm text-gray-500">{f.noUnbilledHours}</p>
                        ) : (
                            <>
                                <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                                    {data.unbilledHours.people.map((row) => (
                                        <li key={row.key} className="flex min-h-touch flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                                            <span className="min-w-0 flex-1 truncate">{row.name}</span>
                                            <span className="text-xs text-gray-500">{row.hours} h</span>
                                            {row.memberId ? (
                                                <Input
                                                    aria-label={`${f.billRate} — ${row.name}`}
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    placeholder={project.billRate === null ? '' : String(project.billRate)}
                                                    value={rates[row.key] ?? (row.rateSource === 'MEMBER' && row.rate !== null ? String(row.rate) : '')}
                                                    onChange={(e) => setRates((prev) => ({ ...prev, [row.key]: e.target.value }))}
                                                    onBlur={() => {
                                                        const typed = rates[row.key];
                                                        if (typed === undefined) return;
                                                        void run(() => api.setProjectMemberBillRate(projectId, row.memberId!, typed === '' ? null : Number(typed)));
                                                    }}
                                                    className="w-28"
                                                />
                                            ) : (
                                                <span className="w-28 text-end text-xs text-gray-500">{row.rate === null ? '—' : formatBDT(row.rate)}</span>
                                            )}
                                            <span className="w-28 text-end">{row.rate === null ? '—' : formatBDT(row.amount)}</span>
                                        </li>
                                    ))}
                                </ul>
                                {data.unbilledHours.unratedHours > 0 && (
                                    <Alert tone="warning">{fmt(f.unratedHours, { hours: data.unbilledHours.unratedHours })}</Alert>
                                )}
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm text-gray-700">
                                        {fmt(f.unbilledTotal, { hours: data.unbilledHours.hours, amount: formatBDT(data.unbilledHours.amount) })}
                                    </p>
                                    <Button
                                        type="button"
                                        disabled={!project.customer || data.unbilledHours.unratedHours > 0 || data.unbilledHours.amount <= 0}
                                        onClick={() =>
                                            setRequest({
                                                kind: 'HOURS',
                                                upTo,
                                                label: fmt(f.unbilledTotal, { hours: data.unbilledHours.hours, amount: formatBDT(data.unbilledHours.amount) }),
                                                amount: data.unbilledHours.amount,
                                            })
                                        }
                                    >
                                        {f.invoiceHours}
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {data.invoices.length > 0 && (
                    <div className="space-y-1">
                        <h3 className="text-xs font-medium text-gray-600">{f.invoicesTitle}</h3>
                        <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                            {data.invoices.map((invoice) => (
                                <li key={invoice.id} className="flex min-h-touch flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                                    <Link href={routes.sales.detail(invoice.id)} className="font-medium text-blue-600 hover:underline">
                                        {invoice.serialNumber}
                                    </Link>
                                    <span className="text-xs text-gray-500">{invoice.date}</span>
                                    <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{invoice.note}</span>
                                    {invoice.status === 'CANCELLED' ? (
                                        <StatusBadge tone="neutral">{f.cancelled}</StatusBadge>
                                    ) : invoice.amountPaid >= invoice.totalAmount ? (
                                        <StatusBadge tone="success">{f.paid}</StatusBadge>
                                    ) : (
                                        <StatusBadge tone="warning">{f.due}</StatusBadge>
                                    )}
                                    <span className="w-28 text-end">{formatBDT(invoice.totalAmount)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {request && (
                <ProjectInvoiceModal
                    projectId={projectId}
                    request={request}
                    defaultProductId={data.billingProductId}
                    customerName={project.customer?.name ?? null}
                    onClose={() => setRequest(null)}
                    onSaved={changed}
                />
            )}
        </section>
    );
}
