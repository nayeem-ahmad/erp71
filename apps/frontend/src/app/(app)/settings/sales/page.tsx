'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShoppingBag, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import type { PaperSize } from '@/lib/sales-invoice-printer';
import { isOwner } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Button, Checkbox, Field, Input, PageShell, Select } from '@/components/ui';

const PAPER_SIZE_OPTIONS: { value: PaperSize; label: string }[] = [
    { value: 'A4', label: 'A4 (210 × 297 mm)' },
    { value: 'A5', label: 'A5 (148 × 210 mm)' },
    { value: 'Letter', label: 'Letter (8.5 × 11 in)' },
    { value: 'Thermal80', label: '80mm Thermal Roll' },
    { value: 'Thermal58', label: '58mm Thermal Roll' },
];

export default function SalesSettingsPage() {
    const { t } = useI18n();
    const pageTitle = 'Sales Settings';
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [paperSize, setPaperSize] = useState<PaperSize>('A4');
    const [refFormat, setRefFormat] = useState('');
    const [posEnabled, setPosEnabled] = useState(true);
    const [isShopOwner, setIsShopOwner] = useState(false);

    const loadSettings = useCallback(async () => {
        try {
            const [data, me] = await Promise.all([api.getSalesSettings(), api.getMe()]);
            const tenantId = localStorage.getItem('tenant_id');
            const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === tenantId) || me?.tenants?.[0];
            setIsShopOwner(isOwner(tenant?.role));

            if (data?.default_paper_size) setPaperSize(data.default_paper_size as PaperSize);
            if (data?.paper_size) setPaperSize(data.paper_size as PaperSize);
            if (data?.reference_number_format) setRefFormat(data.reference_number_format);
            setPosEnabled(data?.pos_enabled !== false);
        } catch (err: any) {
            toast.error(err?.message || 'Failed to load settings');
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
                paper_size: paperSize,
                ...(refFormat ? { reference_number_format: refFormat } : {}),
                ...(isShopOwner ? { pos_enabled: posEnabled } : {}),
            });
            window.dispatchEvent(new Event('erp71:sales-settings-updated'));
            toast.success('Sales settings saved');
        } catch (err: any) {
            toast.error(err?.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageShell maxWidth="full">
            <PageHeader
                    title={(
                        <span className="inline-flex items-center gap-3">
                            <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                                <ShoppingBag className="w-5 h-5 text-blue-600" />
                            </span>
                            {pageTitle}
                        </span>
                    )}
                    subtitle="Configure invoice printing and reference number format"
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.accountSettings,
                        pageTitle,
                        'settings',
                    )}
                />

            {loading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading settings...
                </div>
            ) : (
                <form onSubmit={handleSave} className="space-y-6 mt-4">
                    {/* Paper Size */}
                    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
                        <h2 className="text-sm font-semibold text-gray-700">Print Settings</h2>

                        <Field label="Default Paper Size" className="max-w-xs" hint="Used as the default when printing invoices from the New Sale page. Can be changed per-session.">
                            <Select
                                value={paperSize}
                                onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                            >
                                {PAPER_SIZE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </Select>
                        </Field>
                    </div>

                    {isShopOwner ? (
                        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
                            <h2 className="text-sm font-semibold text-gray-700">Checkout</h2>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <Checkbox
                                    checked={posEnabled}
                                    onChange={(e) => setPosEnabled(e.target.checked)}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-gray-700">Enable Point of Sale (POS)</span>
                                    <span className="block mt-1 text-xs text-gray-400">
                                        When disabled, the POS menu link and page are hidden. Staff can still record sales via New Sales Entry.
                                    </span>
                                </span>
                            </label>
                        </div>
                    ) : null}

                    {/* Reference Number Format */}
                    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
                        <h2 className="text-sm font-semibold text-gray-700">Reference Number</h2>

                        <Field label="Format Template" className="max-w-xs">
                            <Input
                                type="text"
                                value={refFormat}
                                onChange={(e) => setRefFormat(e.target.value)}
                                placeholder="e.g. INV-{YYYY}-{####}"
                                className="font-mono"
                            />
                        </Field>
                        <p className="mt-1 text-xs text-gray-400">
                            Tokens: <code className="bg-gray-100 px-1 rounded">{'{YYYY}'}</code> year,{' '}
                            <code className="bg-gray-100 px-1 rounded">{'{MM}'}</code> month,{' '}
                            <code className="bg-gray-100 px-1 rounded">{'{####}'}</code> auto-incremented sequence.
                        </p>
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving} loading={saving}>
                            {saving ? 'Saving...' : 'Save Settings'}
                        </Button>
                    </div>
                </form>
            )}
        </PageShell>
    );
}
