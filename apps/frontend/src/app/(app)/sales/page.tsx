'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    ArrowLeftRight,
    ArrowRight,
    BarChart3,
    CheckSquare,
    Clock,
    ClipboardList,
    FileText,
    FolderTree,
    Gift,
    Globe,
    MapPin,
    Megaphone,
    Package,
    Settings,
    ShieldCheck,
    ShoppingCart,
    Tag,
    TrendingUp,
    Users,
    Wallet,
    BookOpen,
    type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

interface HubLinkConfig {
    href: string;
    key: string;
    icon: LucideIcon;
    accent: string;
    advancedOnly?: boolean;
}

interface HubSectionConfig {
    sectionKey: string;
    advancedOnly?: boolean;
    links: HubLinkConfig[];
}

const SALES_HUB_SECTIONS: HubSectionConfig[] = [
    {
        sectionKey: 'dailyOperations',
        links: [
            { href: routes.sales.pos, key: 'pos', icon: ShoppingCart, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
            { href: routes.sales.list, key: 'allSales', icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { href: routes.sales.new, key: 'newSale', icon: FileText, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
            { href: routes.sales.cashierSessions, key: 'cashierSessions', icon: Clock, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
        ],
    },
    {
        sectionKey: 'receivables',
        links: [
            { href: routes.sales.customerPayments, key: 'customerPayments', icon: Wallet, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
            { href: routes.sales.customerLedger, key: 'customerLedger', icon: BookOpen, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
            { href: routes.sales.customerDueAging, key: 'dueAging', icon: Clock, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
        ],
    },
    {
        sectionKey: 'orderFlow',
        links: [
            { href: routes.sales.quotes, key: 'quotes', icon: FileText, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
            { href: routes.sales.orders, key: 'orders', icon: ClipboardList, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { href: routes.sales.delivery, key: 'delivery', icon: MapPin, accent: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
            { href: routes.sales.returns, key: 'returns', icon: ArrowLeftRight, accent: 'bg-orange-50 text-orange-700 border-orange-100' },
            { href: routes.sales.warrantyClaims, key: 'warrantyClaims', icon: ShieldCheck, accent: 'bg-purple-50 text-purple-700 border-purple-100' },
        ],
    },
    {
        sectionKey: 'storefront',
        links: [
            { href: routes.storefront.root, key: 'storefrontOrders', icon: ShoppingCart, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
            { href: routes.storefront.settings, key: 'storefrontSettings', icon: Globe, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
        ],
    },
    {
        sectionKey: 'customersCrm',
        links: [
            { href: routes.sales.customers, key: 'customers', icon: Users, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
            { href: routes.sales.loyalty, key: 'loyalty', icon: Gift, accent: 'bg-pink-50 text-pink-700 border-pink-100' },
        ],
    },
    {
        sectionKey: 'reports',
        advancedOnly: true,
        links: [
            { href: routes.sales.reports.summary, key: 'salesSummary', icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100', advancedOnly: true },
            { href: routes.sales.reports.products, key: 'salesByProduct', icon: Package, accent: 'bg-sky-50 text-sky-700 border-sky-100', advancedOnly: true },
            { href: routes.sales.reports.consolidated, key: 'consolidated', icon: BarChart3, accent: 'bg-violet-50 text-violet-700 border-violet-100', advancedOnly: true },
            { href: routes.sales.reports.branchReport, key: 'branchReport', icon: BarChart3, accent: 'bg-amber-50 text-amber-700 border-amber-100', advancedOnly: true },
        ],
    },
    {
        sectionKey: 'setup',
        links: [
            { href: routes.sales.customerGroups, key: 'customerGroups', icon: FolderTree, accent: 'bg-slate-50 text-slate-700 border-slate-100' },
            { href: routes.sales.priceLists, key: 'priceLists', icon: Tag, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
            { href: routes.sales.territories, key: 'territories', icon: MapPin, accent: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
            { href: routes.settings.sales, key: 'salesSettings', icon: Settings, accent: 'bg-gray-50 text-gray-700 border-gray-100' },
        ],
    },
];

function hasAdvancedReportsEntitlement(planCode: string | null, features: Record<string, unknown>) {
    return Boolean(features.premiumInventoryReports) || planCode === 'STANDARD' || planCode === 'PREMIUM';
}

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
                setCanAccessAdvancedReports(hasAdvancedReportsEntitlement(planCode, features));
            })
            .catch(() => setCanAccessAdvancedReports(false));
    }, []);

    const sections = useMemo(() => {
        const hub = t.sales.hub;
        const sectionLabels: Record<string, string> = {
            dailyOperations: hub.dailyOperations,
            receivables: hub.receivables,
            orderFlow: hub.orderFlow,
            storefront: hub.storefront,
            customersCrm: hub.customersCrm,
            reports: hub.reports,
            setup: hub.setup,
        };

        return SALES_HUB_SECTIONS
            .filter((section) => !section.advancedOnly || canAccessAdvancedReports)
            .map((section) => ({
                label: sectionLabels[section.sectionKey] ?? section.sectionKey,
                links: section.links
                    .filter((link) => !link.advancedOnly || canAccessAdvancedReports)
                    .flatMap(({ href, key, icon, accent }) => {
                        const linkCopy = hub.links[key as keyof typeof hub.links];
                        if (!linkCopy) return [];
                        return [{
                            href,
                            title: linkCopy.title,
                            description: linkCopy.description,
                            icon,
                            accent,
                            isReport: section.sectionKey === 'reports',
                        }];
                    }),
            }))
            .filter((section) => section.links.length > 0);
    }, [canAccessAdvancedReports, t]);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1200px] mx-auto space-y-8">
                <div className="space-y-2">
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">{t.sales.hub.moduleLabel}</p>
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-gray-950">{t.sales.hub.title}</h1>
                        <p className="text-sm text-gray-500 max-w-3xl mt-2">{t.sales.hub.subtitle}</p>
                    </div>
                </div>

                {sections.map((section) => (
                    <div key={section.label} className="space-y-3">
                        <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">{section.label}</p>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            {section.links.map(({ href, title, description, icon: Icon, accent, isReport }) => (
                                <Link
                                    key={href}
                                    href={href}
                                    className="group rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
                                >
                                    <div className={`inline-flex rounded-2xl border px-3 py-3 ${accent}`}>
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <div className="mt-5 space-y-2">
                                        <h2 className="text-lg font-black tracking-tight text-gray-950">{title}</h2>
                                        <p className="text-sm leading-6 text-gray-500">{description}</p>
                                    </div>
                                    <div className="mt-5 flex items-center text-sm font-bold text-gray-900">
                                        {isReport ? t.accountingShared.viewReport : t.accountingShared.openSection}
                                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}