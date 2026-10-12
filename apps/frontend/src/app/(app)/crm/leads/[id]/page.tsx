'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { PageShell, PageHeader } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import LeadWorkspace from '@/components/crm/LeadWorkspace';

/** The lead's own page. Everything on it is `LeadWorkspace`, which the leads board also opens in a drawer. */
export default function LeadDetailPage() {
    const { id } = useParams();
    const leadId = id as string;
    const router = useRouter();
    const { t } = useI18n();
    const m = t.crm.leads;
    const [name, setName] = useState<string | null>(null);

    return (
        <PageShell>
            {name && (
                <PageHeader
                    title={name}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.crm,
                        'crm',
                        [{ label: m.title, href: routes.crm.leads }],
                        name,
                    )}
                />
            )}
            <LeadWorkspace
                leadId={leadId}
                onLoaded={(lead) => setName(lead.name)}
                onConvertResult={({ customerId, existing }) => {
                    if (existing) alert(m.customerExists);
                    router.push(routes.sales.customerDetail(customerId));
                }}
                onDeleted={() => router.push(routes.crm.leads)}
            />
        </PageShell>
    );
}
