'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Copy, Gift, Link2, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import ActivityChart from '@/components/referrals/ActivityChart';
import EarningsChart from '@/components/referrals/EarningsChart';
import FunnelChart from '@/components/referrals/FunnelChart';
import { buildFunnel } from '@/components/referrals/funnel-model';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { useRefereeLedger } from './use-referee-ledger';

export default function RefereePortalPage() {
    const { t, locale } = useI18n();
    const m = t.referralPortal;
    const isMdUp = useIsMdUp();
    const { ledger, error, isLoading } = useRefereeLedger();

    // Twelve month labels collide below ~500px. Narrowing to six is the honest
    // fix; squeezing or rotating the labels is not.
    const activityPoints = useMemo(
        () => (isMdUp ? ledger?.activity ?? [] : (ledger?.activity ?? []).slice(-6)),
        [ledger?.activity, isMdUp],
    );

    const signupUrl = useMemo(() => {
        if (!ledger?.referee.referral_code || typeof window === 'undefined') return '';
        // /r/<code> records the click, then forwards to /signup?ref=<code>.
        return `${window.location.origin}/r/${encodeURIComponent(ledger.referee.referral_code)}`;
    }, [ledger?.referee.referral_code]);

    const funnel = useMemo(() => buildFunnel({
        clicks: ledger?.summary.clicks ?? 0,
        signups: ledger?.summary.total_referrals ?? 0,
        // Cumulative: a paid commission was earned first, so it still counts here.
        earned: (ledger?.summary.earned ?? 0) + (ledger?.summary.paid ?? 0),
        paid: ledger?.summary.paid ?? 0,
    }), [ledger?.summary]);

    const copyText = async (value: string, message: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(message);
        } catch {
            toast.error(m.copyFailed);
        }
    };

    const summaryCards = ledger ? [
        { label: m.summary.balanceDue, value: formatBDT(ledger.summary.balance_due), highlight: true },
        { label: m.summary.clicks, value: String(ledger.summary.clicks) },
        {
            label: m.summary.conversionRate,
            value: ledger.summary.conversion_rate === null ? '—' : `${ledger.summary.conversion_rate}%`,
        },
        { label: m.summary.totalReferrals, value: String(ledger.summary.total_referrals) },
        { label: m.summary.pending, value: String(ledger.summary.pending) },
        { label: m.summary.earned, value: String(ledger.summary.earned) },
        { label: m.summary.paid, value: String(ledger.summary.paid) },
        { label: m.summary.totalEarned, value: formatBDT(ledger.summary.total_earned_amount) },
        { label: m.summary.totalPaid, value: formatBDT(ledger.summary.total_paid_amount) },
    ] : [];

    return (
        <PageShell>
                <PageHeader
                    title={formatMessage(m.title, { name: ledger?.referee.name ?? '' })}
                    subtitle={m.subtitle}
                    breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [{ label: m.dashboard }])}
                />

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                {isLoading ? (
                    <div className="flex items-center justify-center py-16 text-gray-500">
                        <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                ) : ledger ? (
                    <>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                                        <Gift className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900">{m.share.referralCode}</p>
                                        <p className="font-mono text-lg font-bold tracking-wider text-gray-900">{ledger.referee.referral_code}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void copyText(ledger.referee.referral_code, m.share.codeCopied)}
                                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    <Copy className="w-4 h-4" />
                                    {m.share.copyCode}
                                </button>
                            </div>

                            <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-light text-primary">
                                        <Link2 className="w-5 h-5" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-gray-900">{m.share.signupLink}</p>
                                        <p className="truncate text-sm text-gray-500">{signupUrl}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void copyText(signupUrl, m.share.linkCopied)}
                                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    <Copy className="w-4 h-4" />
                                    {m.share.copyLink}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
                            {summaryCards.map((card) => (
                                <div
                                    key={card.label}
                                    className={`rounded-lg border p-4 ${card.highlight ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'}`}
                                >
                                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{card.label}</p>
                                    <p className={`mt-2 text-xl font-bold ${card.highlight ? 'text-amber-700' : 'text-gray-900'}`}>{card.value}</p>
                                </div>
                            ))}
                        </div>

                        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-semibold text-gray-900">{m.charts.activity.title}</h2>
                                <Link
                                    href={routes.referralsPortal.signups}
                                    className="text-xs font-semibold text-blue-600 hover:underline"
                                >
                                    {m.signupsPage.title}
                                </Link>
                            </div>
                            <ActivityChart points={activityPoints} locale={locale} labels={m.charts.activity} />
                        </div>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between">
                                    <h2 className="text-sm font-semibold text-gray-900">{m.charts.earnings.title}</h2>
                                    <Link
                                        href={routes.referralsPortal.payments}
                                        className="text-xs font-semibold text-blue-600 hover:underline"
                                    >
                                        {m.paymentsPage.title}
                                    </Link>
                                </div>
                                <EarningsChart points={activityPoints} locale={locale} labels={m.charts.earnings} />
                            </div>

                            <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                                <h2 className="mb-3 text-sm font-semibold text-gray-900">{m.charts.funnel.title}</h2>
                                <FunnelChart stages={funnel} labels={m.charts.funnel} />
                            </div>
                        </div>
                    </>
                ) : null}
        </PageShell>
    );
}
