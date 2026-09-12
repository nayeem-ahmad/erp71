'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowRightLeft, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { formatDateTime } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

export default function InventoryTransferDetailPage() {
    const { t } = useI18n();
    const params = useParams();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const [transfer, setTransfer] = useState<any>(null);
    const [message, setMessage] = useState('');
    const [receiveLines, setReceiveLines] = useState<Record<string, string>>({});
    const [rejectionReason, setRejectionReason] = useState('');
    const [rejecting, setRejecting] = useState(false);

    useEffect(() => {
        if (!id) return;
        void loadTransfer();
    }, [id]);

    const loadTransfer = async () => {
        try {
            const data = await api.getWarehouseTransfer(String(id));
            setTransfer(data);
            setReceiveLines(
                Object.fromEntries(
                    (data.items || []).map((item: any) => [item.product_id, String(Math.max(item.quantity_sent - item.quantity_received, 0))]),
                ),
            );
        } catch (error) {
            console.error('Failed to load warehouse transfer', error);
        }
    };

    const handleSend = async () => {
        try {
            await api.sendWarehouseTransfer(String(id));
            setMessage(t.inventoryTransferDetail.transferSent);
            await loadTransfer();
        } catch (error: any) {
            setMessage(error.message || t.inventoryTransferDetail.sendFailed);
        }
    };

    const handleApprove = async () => {
        try {
            await api.approveWarehouseTransfer(String(id));
            setMessage(t.inventoryTransferDetail.transferApproved);
            await loadTransfer();
        } catch (error: any) {
            setMessage(error.message || t.inventoryTransferDetail.approveFailed);
        }
    };

    const handleReject = async () => {
        try {
            await api.rejectWarehouseTransfer(String(id), { reason: rejectionReason.trim() || undefined });
            setMessage(t.inventoryTransferDetail.transferRejected);
            setRejecting(false);
            setRejectionReason('');
            await loadTransfer();
        } catch (error: any) {
            setMessage(error.message || t.inventoryTransferDetail.rejectFailed);
        }
    };

    const handleReceive = async () => {
        try {
            await api.receiveWarehouseTransfer(String(id), {
                items: transfer.items
                    .map((item: any) => ({
                        productId: item.product_id,
                        quantityReceived: Number(receiveLines[item.product_id] || 0),
                    }))
                    .filter((item: any) => item.quantityReceived > 0),
            });
            setMessage(t.inventoryTransferDetail.receiptRecorded);
            await loadTransfer();
        } catch (error: any) {
            setMessage(error.message || t.inventoryTransferDetail.receiveFailed);
        }
    };

    if (!transfer) {
        return <div className="p-6 text-sm text-gray-500">{t.inventoryTransferDetail.loading}</div>;
    }

    const canReceive = ['SENT', 'PARTIALLY_RECEIVED'].includes(transfer.status);
    const awaitingApproval = transfer.status === 'PENDING_APPROVAL';
    const timeline = [
        { label: t.inventoryTransferDetail.timeline.created, at: transfer.created_at, tone: 'text-slate-700' },
        awaitingApproval ? { label: t.inventoryTransferDetail.timeline.awaitingApproval, at: transfer.updated_at || transfer.created_at, tone: 'text-amber-700' } : null,
        transfer.approval_date ? { label: t.inventoryTransferDetail.timeline.approved, at: transfer.approval_date, tone: 'text-emerald-700' } : null,
        transfer.rejected_at ? { label: t.inventoryTransferDetail.timeline.rejected, at: transfer.rejected_at, tone: 'text-red-700' } : null,
        transfer.sent_at ? { label: t.inventoryTransferDetail.timeline.sent, at: transfer.sent_at, tone: 'text-blue-700' } : null,
        transfer.status === 'PARTIALLY_RECEIVED' ? { label: t.inventoryTransferDetail.timeline.partiallyReceived, at: transfer.received_at || transfer.updated_at || transfer.created_at, tone: 'text-amber-700' } : null,
        transfer.status === 'RECEIVED' ? { label: t.inventoryTransferDetail.timeline.completed, at: transfer.received_at || transfer.updated_at || transfer.created_at, tone: 'text-emerald-700' } : null,
    ].filter(Boolean) as Array<{ label: string; at: string; tone: string }>;

    return (
        <PageShell>
            <div className="max-w-[1100px] mx-auto space-y-6">
                <PageHeader
                    title={formatMessage(t.inventoryTransferDetail.transferTitle, { number: transfer.transfer_number })}
                    subtitle={formatMessage(t.inventoryTransferDetail.routeSubtitle, {
                        source: transfer.sourceWarehouse?.name ?? '-',
                        destination: transfer.destinationWarehouse?.name ?? '-',
                        status: transfer.status,
                    })}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.inventory,
                        'inventory',
                        [{ label: t.inventoryTransfers.title, href: routes.inventory.transfers }],
                        transfer.transfer_number,
                    )}
                    actions={(
                        <>
                            {transfer.status === 'DRAFT' ? (
                                <button onClick={() => void handleSend()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-sm">
                                    <ArrowRightLeft className="w-4 h-4 me-2" /> {transfer.requires_approval ? t.inventoryTransferDetail.submitForApproval : t.inventoryTransferDetail.sendTransfer}
                                </button>
                            ) : null}
                            {awaitingApproval ? (
                                <>
                                    <button onClick={() => void handleApprove()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-sm">
                                        <ShieldCheck className="w-4 h-4 me-2" /> {t.inventoryTransferDetail.approveTransfer}
                                    </button>
                                    <button onClick={() => setRejecting((current) => !current)} className="bg-white border border-red-200 text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center">
                                        <XCircle className="w-4 h-4 me-2" /> {t.inventoryTransferDetail.rejectTransfer}
                                    </button>
                                </>
                            ) : null}
                            {canReceive ? (
                                <button onClick={() => void handleReceive()} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-sm">
                                    <CheckCircle2 className="w-4 h-4 me-2" /> {t.inventoryTransferDetail.receiveStock}
                                </button>
                            ) : null}
                        </>
                    )}
                />

                {message ? <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-700">{message}</div> : null}

                {awaitingApproval ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{t.inventoryTransferDetail.awaitingApprovalNotice}</span>
                    </div>
                ) : null}

                {transfer.status === 'REJECTED' ? (
                    <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                            {t.inventoryTransferDetail.rejectedNotice}
                            {transfer.rejection_reason ? ` — ${transfer.rejection_reason}` : ''}
                        </span>
                    </div>
                ) : null}

                {/* Inline rather than a modal: the approver is reading the lines
                    above while typing the reason, and a sheet would cover them. */}
                {rejecting && awaitingApproval ? (
                    <div className="bg-white border border-gray-100 rounded-lg p-4 space-y-3">
                        <label htmlFor="rejection-reason" className="block text-xs font-medium text-gray-500">
                            {t.inventoryTransferDetail.rejectionReasonLabel}
                        </label>
                        <textarea
                            id="rejection-reason"
                            rows={2}
                            maxLength={500}
                            value={rejectionReason}
                            onChange={(event) => setRejectionReason(event.target.value)}
                            placeholder={t.inventoryTransferDetail.rejectionReasonPlaceholder}
                            className="w-full bg-gray-50 border-none rounded-xl py-3 px-4 text-sm font-medium"
                        />
                        <div className="flex items-center gap-2">
                            <button onClick={() => void handleReject()} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold min-h-touch">
                                {t.inventoryTransferDetail.confirmRejection}
                            </button>
                            <button onClick={() => { setRejecting(false); setRejectionReason(''); }} className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold min-h-touch">
                                {t.common.cancel}
                            </button>
                        </div>
                    </div>
                ) : null}

                <div className="grid lg:grid-cols-[1.4fr_0.8fr] gap-6">
                    <div className="bg-white border border-gray-100 rounded-lg p-6 space-y-4">
                        <h2 className="font-bold text-lg">{t.inventoryTransferDetail.transferLines}</h2>
                        <div className="space-y-3">
                            {transfer.items.map((item: any) => {
                                const outstanding = item.quantity_sent - item.quantity_received;
                                return (
                                    <div key={item.id} className="grid md:grid-cols-[1fr_120px_120px_160px] gap-4 items-center rounded-xl bg-gray-50 px-4 py-3">
                                        <div>
                                            <div className="text-sm font-bold text-gray-900">{item.product?.name}</div>
                                            <div className="text-xs text-gray-500">
                                                {formatMessage(t.inventoryTransferDetail.sentReceived, {
                                                    sent: item.quantity_sent,
                                                    received: item.quantity_received,
                                                })}
                                            </div>
                                        </div>
                                        <div className="text-sm font-bold text-gray-700">
                                            {formatMessage(t.inventoryTransferDetail.outstanding, { count: outstanding })}
                                        </div>
                                        <div className="text-sm font-bold text-gray-700">
                                            {t.inventoryTransferDetail.statusLabel} {outstanding === 0 ? t.inventoryTransferDetail.statusComplete : t.inventoryTransferDetail.statusInTransit}
                                        </div>
                                        {canReceive ? (
                                            <input
                                                type="number"
                                                min="0"
                                                max={outstanding}
                                                value={receiveLines[item.product_id] || '0'}
                                                onChange={(event) => setReceiveLines((current) => ({ ...current, [item.product_id]: event.target.value }))}
                                                className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-4 text-sm font-medium"
                                            />
                                        ) : (
                                            <div className="text-sm text-gray-500">{t.inventoryTransferDetail.noReceiptAction}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="bg-white border border-gray-100 rounded-lg p-6 space-y-4">
                        <h2 className="font-bold text-lg">{t.inventoryTransferDetail.transferTimeline}</h2>
                        <div className="space-y-4">
                            {timeline.map((event, index) => (
                                <div key={`${event.label}-${index}`} className="flex gap-3">
                                    <div className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-600" />
                                    <div>
                                        <div className={`text-sm font-bold ${event.tone}`}>{event.label}</div>
                                        <div className="text-xs text-gray-500">{formatDateTime(event.at)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
                            <div className="font-bold text-gray-900">{t.inventoryTransferDetail.auditSnapshot}</div>
                            <div>{t.inventoryTransferDetail.source}: {transfer.sourceWarehouse?.name || '-'}</div>
                            <div>{t.inventoryTransferDetail.destination}: {transfer.destinationWarehouse?.name || '-'}</div>
                            <div>{t.inventoryTransferDetail.outstandingUnits}: {transfer.items.reduce((sum: number, item: any) => sum + (item.quantity_sent - item.quantity_received), 0)}</div>
                            <div>
                                {t.inventoryTransferDetail.scope}:{' '}
                                {transfer.is_cross_branch ? t.inventoryTransferDetail.crossBranch : t.inventoryTransferDetail.withinBranch}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
    </PageShell>
    );
}