'use client';

import { useMemo } from 'react';
import AccountingLedgerExport from '@/components/accounting/AccountingLedgerExport';
import { CompactLinkGrid } from '@/components/accounting/compact';
import AccountingPageShell from '@/components/accounting/compact/AccountingPageShell';
import { compactDensity } from '@/lib/ui/compact-density';
import {
    ACCOUNTING_DAILY_LINKS,
    ACCOUNTING_RECONCILIATION_LINKS,
    ACCOUNTING_REPORT_LINKS,
    ACCOUNTING_SETUP_LINKS,
    ACCOUNTING_TRANSACTION_LINKS,
} from '@/lib/accounting-nav';
import { useI18n } from '@/lib/i18n';

export default function AccountingPage() {
    const { t } = useI18n();

    const mapLinks = (items: typeof ACCOUNTING_DAILY_LINKS) =>
        items.map(({ href, key, icon, accent }) => ({
            href,
            title: t.accounting.links[key].title,
            icon,
            accent,
        }));

    const dailyLinks = useMemo(() => mapLinks(ACCOUNTING_DAILY_LINKS), [t]);
    const transactionLinks = useMemo(() => mapLinks(ACCOUNTING_TRANSACTION_LINKS), [t]);
    const reconciliationLinks = useMemo(() => mapLinks(ACCOUNTING_RECONCILIATION_LINKS), [t]);
    const reportLinks = useMemo(() => mapLinks(ACCOUNTING_REPORT_LINKS), [t]);
    const setupLinks = useMemo(() => mapLinks(ACCOUNTING_SETUP_LINKS), [t]);

    return (
        <AccountingPageShell maxWidth="wide">
            <CompactLinkGrid label={t.accounting.hub.dailyOperations} links={dailyLinks} />
            <CompactLinkGrid label={t.accounting.hub.transactions} links={transactionLinks} />
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