'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeftRight,
    BarChart3,
    BookOpen,
    Clock,
    ClipboardList,
    FileText,
    FolderTree,
    Gift,
    Globe,
    MapPin,
    Package,
    Settings,
    ShieldCheck,
    Tag,
    TrendingUp,
    Users,
    Wallet,
} from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import { api } from '@/lib/api';
import { canAccessInventoryAdvancedReports } from '@/lib/plan-entitlements';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

const SALES_HUB_SECTIONS: HubSectionConfig[] = [
    {
        sectionKey: 'dailyOperations',
        links: [
            { href: routes.sales.root, key: 'overview', icon: TrendingUp, accent: 'bg-slate-50 text-slate-700 border-slate-100' },
            { href: routes.sales.list, key: 'allSales', icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { href: routes.sales.returns, key: 'returns', icon: ArrowLeftRight, accent: 'bg-orange-50 text-orange-700 border-orange-100' },
            { href: routes.sales.customerPayments, key: 'customerPayments', icon: Wallet, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
            { href: routes.sales.new, key: 'newSale', icon: FileText, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
        ],
    },
    {
        sectionKey: 'orderFlow',
        links: [
            { href: routes.sales.quotes, key: 'quotes', icon: FileText, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
            { href: routes.sales.orders, key: 'orders', icon: ClipboardList, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { href: routes.sales.delivery, key: 'delivery', icon: MapPin, accent: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
            { href: routes.sales.warrantyClaims, key: 'warrantyClaims', icon: ShieldCheck, accent: 'bg-purple-50 text-purple-700 border-purple-100' },
        ],
    },
    {
        sectionKey: 'reports',
        links: [
            { href: routes.sales.reports.summary, key: 'salesSummary', icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100', advancedOnly: true },
            { href: routes.sales.reports.products, key: 'salesByProduct', icon: Package, accent: 'bg-sky-50 text-sky-700 border-sky-100', advancedOnly: true },
            { href: routes.sales.reports.consolidated, key: 'consolidated', icon: BarChart3, accent: 'bg-primary-light text-primary border-primary-border', advancedOnly: true },
            { href: routes.sales.reports.branchReport, key: 'branchReport', icon: BarChart3, accent: 'bg-amber-50 text-amber-700 border-amber-100', advancedOnly: true },
            { href: routes.sales.customerLedger, key: 'customerLedger', icon: BookOpen, accent: 'bg-primary-light text-primary border-primary-border' },
            { href: routes.sales.customerDueAging, key: 'dueAging', icon: Clock, accent: 'bg-danger-light text-danger-text border-red-100' },
            { href: routes.sales.loyalty, key: 'loyalty', icon: Gift, accent: 'bg-pink-50 text-pink-700 border-pink-100' },
        ],
    },
    {
        sectionKey: 'setup',
        links: [
            { href: routes.sales.customerGroups, key: 'customerGroups', icon: FolderTree, accent: 'bg-slate-50 text-slate-700 border-slate-100' },
            { href: routes.sales.priceLists, key: 'priceLists', icon: Tag, accent: 'bg-primary-light text-primary border-primary-border' },
            { href: routes.sales.territories, key: 'territories', icon: MapPin, accent: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
            { href: routes.sales.customers, key: 'customers', icon: Users, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
            { href: routes.sales.cashierSessions, key: 'cashierSessions', icon: Clock, accent: 'bg-primary-light text-primary border-primary-border' },
            { href: routes.storefront.settings, key: 'storefrontSettings', icon: Globe, accent: 'bg-primary-light text-primary border-primary-border' },
            { href: routes.settings.sales, key: 'salesSettings', icon: Settings, accent: 'bg-gray-50 text-gray-700 border-gray-100' },
        ],
    },
];

export default function SalesHubPage() {
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

    const hub = t.sales.hub;
    const sectionLabels = useMemo(() => ({
        dailyOperations: hub.dailyOperations,
        orderFlow: hub.orderFlow,
        reports: hub.reports,
        setup: hub.setup,
    }), [hub]);

    const linkCopy = useMemo(() => ({
        ...hub.links,
        overview: { title: t.sidebar.items.overview, description: hub.subtitle },
    }), [hub.links, hub.subtitle, t.sidebar.items.overview]);

    return (
        <ModuleHub
            module="sales"
            moduleLabel={hub.moduleLabel}
            title={hub.title}
            subtitle={hub.subtitle}
            sections={SALES_HUB_SECTIONS}
            sectionLabels={sectionLabels}
            linkCopy={linkCopy}
            openSectionLabel={t.accountingShared.openSection}
            viewReportLabel={t.accountingShared.viewReport}
            canAccessAdvanced={canAccessAdvancedReports}
        />
    );
}