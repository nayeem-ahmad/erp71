'use client';

import { useCallback } from 'react';
import { KpiAudience } from '@erp71/shared-types';
import KpiScorecardView from '@/components/kpis/KpiScorecardView';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/** ERP71's own KPI scorecard, in the admin console. */
export default function PlatformKpisPage() {
    const { t } = useI18n();
    const copy = t.kpis.platform;
    const load = useCallback((range: { from: string; to: string }) => api.getPlatformKpiScorecard(range), []);

    return (
        <KpiScorecardView
            audience={KpiAudience.PLATFORM}
            title={copy.title}
            subtitle={copy.subtitle}
            breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.admin, copy.title, 'admin')}
            load={load}
        />
    );
}
