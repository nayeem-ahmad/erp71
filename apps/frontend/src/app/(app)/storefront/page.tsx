'use client';

import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useBranchScope } from '@/lib/branch-scope';
import StorefrontOrdersPanel from './StorefrontOrdersPanel';

/**
 * Web orders placed on the public shop. They used to share a tab with Sales
 * Orders; they live here so the storefront's queue is next to its pages, menu
 * and settings, and the sales-order list is only the shop's own orders.
 */
export default function StorefrontOrdersPage() {
    const { t } = useI18n();
    const branch = useBranchScope();
    const m = t.storefront.dashboard.orders;
    const onlineStoreId = branch.branches.find((store) => store.is_online)?.id;

    return (
        <PageShell>
            <PageHeader
                title={t.sidebar.items.storefrontOrders}
                subtitle={m.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.storefront,
                    t.sidebar.items.storefrontOrders,
                    'storefront',
                )}
            />
            <StorefrontOrdersPanel storeId={onlineStoreId} />
        </PageShell>
    );
}
