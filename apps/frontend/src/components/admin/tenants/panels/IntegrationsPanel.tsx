'use client';

import Link from 'next/link';
import { PlugZap } from 'lucide-react';
import CompactSection from '@/components/ui/compact/CompactSection';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import TenantMessagingIdentityCard from '../TenantMessagingIdentityCard';
import type { TenantRecord } from '../types';

type Props = {
    tenant: TenantRecord;
    onToast: (message: string) => void;
    onError: (message: string) => void;
};

export default function IntegrationsPanel({ tenant, onToast, onError }: Props) {
    const { t } = useI18n();
    const dp = t.admin.tenants.detailPage;

    return (
        <div className="space-y-4">
            <TenantMessagingIdentityCard
                tenantId={tenant.id}
                onToast={onToast}
                onError={onError}
            />

            <CompactSection>
                <p className="text-sm font-semibold text-gray-900">{dp.externalImportTitle}</p>
                <p className="mt-0.5 text-xs text-gray-500">{dp.externalImportDescription}</p>
                <Link
                    href={`${routes.admin.tenantDetail(tenant.id)}/external-sync`}
                    className="mt-3 inline-flex min-h-touch items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                    <PlugZap className="w-4 h-4" />
                    {dp.configureImport}
                </Link>
            </CompactSection>
        </div>
    );
}
