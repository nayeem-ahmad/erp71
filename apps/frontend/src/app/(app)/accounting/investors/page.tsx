'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BadgePercent, CalendarClock, CircleCheck, Coins, Eye, Hourglass, Pencil, PiggyBank, Plus, Trash2, Users } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { tenantDateOnly, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { AccountingPageShell, CompactStat } from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { BranchFilter, Button, ConfirmDialog, StatusBadge } from '@/components/ui';
import { RowActions, RowActionButton } from '@/components/table';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
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
const STATUSES = ['ACTIVE', 'EXITED'] as const;

const columnHelper = createColumnHelper<Investor>();

/** Today on the workspace's calendar, not the UTC day. */
const today = () => tenantDateOnly();
const monthLabel = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** Default the run form to last month — the month you can actually close. */
const lastMonth = () => {
    const now = new Date();
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
};

export default function InvestorsPage() {
    const { t, locale } = useI18n();
    // Narrows the list and the totals; the monthly profit run is company-wide
    // and has no branch to pick.
    const branch = useBranchScope();
    const copy = t.investors;
    const ui = t.accountingFinanceUi.investors;
    const methodLabels = t.accountingFinanceUi.common.paymentMethods;

    const [investors, setInvestors] = useState<Investor[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statuses, setStatuses] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [joinedRange, setJoinedRange] = useState<CreatedRange | null>(null);
    const [capitalFilter, setCapitalFilter] = useState<NumberCondition | null>(null);
    const [unpaidFilter, setUnpaidFilter] = useState<NumberCondition | null>(null);
    const [shareFilter, setShareFilter] = useState<NumberCondition | null>(null);

    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
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

    const [deleteTarget, setDeleteTarget] = useState<Investor | null>(null);
    const [deleting, setDeleting] = useState(false);

    // The branch narrows what the server sends — every investor of it — so
    // the chips and the strip narrow the same rows here.
    const loadData = async () => {
        setLoading(true);
        try {
            const list = await api.getInvestors({ storeId: branch.apiStoreId });
            setInvestors(Array.isArray(list) ? list : []);
        } catch (error) {
            if (handleBranchForbidden(error, branch, t.dashboardLayout.branchFilterForbidden)) return;
            console.error('Failed to load investors', error);
            toast.error(error instanceof Error && error.message ? error.message : t.common.error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!branch.ready) return;
        void loadData();
    }, [branch.ready, branch.apiStoreId]);

    const openCreate = () => {
        setEditingId(null);
        setFormError('');
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
        setFormError('');
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
            setFormError(copy.nameRequired);
            return;
        }
        setFormError('');
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
            toast.success(copy.investorSaved);
            setShowForm(false);
            await loadData();
        } catch (error: any) {
            setFormError(error?.message || t.common.error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deleteInvestor(deleteTarget.id);
            toast.success(copy.investorDeleted);
            setDeleteTarget(null);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setDeleting(false);
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
            toast.error(error?.message || t.common.error);
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
            toast.success(copy.capitalSaved);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setSavingCapital(false);
        }
    };

    const handleDeleteCapital = async (txnId: string) => {
        if (!detail) return;
        try {
            setDetail(await api.deleteInvestorCapital(detail.id, txnId));
            toast.success(copy.capitalDeleted);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        }
    };

    const handlePayShare = async (shareId: string) => {
        if (!detail) return;
        try {
            setDetail(await api.payInvestorProfitShare(shareId, { paymentDate: today(), paymentMethod: 'CASH' }));
            toast.success(copy.sharePaid);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
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
            toast.error(error?.message || t.common.error);
        } finally {
            setRunBusy(false);
        }
    };

    const handleConfirmRun = async () => {
        setRunBusy(true);
        try {
            await api.createInvestorProfitRun({ year: runForm.year, month: runForm.month });
            toast.success(copy.runCreated);
            setShowRun(false);
            await loadData();
        } catch (error: any) {
            toast.error(error?.message || t.common.error);
        } finally {
            setRunBusy(false);
        }
    };

    const statusLabel = (status: string) => (status === 'EXITED' ? copy.exited : copy.active);
    const methodLabel = (method: string) => methodLabels[method as keyof typeof methodLabels] ?? method;

    const filtered = useMemo(
        () => investors.filter((investor) => {
            if (!matchesAnyOf(statuses, investor.status, statusExclude)) return false;
            if (!inDateRange(investor.joined_on, joinedRange)) return false;
            if (!matchesNumberCondition(Number(investor.capital_balance || 0), capitalFilter)) return false;
            if (!matchesNumberCondition(Number(investor.profit_outstanding || 0), unpaidFilter)) return false;
            if (!matchesNumberCondition(Number(investor.profit_share_pct || 0), shareFilter)) return false;
            return matchesSearch(
                search,
                investor.name,
                investor.phone,
                investor.email,
                investor.national_id,
                investor.notes,
                investor.store?.name,
            );
        }),
        [investors, statuses, statusExclude, joinedRange, capitalFilter, unpaidFilter, shareFilter, search],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'status',
                type: 'multi-select',
                label: copy.status,
                value: statuses,
                onChange: setStatuses,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: STATUSES.map((value) => ({ value, label: statusLabel(value) })),
            },
            {
                id: 'joinedOn',
                type: 'date-range',
                label: copy.joinedOn,
                value: joinedRange,
                onChange: setJoinedRange,
                operators: true,
            },
            {
                id: 'capital',
                type: 'number',
                label: copy.capitalBalance,
                value: capitalFilter,
                onChange: setCapitalFilter,
                money: true,
            },
            {
                id: 'unpaid',
                type: 'number',
                label: copy.profitOutstanding,
                value: unpaidFilter,
                onChange: setUnpaidFilter,
                money: true,
            },
            {
                id: 'share',
                type: 'number',
                label: copy.sharePct,
                value: shareFilter,
                onChange: setShareFilter,
                more: true,
            },
        ],
        [copy, statuses, statusExclude, joinedRange, capitalFilter, unpaidFilter, shareFilter],
    );

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const n = (value: number) => value.toLocaleString(locale);
        let capital = 0;
        let committed = 0;
        let declared = 0;
        let paid = 0;
        let unpaid = 0;
        let active = 0;
        for (const investor of filtered) {
            capital += Number(investor.capital_balance || 0);
            declared += Number(investor.profit_accrued || 0);
            paid += Number(investor.profit_paid || 0);
            unpaid += Number(investor.profit_outstanding || 0);
            if (investor.status !== 'EXITED') {
                active += 1;
                committed += Number(investor.profit_share_pct || 0);
            }
        }
        const items: ListStat[] = [
            {
                id: 'count',
                icon: <Users aria-hidden />,
                label: copy.title,
                value: n(filtered.length),
                hint: `${n(active)} ${copy.active.toLowerCase()}`,
            },
            { id: 'capital', icon: <PiggyBank aria-hidden />, label: copy.capitalInvested, value: money(capital) },
            {
                id: 'committed',
                icon: <BadgePercent aria-hidden />,
                label: copy.totalSharePct,
                value: `${committed.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
            },
            { id: 'declared', icon: <Coins aria-hidden />, label: copy.profitAccrued, value: money(declared) },
            { id: 'paid', icon: <CircleCheck aria-hidden />, label: copy.profitPaid, value: money(paid) },
            {
                id: 'unpaid',
                icon: <Hourglass aria-hidden />,
                label: copy.profitOutstanding,
                value: money(unpaid),
                tone: unpaid > 0 ? 'warning' : 'default',
            },
        ];
        return { items, loading, label: ui.statsLabel };
    }, [filtered, loading, locale, copy, ui]);

    const columns: ColumnDef<Investor, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: copy.name,
                cell: (info) => (
                    <button
                        type="button"
                        onClick={() => openDetail(info.row.original)}
                        className="text-primary hover:underline text-start"
                    >
                        {info.getValue()}
                    </button>
                ),
                size: 180,
            }),
            columnHelper.accessor((row) => Number(row.profit_share_pct || 0), {
                id: 'profit_share_pct',
                header: copy.sharePct,
                cell: (info) => `${info.getValue().toFixed(2)}%`,
                meta: { align: 'end' },
                size: 110,
            }),
            columnHelper.accessor((row) => Number(row.capital_balance || 0), {
                id: 'capital_balance',
                header: copy.capitalBalance,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end' },
                size: 130,
            }),
            columnHelper.accessor((row) => Number(row.profit_accrued || 0), {
                id: 'profit_accrued',
                header: copy.profitAccrued,
                cell: (info) => formatBDT(info.getValue(), { locale }),
                meta: { align: 'end', hideOnMobile: true },
                size: 130,
            }),
            columnHelper.accessor((row) => Number(row.profit_outstanding || 0), {
                id: 'profit_outstanding',
                header: copy.profitOutstanding,
                cell: (info) => (
                    <span className={info.getValue() > 0 ? 'text-amber-700' : undefined}>
                        {formatBDT(info.getValue(), { locale })}
                    </span>
                ),
                meta: { align: 'end' },
                size: 130,
            }),
            columnHelper.accessor('joined_on', {
                header: copy.joinedOn,
                cell: (info) => formatDate(info.getValue() as string, locale),
                sortingFn: 'datetime',
                meta: { hideOnMobile: true },
                size: 110,
            }),
            columnHelper.accessor('status', {
                header: copy.status,
                cell: (info) => (
                    info.getValue() === 'EXITED'
                        ? <StatusBadge tone="neutral">{copy.exited}</StatusBadge>
                        : <StatusBadge tone="success">{copy.active}</StatusBadge>
                ),
                size: 90,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: ({ row }) => (
                    <RowActions>
                        <RowActionButton icon={<Eye />} label={copy.viewDetails} onClick={() => void openDetail(row.original)} />
                        <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(row.original)} />
                        <RowActionButton
                            icon={<Trash2 />}
                            label={t.common.delete}
                            intent="danger"
                            onClick={() => setDeleteTarget(row.original)}
                        />
                    </RowActions>
                ),
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, copy, locale],
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
                    <>
                        <BranchFilter scope={branch} />
                        <Button variant="secondary" icon={<CalendarClock className="w-3.5 h-3.5" />} onClick={openRun}>
                            {copy.runMonth}
                        </Button>
                        <Button variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={openCreate}>
                            {copy.addInvestor}
                        </Button>
                    </>
                )}
            />

            <DataTable
                tableId="investors"
                title={copy.title}
                data={filtered}
                columns={columns}
                isLoading={loading}
                searchPlaceholder={copy.searchInvestors}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                emptyMessage={t.common.noData}
                emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
            />

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
                            {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}
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
                                                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                                            >
                                                <div>
                                                    <p className="text-sm font-semibold text-gray-700">{line.name}</p>
                                                    <p className="text-[11px] text-gray-400">
                                                        {line.sharePct.toFixed(2)}%
                                                        {line.lossCarryForwardAfter > 0
                                                            ? ` • ${copy.lossCarryForward}: ${formatBDT(line.lossCarryForwardAfter)}`
                                                            : ''}
                                                    </p>
                                                </div>
                                                <p className="text-sm font-semibold text-gray-700">{formatBDT(line.amount)}</p>
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
                                            className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                                        >
                                            <div>
                                                <p className="text-sm font-semibold text-gray-700">
                                                    {formatBDT(Number(share.amount))}
                                                </p>
                                                <p className="text-[11px] text-gray-400">
                                                    {monthLabel(share.run.year, share.run.month)} •{' '}
                                                    {Number(share.share_pct_snapshot).toFixed(2)}%
                                                </p>
                                            </div>
                                            {share.status === 'PAID' ? (
                                                <StatusBadge tone="success">{copy.paid}</StatusBadge>
                                            ) : Number(share.amount) > 0 ? (
                                                <button
                                                    type="button"
                                                    onClick={() => handlePayShare(share.id)}
                                                    className="text-xs font-semibold text-primary hover:underline"
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
                                            className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                                        >
                                            <div>
                                                <p
                                                    className={`text-sm font-semibold ${txn.direction === 'WITHDRAWAL' ? 'text-amber-700' : 'text-gray-700'}`}
                                                >
                                                    {txn.direction === 'WITHDRAWAL' ? '−' : '+'}
                                                    {formatBDT(Number(txn.amount))}
                                                </p>
                                                <p className="text-[11px] text-gray-400">
                                                    {formatDate(txn.txn_date, locale)} • {methodLabel(txn.payment_method)}
                                                    {txn.reference ? ` • ${txn.reference}` : ''}
                                                </p>
                                            </div>
                                            <RowActionButton
                                                icon={<Trash2 />}
                                                label={t.common.delete}
                                                intent="danger"
                                                onClick={() => void handleDeleteCapital(txn.id)}
                                            />
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
                                                {methodLabel(m)}
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
                                <Button variant="primary" type="submit" loading={savingCapital} className="w-full justify-center">
                                    {copy.addCapital}
                                </Button>
                            </form>
                        </div>
                    </div>
                </ModalShell>
            )}

            <ConfirmDialog
                open={deleteTarget !== null}
                title={ui.deleteTitle}
                prompt={copy.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => { if (!deleting) setDeleteTarget(null); }}
            />
        </AccountingPageShell>
    );
}
