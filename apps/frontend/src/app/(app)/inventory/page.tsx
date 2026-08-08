'use client';

import { useMemo } from 'react';
import {
    AlertTriangle,
    BarChart3,
    BookOpen,
    Boxes,
    Calculator,
    ClipboardCheck,
    ClipboardList,
    FolderTree,
    Package,
    Settings,
    Tag,
    TrendingUp,
} from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import InventoryDashboard from '@/components/dashboard/InventoryDashboard';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { canAccessInventoryAdvancedReports } from '@/lib/plan-entitlements';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

const INVENTORY_HUB_SECTIONS: HubSectionConfig[] = [
    {
        sectionKey: 'dailyOperations',
        links: [
            { href: routes.inventory.products, key: 'products', icon: Package, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
            { href: routes.inventory.demands, key: 'demands', icon: ClipboardList, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
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

/**
 * Inventory > Overview. The stock dashboard sits above the link hub for every
 * plan: valuation and aging are the premium half and the server withholds them
 * on its own, so there is nothing here to gate the whole page on.
 */
export default function InventoryHubPage() {
    const { t } = useI18n();
    const { planCode, features, ready } = useTenantPlanFeatures();
    const canAccessAdvancedReports = canAccessInventoryAdvancedReports(planCode, features);

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
        >
            {ready ? (
                <div className="mb-4">
                    <InventoryDashboard variant="embedded" greeting="" tenantName="" renewalEnd={null} />
                </div>
            ) : null}
        </ModuleHub>
    );
}