'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, Save } from 'lucide-react';
import { ContextualHelpPanel } from '@/components/ContextualHelpPanel';
import { HelpTooltip } from '@/components/HelpTooltip';
import { STOCK_TAKES_FIELD_HELP, STOCK_TAKE_DETAIL_HELP } from '@/lib/help/contextual-help';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

export default function StockTakeDetailPage() {
    const { t } = useI18n();
    const params = useParams();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const [session, setSession] = useState<any>(null);
    const [reasons, setReasons] = useState<any[]>([]);
    const [message, setMessage] = useState('');
    const [draftCounts, setDraftCounts] = useState<Record<string, { countedQuantity: string; reasonId: string; note: string }>>({});

    useEffect(() => {
        if (!id) return;
        void Promise.all([loadSession(), loadReasons()]);
    }, [id]);

    const loadSession = async () => {
        try {
            const data = await api.getStockTake(String(id));
            setSession(data);
            setDraftCounts(
                Object.fromEntries(
                    data.lines.map((line: any) => [
                        line.product_id,
                        {
                            countedQuantity: line.counted_quantity ?? '',
                            reasonId: line.reason_id ?? '',
                            note: line.note ?? '',
                        },
                    ]),
                ),
            );
        } catch (error) {
            console.error('Failed to load stock take session', error);
        }
    };

    const loadReasons = async () => {
        try {
            const data = await api.getInventoryReasons({ type: 'DISCREPANCY' });
            setReasons(data.filter((reason: any) => reason.is_active));
        } catch (error) {
            console.error('Failed to load discrepancy reasons', error);
        }
    };

    const handleSave = async () => {
        try {
            await api.updateStockTakeCounts(String(id), {
                lines: session.lines
                    .map((line: any) => ({
                        productId: line.product_id,
                        countedQuantity: Number(draftCounts[line.product_id]?.countedQuantity),
                        reasonId: draftCounts[line.product_id]?.reasonId || undefined,
                        note: draftCounts[line.product_id]?.note || undefined,
                    }))
                    .filter((line: any) => Number.isFinite(line.countedQuantity)),
            });
            setMessage(t.inventoryStockTakeDetail.countsSaved);
            await loadSession();
        } catch (error: any) {
            setMessage(error.message || t.inventoryStockTakeDetail.saveFailed);
        }
    };

    const handleMoveToReview = async () => {
        try {
            await api.updateStockTakeStatus(String(id), { status: 'REVIEW' });
            setMessage(t.inventoryStockTakeDetail.movedToReview);
            await loadSession();
        } catch (error: any) {
            setMessage(error.message || t.inventoryStockTakeDetail.statusUpdateFailed);
        }
    };

    const handlePost = async () => {
        try {
            await api.postStockTake(String(id));
            setMessage(t.inventoryStockTakeDetail.posted);
            await loadSession();
        } catch (error: any) {
            setMessage(error.message || t.inventoryStockTakeDetail.postFailed);
        }
    };

    const discrepancyCount = useMemo(
        () => session?.lines?.filter((line: any) => (line.variance_quantity ?? 0) !== 0).length ?? 0,
        [session],
    );

    const requiresReview = Boolean(session?.summary?.requiresReview);
    const canReturnToCounting = session?.status === 'REVIEW';
    const canMoveToReview = session?.status === 'COUNTING';
    const canPost = session?.status !== 'POSTED' && (!requiresReview || session?.status === 'REVIEW');

    if (!session) {
        return <div className="p-6 text-sm text-gray-500">{t.inventoryStockTakeDetail.loading}</div>;
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-[1300px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950 inline-flex items-center gap-2">
                            {formatMessage(t.inventoryStockTakeDetail.title, { number: session.session_number })}
                            <HelpTooltip text={STOCK_TAKES_FIELD_HELP.page} wide />
                        </h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {formatMessage(t.inventoryStockTakeDetail.subtitle, {
                                warehouse: session.warehouse?.name ?? '-',
                                status: session.status,
                                count: discrepancyCount,
                            })}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => void handleSave()} className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center">
                            <Save className="w-4 h-4 mr-2" /> {t.inventoryStockTakeDetail.saveCounts}
                        </button>
                        {canMoveToReview ? (
                            <button onClick={() => void handleMoveToReview()} className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">{t.inventoryStockTakeDetail.moveToReview}</button>
                        ) : null}
                        {canReturnToCounting ? (
                            <button onClick={() => void api.updateStockTakeStatus(String(id), { status: 'COUNTING' }).then(loadSession).catch((error: any) => setMessage(error.message || t.inventoryStockTakeDetail.returnFailed))} className="bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold">
                                {t.inventoryStockTakeDetail.returnToCounting}
                            </button>
                        ) : null}
                        <button disabled={!canPost} onClick={() => void handlePost()} className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-emerald-200 disabled:shadow-none">
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            <span className="inline-flex items-center gap-1.5">
                                {t.inventoryStockTakeDetail.postSession}
                                <HelpTooltip text={STOCK_TAKES_FIELD_HELP.post} side="left" />
                            </span>
                        </button>
                    </div>
                </div>

                {message ? <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-700">{message}</div> : null}

                <ContextualHelpPanel {...STOCK_TAKE_DETAIL_HELP} />

                <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryStockTakeDetail.approvalThreshold}</div>
                        <div className="mt-2 text-2xl font-black text-gray-900">{session.summary?.approvalThreshold ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryStockTakeDetail.maxVariance}</div>
                        <div className="mt-2 text-2xl font-black text-gray-900">{session.summary?.maxVariance ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryStockTakeDetail.netQuantityImpact}</div>
                        <div className={`mt-2 text-2xl font-black ${(session.summary?.netQuantityImpact ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{session.summary?.netQuantityImpact ?? 0}</div>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                        <div className="text-xs font-medium text-gray-500">{t.inventoryStockTakeDetail.estimatedValueImpact}</div>
                        <div className={`mt-2 text-2xl font-black ${(session.summary?.netValueImpact ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatBDT(Number(session.summary?.netValueImpact ?? 0))}</div>
                    </div>
                </div>

                {requiresReview ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm font-bold text-amber-900">
                        {t.inventoryStockTakeDetail.reviewRequired}
                    </div>
                ) : null}

                <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-3">
                    {session.lines.map((line: any) => {
                        const values = draftCounts[line.product_id] || { countedQuantity: '', reasonId: '', note: '' };
                        const variance = values.countedQuantity === '' ? line.variance_quantity : Number(values.countedQuantity) - line.expected_quantity;
                        return (
                            <div key={line.id} className="grid lg:grid-cols-[1.3fr_140px_140px_220px_1fr] gap-4 items-center rounded-xl bg-gray-50 px-4 py-3">
                                <div>
                                    <div className="text-sm font-black text-gray-900">{line.product?.name}</div>
                                    <div className="text-xs text-gray-500">
                                        {formatMessage(t.inventoryStockTakeDetail.expected, { qty: line.expected_quantity })}
                                    </div>
                                </div>
                                <div className="text-sm font-bold text-gray-700">
                                    {formatMessage(t.inventoryStockTakeDetail.expected, { qty: line.expected_quantity })}
                                </div>
                                <input type="number" min="0" value={values.countedQuantity} onChange={(event) => setDraftCounts((current) => ({ ...current, [line.product_id]: { ...values, countedQuantity: event.target.value } }))} className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-4 text-sm font-medium" placeholder={t.inventoryStockTakeDetail.counted} title={STOCK_TAKES_FIELD_HELP.countedQuantity} />
                                <select value={values.reasonId} onChange={(event) => setDraftCounts((current) => ({ ...current, [line.product_id]: { ...values, reasonId: event.target.value } }))} className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-4 text-sm font-medium" title={STOCK_TAKES_FIELD_HELP.reason}>
                                    <option value="">{t.inventoryStockTakeDetail.noReason}</option>
                                    {reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
                                </select>
                                <div className="space-y-2">
                                    <div className={`text-sm font-black ${variance === 0 ? 'text-gray-500' : variance > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {formatMessage(t.inventoryStockTakeDetail.variance, { value: Number.isFinite(variance) ? variance : '-' })}
                                    </div>
                                    <input value={values.note} onChange={(event) => setDraftCounts((current) => ({ ...current, [line.product_id]: { ...values, note: event.target.value } }))} className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-4 text-sm font-medium" placeholder={t.inventoryStockTakeDetail.note} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}