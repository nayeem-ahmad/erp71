'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { CalendarClock, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { AccountingPageShell, CompactStat } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatBDT, formatDate } from '@/lib/format';
import { compactDensity } from '@/lib/ui/compact-density';

interface CapitalTxn {
    id: string;
    direction: 'CONTRIBUTION' | 'WITHDRAWAL';
    amount: string | number;
    txn_date: string;
    payment_method: string;
    reference?: string | null;
    notes?: string | null;
}

interface ProfitShare {
    id: string;
    share_pct_snapshot: string | number;
    amount: string | number;
    paid_amount: string | number;
    loss_applied: string | number;
    status: 'ACCRUED' | 'PAID';
    run: { id: string; year: number; month: number; status: string; profit_basis_amount: string | number };
}

interface Investor {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    national_id?: string | null;
    profit_share_pct: string | number;
    status: 'ACTIVE' | 'EXITED';
    joined_on: string;
    exited_on?: string | null;
    loss_carry_forward: string | number;
    notes?: string | null;
    capital_balance: number;
    profit_accrued: number;
    profit_paid: number;
    profit_outstanding: number;
    capitalTxns?: CapitalTxn[];
    profitShares?: ProfitShare[];
    store?: { id: string; name: string } | null;
}

interface InvestorSummary {
    activeCount: number;
    exitedCount: number;
    capitalInvested: number;
    totalSharePct: number;
    profitAccrued: number;
    profitPaid: number;
    profitOutstanding: number;
}

interface PreviewLine {
    investorId: string;
    name: string;
    sharePct: number;
    grossShare: number;
    amount: number;
    lossApplied: number;
    lossCarryForwardAfter: number;
}

interface RunPreview {
    year: number;
    month: number;
    profit_basis_amount: number;
    already_run: boolean;
    total_accrued: number;
    lines: PreviewLine[];
}

const PAYMENT_METHODS = ['CASH', 'BKASH', 'NAGAD', 'BANK'] as const;

const columnHelper = createColumnHelper<Investor>();

const today = () => new Date().toISOString().slice(0, 10);
const monthLabel = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** Default the run form to last month — the month you can actually close. */
const lastMonth = () => {
    const now = new Date();
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
};

export default function InvestorsPage() {
    const { t } = useI18n();
    const copy = t.investors;

    const [investors, setInvestors] = useState<Investor[]>([]);
    const [summary, setSummary] = useState<InvestorSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({
        name: '',
        phone: '',
        email: '',
        nationalId: '',
        profitSharePct: '',
        joinedOn: today(),
        notes: '',
    });

    const [detail, setDetail] = useState<Investor | null>(null);
    const [capitalForm, setCapitalForm] = useState({
        direction: 'CONTRIBUTION' as 'CONTRIBUTION' | 'WITHDRAWAL',
        amount: '',
        txnDate: today(),
        paymentMethod: 'CASH',
        reference: '',
    });
    const [savingCapital, setSavingCapital] = useState(false);

    const [showRun, setShowRun] = useState(false);
    const [runForm, setRunForm] = useState(lastMonth());
    const [preview, setPreview] = useState<RunPreview | null>(null);
    const [runBusy, setRunBusy] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const [list, stats] = await Promise.all([
                api.getInvestors({ status: statusFilter || undefined }),
                api.getInvestorSummary(),
            ]);
            setInvestors(list ?? []);
            setSummary(stats ?? null);
        } catch (error) {
            console.error('Failed to load investors', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, [statusFilter]);

    const openCreate = () => {
        setEditingId(null);
        setForm({
            name: '',
            phone: '',
            email: '',
            nationalId: '',
            profitSharePct: '',
            joinedOn: today(),
            notes: '',
        });
        setShowForm(true);
    };

    const openEdit = (investor: Investor) => {
        setEditingId(investor.id);
        setForm({
            name: investor.name,
            phone: investor.phone ?? '',
            email: investor.email ?? '',
            nationalId: investor.national_id ?? '',
            profitSharePct: String(investor.profit_share_pct),
            joinedOn: investor.joined_on.slice(0, 10),
            notes: investor.notes ?? '',
        });
        setShowForm(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || !form.profitSharePct) {
            setToast({ type: 'error', message: copy.nameRequired });
            return;
        }
        setSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                phone: form.phone.trim() || undefined,
                email: form.email.trim() || undefined,
                nationalId: form.nationalId.trim() || undefined,
                profitSharePct: Number(form.profitSharePct),
                joinedOn: form.joinedOn,
                notes: form.notes.trim() || undefined,
            };
            if (editingId) {
                await api.updateInvestor(editingId, payload);
            } else {
                await api.createInvestor(payload);
            }
            setToast({ type: 'success', message: copy.investorSaved });
            setShowForm(false);
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (investor: Investor) => {
        if (!globalThis.confirm(copy.deleteConfirm)) return;
        try {
            await api.deleteInvestor(investor.id);
            setToast({ type: 'success', message: copy.investorDeleted });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const openDetail = async (investor: Investor) => {
        try {
            setDetail(await api.getInvestor(investor.id));
            setCapitalForm({
                direction: 'CONTRIBUTION',
                amount: '',
                txnDate: today(),
                paymentMethod: 'CASH',
                reference: '',
            });
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const handleAddCapital = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!detail || !capitalForm.amount) return;
        setSavingCapital(true);
        try {
            const updated = await api.addInvestorCapital(detail.id, {
                direction: capitalForm.direction,
                amount: Number(capitalForm.amount),
                txnDate: capitalForm.txnDate,
                paymentMethod: capitalForm.paymentMethod,
                reference: capitalForm.reference.trim() || undefined,
            });
            setDetail(updated);
            setCapitalForm((f) => ({ ...f, amount: '', reference: '' }));
            setToast({ type: 'success', message: copy.capitalSaved });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setSavingCapital(false);
        }
    };

    const handleDeleteCapital = async (txnId: string) => {
        if (!detail) return;
        try {
            setDetail(await api.deleteInvestorCapital(detail.id, txnId));
            setToast({ type: 'success', message: copy.capitalDeleted });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const handlePayShare = async (shareId: string) => {
        if (!detail) return;
        try {
            setDetail(await api.payInvestorProfitShare(shareId, { paymentDate: today(), paymentMethod: 'CASH' }));
            setToast({ type: 'success', message: copy.sharePaid });
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        }
    };

    const openRun = () => {
        setRunForm(lastMonth());
        setPreview(null);
        setShowRun(true);
    };

    const handlePreview = async () => {
        setRunBusy(true);
        try {
            setPreview(await api.previewInvestorProfitRun({ year: runForm.year, month: runForm.month }));
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setRunBusy(false);
        }
    };

    const handleConfirmRun = async () => {
        setRunBusy(true);
        try {
            await api.createInvestorProfitRun({ year: runForm.year, month: runForm.month });
            setToast({ type: 'success', message: copy.runCreated });
            setShowRun(false);
            await loadData();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.common.error });
        } finally {
            setRunBusy(false);
        }
    };

    const columns: ColumnDef<Investor, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: copy.name,
                cell: (info) => (
                    <button
                        type="button"
                        onClick={() => openDetail(info.row.original)}
                        className="text-sm font-bold text-primary hover:underline text-start"
                    >
                        {info.getValue()}
                    </button>
                ),
                size: 180,
            }),
            columnHelper.accessor('profit_share_pct', {
                header: copy.sharePct,
                cell: (info) => (
                    <span className="text-sm font-semibold text-gray-700">{Number(info.getValue()).toFixed(2)}%</span>
                ),
                size: 110,
            }),
            columnHelper.accessor('capital_balance', {
                header: copy.capitalBalance,
                cell: (info) => <span className="text-sm text-gray-700">{formatBDT(Number(info.getValue() || 0))}</span>,
                size: 130,
            }),
            columnHelper.accessor('profit_accrued', {
                header: copy.profitAccrued,
                cell: (info) => <span className="text-sm text-gray-500">{formatBDT(Number(info.getValue() || 0))}</span>,
                size: 130,
            }),
            columnHelper.accessor('profit_outstanding', {
                header: copy.profitOutstanding,
                cell: (info) => (
                    <span className="text-sm font-bold text-amber-700">{formatBDT(Number(info.getValue() || 0))}</span>
                ),
                size: 130,
            }),
            columnHelper.accessor('joined_on', {
                header: copy.joinedOn,
                cell: (info) => <span className="text-sm text-gray-500">{formatDate(info.getValue() as string)}</span>,
                size: 110,
            }),
            columnHelper.accessor('status', {
                header: copy.status,
                cell: (info) => (
                    <span
                        className={`text-[10px] font-semibold ${info.getValue() === 'EXITED' ? 'text-gray-400' : 'text-primary'}`}
                    >
                        {info.getValue() === 'EXITED' ? copy.exited : copy.active}
                    </span>
                ),
                size: 90,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => openEdit(row.original)}
                            className="px-2 py-1 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100"
                        >
                            {t.common.edit}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDelete(row.original)}
                            className="p-2 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50"
                            title={t.common.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                size: 110,
            }),
        ],
        [t],
    );

    return (
        <AccountingPageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    copy.title,
                    'accounting',
                )}
                actions={(
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={openRun}
                            className={compactDensity.btnSecondary}
                        >
                            <CalendarClock className="w-3.5 h-3.5" />
                            {copy.runMonth}
                        </button>
                        <button
                            type="button"
                            onClick={openCreate}
                            className={`${compactDensity.btnPrimary} bg-primary text-white hover:bg-primary-hover`}
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {copy.addInvestor}
                        </button>
                    </div>
                )}
            />

            {toast && (
                <div
                    className={`rounded-lg px-3 py-2 text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-danger-light text-danger-text border border-red-200'}`}
                >
                    {toast.message}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <CompactStat label={copy.capitalInvested} value={formatBDT(summary?.capitalInvested ?? 0)} tone="info" />
                <CompactStat label={copy.profitOutstanding} value={formatBDT(summary?.profitOutstanding ?? 0)} tone="warning" />
                <CompactStat label={copy.profitPaid} value={formatBDT(summary?.profitPaid ?? 0)} tone="positive" />
                <CompactStat
                    label={copy.totalSharePct}
                    value={`${(summary?.totalSharePct ?? 0).toFixed(2)}%`}
                    tone="info"
                />
            </div>

            <div className={compactDensity.filterBar}>
                <label className="block">
                    <span className={`${compactDensity.formLabel} block mb-1`}>{copy.status}</span>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className={compactDensity.formField}
                    >
                        <option value="">{copy.allStatuses}</option>
                        <option value="ACTIVE">{copy.active}</option>
                        <option value="EXITED">{copy.exited}</option>
                    </select>
                </label>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin me-2" />
                    {t.common.loading}
                </div>
            ) : (
                <DataTable
                    tableId="investors"
                    title="Investors"
                    data={investors}
                    columns={columns}
                    searchPlaceholder={copy.searchInvestors}
                    emptyMessage={t.common.noData}
                />
            )}

            {showForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowForm(false)}>
                    <form onSubmit={handleSave} className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title={editingId ? copy.editInvestor : copy.addInvestor}
                            onClose={() => setShowForm(false)}
                        />
                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack} overflow-y-auto`}>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{copy.name}</span>
                                <input
                                    value={form.name}
                                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                    className={compactDensity.formField}
                                    required
                                />
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{copy.sharePct}</span>
                                    <input
                                        type="number"
                                        min="0.01"
                                        max="100"
                                        step="0.01"
                                        value={form.profitSharePct}
                                        onChange={(e) => setForm((f) => ({ ...f, profitSharePct: e.target.value }))}
                                        className={compactDensity.formField}
                                        required
                                    />
                                    <span className="text-[11px] text-gray-400">{copy.sharePctHint}</span>
                                </label>
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{copy.joinedOn}</span>
                                    <input
                                        type="date"
                                        value={form.joinedOn}
                                        onChange={(e) => setForm((f) => ({ ...f, joinedOn: e.target.value }))}
                                        className={compactDensity.formField}
                                        required
                                    />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{copy.phone}</span>
                                    <input
                                        value={form.phone}
                                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                                        className={compactDensity.formField}
                                    />
                                </label>
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{copy.nationalId}</span>
                                    <input
                                        value={form.nationalId}
                                        onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))}
                                        className={compactDensity.formField}
                                    />
                                </label>
                            </div>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{copy.email}</span>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                                    className={compactDensity.formField}
                                />
                            </label>
                            <label className="block">
                                <span className={`${compactDensity.formLabel} block mb-1`}>{copy.notes}</span>
                                <textarea
                                    value={form.notes}
                                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                    rows={2}
                                    className={compactDensity.formField}
                                />
                            </label>
                        </div>
                        <ModalFooter>
                            <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button variant="primary" type="submit" loading={saving}>
                                {t.common.save}
                            </Button>
                        </ModalFooter>
                    </form>
                </ModalShell>
            )}

            {showRun && (
                <ModalShell size="md" onBackdropClick={() => setShowRun(false)}>
                    <div className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader title={copy.runMonth} onClose={() => setShowRun(false)} />
                        <div className={`${compactDensity.modalPadding} space-y-4 overflow-y-auto`}>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{copy.year}</span>
                                    <input
                                        type="number"
                                        min="2000"
                                        max="2100"
                                        value={runForm.year}
                                        onChange={(e) => {
                                            setPreview(null);
                                            setRunForm((f) => ({ ...f, year: Number(e.target.value) }));
                                        }}
                                        className={compactDensity.formField}
                                    />
                                </label>
                                <label className="block">
                                    <span className={`${compactDensity.formLabel} block mb-1`}>{copy.month}</span>
                                    <select
                                        value={runForm.month}
                                        onChange={(e) => {
                                            setPreview(null);
                                            setRunForm((f) => ({ ...f, month: Number(e.target.value) }));
                                        }}
                                        className={compactDensity.formField}
                                    >
                                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                            <option key={m} value={m}>
                                                {monthLabel(runForm.year, m)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            {!preview ? (
                                <Button variant="secondary" type="button" onClick={handlePreview} loading={runBusy}>
                                    {copy.previewRun}
                                </Button>
                            ) : (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <CompactStat
                                            label={copy.profitBasis}
                                            value={formatBDT(preview.profit_basis_amount)}
                                            tone={preview.profit_basis_amount < 0 ? 'negative' : 'positive'}
                                        />
                                        <CompactStat label={copy.totalAccrued} value={formatBDT(preview.total_accrued)} />
                                    </div>

                                    {preview.already_run && (
                                        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                            {copy.alreadyRun}
                                        </p>
                                    )}

                                    <div className="space-y-2">
                                        {preview.lines.map((line) => (
                                            <div
                                                key={line.investorId}
                                                className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2"
                                            >
                                                <div>
                                                    <p className="text-sm font-bold text-gray-700">{line.name}</p>
                                                    <p className="text-[11px] text-gray-400">
                                                        {line.sharePct.toFixed(2)}%
                                                        {line.lossCarryForwardAfter > 0
                                                            ? ` • ${copy.lossCarryForward}: ${formatBDT(line.lossCarryForwardAfter)}`
                                                            : ''}
                                                    </p>
                                                </div>
                                                <p className="text-sm font-bold text-gray-700">{formatBDT(line.amount)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <ModalFooter>
                            <Button variant="secondary" type="button" onClick={() => setShowRun(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                variant="primary"
                                type="button"
                                disabled={!preview || preview.already_run}
                                loading={runBusy}
                                onClick={handleConfirmRun}
                            >
                                {copy.confirmRun}
                            </Button>
                        </ModalFooter>
                    </div>
                </ModalShell>
            )}

            {detail && (
                <ModalShell size="md" onBackdropClick={() => setDetail(null)}>
                    <div className="flex max-h-[90vh] flex-col overflow-hidden">
                        <ModalHeader
                            title={(
                                <span className="inline-flex items-center gap-2">
                                    <Users className="w-4 h-4 text-primary" />
                                    {detail.name}
                                </span>
                            )}
                            subtitle={`${Number(detail.profit_share_pct).toFixed(2)}% • ${detail.status === 'EXITED' ? copy.exited : copy.active}`}
                            onClose={() => setDetail(null)}
                        />
                        <div className={`${compactDensity.modalPadding} space-y-4 overflow-y-auto`}>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <CompactStat label={copy.capitalBalance} value={formatBDT(detail.capital_balance)} />
                                <CompactStat label={copy.profitPaid} value={formatBDT(detail.profit_paid)} tone="positive" />
                                <CompactStat
                                    label={copy.profitOutstanding}
                                    value={formatBDT(detail.profit_outstanding)}
                                    tone="warning"
                                />
                            </div>

                            {Number(detail.loss_carry_forward) > 0 && (
                                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                    {copy.lossCarryForward}: {formatBDT(Number(detail.loss_carry_forward))} — {copy.lossCarryForwardHint}
                                </p>
                            )}

                            <h3 className="text-sm font-semibold text-gray-500">{copy.profitShares}</h3>
                            {detail.profitShares && detail.profitShares.length > 0 ? (
                                <div className="space-y-2">
                                    {detail.profitShares.map((share) => (
                                        <div
                                            key={share.id}
                                            className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2"
                                        >
                                            <div>
                                                <p className="text-sm font-bold text-gray-700">
                                                    {formatBDT(Number(share.amount))}
                                                </p>
                                                <p className="text-[11px] text-gray-400">
                                                    {monthLabel(share.run.year, share.run.month)} •{' '}
                                                    {Number(share.share_pct_snapshot).toFixed(2)}%
                                                </p>
                                            </div>
                                            {share.status === 'PAID' ? (
                                                <span className="text-[10px] font-semibold text-emerald-700">{copy.paid}</span>
                                            ) : Number(share.amount) > 0 ? (
                                                <button
                                                    type="button"
                                                    onClick={() => handlePayShare(share.id)}
                                                    className="text-xs font-bold text-primary hover:underline"
                                                >
                                                    {copy.pay}
                                                </button>
                                            ) : (
                                                <span className="text-[10px] font-semibold text-gray-400">—</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400">{copy.noShares}</p>
                            )}

                            <h3 className="text-sm font-semibold text-gray-500">{copy.capital}</h3>
                            {detail.capitalTxns && detail.capitalTxns.length > 0 ? (
                                <div className="space-y-2">
                                    {detail.capitalTxns.map((txn) => (
                                        <div
                                            key={txn.id}
                                            className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2"
                                        >
                                            <div>
                                                <p
                                                    className={`text-sm font-bold ${txn.direction === 'WITHDRAWAL' ? 'text-amber-700' : 'text-gray-700'}`}
                                                >
                                                    {txn.direction === 'WITHDRAWAL' ? '−' : '+'}
                                                    {formatBDT(Number(txn.amount))}
                                                </p>
                                                <p className="text-[11px] text-gray-400">
                                                    {formatDate(txn.txn_date)} • {txn.payment_method}
                                                    {txn.reference ? ` • ${txn.reference}` : ''}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteCapital(txn.id)}
                                                className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400">{copy.noCapital}</p>
                            )}

                            <form onSubmit={handleAddCapital} className={`${compactDensity.cardFlat} space-y-2`}>
                                <p className={compactDensity.sectionLabel}>{copy.addCapital}</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {(['CONTRIBUTION', 'WITHDRAWAL'] as const).map((dir) => (
                                        <button
                                            type="button"
                                            key={dir}
                                            onClick={() => setCapitalForm((f) => ({ ...f, direction: dir }))}
                                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${capitalForm.direction === dir ? 'border-primary bg-primary-light text-primary' : 'border-gray-200 text-gray-500'}`}
                                        >
                                            {dir === 'CONTRIBUTION' ? copy.contribution : copy.withdrawal}
                                        </button>
                                    ))}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        value={capitalForm.amount}
                                        onChange={(e) => setCapitalForm((f) => ({ ...f, amount: e.target.value }))}
                                        placeholder={copy.capitalAmount}
                                        className={compactDensity.formField}
                                        required
                                    />
                                    <input
                                        type="date"
                                        value={capitalForm.txnDate}
                                        onChange={(e) => setCapitalForm((f) => ({ ...f, txnDate: e.target.value }))}
                                        className={compactDensity.formField}
                                        required
                                    />
                                    <select
                                        value={capitalForm.paymentMethod}
                                        onChange={(e) => setCapitalForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                                        className={compactDensity.formField}
                                    >
                                        {PAYMENT_METHODS.map((m) => (
                                            <option key={m} value={m}>
                                                {m}
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        value={capitalForm.reference}
                                        onChange={(e) => setCapitalForm((f) => ({ ...f, reference: e.target.value }))}
                                        placeholder={copy.reference}
                                        className={compactDensity.formField}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={savingCapital}
                                    className={`${compactDensity.btnPrimary} w-full bg-primary text-white hover:bg-primary-hover disabled:opacity-50`}
                                >
                                    {savingCapital ? t.common.loading : copy.addCapital}
                                </button>
                            </form>
                        </div>
                    </div>
                </ModalShell>
            )}
        </AccountingPageShell>
    );
}
