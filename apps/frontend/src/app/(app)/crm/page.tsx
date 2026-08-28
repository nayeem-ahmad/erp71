'use client';

import { useMemo } from 'react';
import { UserPlus, Users, Megaphone, ListChecks, MessageSquare, SlidersHorizontal, Contact } from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import CrmDashboard from '@/components/dashboard/CrmDashboard';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { canChooseCrmDashboard } from '@/lib/plan-entitlements';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';

/**
 * CRM > Overview. For a premium-CRM tenant this is the pipeline dashboard, with
 * the module link grid kept underneath it; without the module it stays the plain
 * hub it has always been, since every panel below reads lead data that plan has
 * no access to.
 */
export default function CrmHubPage() {
    const { t } = useI18n();
    const hub = t.crm.hub;
    const { planCode, features, ready } = useTenantPlanFeatures();
    const canAccessPremiumCrm = canChooseCrmDashboard(planCode, features);

    const sections: HubSectionConfig[] = useMemo(() => {
        const pipelineLinks = canAccessPremiumCrm
            ? [
                { href: routes.crm.leads, key: 'leads', icon: UserPlus, accent: 'bg-primary-light text-blue-700 border-primary-border' },
                { href: routes.crm.contacts, key: 'contacts', icon: Contact, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
                // One tile where there were two: the conversations and follow-ups
                // lists merged into /crm/activities.
                { href: routes.crm.activities, key: 'crmActivities', icon: ListChecks, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
            ]
            : [];
        const result: HubSectionConfig[] = [];
        if (pipelineLinks.length > 0) {
            result.push({ sectionKey: 'pipeline', links: pipelineLinks });
        }
        result.push({
            sectionKey: 'relationships',
            links: [
                { href: routes.crm.customers, key: 'customers', icon: Users, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
            ],
        });
        if (canAccessPremiumCrm) {
            result.push(
                {
                    sectionKey: 'engagement',
                    links: [
                        { href: routes.crm.campaigns, key: 'crmCampaigns', icon: Megaphone, accent: 'bg-danger-light text-danger-text border-red-200' },
                    ],
                },
                // One entry now: the three lookup lists and the custom fields are all
                // tabs of CRM Setup, and two of them were previously reachable only
                // by typing the URL.
                {
                    sectionKey: 'settings',
                    links: [
                        { href: routes.crm.setup, key: 'crmSetup', icon: SlidersHorizontal, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
                    ],
                },
            );
        }
        return result;
    }, [canAccessPremiumCrm]);

    const sectionLabels = useMemo(() => ({
        pipeline: hub.pipeline,
        relationships: hub.relationships,
        engagement: hub.engagement,
        settings: hub.settings,
    }), [hub]);

    return (
        <ModuleHub
            module="crm"
            moduleLabel={hub.moduleLabel}
            title={hub.title}
            subtitle={hub.subtitle}
            sections={sections}
            sectionLabels={sectionLabels}
            linkCopy={hub.links}
            openSectionLabel={t.accountingShared.openSection}
            viewReportLabel={t.accountingShared.viewReport}
        >
            {/* Waits for the plan before deciding: rendering the dashboard first and
                pulling it away is worse than a beat of nothing. */}
            {ready && canAccessPremiumCrm ? (
                <div className="mb-4">
                    <CrmDashboard variant="embedded" greeting="" tenantName="" renewalEnd={null} />
                </div>
            ) : null}
        </ModuleHub>
    );
}
