'use client';

import Link from 'next/link';
import { MessageSquare, Mail, CreditCard, Settings, ChevronRight, ShieldCheck, Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function PlatformSettingsIndexPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.index;

    const SECTIONS = [
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
            href: '/admin/platform-settings/payments',
            icon: CreditCard,
            label: m.sections.payments.label,
            description: m.sections.payments.description,
            color: 'text-violet-600',
            bg: 'bg-violet-50',
        },
        {
            href: '/admin/platform-settings/general',
            icon: Settings,
            label: m.sections.general.label,
            description: m.sections.general.description,
            color: 'text-amber-600',
            bg: 'bg-amber-50',
        },
        {
            href: '/admin/platform-settings/ai',
            icon: Sparkles,
            label: 'AI (OpenRouter)',
            description: 'OpenRouter API key and default model for AI-powered features across all tenants.',
            color: 'text-purple-600',
            bg: 'bg-purple-50',
        },
    ];

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-3xl mx-auto space-y-6">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck className="w-4 h-4 text-indigo-600" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{m.badge}</p>
                    </div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{m.title}</h1>
                    <p className="mt-1 text-sm text-gray-500">{m.description}</p>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <strong>{m.securityNotice}</strong> {m.securityBody}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {SECTIONS.map(({ href, icon: Icon, label, description, color, bg }) => (
                        <Link
                            key={href}
                            href={href}
                            className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 hover:border-blue-300 hover:shadow-sm transition-all group"
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
        </div>
    );
}