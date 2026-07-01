'use client';

import Link from 'next/link';
import { Activity, ShieldCheck } from 'lucide-react';
import SystemHealthPanel from '@/components/platform/SystemHealthPanel';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

export default function StatusPage() {
    const { t } = useI18n();
    const m = t.marketing.status;
    const admin = t.admin.systemHealth;

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full max-w-5xl mx-auto space-y-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <ShieldCheck className="w-5 h-5 text-indigo-600" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{admin.badge}</p>
                        </div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{m.title}</h1>
                        <p className="mt-1 text-sm text-gray-500">{m.description}</p>
                        <p className="mt-2 text-xs font-semibold text-indigo-600">{m.adminOnly}</p>
                    </div>
                    <Link
                        href={routes.admin.systemHealth}
                        className="inline-flex items-center gap-2 self-start rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50"
                    >
                        <Activity className="w-4 h-4" />
                        {m.openFullDashboard}
                    </Link>
                </div>

                <SystemHealthPanel />
            </div>
        </div>
    );
}