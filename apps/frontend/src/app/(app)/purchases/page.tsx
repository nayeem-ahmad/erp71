'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    BarChart3,
    BookOpen,
    ClipboardList,
    FileSearch,
    FileText,
    Package,
    TrendingUp,
    Truck,
    Undo2,
    Wallet,
} from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import { api } from '@/lib/api';
import { canAccessInventoryAdvancedReports } from '@/lib/plan-entitlements';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

const PURCHASE_HUB_SECTIONS: HubSectionConfig[] = [
    {
        sectionKey: 'dailyOperations',
        links: [
            { href: routes.purchases.list, key: 'allPurchases', icon: ClipboardList, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
        ],
    },
    {
        sectionKey: 'payables',
        links: [
            { href: routes.purchases.supplierPayments, key: 'supplierPayments', icon: Wallet, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
            { href: routes.purchases.supplierLedger, key: 'supplierLedger', icon: BookOpen, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
        ],
    },
    {
        sectionKey: 'orderFlow',
        links: [
            { href: routes.purchases.orders, key: 'purchaseOrders', icon: FileText, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
            { href: routes.purchases.quotations, key: 'purchaseQuotations', icon: FileSearch, accent: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
            { href: routes.purchases.returns, key: 'purchaseReturns', icon: Undo2, accent: 'bg-orange-50 text-orange-700 border-orange-100' },
        ],
    },
    {
        sectionKey: 'reports',
        advancedOnly: true,
        links: [
            { href: routes.purchases.reports.summary, key: 'purchaseSummary', icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100', advancedOnly: true },
            { href: routes.purchases.reports.byProduct, key: 'purchasesByProduct', icon: Package, accent: 'bg-sky-50 text-sky-700 border-sky-100', advancedOnly: true },
            { href: routes.purchases.reports.bySupplier, key: 'purchasesBySupplier', icon: Truck, accent: 'bg-violet-50 text-violet-700 border-violet-100', advancedOnly: true },
        ],
    },
    {
        sectionKey: 'setup',
        links: [
            { href: routes.purchases.suppliers, key: 'suppliers', icon: Truck, accent: 'bg-slate-50 text-slate-700 border-slate-100' },
        ],
    },
];

export default function PurchasesHubPage() {
    const { t } = useI18n();
    const [canAccessAdvancedReports, setCanAccessAdvancedReports] = useState(false);

    useEffect(() => {
        api.getMe()
            .then((me) => {
                const tenantId = localStorage.getItem('tenant_id');
                const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === tenantId) || me?.tenants?.[0];
                const planCode = tenant?.subscription?.plan?.code || null;
                const features = (tenant?.subscription?.plan?.features_json || {}) as Record<string, unknown>;
                setCanAccessAdvancedReports(canAccessInventoryAdvancedReports(planCode, features));
            })
            .catch(() => setCanAccessAdvancedReports(false));
    }, []);

    const hub = t.purchases.hub;
    const sectionLabels = useMemo(() => ({
        dailyOperations: hub.dailyOperations,
        payables: hub.payables,
        orderFlow: hub.orderFlow,
        reports: hub.reports,
        setup: hub.setup,
    }), [hub]);

    return (
        <ModuleHub
            module="purchases"
            moduleLabel={hub.moduleLabel}
            title={hub.title}
            subtitle={hub.subtitle}
            sections={PURCHASE_HUB_SECTIONS}
            sectionLabels={sectionLabels}
            linkCopy={hub.links}
            openSectionLabel={t.accountingShared.openSection}
            viewReportLabel={t.accountingShared.viewReport}
            canAccessAdvanced={canAccessAdvancedReports}
        />
    );
}