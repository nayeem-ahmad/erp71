'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { useModuleDashboard } from '@/lib/use-module-dashboard';
import { routes } from '@/lib/routes';
import ModuleDashboard, {
    AttentionSection,
    DashboardSection,
    KpiTileGrid,
    type DashboardMount,
    type KpiTileSpec,
} from '@/components/dashboard/ModuleDashboard';
import { type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui';
import type { DashboardIdentity } from './dashboard-identity';

type OverviewResponse = {
    filters: { from: string; to: string };
    spend: {
        total: number;
        purchases: number;
        avg_value: number | null;
        returns_value: number;
        returns_count: number;
    };
    payables: { outstanding: number; unpaid_purchases: number; partial_purchases: number };
    orders: {
        awaiting_receipt: number;
        draft: number;
        overdue_expected: number;
        received_in_period: number;
    };
    quotations: { open: number; expiring: number; expired: number };
    suppliers: Array<{
        id: string | null;
        name: string;
        spend: number;
        purchases: number;
        outstanding: number;
    }>;
    products: Array<{ id: string; name: string; units: number; spend: number }>;
    recent: Array<{
        id: string;
        purchase_number: string;
        supplier_name: string | null;
        total: number;
        payment_status: string;
        created_at: string;
    }>;
};

type TrendPoint = { date: string; spend: number; purchases: number };

const paymentTone: Record<string, StatusBadgeTone> = {
    PAID: 'success',
    PARTIAL: 'warning',
    UNPAID: 'danger',
};

/**
 * Purchases > Overview: what was bought, what is owed, and what has been ordered
 * but has not yet arrived.
 */
export default function PurchaseDashboard({
    greeting,
    tenantName,
    variant = 'page',
}: Readonly<DashboardIdentity & { variant?: DashboardMount }>) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const pur = copy.purchases;

    const {
        range,
        setRange,
        overview,
        previous: prev,
        trends,
        loading,
        error,
        deltaContext,
        compare,
    } = useModuleDashboard<OverviewResponse, TrendPoint>({
        fetchOverview: (window) => api.getPurchaseDashboardOverview(window),
        fetchTrends: (window) => api.getPurchaseDashboardTrends(window),
        unavailableMessage: pur.overviewUnavailable,
    });

    const money = (value: number) => formatBDT(value, { locale });
    const spend = overview?.spend;
    const payables = overview?.payables;
    const orders = overview?.orders;

    const kpiTiles: KpiTileSpec[] = [
        {
            key: 'spend',
            title: pur.kpiSpend,
            value: money(spend?.total ?? 0),
            points: trends.map((point) => point.spend),
            delta: compare(spend?.total, prev?.spend.total),
            note: formatMessage(pur.helperReturns, {
                count: spend?.returns_count ?? 0,
                amount: money(spend?.returns_value ?? 0),
            }),
        },
        {
            key: 'purchases',
            title: pur.kpiPurchases,
            value: String(spend?.purchases ?? 0),
            points: trends.map((point) => point.purchases),
            delta: compare(spend?.purchases, prev?.spend.purchases),
            note: formatMessage(pur.helperReceived, { count: orders?.received_in_period ?? 0 }),
        },
        {
            key: 'avg-value',
            title: pur.kpiAvgValue,
            value: spend?.avg_value == null ? '—' : money(spend.avg_value),
            delta: compare(spend?.avg_value, prev?.spend.avg_value),
        },
        {
            key: 'payables',
            title: pur.kpiPayables,
            // A balance across the whole book, so no window comparison and no
            // sparkline — the trend points are flows and would not be this.
            value: money(payables?.outstanding ?? 0),
            delta: { label: '—', positive: true },
            note: formatMessage(pur.helperUnpaid, {
                unpaid: payables?.unpaid_purchases ?? 0,
                partial: payables?.partial_purchases ?? 0,
            }),
        },
    ];

    const attentionItems = useMemo<AttentionItem[]>(() => {
        const items: AttentionItem[] = [];
        if (!overview) return items;

        const { payables: owed, orders: po, quotations: rfq } = overview;

        if (owed.outstanding > 0) {
            items.push({
                id: 'payables',
                tone: 'red',
                value: money(owed.outstanding),
                label: formatMessage(pur.attnOverduePayables, { amount: money(owed.outstanding) }),
                href: routes.purchases.supplierLedger,
                cta: pur.viewAll,
            });
        }
        if (po.overdue_expected > 0) {
            items.push({
                id: 'overdue-orders',
                tone: 'red',
                value: String(po.overdue_expected),
                label: formatMessage(pur.attnOverdueOrders, { count: po.overdue_expected }),
                href: routes.purchases.orders,
                cta: pur.viewAll,
            });
        }
        if (po.awaiting_receipt > 0) {
            items.push({
                id: 'awaiting-receipt',
                tone: 'amber',
                value: String(po.awaiting_receipt),
                label: formatMessage(pur.attnAwaitingReceipt, { count: po.awaiting_receipt }),
                href: routes.purchases.orders,
                cta: pur.viewAll,
            });
        }
        if (rfq.expired > 0) {
            items.push({
                id: 'expired-quotes',
                tone: 'amber',
                value: String(rfq.expired),
                label: formatMessage(pur.attnExpiredQuotes, { count: rfq.expired }),
                href: routes.purchases.quotations,
                cta: pur.viewAll,
            });
        }
        if (rfq.expiring > 0) {
            items.push({
                id: 'expiring-quotes',
                tone: 'amber',
                value: String(rfq.expiring),
                label: formatMessage(pur.attnExpiringQuotes, { count: rfq.expiring }),
                href: routes.purchases.quotations,
                cta: pur.viewAll,
            });
        }
        if (po.draft > 0) {
            items.push({
                id: 'draft-orders',
                tone: 'blue',
                value: String(po.draft),
                label: formatMessage(pur.attnDraftOrders, { count: po.draft }),
                href: routes.purchases.orders,
                cta: pur.viewAll,
            });
        }
        return items;
    }, [overview, pur, locale]);

    const supplierItems = useMemo<RankedItem[]>(
        () => (overview?.suppliers ?? []).map((row) => ({
            id: row.id ?? 'no-supplier',
            name: row.name,
            meta: formatMessage(pur.supplierMeta, {
                count: row.purchases,
                outstanding: money(row.outstanding),
            }),
            amount: money(row.spend),
        })),
        [overview?.suppliers, pur, locale],
    );

    const productItems = useMemo<RankedItem[]>(
        () => (overview?.products ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            meta: formatMessage(pur.productMeta, { units: row.units }),
            amount: money(row.spend),
        })),
        [overview?.products, pur, locale],
    );

    return (
        <ModuleDashboard
            mount={variant}
            greeting={greeting}
            tenantName={tenantName}
            subtitle={pur.subtitle}
            range={range}
            onRangeChange={setRange}
            error={error}
        >
            <AttentionSection
                items={attentionItems}
                loading={loading}
                label={copy.sectionAttention}
                allClearLabel={pur.attnAllClear}
            />

            <DashboardSection label={pur.sectionSpend}>
                <KpiTileGrid tiles={kpiTiles} loading={loading} deltaContext={deltaContext} />
            </DashboardSection>

            <DashboardSection label={pur.sectionDrivers}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <RankedListPanel
                        title={pur.suppliersTitle}
                        items={supplierItems}
                        emptyLabel={pur.suppliersEmpty}
                    />
                    <RankedListPanel
                        title={pur.productsTitle}
                        items={productItems}
                        emptyLabel={pur.productsEmpty}
                    />

                    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="text-xs font-bold text-gray-900">{pur.recentTitle}</h3>
                            <Link href={routes.purchases.list} className="text-[10px] font-bold text-primary hover:underline">
                                {pur.viewAll}
                            </Link>
                        </div>
                        {(overview?.recent ?? []).length === 0 ? (
                            <p className="py-4 text-center text-[11px] text-gray-400">{pur.recentEmpty}</p>
                        ) : (
                            <ul>
                                {overview!.recent.map((row) => (
                                    <li
                                        key={row.id}
                                        className="flex items-center gap-2 border-b border-gray-50 py-1.5 text-[11px] last:border-0"
                                    >
                                        <StatusBadge tone={paymentTone[row.payment_status] ?? 'neutral'} className="shrink-0">
                                            {row.payment_status}
                                        </StatusBadge>
                                        <span className="min-w-0 truncate font-semibold text-gray-900">
                                            {row.supplier_name ?? pur.recentNoSupplier}
                                        </span>
                                        <span className="ms-auto shrink-0 font-bold tabular-nums text-gray-900">
                                            {money(row.total)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </DashboardSection>
        </ModuleDashboard>
    );
}
