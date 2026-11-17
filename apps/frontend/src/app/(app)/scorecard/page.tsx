'use client';

import { useCallback } from 'react';
import { KpiAudience } from '@erp71/shared-types';
import KpiScorecardView from '@/components/kpis/KpiScorecardView';
import { BranchFilter } from '@/components/ui';
import { api } from '@/lib/api';
import { useBranchScope } from '@/lib/branch-scope';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/**
 * The shop's KPI scorecard. Opens on the whole business for anyone allowed to
 * see it (owner, or consolidated reports); the branch filter narrows it.
 */
export default function ScorecardPage() {
    const { t } = useI18n();
    const copy = t.kpis.tenant;
    const branch = useBranchScope({ startOnAll: true });
    const storeId = branch.apiStoreId;

    const load = useCallback(
        (range: { from: string; to: string }) => api.getKpiScorecard({ ...range, storeId }),
        [storeId],
    );

    return (
        <KpiScorecardView
            audience={KpiAudience.TENANT}
            title={copy.title}
            subtitle={copy.subtitle}
            breadcrumbs={modulePageBreadcrumbs(
                t.dashboardHome.breadcrumbHome,
                t.sidebar.modules.accountSettings,
                copy.title,
                'settings',
            )}
            actions={<BranchFilter scope={branch} />}
            load={load}
            ready={branch.ready}
        />
    );
}
