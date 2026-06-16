'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShoppingBag, Loader2, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import Link from 'next/link';
import type { PaperSize } from '@/lib/sales-invoice-printer';

type ToastState = { type: 'success' | 'error'; message: string } | null;

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);

    if (!toast) return null;
    const isSuccess = toast.type === 'success';
    return (
        <div
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold ${
                isSuccess
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
            }`}
        >
            {isSuccess ? (
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : (
                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            {toast.message}
        </div>
    );
}

const PAPER_SIZE_OPTIONS: { value: PaperSize; label: string }[] = [
    { value: 'A4', label: 'A4 (210 × 297 mm)' },
    { value: 'Letter', label: 'Letter (8.5 × 11 in)' },
    { value: 'Thermal80', label: '80mm Thermal Roll' },
    { value: 'Thermal58', label: '58mm Thermal Roll' },
];

export default function SalesSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<ToastState>(null);

    const [paperSize, setPaperSize] = useState<PaperSize>('A4');
    const [refFormat, setRefFormat] = useState('');

    const loadSettings = useCallback(async () => {
        try {
            const data = await api.getSalesSettings();
            if (data?.default_paper_size) setPaperSize(data.default_paper_size as PaperSize);
            if (data?.reference_number_format) setRefFormat(data.reference_number_format);
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to load settings' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await api.updateSalesSettings({
                default_paper_size: paperSize,
                ...(refFormat ? { reference_number_format: refFormat } : {}),
            });
            setToast({ type: 'success', message: 'Sales settings saved' });
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to save settings' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
                {/* Back link */}
                <div className="flex items-center gap-3">
                    <Link
                        href="/dashboard/settings"
                        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Settings
                    </Link>
                </div>

                {/* Page title */}
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                        <ShoppingBag className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight">Sales Settings</h1>
                        <p className="text-sm text-gray-500">Configure invoice printing and reference number format</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading settings...
                    </div>
                ) : (
                    <form onSubmit={handleSave} className="space-y-6">
                        {/* Paper Size */}
                        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Print Settings</h2>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    Default Paper Size
                                </label>
                                <select
                                    value={paperSize}
                                    onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                                    className="w-full max-w-xs rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                >
                                    {PAPER_SIZE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <p className="mt-1 text-xs text-gray-400">
                                    Used as the default when printing invoices from the New Sale page. Can be changed per-session.
                                </p>
                            </div>
                        </div>

                        {/* Reference Number Format */}
                        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Reference Number</h2>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    Format Template
                                </label>
                                <input
                                    type="text"
                                    value={refFormat}
                                    onChange={(e) => setRefFormat(e.target.value)}
                                    placeholder="e.g. INV-{YYYY}-{####}"
                                    className="w-full max-w-xs rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition font-mono"
                                />
                                <p className="mt-1 text-xs text-gray-400">
                                    Tokens: <code className="bg-gray-100 px-1 rounded">{'{YYYY}'}</code> year,{' '}
                                    <code className="bg-gray-100 px-1 rounded">{'{MM}'}</code> month,{' '}
                                    <code className="bg-gray-100 px-1 rounded">{'{####}'}</code> auto-incremented sequence.
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? 'Saving...' : 'Save Settings'}
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
