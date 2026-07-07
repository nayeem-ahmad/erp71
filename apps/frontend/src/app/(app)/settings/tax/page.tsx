'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { useState, useEffect } from 'react';
import { Receipt, CheckCircle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

export default function TaxSettingsPage() {
    const { t } = useI18n();
    const m = t.settingsExtras.tax;
    const [vatRate, setVatRate] = useState('');
    const [vatRegNo, setVatRegNo] = useState('');
    const [businessTin, setBusinessTin] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchWithAuth('/tenants/tax-settings')
            .then(d => {
                setVatRate(d?.default_vat_rate != null ? String(d.default_vat_rate) : '');
                setVatRegNo(d?.vat_registration_no ?? '');
                setBusinessTin(d?.business_tin ?? '');
            })
            .catch(() => setError(m.loadFailed))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        setError('');
        setSuccess(false);
        try {
            const rate = vatRate === '' ? null : parseFloat(vatRate);
            if (rate !== null && (isNaN(rate) || rate < 0 || rate > 100)) {
                setError(m.vatRateInvalid);
                return;
            }
            await fetchWithAuth('/tenants/tax-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    default_vat_rate: rate,
                    vat_registration_no: vatRegNo || null,
                    business_tin: businessTin || null,
                }),
            });
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (e: any) {
            setError(e.message ?? m.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="p-6 max-w-2xl space-y-6">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-2">
                        <Receipt className="h-6 w-6 text-gray-600" />
                        {m.title}
                    </span>
                )}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    m.title,
                    'settings',
                )}
            />

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <strong>{m.complianceTitle}</strong> — {m.complianceBody}
            </div>

            {loading ? (
                <div className="text-gray-500 py-8 text-center">{m.loading}</div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            {m.vatRate.label}
                        </label>
                        <div className="flex items-center gap-2 max-w-xs">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={vatRate}
                                onChange={e => setVatRate(e.target.value)}
                                placeholder={m.vatRate.placeholder}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                            <span className="text-gray-500 text-sm">%</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            {m.vatRate.hint}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            {m.vatReg.label}
                        </label>
                        <input
                            type="text"
                            value={vatRegNo}
                            onChange={e => setVatRegNo(e.target.value)}
                            placeholder={m.vatReg.placeholder}
                            className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            {m.vatReg.hint}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            {m.tin.label}
                        </label>
                        <input
                            type="text"
                            value={businessTin}
                            onChange={e => setBusinessTin(e.target.value)}
                            placeholder={m.tin.placeholder}
                            className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            {m.tin.hint12Digit}
                        </p>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">
                            <CheckCircle className="h-4 w-4" />
                            {m.savedSuccess}
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                            {saving ? m.saving : m.saveButton}
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm space-y-3">
                <h2 className="font-semibold text-gray-800">{m.checklist.title}</h2>
                <ul className="space-y-2 text-gray-600">
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>{m.checklist.items[0]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>{m.checklist.items[1]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>{m.checklist.items[2]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">→</span>
                        <span>{m.checklist.items[3]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">→</span>
                        <span>{m.checklist.items[4]}</span>
                    </li>
                </ul>
            </div>
        </div>
    );
}
