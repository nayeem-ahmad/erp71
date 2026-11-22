'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { CHEQUE_STATUSES, type ChequeDirection, type ChequeStatus } from '@erp71/shared-types';
import {
    Button,
    CompactStat,
    ConfirmDialog,
    Input,
    PageHeader,
    PageShell,
    Select,
    SkeletonBar,
    StatusBadge,
    type StatusBadgeTone,
} from '@/components/ui';
import { Tabs } from '@/components/ui/compact/Tabs';
import { ChequeFormModal } from '@/components/tools/cheques/ChequeFormModal';
import { ChequePrintModal } from '@/components/tools/cheques/ChequePrintModal';
import { daysFromToday } from '@/components/tools/dates';
import type { Cheque, ChequeRegister } from '@/components/tools/types';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

type DirectionTab = 'all' | ChequeDirection;

const STATUS_TONE: Record<ChequeStatus, StatusBadgeTone> = {
    PENDING: 'warning',
    DEPOSITED: 'info',
    CLEARED: 'success',
    BOUNCED: 'danger',
    CANCELLED: 'neutral',
};

/**
 * Tools → Cheques: the register of cheques written and received, the
 * post-dated ones especially, with printing onto the bank's leaf.
 */
export default function ChequesPage() {
    const { t, fmt, locale } = useI18n();
    const m = t.tools.cheques;
    const [register, setRegister] = useState<ChequeRegister | null>(null);
    const [loading, setLoading] = useState(true);
    const [direction, setDirection] = useState<DirectionTab>('all');
    const [status, setStatus] = useState<'' | 'open' | ChequeStatus>('open');
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState<Cheque | null | 'new'>(null);
    const [printing, setPrinting] = useState<Cheque | null>(null);
    const [deleting, setDeleting] = useState<Cheque | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setRegister(
                await api.getCheques({
                    direction: direction === 'all' ? undefined : direction,
                    status: status || undefined,
                    search: search.trim() || undefined,
                }),
            );
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [direction, status, search, m.loadFailed]);

    useEffect(() => {
        const timer = setTimeout(() => void load(), search.trim() ? 300 : 0);
        return () => clearTimeout(timer);
    }, [load, search]);

    const changeStatus = async (cheque: Cheque, next: ChequeStatus) => {
        try {
            await api.updateCheque(cheque.id, { status: next });
            toast.success(fmt(m.statusUpdated, { status: m.status[next].toLowerCase() }));
            void load();
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
        }
    };

    const confirmDelete = async () => {
        if (!deleting) return;
        setBusy(true);
        try {
            await api.deleteCheque(deleting.id);
            toast.success(m.deleted);
            setDeleting(null);
            void load();
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const tally = (value: { count: number; amount: number } | undefined) =>
        fmt(m.countAmount, { count: value?.count ?? 0, amount: formatBDT(value?.amount ?? 0, { locale }) });

    const summary = register?.summary;
    const items = register?.items ?? [];
    const filtered = direction !== 'all' || status !== '' || search.trim() !== '';

    const dueLabel = (cheque: Cheque) => {
        if (cheque.status !== 'PENDING' && cheque.status !== 'DEPOSITED') return null;
        const days = daysFromToday(cheque.cheque_date);
        if (days === 0) return { text: m.dueToday, tone: 'warning' as const };
        if (days > 0 && days <= 7) return { text: fmt(m.dueIn, { days }), tone: 'info' as const };
        if (days < 0) return { text: fmt(m.overdue, { days: -days }), tone: 'danger' as const };
        return null;
    };

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
                actions={
                    <Button onClick={() => setEditing('new')}>
                        <Plus className="h-4 w-4" aria-hidden /> {m.newCheque}
                    </Button>
                }
            />

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <CompactStat label={m.issuedOpen} value={tally(summary?.issuedOpen)} />
                <CompactStat label={fmt(m.issuedDueSoon, { days: summary?.dueSoonDays ?? 7 })} value={tally(summary?.issuedDueSoon)} tone={summary?.issuedDueSoon.count ? 'warning' : 'default'} />
                <CompactStat label={m.receivedOpen} value={tally(summary?.receivedOpen)} />
                <CompactStat label={fmt(m.receivedDueSoon, { days: summary?.dueSoonDays ?? 7 })} value={tally(summary?.receivedDueSoon)} tone={summary?.receivedDueSoon.count ? 'warning' : 'default'} />
            </div>

            <div className="space-y-2 rounded-md border border-gray-200 bg-white">
                <Tabs<DirectionTab>
                    idPrefix="cheque-direction"
                    label={m.form.direction}
                    value={direction}
                    onChange={(next) => setDirection(next ?? 'all')}
                    tabs={[
                        { key: 'all', label: m.filterAll },
                        { key: 'ISSUED', label: m.direction.ISSUED },
                        { key: 'RECEIVED', label: m.direction.RECEIVED },
                    ]}
                />
                <div className="flex flex-col gap-2 px-3 pb-1 sm:flex-row">
                    <div className="relative flex-1">
                        <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={m.searchPlaceholder} aria-label={m.searchPlaceholder} className="w-full ps-8" />
                    </div>
                    <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={m.columns.status} className="sm:w-48">
                        <option value="open">{m.filterOpen}</option>
                        <option value="">{m.allStatuses}</option>
                        {CHEQUE_STATUSES.map((value) => (
                            <option key={value} value={value}>
                                {m.status[value]}
                            </option>
                        ))}
                    </Select>
                </div>

                {loading && !register ? (
                    <div className="space-y-2 p-3" aria-busy>
                        {[0, 1, 2].map((row) => (
                            <SkeletonBar key={row} className="h-8 w-full" />
                        ))}
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
                        <Banknote className="h-10 w-10 text-gray-200" aria-hidden />
                        <p className="text-sm text-gray-500">{filtered ? m.emptyFiltered : m.empty}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-y border-gray-100 bg-gray-50 text-xs text-gray-500">
                                <tr>
                                    <th className="hidden px-3 py-2 text-start font-medium sm:table-cell">{m.columns.date}</th>
                                    <th className="px-3 py-2 text-start font-medium">{m.columns.party}</th>
                                    <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{m.columns.number}</th>
                                    <th className="hidden px-3 py-2 text-start font-medium md:table-cell">{m.columns.bank}</th>
                                    <th className="px-3 py-2 text-end font-medium">{m.columns.amount}</th>
                                    <th className="hidden px-3 py-2 text-start font-medium sm:table-cell">{m.columns.status}</th>
                                    <th className="px-3 py-2 text-end font-medium">{m.columns.actions}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {items.map((cheque) => {
                                    const due = dueLabel(cheque);
                                    return (
                                        <tr key={cheque.id} className="align-top">
                                            <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">
                                                <div className="text-gray-900">{formatDate(cheque.cheque_date, locale)}</div>
                                                {due && <StatusBadge tone={due.tone} className="mt-0.5">{due.text}</StatusBadge>}
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="text-xs text-gray-500 sm:hidden">{formatDate(cheque.cheque_date, locale)}</div>
                                                <div className="font-medium text-gray-900">{cheque.party_name}</div>
                                                <div className="text-xs text-gray-500">
                                                    {m.direction[cheque.direction]}
                                                    <span className="md:hidden"> · {cheque.bank_name} {cheque.cheque_number}</span>
                                                </div>
                                                <div className="mt-0.5 flex flex-wrap gap-1 sm:hidden">
                                                    <StatusBadge tone={STATUS_TONE[cheque.status]}>{m.status[cheque.status]}</StatusBadge>
                                                    {due && <StatusBadge tone={due.tone}>{due.text}</StatusBadge>}
                                                </div>
                                            </td>
                                            <td className="hidden px-3 py-2 text-gray-700 md:table-cell">{cheque.cheque_number}</td>
                                            <td className="hidden px-3 py-2 text-gray-700 md:table-cell">
                                                {cheque.bank_name}
                                                {cheque.branch_name && <div className="text-xs text-gray-500">{cheque.branch_name}</div>}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-end font-medium tabular-nums text-gray-900">{formatBDT(cheque.amount, { locale })}</td>
                                            <td className="hidden px-3 py-2 sm:table-cell">
                                                <StatusBadge tone={STATUS_TONE[cheque.status]}>{m.status[cheque.status]}</StatusBadge>
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end">
                                                    {cheque.direction === 'ISSUED' && (
                                                        <Button variant="ghost" size="sm" onClick={() => setPrinting(cheque)} aria-label={m.actions.print} title={m.actions.print}>
                                                            <Printer className="h-4 w-4" aria-hidden />
                                                        </Button>
                                                    )}
                                                    <Select
                                                        value=""
                                                        onChange={(e) => e.target.value && void changeStatus(cheque, e.target.value as ChequeStatus)}
                                                        aria-label={m.actions.more}
                                                        className="hidden w-32 text-xs lg:block"
                                                    >
                                                        <option value="">{m.actions.more}</option>
                                                        {CHEQUE_STATUSES.filter((value) => value !== cheque.status).map((value) => (
                                                            <option key={value} value={value}>
                                                                {m.status[value]}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                    <Button variant="ghost" size="sm" onClick={() => setEditing(cheque)} aria-label={m.actions.edit} title={m.actions.edit}>
                                                        <Pencil className="h-4 w-4" aria-hidden />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => setDeleting(cheque)} aria-label={m.actions.delete} title={m.actions.delete}>
                                                        <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editing && (
                <ChequeFormModal
                    cheque={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        void load();
                    }}
                />
            )}
            {printing && <ChequePrintModal cheque={printing} onClose={() => setPrinting(null)} />}
            <ConfirmDialog
                open={!!deleting}
                title={m.deleteTitle}
                prompt={m.deletePrompt}
                confirmLabel={m.actions.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => setDeleting(null)}
            />
        </PageShell>
    );
}
