'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    BarChart3,
    BookOpen,
    Boxes,
    Calculator,
    ClipboardCheck,
    FolderTree,
    Package,
    Settings,
    Tag,
    TrendingUp,
} from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import { api } from '@/lib/api';
import { canAccessInventoryAdvancedReports } from '@/lib/plan-entitlements';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

const INVENTORY_HUB_SECTIONS: HubSectionConfig[] = [
    {
        sectionKey: 'dailyOperations',
        links: [
            { href: routes.inventory.products, key: 'products', icon: Package, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
            { href: routes.inventory.transfers, key: 'transfers', icon: Boxes, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.inventory.stockTakes, key: 'stockTakes', icon: ClipboardCheck, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { href: routes.inventory.shrinkage, key: 'shrinkage', icon: AlertTriangle, accent: 'bg-danger-light text-danger-text border-red-200' },
            { href: routes.inventory.labels, key: 'printLabels', icon: Tag, accent: 'bg-primary-light text-blue-700 border-primary-border' },
        ],
    },
    {
        sectionKey: 'reports',
        links: [
            { href: routes.inventory.ledger, key: 'stockLedger', icon: BookOpen, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
            { href: routes.inventory.reports.reorder, key: 'reorderReport', icon: TrendingUp, accent: 'bg-sky-50 text-sky-700 border-sky-100', advancedOnly: true },
            { href: routes.inventory.reports.shrinkage, key: 'shrinkageReport', icon: AlertTriangle, accent: 'bg-orange-50 text-orange-700 border-orange-100', advancedOnly: true },
            { href: routes.inventory.reports.valuation, key: 'valuation', icon: Calculator, accent: 'bg-purple-50 text-purple-700 border-purple-100', advancedOnly: true },
        ],
    },
    {
        sectionKey: 'setup',
        links: [
            { href: routes.inventory.brands, key: 'brands', icon: Tag, accent: 'bg-slate-50 text-slate-700 border-slate-100' },
            { href: routes.inventory.categories, key: 'categories', icon: FolderTree, accent: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
            { href: routes.inventory.settings, key: 'inventorySettings', icon: Settings, accent: 'bg-gray-50 text-gray-700 border-gray-100' },
        ],
    },
];

export default function InventoryHubPage() {
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

    const hub = t.inventory.hub;
    const sectionLabels = useMemo(() => ({
        dailyOperations: hub.dailyOperations,
        reports: hub.reports,
        setup: hub.setup,
    }), [hub]);

    return (
        <ModuleHub
            module="inventory"
            moduleLabel={hub.moduleLabel}
            title={hub.title}
            subtitle={hub.subtitle}
            sections={INVENTORY_HUB_SECTIONS}
            sectionLabels={sectionLabels}
            linkCopy={hub.links}
            openSectionLabel={t.accountingShared.openSection}
            viewReportLabel={t.accountingShared.viewReport}
            canAccessAdvanced={canAccessAdvancedReports}
        />
    );
}