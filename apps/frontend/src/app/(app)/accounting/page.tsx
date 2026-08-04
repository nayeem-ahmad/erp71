'use client';

import { useMemo } from 'react';
import AccountingLedgerExport from '@/components/accounting/AccountingLedgerExport';
import { CompactLinkGrid } from '@/components/accounting/compact';
import AccountingPageShell from '@/components/accounting/compact/AccountingPageShell';
import AccountingDashboard from '@/components/dashboard/AccountingDashboard';
import PageHeader from '@/components/ui/compact/PageHeader';
import { compactDensity } from '@/lib/ui/compact-density';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    ACCOUNTING_DAILY_LINKS,
    ACCOUNTING_FINANCING_LINKS,
    ACCOUNTING_RECONCILIATION_LINKS,
    ACCOUNTING_REPORT_LINKS,
    ACCOUNTING_SETUP_LINKS,
} from '@/lib/accounting-nav';
import { canAccessAccountingAdvancedReports } from '@/lib/plan-entitlements';
import { hasPermission } from '@/lib/permissions';
import { useI18n } from '@/lib/i18n';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';

/**
 * Accounting > Overview. The books dashboard for anyone who can read the ledger,
 * with the link hub kept underneath it; without `VIEW_LEDGER` it stays the plain
 * hub, since every panel below reads posted balances.
 */
export default function AccountingPage() {
    const { t } = useI18n();
    const { planCode, features, permissions, ready } = useTenantPlanFeatures();
    const canAccessAdvancedReports = canAccessAccountingAdvancedReports(planCode, features);
    const canViewLedger = hasPermission(permissions, 'VIEW_LEDGER');

    const mapLinks = (items: typeof ACCOUNTING_DAILY_LINKS) =>
        items
            .filter((item) => !item.advancedOnly || canAccessAdvancedReports)
            .map(({ href, key, icon, accent }) => ({
                href,
                title: t.accounting.links[key].title,
                icon,
                accent,
            }));

    const dailyLinks = useMemo(() => mapLinks(ACCOUNTING_DAILY_LINKS), [t, canAccessAdvancedReports]);
    const financingLinks = useMemo(() => mapLinks(ACCOUNTING_FINANCING_LINKS), [t, canAccessAdvancedReports]);
    const reconciliationLinks = useMemo(() => mapLinks(ACCOUNTING_RECONCILIATION_LINKS), [t, canAccessAdvancedReports]);
    const reportLinks = useMemo(() => mapLinks(ACCOUNTING_REPORT_LINKS), [t, canAccessAdvancedReports]);
    const setupLinks = useMemo(() => mapLinks(ACCOUNTING_SETUP_LINKS), [t]);

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={t.accounting.title}
                subtitle={t.accounting.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.accounting.title,
                    'accounting',
                )}
            />

            {/* Waits for the permission before deciding: rendering the dashboard
                and pulling it away is worse than a beat of nothing. */}
            {ready && canViewLedger ? (
                <div className="mb-4">
                    <AccountingDashboard variant="embedded" greeting="" tenantName="" renewalEnd={null} />
                </div>
            ) : null}

            <CompactLinkGrid label={t.accounting.hub.dailyOperations} links={dailyLinks} />
            <CompactLinkGrid label={t.accounting.hub.financing} links={financingLinks} />
            <CompactLinkGrid label={t.accounting.hub.reconciliation} links={reconciliationLinks} />
            <CompactLinkGrid label={t.accounting.financialReports} links={reportLinks} />

            <div className="space-y-2">
                <p className={compactDensity.sectionLabel}>{t.sidebar.sections.accountingSetup}</p>
                <CompactLinkGrid links={setupLinks} />
                <AccountingLedgerExport />
            </div>
        </AccountingPageShell>
    );
}
