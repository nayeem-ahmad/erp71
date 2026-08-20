'use client';

import { useMemo } from 'react';
import {
    ArrowLeftRight,
    BadgeCheck,
    Banknote,
    BarChart3,
    BookOpen,
    Briefcase,
    CalendarDays,
    CalendarOff,
    ClipboardList,
    Clock,
    Landmark,
    Layers,
    ScrollText,
    UserSearch,
    Users,
    Wallet,
} from 'lucide-react';
import ModuleHub, { type HubSectionConfig } from '@/components/ModuleHub';
import HrDashboard from '@/components/dashboard/HrDashboard';
import { hasPermission } from '@/lib/permissions';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

/** Mirrors the HR sidebar tree in `NAV_REGISTRY` — the hub and the menu must group alike. */
const HR_HUB_SECTIONS: HubSectionConfig[] = [
    {
        sectionKey: 'people',
        links: [
            { href: routes.hr.employees, key: 'employees', icon: Users, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
        ],
    },
    {
        sectionKey: 'attendanceLeave',
        links: [
            { href: routes.hr.attendance, key: 'attendance', icon: Clock, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { href: routes.hr.attendancePunches, key: 'attendancePunches', icon: ArrowLeftRight, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { href: routes.hr.leaves, key: 'leaves', icon: CalendarOff, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
        ],
    },
    {
        sectionKey: 'payroll',
        links: [
            { href: routes.hr.salaryPayments, key: 'salaryPayments', icon: Banknote, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
        ],
    },
    {
        sectionKey: 'recruitment',
        links: [
            { href: routes.hr.jobPosts, key: 'jobPosts', icon: Briefcase, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.applicants, key: 'applicants', icon: UserSearch, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.applications, key: 'applications', icon: ClipboardList, accent: 'bg-primary-light text-blue-700 border-primary-border' },
        ],
    },
    {
        sectionKey: 'reports',
        links: [
            { href: routes.hr.reports.attendance, key: 'attendanceReport', icon: BarChart3, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.reports.leaveBalance, key: 'leaveBalanceReport', icon: CalendarOff, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.reports.payrollCost, key: 'payrollCostReport', icon: Banknote, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.reports.wagesRegister, key: 'wagesRegister', icon: ScrollText, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.reports.employeeRegister, key: 'employeeRegister', icon: Users, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.reports.taxDeduction, key: 'taxDeduction', icon: Landmark, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.reports.providentFund, key: 'providentFund', icon: Wallet, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.reports.serviceBook, key: 'serviceBook', icon: BookOpen, accent: 'bg-primary-light text-blue-700 border-primary-border' },
        ],
    },
    {
        sectionKey: 'setup',
        links: [
            { href: routes.hr.departments, key: 'departments', icon: Layers, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.designations, key: 'designations', icon: BadgeCheck, accent: 'bg-primary-light text-blue-700 border-primary-border' },
            { href: routes.hr.schedules, key: 'schedules', icon: CalendarDays, accent: 'bg-primary-light text-blue-700 border-primary-border' },
        ],
    },
];

/**
 * HR > Overview. The team dashboard above the link hub, for anyone holding
 * `VIEW_HR`; the payroll half of it is gated separately server-side.
 */
export default function HrHubPage() {
    const { t } = useI18n();
    const { permissions, ready } = useTenantPlanFeatures();
    const canViewHr = hasPermission(permissions, 'VIEW_HR');
    const hub = t.hr.hub;
    const sectionLabels = useMemo(() => ({
        people: hub.people,
        attendanceLeave: hub.attendanceLeave,
        payroll: hub.payroll,
        recruitment: hub.recruitment,
        reports: hub.reports,
        setup: hub.setup,
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
        >
            {ready && canViewHr ? (
                <div className="mb-4">
                    <HrDashboard variant="embedded" greeting="" tenantName="" renewalEnd={null} />
                </div>
            ) : null}
        </ModuleHub>
    );
}