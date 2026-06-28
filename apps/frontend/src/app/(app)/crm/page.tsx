'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Megaphone, UserPlus, Users } from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';

export default function CrmHubPage() {
    const { t } = useI18n();
    const hub = t.crm.hub;
    const [canAccessPremiumCrm, setCanAccessPremiumCrm] = useState(false);

    useEffect(() => {
        api.getMe().then((me) => {
            const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === localStorage.getItem('tenant_id')) ?? me?.tenants?.[0];
            const planCode = tenant?.subscription?.plan?.code;
            const features = (tenant?.subscription?.plan?.features_json ?? {}) as Record<string, unknown>;
            setCanAccessPremiumCrm(planCode === 'PREMIUM' || Boolean(features.premiumCrm));
        }).catch(() => null);
    }, []);

    const sections: HubSectionConfig[] = useMemo(() => {
        const pipelineLinks = canAccessPremiumCrm
            ? [{ href: routes.crm.leads, key: 'leads', icon: UserPlus, accent: 'bg-violet-50 text-violet-700 border-violet-100' }]
            : [];
        const result: HubSectionConfig[] = [];
        if (pipelineLinks.length > 0) {
            result.push({ sectionKey: 'pipeline', links: pipelineLinks });
        }
        result.push({
            sectionKey: 'relationships',
            links: [
                { href: routes.crm.customers, key: 'customers', icon: Users, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
                { href: routes.crm.tasks, key: 'crmTasks', icon: CheckSquare, accent: 'bg-teal-50 text-teal-700 border-teal-100' },
                { href: routes.crm.campaigns, key: 'crmCampaigns', icon: Megaphone, accent: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100' },
            ],
        });
        return result;
    }, [canAccessPremiumCrm]);

    const sectionLabels = useMemo(() => ({
        pipeline: hub.pipeline,
        relationships: hub.relationships,
    }), [hub]);

    return (
        <ModuleHub
            moduleLabel={hub.moduleLabel}
            title={hub.title}
            subtitle={hub.subtitle}
            sections={sections}
            sectionLabels={sectionLabels}
            linkCopy={hub.links}
            openSectionLabel={t.accountingShared.openSection}
            viewReportLabel={t.accountingShared.viewReport}
        />
    );
}