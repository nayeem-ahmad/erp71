'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Gift,
    Search,
    ChevronDown,
    ChevronRight,
    Loader2,
    Plus,
    Minus,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { toast } from '@/lib/toast';

interface LoyaltyCustomer {
    id: string;
    name: string;
    phone: string;
    loyalty_points: number;
    last_transaction_at: string | null;
}

interface LoyaltyTransaction {
    id: string;
    type: string;
    points: number;
    description: string | null;
    created_at: string;
}

interface CustomerDetail {
    id: string;
    name: string;
    phone: string;
    loyalty_points: number;
    transactions: LoyaltyTransaction[];
}

function AdjustPointsModal({
    customer,
    onClose,
    onSuccess,
}: {
    customer: LoyaltyCustomer;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const { t } = useI18n();
    const [points, setPoints] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const pts = parseInt(points, 10);
        if (isNaN(pts) || pts === 0) {
            setError(t.shared.form.nonZeroPoints);
            return;
        }
        setSaving(true);
        setError('');
        try {
            await fetchWithAuth(`/loyalty/customers/${customer.id}/adjust`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: pts, description: description || undefined }),
            });
            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err?.message || t.shared.errors.adjustPoints);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
                <ModalHeader
                    title={t.loyalty.adjustPoints}
                    subtitle={
                        <>
                            {customer.name} &bull; {t.loyalty.currentBalance}{' '}
                            <span className="font-bold text-purple-700">{customer.loyalty_points} {t.loyalty.pointsSuffix}</span>
                        </>
                    }
                    onClose={onClose}
                />

                <div className="p-6 space-y-4 overflow-y-auto">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                            {t.loyalty.pointsAdjustment}
                        </label>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    const v = parseInt(points || '0', 10);
                                    if (!isNaN(v) && v > 0) setPoints(String(-v));
                                    else if (!isNaN(v)) setPoints(String(Math.abs(v)));
                                }}
                                className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                            >
                                <Plus className="w-3 h-3" />/<Minus className="w-3 h-3" />
                            </button>
                            <input
                                type="number"
                                value={points}
                                onChange={(e) => setPoints(e.target.value)}
                                placeholder={t.shared.form.pointsPlaceholder}
                                className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                            />
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                            {t.shared.form.pointsHint}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                            {t.shared.form.descriptionOptional}
                        </label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t.shared.form.reasonOptional}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                        />
                    </div>

                    {error && (
                        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
                            {error}
                        </div>
                    )}
                </div>

                <ModalFooter>
                    <Button type="button" variant="secondary" size="md" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="md" loading={saving}>
                        {saving ? t.loyalty.saving : t.loyalty.adjustPointsButton}
                    </Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}

function TransactionTypeBadge({ type }: { type: string }) {
    const styles: Record<string, string> = {
        EARN: 'bg-green-50 text-green-700 border-green-200',
        REDEEM: 'bg-blue-50 text-blue-700 border-blue-200',
        ADJUST: 'bg-amber-50 text-amber-700 border-amber-200',
    };
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                styles[type] ?? 'bg-gray-50 text-gray-600 border-gray-200'
            }`}
        >
            {type}
        </span>
    );
}

export default function LoyaltyPage() {
    const { t, locale } = useI18n();
    const [customers, setCustomers] = useState<LoyaltyCustomer[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [detailMap, setDetailMap] = useState<Record<string, CustomerDetail>>({});
    const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
    const [adjustCustomer, setAdjustCustomer] = useState<LoyaltyCustomer | null>(null);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 350);
        return () => clearTimeout(t);
    }, [search]);

    const loadCustomers = useCallback(async () => {
        setLoading(true);
        try {
            const params = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : '';
            const data = (await fetchWithAuth(`/loyalty/customers${params}`)) as LoyaltyCustomer[];
            setCustomers(data);
        } catch (err: any) {
            toast.error(err?.message || t.shared.errors.loadCustomers);
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch]);

    useEffect(() => {
        loadCustomers();
    }, [loadCustomers]);

    const toggleExpand = async (customer: LoyaltyCustomer) => {
        if (expandedId === customer.id) {
            setExpandedId(null);
            return;
        }
        setExpandedId(customer.id);
        if (detailMap[customer.id]) return;

        setLoadingDetail(customer.id);
        try {
            const detail = (await fetchWithAuth(
                `/loyalty/customers/${customer.id}/points`,
            )) as CustomerDetail;
            setDetailMap((prev) => ({ ...prev, [customer.id]: detail }));
        } catch (err: any) {
            toast.error(err?.message || t.shared.errors.loadTransactions);
        } finally {
            setLoadingDetail(null);
        }
    };

    const handleAdjustSuccess = () => {
        toast.success(t.shared.success.pointsAdjusted);
        // Refresh list and clear cached detail for the customer
        if (adjustCustomer) {
            setDetailMap((prev) => {
                const next = { ...prev };
                delete next[adjustCustomer.id];
                return next;
            });
        }
        loadCustomers();
    };

    return (
        <PageShell>
                <PageHeader
                    title={
                        <span className="inline-flex items-center gap-3">
                            <span className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                                <Gift className="w-5 h-5 text-purple-600" />
                            </span>
                            {t.loyalty.title}
                        </span>
                    }
                    subtitle={t.loyalty.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        t.loyalty.title,
                        'sales',
                    )}
                />

                {/* Search */}
                <div className="relative max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t.loyalty.searchPlaceholder}
                        className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                    />
                </div>

                {/* Table */}
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-[1fr_140px_120px_140px_120px] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100">
                        <span className="text-xs font-black uppercase tracking-wider text-gray-400">{t.shared.columns.customer}</span>
                        <span className="text-xs font-black uppercase tracking-wider text-gray-400">{t.shared.columns.phone}</span>
                        <span className="text-xs font-black uppercase tracking-wider text-gray-400 text-right">{t.shared.columns.points}</span>
                        <span className="text-xs font-black uppercase tracking-wider text-gray-400">{t.shared.columns.lastTransaction}</span>
                        <span className="text-xs font-black uppercase tracking-wider text-gray-400 text-right">{t.shared.columns.actions}</span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-gray-400 text-sm">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            {t.shared.loading.generic}
                        </div>
                    ) : customers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                            <Gift className="w-10 h-10 mb-3 opacity-30" />
                            <p className="text-sm font-semibold">{t.shared.empty.noCustomers}</p>
                            {debouncedSearch && (
                                <p className="text-xs mt-1">{t.shared.empty.tryDifferentSearch}</p>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {customers.map((customer) => {
                                const isExpanded = expandedId === customer.id;
                                const detail = detailMap[customer.id];
                                const isLoadingDetail = loadingDetail === customer.id;

                                return (
                                    <div key={customer.id}>
                                        {/* Row */}
                                        <div className="grid grid-cols-[1fr_140px_120px_140px_120px] gap-4 px-5 py-3.5 items-center hover:bg-gray-50 transition-colors">
                                            <button
                                                className="flex items-center gap-2 text-left min-w-0"
                                                onClick={() => toggleExpand(customer)}
                                            >
                                                {isExpanded ? (
                                                    <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                                ) : (
                                                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                                )}
                                                <span className="text-sm font-semibold text-gray-800 truncate">
                                                    {customer.name}
                                                </span>
                                            </button>
                                            <span className="text-sm text-gray-500">{customer.phone}</span>
                                            <span className="text-sm font-bold text-purple-700 text-right">
                                                {customer.loyalty_points.toLocaleString()}
                                            </span>
                                            <span className="text-sm text-gray-400">
                                                {customer.last_transaction_at
                                                    ? formatDate(customer.last_transaction_at, locale)
                                                    : '—'}
                                            </span>
                                            <div className="flex justify-end">
                                                <button
                                                    onClick={() => setAdjustCustomer(customer)}
                                                    className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition-colors"
                                                >
                                                    Adjust
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expanded transactions */}
                                        {isExpanded && (
                                            <div className="bg-gray-50 border-t border-gray-100 px-6 py-4">
                                                {isLoadingDetail ? (
                                                    <div className="flex items-center gap-2 text-gray-400 text-sm">
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        {t.shared.loading.transactions}
                                                    </div>
                                                ) : !detail ? (
                                                    <p className="text-sm text-gray-400">{t.shared.empty.noData}</p>
                                                ) : detail.transactions.length === 0 ? (
                                                    <p className="text-sm text-gray-400">{t.shared.empty.noTransactionsYet}</p>
                                                ) : (
                                                    <div>
                                                        <h4 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-3">
                                                            {t.loyalty.recentTransactions}
                                                        </h4>
                                                        <div className="space-y-2">
                                                            {detail.transactions.slice(0, 10).map((tx) => (
                                                                <div
                                                                    key={tx.id}
                                                                    className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-2.5"
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <TransactionTypeBadge type={tx.type} />
                                                                        <span className="text-sm text-gray-600">
                                                                            {tx.description || '—'}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-4 flex-shrink-0">
                                                                        <span
                                                                            className={`text-sm font-bold ${
                                                                                tx.points > 0
                                                                                    ? 'text-green-700'
                                                                                    : 'text-red-600'
                                                                            }`}
                                                                        >
                                                                            {tx.points > 0 ? '+' : ''}
                                                                            {tx.points}
                                                                        </span>
                                                                        <span className="text-xs text-gray-400 w-24 text-right">
                                                                            {formatDate(tx.created_at, locale)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            

            {adjustCustomer && (
                <AdjustPointsModal
                    customer={adjustCustomer}
                    onClose={() => setAdjustCustomer(null)}
                    onSuccess={handleAdjustSuccess}
                />
            )}
        </PageShell>
    );
}
