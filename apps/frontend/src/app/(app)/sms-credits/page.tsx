'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, MessageSquare, Plus, ArrowDownCircle, ArrowUpCircle, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { formatBDT, formatDate, formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';

type SmsPackage = {
    id: string;
    name: string;
    credits: number;
    price: number;
    currency: string;
};

type SmsTransaction = {
    id: string;
    type: 'PURCHASE' | 'USAGE' | 'ADJUSTMENT' | 'REFUND';
    credits: number;
    balance_after: number;
    description?: string | null;
    recipient?: string | null;
    reference?: string | null;
    created_at: string;
};

type SmsCreditSummary = {
    tenant: { id: string; name: string };
    role: string;
    can_manage_billing: boolean;
    sms_enabled: boolean;
    balance: number;
    low_balance: boolean;
    packages: SmsPackage[];
    transactions: SmsTransaction[];
};

export default function SmsCreditsPage() {
    const { t } = useI18n();
    const [summary, setSummary] = useState<SmsCreditSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [purchasingId, setPurchasingId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const loadSummary = async () => {
        setIsLoading(true);
        try {
            const next = await api.getSmsCreditSummary();
            setSummary(next);
        } catch (err: any) {
            setError(err.message || 'Failed to load SMS credit summary.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadSummary();
    }, []);

    const buyPackage = async (pkg: SmsPackage) => {
        setPurchasingId(pkg.id);
        setError('');
        setNotice('');
        try {
            // Manual flow: create the purchase, then confirm to credit the balance.
            const session = await api.purchaseSmsCredits({ packageId: pkg.id });
            const result = await api.confirmSmsCreditsPurchase({
                packageId: pkg.id,
                reference: session.reference,
            });
            setNotice(`${formatNumber(result.credits_added)} SMS credits added. New balance: ${formatNumber(result.balance)}.`);
            await loadSummary();
        } catch (err: any) {
            setError(err.message || 'Failed to purchase SMS credits.');
        } finally {
            setPurchasingId(null);
        }
    };

    const balance = summary?.balance ?? 0;

    const balanceTone = useMemo(() => {
        if (balance <= 0) return 'text-danger';
        if (summary?.low_balance) return 'text-amber-600';
        return 'text-emerald-700';
    }, [balance, summary?.low_balance]);

    return (
        <PageShell>
            <div className="max-w-6xl mx-auto space-y-6">
                <PageHeader
                    title="SMS Credits"
                    subtitle={`Prepaid SMS balance for ${summary?.tenant.name || 'your shop'} — credits are spent whenever an SMS is sent`}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        'SMS Credits',
                        'SMS Credits',
                        'smsCredits',
                    )}
                />

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}
                {notice && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                        {notice}
                    </div>
                )}

                {isLoading ? (
                    <div className="rounded-lg border border-gray-100 bg-white p-8 flex items-center justify-center text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading SMS credits...
                    </div>
                ) : summary && (
                    <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
                        <section className="space-y-6">
                            {/* Balance card */}
                            <div className="rounded-lg border border-gray-100 bg-white p-6">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-medium text-gray-500">Current Balance</p>
                                        <div className="mt-2 flex items-end gap-2">
                                            <span className={`text-5xl font-bold tracking-tight ${balanceTone}`}>{formatNumber(balance)}</span>
                                            <span className="mb-1 text-sm font-bold text-gray-500">SMS credits</span>
                                        </div>
                                        {!summary.sms_enabled && (
                                            <p className="mt-2 text-xs text-gray-500">
                                                SMS sending is currently disabled for this shop. Enable it in settings to start using credits.
                                            </p>
                                        )}
                                    </div>
                                    <div className="rounded-lg bg-primary-light p-3 text-primary">
                                        <MessageSquare className="w-7 h-7" />
                                    </div>
                                </div>

                                {summary.low_balance && balance > 0 && (
                                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                                        <AlertTriangle className="w-4 h-4" /> Your SMS balance is running low. Top up to avoid interruptions.
                                    </div>
                                )}
                                {balance <= 0 && (
                                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">
                                        <AlertTriangle className="w-4 h-4" /> You are out of SMS credits. New messages will not be sent until you top up.
                                    </div>
                                )}
                            </div>

                            {/* Packages */}
                            <div className="rounded-lg border border-gray-100 bg-white p-6 space-y-4">
                                <div className="flex items-center gap-2">
                                    <Plus className="w-5 h-5 text-primary" />
                                    <h2 className="text-lg font-bold tracking-tight">Buy SMS Credits</h2>
                                </div>

                                {!summary.can_manage_billing ? (
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4 text-sm text-gray-600">
                                        Your role is {summary.role}. Only owners and managers can purchase SMS credits.
                                    </div>
                                ) : summary.packages.length === 0 ? (
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4 text-sm text-gray-600">
                                        No SMS packages are available right now.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {summary.packages.map((pkg) => (
                                            <div
                                                key={pkg.id}
                                                className="rounded-lg border border-gray-100 bg-gray-50 p-4 flex flex-col gap-3"
                                            >
                                                <div>
                                                    <p className="text-sm font-bold text-gray-900">{pkg.name}</p>
                                                    <p className="mt-1 text-2xl font-bold text-primary">{formatNumber(pkg.credits)} <span className="text-xs font-bold text-gray-500">SMS</span></p>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-lg font-bold text-gray-900">{formatBDT(pkg.price)}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => buyPackage(pkg)}
                                                        disabled={purchasingId !== null}
                                                        className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-primary-hover disabled:opacity-60"
                                                    >
                                                        {purchasingId === pkg.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                                                        Buy
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Transaction history */}
                        <aside className="rounded-lg border border-gray-100 bg-white p-6 space-y-4 h-fit">
                            <p className="text-xs font-medium text-gray-500">Recent Activity</p>
                            {summary.transactions.length === 0 ? (
                                <p className="text-sm text-gray-500">No SMS credit activity yet.</p>
                            ) : (
                                <div className="space-y-2">
                                    {summary.transactions.map((tx) => {
                                        const isCredit = tx.credits >= 0;
                                        return (
                                            <div key={tx.id} className="rounded-xl bg-gray-50 px-3 py-2">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        {isCredit ? (
                                                            <ArrowUpCircle className="w-4 h-4 shrink-0 text-emerald-600" />
                                                        ) : (
                                                            <ArrowDownCircle className="w-4 h-4 shrink-0 text-danger" />
                                                        )}
                                                        <span className="truncate text-sm font-bold text-gray-900">
                                                            {tx.description || tx.type}
                                                        </span>
                                                    </div>
                                                    <span className={`text-sm font-bold shrink-0 ${isCredit ? 'text-emerald-600' : 'text-danger'}`}>
                                                        {isCredit ? '+' : ''}{formatNumber(tx.credits)}
                                                    </span>
                                                </div>
                                                <p className="mt-1 text-[11px] text-gray-500">
                                                    {formatDate(tx.created_at)}
                                                    {tx.recipient ? ` · ${tx.recipient}` : ''}
                                                    {` · Balance ${formatNumber(tx.balance_after)}`}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </aside>
                    </div>
                )}
            </div>
        </PageShell>
    );
}
