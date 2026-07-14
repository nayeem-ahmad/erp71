'use client';

import Link from 'next/link';
import { MessageSquare, Mail, Landmark, Cog, ChevronRight, Sparkles, LayoutList, BadgePercent, MessageCircle, ToggleLeft, PackagePlus, Bot, Share2, Lightbulb, Rocket } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

export default function PlatformSettingsIndexPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.index;

    const GROUPS = [
        {
            key: 'channels',
            heading: m.groups.channels,
            sections: [
                {
                    href: '/admin/platform-settings/sms',
                    icon: MessageSquare,
                    label: m.sections.sms.label,
                    description: m.sections.sms.description,
                    color: 'text-green-600',
                    bg: 'bg-green-50',
                },
                {
                    href: '/admin/platform-settings/email',
                    icon: Mail,
                    label: m.sections.email.label,
                    description: m.sections.email.description,
                    color: 'text-blue-600',
                    bg: 'bg-blue-50',
                },
                {
                    href: routes.admin.platformSettings.whatsapp,
                    icon: MessageCircle,
                    label: m.sections.whatsapp.label,
                    description: m.sections.whatsapp.description,
                    color: 'text-emerald-600',
                    bg: 'bg-emerald-50',
                },
                {
                    href: '/admin/platform-settings/payments',
                    icon: Landmark,
                    label: m.sections.payments.label,
                    description: m.sections.payments.description,
                    color: 'text-violet-600',
                    bg: 'bg-violet-50',
                },
            ],
        },
        {
            key: 'plans',
            heading: m.groups.plans,
            sections: [
                {
                    href: '/admin/platform-settings/plans',
                    icon: BadgePercent,
                    label: m.sections.plans.label,
                    description: m.sections.plans.description,
                    color: 'text-rose-600',
                    bg: 'bg-rose-50',
                },
                {
                    href: '/admin/platform-settings/addons',
                    icon: PackagePlus,
                    label: 'Add-on Modules',
                    description: 'Manage optional paid modules (Manufacturing, Advanced Accounting, etc.) tenants can buy on top of any plan.',
                    color: 'text-teal-600',
                    bg: 'bg-teal-50',
                },
            ],
        },
        {
            key: 'config',
            heading: m.groups.config,
            sections: [
                {
                    href: '/admin/platform-settings/general',
                    icon: Cog,
                    label: m.sections.general.label,
                    description: m.sections.general.description,
                    color: 'text-amber-600',
                    bg: 'bg-amber-50',
                },
                {
                    href: '/admin/platform-settings/tenant-features',
                    icon: ToggleLeft,
                    label: m.sections.tenantFeatures.label,
                    description: m.sections.tenantFeatures.description,
                    color: 'text-indigo-600',
                    bg: 'bg-indigo-50',
                },
                {
                    href: '/admin/platform-settings/ai',
                    icon: Sparkles,
                    label: 'AI (OpenRouter)',
                    description: 'OpenRouter API key and default model for AI-powered features across all tenants.',
                    color: 'text-purple-600',
                    bg: 'bg-purple-50',
                },
                {
                    href: '/admin/platform-settings/navigation',
                    icon: LayoutList,
                    label: m.sections.navigation.label,
                    description: m.sections.navigation.description,
                    color: 'text-sky-600',
                    bg: 'bg-sky-50',
                },
                {
                    href: '/admin/platform-settings/feedback-automation',
                    icon: Bot,
                    label: 'Feedback Automation',
                    description: 'Experimental: let an agent propose implementation plans for approved tenant feedback and open a PR once you approve.',
                    color: 'text-fuchsia-600',
                    bg: 'bg-fuchsia-50',
                },
                {
                    href: '/admin/platform-settings/deploy',
                    icon: Rocket,
                    label: 'Production Deploy',
                    description: 'Ship the latest green main to the production VPS, and see what is live vs. pending. Feedback Automation auto-promotes to main; this button deploys it.',
                    color: 'text-emerald-600',
                    bg: 'bg-emerald-50',
                },
            ],
        },
        {
            key: 'growth',
            heading: m.groups.growth,
            sections: [
                {
                    href: '/admin/referrals',
                    icon: Share2,
                    label: m.sections.referrals.label,
                    description: m.sections.referrals.description,
                    color: 'text-pink-600',
                    bg: 'bg-pink-50',
                },
                {
                    href: '/admin/feedback',
                    icon: Lightbulb,
                    label: m.sections.feedback.label,
                    description: m.sections.feedback.description,
                    color: 'text-cyan-600',
                    bg: 'bg-cyan-50',
                },
            ],
        },
    ];

    return (
        <PageShell>
            <div className="max-w-3xl mx-auto space-y-6">
                <PageHeader
                    title={m.title}
                    subtitle={m.description}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
                    )}
                />

                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <strong>{m.securityNotice}</strong> {m.securityBody}
                </div>

                {GROUPS.map((group) => (
                    <div key={group.key} className="space-y-3">
                        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">{group.heading}</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {group.sections.map(({ href, icon: Icon, label, description, color, bg }) => (
                                <Link
                                    key={href}
                                    href={href}
                                    className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4 hover:border-blue-300 hover:shadow-sm transition-all group"
                                >
                                    <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
                                        <Icon className={`w-5 h-5 ${color}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-gray-800">{label}</p>
                                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0 transition-colors" />
                                </Link>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </PageShell>
    );
}