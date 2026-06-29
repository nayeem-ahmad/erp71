'use client';

import { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, Plus, X, Search, CheckCircle, XCircle, Clock, Wrench, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import type { WarrantyClaim } from '@erp71/shared-types';
import { useI18n, formatMessage } from '@/lib/i18n';

const STATUS_STYLES: Record<string, string> = {
    SUBMITTED: 'bg-blue-50 text-blue-700 border-blue-200',
    APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    REPAIRED: 'bg-purple-50 text-purple-700 border-purple-200',
    REPLACED: 'bg-amber-50 text-amber-700 border-amber-200',
    COMPLETED: 'bg-gray-50 text-gray-700 border-gray-200',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
    SUBMITTED: <Clock className="w-3 h-3" />,
    APPROVED: <CheckCircle className="w-3 h-3" />,
    REJECTED: <XCircle className="w-3 h-3" />,
    REPAIRED: <Wrench className="w-3 h-3" />,
    REPLACED: <RefreshCw className="w-3 h-3" />,
    COMPLETED: <CheckCircle className="w-3 h-3" />,
};

const NEXT_STATUSES: Record<string, string[]> = {
    SUBMITTED: ['APPROVED', 'REJECTED'],
    APPROVED: ['REPAIRED', 'REPLACED', 'COMPLETED'],
    REPAIRED: ['COMPLETED'],
    REPLACED: ['COMPLETED'],
    REJECTED: [],
    COMPLETED: [],
};

type LookupResult = {
    serial: any;
    product: any;
    customer: any;
    sale: any;
    warrantyDays: number;
    soldAt: string | null;
    expiresAt: string | null;
    isExpired: boolean;
    isClaimed: boolean;
    isClaimable: boolean;
};

const columnHelper = createColumnHelper<WarrantyClaim>();

export default function WarrantyClaimsPage() {
    const { t, locale } = useI18n();
    const [claims, setClaims] = useState<WarrantyClaim[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [statusModalClaim, setStatusModalClaim] = useState<WarrantyClaim | null>(null);

    // New claim form state
    const [serialInput, setSerialInput] = useState('');
    const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
    const [lookupError, setLookupError] = useState('');
    const [lookupLoading, setLookupLoading] = useState(false);
    const [reason, setReason] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Status update state
    const [newStatus, setNewStatus] = useState('');
    const [resolutionNotes, setResolutionNotes] = useState('');
    const [replacementSerial, setReplacementSerial] = useState('');
    const [statusUpdating, setStatusUpdating] = useState(false);

    const storeId = typeof window !== 'undefined' ? localStorage.getItem('store_id') ?? '' : '';

    useEffect(() => {
        loadClaims();
    }, []);

    const loadClaims = async () => {
        try {
            const data = await api.getWarrantyClaims();
            setClaims(data);
        } catch (err) {
            console.error('Failed to load warranty claims', err);
        } finally {
            setLoading(false);
        }
    };

    const handleLookup = async () => {
        if (!serialInput.trim()) return;
        setLookupLoading(true);
        setLookupError('');
        setLookupResult(null);
        try {
            const result = await api.lookupWarrantySerial(serialInput.trim());
            setLookupResult(result);
        } catch (err: any) {
            setLookupError(err.message ?? t.shared.errors.serialNotFound);
        } finally {
            setLookupLoading(false);
        }
    };

    const handleSubmitClaim = async () => {
        if (!lookupResult?.isClaimable || !reason.trim()) return;
        setSubmitting(true);
        try {
            const claim = await api.createWarrantyClaim({
                storeId,
                serialNumber: serialInput.trim(),
                reason: reason.trim(),
                description: description.trim() || undefined,
            });
            setClaims((prev) => [claim, ...prev]);
            closeModal();
        } catch (err: any) {
            setLookupError(err.message ?? t.shared.errors.submitClaim);
        } finally {
            setSubmitting(false);
        }
    };

    const handleStatusUpdate = async () => {
        if (!statusModalClaim || !newStatus) return;
        setStatusUpdating(true);
        try {
            const updated = await api.updateWarrantyClaimStatus(statusModalClaim.id, {
                status: newStatus,
                resolutionNotes: resolutionNotes.trim() || undefined,
                replacementSerialNumber: newStatus === 'REPLACED' ? replacementSerial.trim() || undefined : undefined,
            });
            setClaims((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setStatusModalClaim(null);
            setNewStatus('');
            setResolutionNotes('');
            setReplacementSerial('');
        } catch (err: any) {
            console.error('Status update failed', err);
        } finally {
            setStatusUpdating(false);
        }
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setSerialInput('');
        setLookupResult(null);
        setLookupError('');
        setReason('');
        setDescription('');
    };

    const openStatusModal = (claim: WarrantyClaim) => {
        setStatusModalClaim(claim);
        setNewStatus(NEXT_STATUSES[claim.status]?.[0] ?? '');
        setResolutionNotes('');
        setReplacementSerial('');
    };

    const columns = useMemo(
        () => [
            columnHelper.accessor('claim_number', {
                header: t.shared.columns.claimNumber,
                cell: (info) => (
                    <span className="font-mono text-sm font-medium text-gray-900">
                        {info.getValue()}
                    </span>
                ),
            }),
            columnHelper.accessor('serial_number', {
                header: t.shared.columns.serialNumberFull,
                cell: (info) => (
                    <span className="font-mono text-sm text-gray-700">{info.getValue()}</span>
                ),
            }),
            columnHelper.accessor('replacement_serial_number', {
                header: t.shared.columns.replacementSerial,
                cell: (info) => {
                    const v = info.getValue();
                    return v ? (
                        <span className="font-mono text-sm text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            {v}
                        </span>
                    ) : (
                        <span className="text-gray-400 text-sm">—</span>
                    );
                },
            }),
            columnHelper.display({
                id: 'product',
                header: t.shared.columns.product,
                cell: ({ row }) => (
                    <span className="text-sm text-gray-900">{row.original.product?.name ?? '—'}</span>
                ),
            }),
            columnHelper.display({
                id: 'customer',
                header: t.shared.columns.customer,
                cell: ({ row }) => (
                    <span className="text-sm text-gray-700">{row.original.customer?.name ?? '—'}</span>
                ),
            }),
            columnHelper.accessor('reason', {
                header: t.shared.columns.reason,
                cell: (info) => <span className="text-sm text-gray-700">{info.getValue()}</span>,
            }),
            columnHelper.accessor('status', {
                header: t.shared.columns.status,
                cell: (info) => {
                    const s = info.getValue();
                    return (
                        <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[s] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}
                        >
                            {STATUS_ICONS[s]}
                            {s}
                        </span>
                    );
                },
            }),
            columnHelper.accessor('created_at', {
                header: t.shared.columns.date,
                cell: (info) => (
                    <span className="text-sm text-gray-500">
                        {formatDate(info.getValue(), locale)}
                    </span>
                ),
            }),
            columnHelper.display({
                id: 'actions',
                header: '',
                cell: ({ row }) => {
                    const claim = row.original;
                    const next = NEXT_STATUSES[claim.status] ?? [];
                    if (next.length === 0) return null;
                    return (
                        <button
                            onClick={() => openStatusModal(claim)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                            {t.warrantyClaims.updateStatus}
                        </button>
                    );
                },
            }),
        ],
        [t, locale],
    );

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <ShieldCheck className="w-6 h-6 text-indigo-600" />
                    <div>
                        <h1 className="text-xl font-semibold text-gray-900">{t.warrantyClaims.title}</h1>
                        <p className="text-sm text-gray-500">{t.warrantyClaims.subtitle}</p>
                    </div>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    {t.warrantyClaims.newClaim}
                </button>
            </div>

            {loading ? (
                <div className="text-center py-16 text-gray-400">{t.warrantyClaims.loadingClaims}</div>
            ) : (
                <DataTable tableId="warranty-claims" title={t.warrantyClaims.title} columns={columns} data={claims} />
            )}

            {/* {t.warrantyClaims.newClaim} Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
                        <div className="flex items-center justify-between p-5 border-b">
                            <h2 className="text-lg font-semibold text-gray-900">{t.warrantyClaims.submitTitle}</h2>
                            <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* Serial number lookup */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t.warrantyClaims.serialNumber}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={serialInput}
                                        onChange={(e) => {
                                            setSerialInput(e.target.value);
                                            setLookupResult(null);
                                            setLookupError('');
                                        }}
                                        onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                                        placeholder={t.warrantyClaims.enterSerial}
                                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                    <button
                                        onClick={handleLookup}
                                        disabled={lookupLoading || !serialInput.trim()}
                                        className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                                    >
                                        <Search className="w-4 h-4" />
                                        {lookupLoading ? t.warrantyClaims.lookingUp : t.warrantyClaims.lookUp}
                                    </button>
                                </div>
                                {lookupError && (
                                    <p className="text-red-600 text-xs mt-1">{lookupError}</p>
                                )}
                            </div>

                            {/* Lookup result */}
                            {lookupResult && (
                                <div
                                    className={`rounded-lg border p-4 text-sm space-y-1.5 ${
                                        lookupResult.isClaimable
                                            ? 'border-emerald-200 bg-emerald-50'
                                            : 'border-red-200 bg-red-50'
                                    }`}
                                >
                                    <p className="font-medium text-gray-900">
                                        {lookupResult.product?.name}
                                    </p>
                                    {lookupResult.customer && (
                                        <p className="text-gray-600">
                                            {t.warrantyClaims.customerLabel} {lookupResult.customer.name} ({lookupResult.customer.phone})
                                        </p>
                                    )}
                                    {lookupResult.soldAt && (
                                        <p className="text-gray-600">
                                            {t.warrantyClaims.sold} {formatDate(lookupResult.soldAt, locale)} &nbsp;·&nbsp;
                                            {formatMessage(t.warrantyClaims.warrantyDays, { days: lookupResult.warrantyDays })}
                                        </p>
                                    )}
                                    {lookupResult.expiresAt && (
                                        <p className="text-gray-600">
                                            {t.warrantyClaims.expires} {formatDate(lookupResult.expiresAt, locale)}
                                        </p>
                                    )}
                                    {lookupResult.isClaimed && (
                                        <p className="text-red-600 font-medium">
                                            {t.warrantyClaims.alreadyClaimed}
                                        </p>
                                    )}
                                    {lookupResult.isExpired && !lookupResult.isClaimed && (
                                        <p className="text-red-600 font-medium">{t.warrantyClaims.warrantyExpired}</p>
                                    )}
                                    {lookupResult.isClaimable && (
                                        <p className="text-emerald-700 font-medium">
                                            {t.warrantyClaims.eligible}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Claim form — only shown after a valid lookup */}
                            {lookupResult?.isClaimable && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t.warrantyClaims.reasonRequired} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            placeholder={t.warrantyClaims.reasonPlaceholder}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t.warrantyClaims.additionalDetails}
                                        </label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows={3}
                                            placeholder={t.warrantyClaims.additionalDetailsPlaceholder}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 p-5 border-t">
                            <button
                                onClick={closeModal}
                                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                            >
                                {t.common.cancel}
                            </button>
                            {lookupResult?.isClaimable && (
                                <button
                                    onClick={handleSubmitClaim}
                                    disabled={submitting || !reason.trim()}
                                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                >
                                    {submitting ? t.warrantyClaims.submitting : t.warrantyClaims.submitClaim}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Status Update Modal */}
            {statusModalClaim && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
                        <div className="flex items-center justify-between p-5 border-b">
                            <h2 className="text-lg font-semibold text-gray-900">{t.warrantyClaims.updateClaimStatus}</h2>
                            <button
                                onClick={() => setStatusModalClaim(null)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <p className="text-sm text-gray-600">
                                Claim <span className="font-mono font-medium">{statusModalClaim.claim_number}</span>
                                &nbsp;·&nbsp;Serial{' '}
                                <span className="font-mono font-medium">{statusModalClaim.serial_number}</span>
                            </p>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t.warrantyClaims.newStatus}
                                </label>
                                <select
                                    value={newStatus}
                                    onChange={(e) => setNewStatus(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    {NEXT_STATUSES[statusModalClaim.status]?.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {newStatus === 'REPLACED' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Replacement {t.warrantyClaims.serialNumber} <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={replacementSerial}
                                        onChange={(e) => setReplacementSerial(e.target.value)}
                                        placeholder={t.warrantyClaims.replacementSerialPlaceholder}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        {t.warrantyClaims.replacementHint}
                                    </p>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {t.warrantyClaims.resolutionNotes}
                                </label>
                                <textarea
                                    value={resolutionNotes}
                                    onChange={(e) => setResolutionNotes(e.target.value)}
                                    rows={3}
                                    placeholder={t.warrantyClaims.resolutionPlaceholder}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-5 border-t">
                            <button
                                onClick={() => setStatusModalClaim(null)}
                                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleStatusUpdate}
                                disabled={
                                    statusUpdating ||
                                    !newStatus ||
                                    (newStatus === 'REPLACED' && !replacementSerial.trim())
                                }
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                                {statusUpdating ? t.warrantyClaims.saving : t.common.save}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
