'use client';

import { AlertTriangle, Database, Trash2, UserX } from 'lucide-react';
import CompactSection from '@/components/ui/compact/CompactSection';
import { Button } from '@/components/ui';
import { formatMessage, useI18n } from '@/lib/i18n';
import type { TenantRecord } from '../types';
import type { DemoBatch } from '../use-tenant-detail';

type Props = {
    tenant: TenantRecord;
    demoBatch: DemoBatch | null;
    isStartingDemo: boolean;
    onStartDemoData: () => void;
    isSuspending: boolean;
    onSuspend: () => void;
    isDeleting: boolean;
    onDelete: () => void;
};

export default function DangerZonePanel({
    tenant,
    demoBatch,
    isStartingDemo,
    onStartDemoData,
    isSuspending,
    onSuspend,
    isDeleting,
    onDelete,
}: Props) {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const dd = m.demoData;
    const dp = m.detailPage;

    const demoRunning = (demoBatch && (demoBatch.status === 'RUNNING' || demoBatch.status === 'PENDING'))
        || isStartingDemo;
    const alreadySuspended = tenant.subscription?.status === 'CANCELLED';

    return (
        <div className="space-y-4">
            <CompactSection>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{dd.title}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{dd.description}</p>
                    </div>
                    {!demoRunning && (
                        <Button
                            variant="secondary"
                            onClick={onStartDemoData}
                            icon={<Database className="w-4 h-4" />}
                        >
                            {dd.button}
                        </Button>
                    )}
                </div>

                {demoRunning && (
                    <div className="mt-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-700">{demoBatch?.phase || dd.generating}</span>
                            {demoBatch && demoBatch.total > 0 ? (
                                <span className="text-gray-500">
                                    {formatMessage(dd.progress, {
                                        processed: String(demoBatch.processed),
                                        total: String(demoBatch.total),
                                    })}
                                </span>
                            ) : null}
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                            <div
                                className="h-full bg-primary transition-all duration-500"
                                style={{
                                    width: `${demoBatch && demoBatch.total > 0
                                        ? Math.min(100, Math.round((demoBatch.processed / demoBatch.total) * 100))
                                        : 0}%`,
                                }}
                            />
                        </div>
                    </div>
                )}
            </CompactSection>

            <section className="rounded-lg border border-red-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 border-b border-red-200 bg-danger-light px-3 py-2 md:px-4">
                    <AlertTriangle className="w-4 h-4 text-danger-text" />
                    <p className="text-sm font-semibold text-danger-text">{dp.tabs.danger}</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-3 md:p-4">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{m.suspendTenant}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{dp.suspendDescription}</p>
                    </div>
                    <Button
                        variant="secondary"
                        onClick={onSuspend}
                        disabled={isSuspending || alreadySuspended}
                        loading={isSuspending}
                        icon={<UserX className="w-4 h-4" />}
                        className="!text-danger-text !border-red-200 hover:!bg-danger-light"
                    >
                        {alreadySuspended ? m.alreadySuspended : m.suspendTenant}
                    </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 p-3 md:p-4">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{m.deleteTenant}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{dp.deleteDescription}</p>
                    </div>
                    <Button
                        variant="danger"
                        onClick={onDelete}
                        disabled={isDeleting}
                        loading={isDeleting}
                        icon={<Trash2 className="w-4 h-4" />}
                    >
                        {m.deleteTenant}
                    </Button>
                </div>
            </section>
        </div>
    );
}
