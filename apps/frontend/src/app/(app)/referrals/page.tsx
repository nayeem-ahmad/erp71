'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import ActivityChart from '@/components/referrals/ActivityChart';
import EarningsChart from '@/components/referrals/EarningsChart';
import FunnelChart from '@/components/referrals/FunnelChart';
import GettingStarted from '@/components/referrals/GettingStarted';
import ShareToolkit from '@/components/referrals/ShareToolkit';
import { buildFunnel } from '@/components/referrals/funnel-model';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useRefereeLedger } from './use-referee-ledger';

type CardTone = 'plain' | 'highlight' | 'warning';

const CARD_CLASS: Record<CardTone, { box: string; value: string }> = {
    plain: { box: 'border-gray-100 bg-white', value: 'text-gray-900' },
    highlight: { box: 'border-amber-200 bg-amber-50', value: 'text-amber-700' },
    warning: { box: 'border-red-200 bg-red-50', value: 'text-red-700' },
};

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

    const funnel = useMemo(() => buildFunnel({
        clicks: ledger?.summary.clicks ?? 0,
        signups: ledger?.summary.total_referrals ?? 0,
        // Cumulative: a paid commission was earned first, so it still counts here.
        earned: (ledger?.summary.earned ?? 0) + (ledger?.summary.paid ?? 0),
        paid: ledger?.summary.paid ?? 0,
    }), [ledger?.summary]);

    /**
     * A partner with no clicks and no signups has nothing for a dashboard to read.
     * Charts and a row of ৳0 tiles teach them nothing; the three steps do.
     */
    const isFirstRun = !!ledger
        && ledger.summary.clicks === 0
        && ledger.summary.total_referrals === 0;

    const summaryCards = ledger ? [
        { label: m.summary.balanceDue, value: formatBDT(ledger.summary.balance_due), tone: 'highlight' as const },
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
        // Both of these were computed by the ledger from the start and rendered
        // nowhere, so a partner whose commission was clawed back watched their
        // balance drop with nothing on the page accounting for it. They appear only
        // when non-zero: a permanent "৳0 reversed" tile invents a worry.
        ...(ledger.summary.total_reversed_amount > 0
            ? [{
                label: m.summary.reversed,
                value: formatBDT(ledger.summary.total_reversed_amount),
                hint: m.summary.reversedHint,
                tone: 'warning' as const,
            }]
            : []),
        ...(ledger.summary.overpaid_amount > 0
            ? [{
                label: m.summary.overpaid,
                value: formatBDT(ledger.summary.overpaid_amount),
                hint: m.summary.overpaidHint,
                tone: 'warning' as const,
            }]
            : []),
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
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            ) : ledger ? (
                <>
                    {isFirstRun && <GettingStarted labels={m.gettingStarted} />}

                    <ShareToolkit
                        refereeName={ledger.referee.name}
                        referralCode={ledger.referee.referral_code}
                        signupDiscount={ledger.referee.signup_discount ?? 0}
                        contactEmail={ledger.referee.email}
                        labels={{ ...m.share, copyFailed: m.copyFailed }}
                    />

                    {!isFirstRun && (
                        <>
                            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
                                {summaryCards.map((card) => {
                                    const tone = CARD_CLASS[card.tone ?? 'plain'];
                                    return (
                                        <div
                                            key={card.label}
                                            title={card.hint}
                                            className={`rounded-lg border p-4 ${tone.box}`}
                                        >
                                            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                                                {card.label}
                                            </p>
                                            <p className={`mt-2 text-xl font-bold ${tone.value}`}>{card.value}</p>
                                            {card.hint && (
                                                <p className="mt-1 text-xs leading-snug text-red-700">{card.hint}</p>
                                            )}
                                        </div>
                                    );
                                })}
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
                                        <div className="flex items-center gap-3">
                                            <Link
                                                href={routes.referralsPortal.payouts}
                                                className="text-xs font-semibold text-blue-600 hover:underline"
                                            >
                                                {m.payoutsPage.title}
                                            </Link>
                                            <Link
                                                href={routes.referralsPortal.payments}
                                                className="text-xs font-semibold text-blue-600 hover:underline"
                                            >
                                                {m.paymentsPage.title}
                                            </Link>
                                        </div>
                                    </div>
                                    <EarningsChart points={activityPoints} locale={locale} labels={m.charts.earnings} />
                                </div>

                                <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                                    <h2 className="mb-3 text-sm font-semibold text-gray-900">{m.charts.funnel.title}</h2>
                                    <FunnelChart stages={funnel} labels={m.charts.funnel} />
                                </div>
                            </div>
                        </>
                    )}
                </>
            ) : null}
        </PageShell>
    );
}
