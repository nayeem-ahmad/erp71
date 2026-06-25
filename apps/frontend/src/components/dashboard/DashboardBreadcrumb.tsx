'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function DashboardBreadcrumb() {
    const { t } = useI18n();
    const copy = t.dashboardHome;

    return (
        <nav className="flex items-center gap-1.5 text-sm text-gray-500" aria-label="Breadcrumb">
            <Link href="/dashboard" className="font-semibold hover:text-gray-800 transition-colors">
                {copy.breadcrumbHome}
            </Link>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />
            <span className="font-bold text-gray-800">{copy.businessMonitor}</span>
        </nav>
    );
}