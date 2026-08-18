'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageShell, PageHeader } from '@/components/ui';
import CrmListPanel from '@/components/crm/CrmListPanel';
import CrmCustomFieldsPanel from '@/components/crm/CrmCustomFieldsPanel';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { hasPermission, isOwner } from '@/lib/permissions';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const TABS = ['channels', 'purposes', 'sources', 'categories', 'customFields'] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
    return TABS.includes(value as Tab);
}

/**
 * Every CRM list a tenant owns, on one screen.
 *
 * These were three separate pages, two of which nothing linked to. Tabs keep them
 * together because they are the same kind of decision ("what can my team pick
 * from?") and are almost always configured in one sitting.
 */
function CrmSetupPage() {
    const { t } = useI18n();
    const m = t.crm.setup;
    const router = useRouter();
    const searchParams = useSearchParams();

    const [canManage, setCanManage] = useState(false);

    // The tab lives in the URL so a specific list can be linked to and survives a
    // reload — the CRM hub links straight at ?tab=channels.
    const param = searchParams.get('tab');
    const tab: Tab = isTab(param) ? param : 'channels';

    const selectTab = useCallback(
        (next: Tab) => router.replace(`${routes.crm.setup}?tab=${next}`, { scroll: false }),
        [router],
    );

    useEffect(() => {
        api.getMe()
            .then((me) => {
                const tenant =
                    me?.tenants?.find((e: { id: string }) => e.id === localStorage.getItem('tenant_id'))
                    ?? me?.tenants?.[0];
                setCanManage(
                    isOwner(tenant?.role) || hasPermission(tenant?.permissions, 'MANAGE_CRM_SETTINGS'),
                );
            })
            .catch(() => setCanManage(false));
    }, []);

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    m.title,
                    'crm',
                )}
            />

            <div className="flex flex-wrap gap-2" role="tablist">
                {TABS.map((k) => (
                    <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={tab === k}
                        onClick={() => selectTab(k)}
                        className={`min-h-touch rounded-md px-3 text-sm font-medium ${
                            tab === k
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        {m.tabs[k]}
                    </button>
                ))}
            </div>

            <p className="text-sm text-gray-500">{m.descriptions[tab]}</p>

            {/* Keyed so switching tabs remounts the panel — otherwise a panel would
                keep the previous list's rows on screen until its refetch lands. */}
            {tab === 'customFields'
                ? <CrmCustomFieldsPanel canManage={canManage} />
                : <CrmListPanel key={tab} kind={tab} canManage={canManage} />}
        </PageShell>
    );
}

export default function CrmSetupPageWrapper() {
    // useSearchParams needs a Suspense boundary to keep the route statically
    // renderable under the app router.
    return (
        <Suspense fallback={null}>
            <CrmSetupPage />
        </Suspense>
    );
}
