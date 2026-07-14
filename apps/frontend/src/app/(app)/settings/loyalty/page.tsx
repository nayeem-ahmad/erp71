'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { useEffect, useState, useCallback } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Button, Input, PageShell } from '@/components/ui';

interface LoyaltySettings {
    loyalty_points_enabled: boolean;
    loyalty_earn_rate: string | number | null;
    loyalty_redeem_rate: string | number | null;
    loyalty_min_redeem: number | null;
}

export default function LoyaltySettingsPage() {
    const { t } = useI18n();
    const m = t.settingsExtras.loyalty;
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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
            toast.error(err?.message || m.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [m.loadFailed]);

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
            toast.success(m.saved);
        } catch (err: any) {
            toast.error(err?.message || m.saveFailed);
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
        <PageShell maxWidth="full">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-3">
                        <span className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                            <Gift className="w-5 h-5 text-purple-600" />
                        </span>
                        {m.title}
                    </span>
                )}
                subtitle={m.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    m.title,
                    'settings',
                )}
            />

            {loading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {m.loading}
                </div>
            ) : (
                <form onSubmit={handleSave} className="space-y-6 mt-4">
                        {/* Enable toggle */}
                        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-bold text-gray-800">{m.enableLabel}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{m.enableHint}</p>
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
                        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-5">
                            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">{m.rateConfigTitle}</h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        Earn Rate
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="number"
                                            step="0.0001"
                                            min="0"
                                            value={earnRate}
                                            onChange={(e) => setEarnRate(e.target.value)}
                                            placeholder={m.earnRate.placeholder}
                                            className="w-32"
                                        />
                                        <span className="text-sm text-gray-500">{m.earnRate.suffix}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-400">
                                        {m.earnRate.hint}
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        Redemption Rate
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-500">{m.redeemRate.prefix}</span>
                                        <span className="text-sm text-gray-500">৳</span>
                                        <Input
                                            type="number"
                                            step="0.0001"
                                            min="0"
                                            value={redeemRate}
                                            onChange={(e) => setRedeemRate(e.target.value)}
                                            placeholder={m.redeemRate.placeholder}
                                            className="w-32"
                                        />
                                    </div>
                                    <p className="mt-1 text-xs text-gray-400">
                                        {m.redeemRate.hint}
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        Minimum Points to Redeem
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="number"
                                            step="1"
                                            min="0"
                                            value={minRedeem}
                                            onChange={(e) => setMinRedeem(e.target.value)}
                                            placeholder={m.minRedeem.placeholder}
                                            className="w-32"
                                        />
                                        <span className="text-sm text-gray-500">{m.minRedeem.suffix}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-400">
                                        {m.minRedeem.hint}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Example calculation */}
                        {earnRateNum > 0 && (
                            <div className="bg-purple-50 rounded-lg border border-purple-100 p-5">
                                <h3 className="text-sm font-bold text-purple-800 mb-2">{m.example.title}</h3>
                                <p className="text-sm text-purple-700">
                                    {formatMessage(m.example.saleEarned, { amount: exampleSaleAmount, points: examplePointsEarned })}
                                </p>
                                {redeemRateNum > 0 && (
                                    <p className="text-sm text-purple-700 mt-1">
                                        {formatMessage(m.example.redeemDiscount, { points: examplePointsEarned, discount: exampleDiscount.toFixed(2) })}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end">
                            <Button
                                type="submit"
                                disabled={saving}
                                loading={saving}
                                className="!bg-purple-600 hover:!bg-purple-700"
                            >
                                {saving ? m.saving : m.saveButton}
                            </Button>
                        </div>
                    </form>
                )}
        </PageShell>
    );
}
