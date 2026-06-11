'use client';

import Link from 'next/link';
import { MessageSquare, Mail, CreditCard, Settings, ChevronRight, ShieldCheck } from 'lucide-react';

const SECTIONS = [
    {
        href: '/dashboard/admin/platform-settings/sms',
        icon: MessageSquare,
        label: 'SMS Gateway',
        description: 'API key, sender ID, and provider URL for outbound SMS.',
        color: 'text-green-600',
        bg: 'bg-green-50',
    },
    {
        href: '/dashboard/admin/platform-settings/email',
        icon: Mail,
        label: 'Email / SMTP',
        description: 'SMTP host, credentials, and sender address for transactional email.',
        color: 'text-blue-600',
        bg: 'bg-blue-50',
    },
    {
        href: '/dashboard/admin/platform-settings/payments',
        icon: CreditCard,
        label: 'Payment Gateways',
        description: 'SSL Wireless, bKash, and Nagad API credentials.',
        color: 'text-violet-600',
        bg: 'bg-violet-50',
    },
    {
        href: '/dashboard/admin/platform-settings/general',
        icon: Settings,
        label: 'General',
        description: 'Platform name, support email, and maintenance mode.',
        color: 'text-amber-600',
        bg: 'bg-amber-50',
    },
];

export default function PlatformSettingsIndexPage() {
    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-3xl mx-auto space-y-6">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck className="w-4 h-4 text-indigo-600" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Platform Admin</p>
                    </div>
                    <h1 className="text-2xl font-black tracking-tight">Platform Settings</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Manage global infrastructure credentials shared across all tenants.
                    </p>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <strong>Security notice:</strong> Secret values (API keys, passwords) are encrypted at rest.
                    Changes take effect within 60 seconds as the in-memory cache expires.
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
