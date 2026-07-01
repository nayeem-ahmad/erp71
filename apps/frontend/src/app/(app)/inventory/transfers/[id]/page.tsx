'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowRightLeft, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';

export default function InventoryTransferDetailPage() {
    const { t } = useI18n();
    const params = useParams();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const [transfer, setTransfer] = useState<any>(null);
    const [message, setMessage] = useState('');
    const [receiveLines, setReceiveLines] = useState<Record<string, string>>({});

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
    const timeline = [
        { label: t.inventoryTransferDetail.timeline.created, at: transfer.created_at, tone: 'text-slate-700' },
        transfer.sent_at ? { label: t.inventoryTransferDetail.timeline.sent, at: transfer.sent_at, tone: 'text-blue-700' } : null,
        transfer.status === 'PARTIALLY_RECEIVED' ? { label: t.inventoryTransferDetail.timeline.partiallyReceived, at: transfer.received_at || transfer.updated_at || transfer.created_at, tone: 'text-amber-700' } : null,
        transfer.status === 'RECEIVED' ? { label: t.inventoryTransferDetail.timeline.completed, at: transfer.received_at || transfer.updated_at || transfer.created_at, tone: 'text-emerald-700' } : null,
    ].filter(Boolean) as Array<{ label: string; at: string; tone: string }>;

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-[1100px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">
                            {formatMessage(t.inventoryTransferDetail.transferTitle, { number: transfer.transfer_number })}
                        </h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {formatMessage(t.inventoryTransferDetail.routeSubtitle, {
                                source: transfer.sourceWarehouse?.name ?? '-',
                                destination: transfer.destinationWarehouse?.name ?? '-',
                                status: transfer.status,
                            })}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {transfer.status === 'DRAFT' ? (
                            <button onClick={() => void handleSend()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200">
                                <ArrowRightLeft className="w-4 h-4 mr-2" /> {t.inventoryTransferDetail.sendTransfer}
                            </button>
                        ) : null}
                        {canReceive ? (
                            <button onClick={() => void handleReceive()} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-emerald-200">
                                <CheckCircle2 className="w-4 h-4 mr-2" /> {t.inventoryTransferDetail.receiveStock}
                            </button>
                        ) : null}
                    </div>
                </div>

                {message ? <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-700">{message}</div> : null}

                <div className="grid lg:grid-cols-[1.4fr_0.8fr] gap-6">
                    <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                        <h2 className="font-black text-lg">{t.inventoryTransferDetail.transferLines}</h2>
                        <div className="space-y-3">
                            {transfer.items.map((item: any) => {
                                const outstanding = item.quantity_sent - item.quantity_received;
                                return (
                                    <div key={item.id} className="grid md:grid-cols-[1fr_120px_120px_160px] gap-4 items-center rounded-xl bg-gray-50 px-4 py-3">
                                        <div>
                                            <div className="text-sm font-black text-gray-900">{item.product?.name}</div>
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

                    <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4">
                        <h2 className="font-black text-lg">{t.inventoryTransferDetail.transferTimeline}</h2>
                        <div className="space-y-4">
                            {timeline.map((event, index) => (
                                <div key={`${event.label}-${index}`} className="flex gap-3">
                                    <div className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-600" />
                                    <div>
                                        <div className={`text-sm font-black ${event.tone}`}>{event.label}</div>
                                        <div className="text-xs text-gray-500">{new Date(event.at).toLocaleString()}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
                            <div className="font-bold text-gray-900">{t.inventoryTransferDetail.auditSnapshot}</div>
                            <div>{t.inventoryTransferDetail.source}: {transfer.sourceWarehouse?.name || '-'}</div>
                            <div>{t.inventoryTransferDetail.destination}: {transfer.destinationWarehouse?.name || '-'}</div>
                            <div>{t.inventoryTransferDetail.outstandingUnits}: {transfer.items.reduce((sum: number, item: any) => sum + (item.quantity_sent - item.quantity_received), 0)}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}