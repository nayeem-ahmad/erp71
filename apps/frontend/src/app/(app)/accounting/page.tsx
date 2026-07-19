'use client';

import { useEffect, useMemo, useState } from 'react';
import AccountingLedgerExport from '@/components/accounting/AccountingLedgerExport';
import { CompactLinkGrid } from '@/components/accounting/compact';
import AccountingPageShell from '@/components/accounting/compact/AccountingPageShell';
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
import { api } from '@/lib/api';
import { canAccessAccountingAdvancedReports } from '@/lib/plan-entitlements';
import { useI18n } from '@/lib/i18n';

export default function AccountingPage() {
    const { t } = useI18n();
    const [canAccessAdvancedReports, setCanAccessAdvancedReports] = useState(false);

    useEffect(() => {
        api.getMe()
            .then((me) => {
                const tenantId = localStorage.getItem('tenant_id');
                const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === tenantId) || me?.tenants?.[0];
                const planCode = tenant?.subscription?.plan?.code || null;
                const features = (tenant?.subscription?.plan?.features_json || {}) as Record<string, unknown>;
                setCanAccessAdvancedReports(canAccessAccountingAdvancedReports(planCode, features));
            })
            .catch(() => setCanAccessAdvancedReports(false));
    }, []);

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