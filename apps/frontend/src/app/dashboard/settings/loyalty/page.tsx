'use client';

import { useEffect, useState, useCallback } from 'react';
import { Gift, Loader2, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import Link from 'next/link';

type ToastState = { type: 'success' | 'error'; message: string } | null;

interface LoyaltySettings {
    loyalty_points_enabled: boolean;
    loyalty_earn_rate: string | number | null;
    loyalty_redeem_rate: string | number | null;
    loyalty_min_redeem: number | null;
}

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

export default function LoyaltySettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<ToastState>(null);

    const [enabled, setEnabled] = useState(false);
    const [earnRate, setEarnRate] = useState('');
    const [redeemRate, setRedeemRate] = useState('');
    const [minRedeem, setMinRedeem] = useState('');

    const loadSettings = useCallback(async () => {
        try {
            const data = (await fetchWithAuth('/loyalty/settings')) as LoyaltySettings;
            setEnabled(data.loyalty_points_enabled ?? false);
            setEarnRate(data.loyalty_earn_rate != null ? String(data.loyalty_earn_rate) : '');
            setRedeemRate(data.loyalty_redeem_rate != null ? String(data.loyalty_redeem_rate) : '');
            setMinRedeem(data.loyalty_min_redeem != null ? String(data.loyalty_min_redeem) : '');
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to load loyalty settings.' });
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
            await fetchWithAuth('/loyalty/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    loyalty_points_enabled: enabled,
                    ...(earnRate !== '' ? { loyalty_earn_rate: parseFloat(earnRate) } : {}),
                    ...(redeemRate !== '' ? { loyalty_redeem_rate: parseFloat(redeemRate) } : {}),
                    ...(minRedeem !== '' ? { loyalty_min_redeem: parseInt(minRedeem, 10) } : {}),
                }),
            });
            setToast({ type: 'success', message: 'Loyalty settings saved.' });
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || 'Failed to save settings.' });
        } finally {
            setSaving(false);
        }
    };

    // Example calculation
    const exampleSaleAmount = 500;
    const earnRateNum = parseFloat(earnRate) || 0;
    const redeemRateNum = parseFloat(redeemRate) || 0;
    const examplePointsEarned = Math.floor(exampleSaleAmount * earnRateNum);
    const exampleDiscount = examplePointsEarned * redeemRateNum;

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
                {/* Header */}
                <div className="flex items-center gap-3">
                    <Link
                        href="/dashboard/settings"
                        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Settings
                    </Link>
                </div>

                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                        <Gift className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight">Loyalty Program</h1>
                        <p className="text-sm text-gray-500">Configure points earn & redeem rates for your customers.</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading settings…
                    </div>
                ) : (
                    <form onSubmit={handleSave} className="space-y-6">
                        {/* Enable toggle */}
                        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-bold text-gray-800">Enable Loyalty Program</p>
                                    <p className="text-xs text-gray-500 mt-0.5">Allow customers to earn and redeem points.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEnabled((v) => !v)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                                        enabled ? 'bg-purple-600' : 'bg-gray-200'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                            enabled ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>

                        {/* Rate configuration */}
                        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5">
                            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Rate Configuration</h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        Earn Rate
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            step="0.0001"
                                            min="0"
                                            value={earnRate}
                                            onChange={(e) => setEarnRate(e.target.value)}
                                            placeholder="e.g. 1.0"
                                            className="w-32 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                                        />
                                        <span className="text-sm text-gray-500">points per ৳1 spent</span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-400">
                                        e.g. 1.0 means a ৳100 sale earns 100 points
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        Redemption Rate
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-500">1 point =</span>
                                        <span className="text-sm text-gray-500">৳</span>
                                        <input
                                            type="number"
                                            step="0.0001"
                                            min="0"
                                            value={redeemRate}
                                            onChange={(e) => setRedeemRate(e.target.value)}
                                            placeholder="e.g. 0.01"
                                            className="w-32 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                                        />
                                    </div>
                                    <p className="mt-1 text-xs text-gray-400">
                                        e.g. 0.01 means 100 points = ৳1.00 discount
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        Minimum Points to Redeem
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            step="1"
                                            min="0"
                                            value={minRedeem}
                                            onChange={(e) => setMinRedeem(e.target.value)}
                                            placeholder="e.g. 100"
                                            className="w-32 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                                        />
                                        <span className="text-sm text-gray-500">points</span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-400">
                                        Customers must have at least this many points to redeem
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Example calculation */}
                        {earnRateNum > 0 && (
                            <div className="bg-purple-50 rounded-2xl border border-purple-100 p-5">
                                <h3 className="text-sm font-bold text-purple-800 mb-2">Example Calculation</h3>
                                <p className="text-sm text-purple-700">
                                    A ৳{exampleSaleAmount} sale earns{' '}
                                    <span className="font-bold">{examplePointsEarned} points</span>.
                                </p>
                                {redeemRateNum > 0 && (
                                    <p className="text-sm text-purple-700 mt-1">
                                        {examplePointsEarned} points ={' '}
                                        <span className="font-bold">৳{exampleDiscount.toFixed(2)} discount</span>.
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? 'Saving…' : 'Save Settings'}
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
