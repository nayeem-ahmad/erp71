'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, ConfirmDialog } from '@/components/ui';

type WriteOff = {
    id: string;
    payment_number: string | null;
    amount: number | string;
    notes: string | null;
    reason: string | null;
    created_at: string;
    accounting_voucher_number: string | null;
    customer: { id: string; name: string; phone: string | null } | null;
    creator: { id: string; name: string } | null;
};

/**
 * The bad-debt register: every customer debt this workspace has forgiven.
 *
 * Exists because a write-off is the one AR action with no document from the
 * other side — nothing arrives in the post to file against it — so the list of
 * them, with who entered each and why, IS the audit trail. It is also the only
 * place a write-off can be undone, which is how a debt that is paid after being
 * written off gets back onto the customer's ledger.
 */
export default function BadDebtsReportPage() {
    const { t } = useI18n();
    const m = t.customers.profile.writeOff;

    const [rows, setRows] = useState<WriteOff[]>([]);
    const [loading, setLoading] = useState(true);
    const [reversing, setReversing] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<WriteOff | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getCustomerWriteOffs();
            setRows(Array.isArray(data) ? data : []);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t.common.error);
        } finally {
            setLoading(false);
        }
    }, [t.common.error]);

    useEffect(() => { void load(); }, [load]);

    const handleReverse = async (writeOff: WriteOff) => {
        setReversing(writeOff.id);
        try {
            await api.reverseCustomerWriteOff(writeOff.id);
            toast.success(m.reversed);
            setConfirming(null);
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.reverseFailed);
        } finally {
            setReversing(null);
        }
    };

    const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);

    return (
        <PageShell>
            <PageHeader
                title={t.sales.hub.links.badDebts.title}
                subtitle={t.sales.hub.links.badDebts.description}
                actions={
                    <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
                        {t.common.refresh}
                    </Button>
                }
            />

            {!loading && rows.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800">{m.writtenOffTotal}</p>
                    <p className="text-xl font-bold text-amber-900">{formatBDT(total)}</p>
                </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
                <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50 text-start text-xs text-gray-500">
                        <tr>
                            <th className="p-3 font-semibold">{t.common.date}</th>
                            <th className="p-3 font-semibold">{t.customers.title}</th>
                            <th className="p-3 font-semibold">{m.reason}</th>
                            <th className="p-3 font-semibold hidden md:table-cell">{m.notes}</th>
                            <th className="p-3 font-semibold hidden md:table-cell">{t.customers.profile.by}</th>
                            <th className="p-3 text-end font-semibold">{t.common.amount}</th>
                            <th className="p-3 text-end font-semibold">{t.common.actions}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-xs text-gray-400">
                                    {t.common.loading}
                                </td>
                            </tr>
                        ) : rows.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-xs text-gray-400">
                                    {t.common.noData}
                                </td>
                            </tr>
                        ) : (
                            rows.map((row) => (
                                <tr key={row.id} className="border-b border-gray-50 last:border-0">
                                    <td className="p-3 whitespace-nowrap text-xs text-gray-600">
                                        <div>{formatDate(row.created_at)}</div>
                                        <div className="text-gray-400">{row.payment_number}</div>
                                    </td>
                                    <td className="p-3">
                                        {row.customer ? (
                                            <Link
                                                href={routes.sales.customerDetail(row.customer.id)}
                                                className="font-medium text-primary hover:underline"
                                            >
                                                {row.customer.name}
                                            </Link>
                                        ) : (
                                            <span className="text-gray-400">—</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-xs text-gray-600">
                                        {row.reason && row.reason in m.reasons
                                            ? m.reasons[row.reason as keyof typeof m.reasons]
                                            : '—'}
                                    </td>
                                    <td className="p-3 hidden md:table-cell text-xs text-gray-500">
                                        {row.notes ?? '—'}
                                    </td>
                                    <td className="p-3 hidden md:table-cell text-xs text-gray-500">
                                        <div>{row.creator?.name ?? '—'}</div>
                                        {row.accounting_voucher_number && (
                                            <div className="text-gray-400">{row.accounting_voucher_number}</div>
                                        )}
                                    </td>
                                    <td className="p-3 text-end font-semibold text-amber-800 whitespace-nowrap">
                                        {formatBDT(Number(row.amount))}
                                    </td>
                                    <td className="p-3 text-end">
                                        <Button
                                            variant="ghost"
                                            icon={<Undo2 className="h-4 w-4" />}
                                            onClick={() => setConfirming(row)}
                                            disabled={reversing === row.id}
                                        >
                                            {m.reverse}
                                        </Button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {confirming && (
                <ConfirmDialog
                    open
                    danger
                    title={m.reverse}
                    prompt={m.reverseConfirm}
                    confirmLabel={m.reverse}
                    cancelLabel={m.cancel}
                    loading={reversing === confirming.id}
                    onConfirm={() => void handleReverse(confirming)}
                    onCancel={() => setConfirming(null)}
                />
            )}
        </PageShell>
    );
}
