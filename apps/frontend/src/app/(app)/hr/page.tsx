'use client';

import { useMemo } from 'react';
import {
    BadgeCheck,
    Banknote,
    CalendarOff,
    Clock,
    Layers,
    Users,
} from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

const HR_HUB_SECTIONS: HubSectionConfig[] = [
    {
        sectionKey: 'dailyOperations',
        links: [
            { href: routes.hr.employees, key: 'employees', icon: Users, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
        ],
    },
    {
        sectionKey: 'organization',
        links: [
            { href: routes.hr.departments, key: 'departments', icon: Layers, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.designations, key: 'designations', icon: BadgeCheck, accent: 'bg-primary-light text-blue-700 border-primary-border' },
        ],
    },
    {
        sectionKey: 'operations',
        links: [
            { href: routes.hr.attendance, key: 'attendance', icon: Clock, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { href: routes.hr.leaves, key: 'leaves', icon: CalendarOff, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
            { href: routes.hr.salaryPayments, key: 'salaryPayments', icon: Banknote, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
        ],
    },
];

export default function HrHubPage() {
    const { t } = useI18n();
    const hub = t.hr.hub;
    const sectionLabels = useMemo(() => ({
        dailyOperations: hub.dailyOperations,
        organization: hub.organization,
        operations: hub.operations,
    }), [hub]);

    return (
        <ModuleHub
            module="hr"
            moduleLabel={hub.moduleLabel}
            title={hub.title}
            subtitle={hub.subtitle}
            sections={HR_HUB_SECTIONS}
            sectionLabels={sectionLabels}
            linkCopy={hub.links}
            openSectionLabel={t.accountingShared.openSection}
            viewReportLabel={t.accountingShared.viewReport}
        />
    );
}