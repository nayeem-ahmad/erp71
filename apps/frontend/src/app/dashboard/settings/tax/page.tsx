'use client';

import { useState, useEffect } from 'react';
import { Receipt, CheckCircle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';

export default function TaxSettingsPage() {
    const [vatRate, setVatRate] = useState('');
    const [vatRegNo, setVatRegNo] = useState('');
    const [businessTin, setBusinessTin] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchWithAuth('/api/v1/tenants/tax-settings')
            .then(r => r.json())
            .then(json => {
                const d = json?.data ?? json;
                setVatRate(d?.default_vat_rate != null ? String(d.default_vat_rate) : '');
                setVatRegNo(d?.vat_registration_no ?? '');
                setBusinessTin(d?.business_tin ?? '');
            })
            .catch(() => setError('Failed to load tax settings'))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        setError('');
        setSuccess(false);
        try {
            const rate = vatRate === '' ? null : parseFloat(vatRate);
            if (rate !== null && (isNaN(rate) || rate < 0 || rate > 100)) {
                setError('VAT rate must be a number between 0 and 100');
                return;
            }
            const res = await fetchWithAuth('/api/v1/tenants/tax-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    default_vat_rate: rate,
                    vat_registration_no: vatRegNo || null,
                    business_tin: businessTin || null,
                }),
            });
            if (!res.ok) throw new Error('Save failed');
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (e: any) {
            setError(e.message ?? 'Failed to save');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="p-6 max-w-2xl space-y-6">
            <div className="flex items-center gap-2">
                <Receipt className="h-6 w-6 text-gray-600" />
                <h1 className="text-2xl font-bold text-gray-900">Tax Settings</h1>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <strong>Bangladesh NBR Compliance</strong> — Configure your VAT registration and default rate.
                The standard VAT rate is 15% under the VAT and Supplementary Duty Act 2012. Your VAT
                registration number and BIN (Business Identification Number / TIN) will appear on all
                customer invoices and receipts.
            </div>

            {loading ? (
                <div className="text-gray-500 py-8 text-center">Loading…</div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Default VAT Rate (%)
                        </label>
                        <div className="flex items-center gap-2 max-w-xs">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={vatRate}
                                onChange={e => setVatRate(e.target.value)}
                                placeholder="e.g. 15"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            />
                            <span className="text-gray-500 text-sm">%</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Leave blank to disable VAT. Products can override this rate individually.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            VAT Registration Number (BIN)
                        </label>
                        <input
                            type="text"
                            value={vatRegNo}
                            onChange={e => setVatRegNo(e.target.value)}
                            placeholder="e.g. 000000000-0101"
                            className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Your 13-digit BIN issued by the National Board of Revenue (NBR).
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Tax Identification Number (TIN)
                        </label>
                        <input
                            type="text"
                            value={businessTin}
                            onChange={e => setBusinessTin(e.target.value)}
                            placeholder="e.g. 123456789012"
                            className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            12-digit TIN issued by the Income Tax department.
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
                            Tax settings saved successfully.
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                            {saving ? 'Saving…' : 'Save Tax Settings'}
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm space-y-3">
                <h2 className="font-semibold text-gray-800">NBR VAT Compliance Checklist</h2>
                <ul className="space-y-2 text-gray-600">
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>VAT rate shown on POS receipts (Mushak 6.3 format)</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>Subtotal, VAT amount, and total displayed separately on invoices</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span>BIN/VAT registration number printed on every invoice</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">→</span>
                        <span>Register for VAT at <strong>ibas++.gov.bd</strong> if you have annual turnover above BDT 30 lakh</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">→</span>
                        <span>File monthly VAT returns (Mushak 9.1) through the NBR online portal</span>
                    </li>
                </ul>
            </div>
        </div>
    );
}
