'use client';

import { useState, useEffect } from 'react';
import { Tag, Plus, Trash2, ToggleLeft, ToggleRight, CheckCircle, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';

interface DiscountCode {
    id: string;
    code: string;
    name: string;
    type: 'PERCENTAGE' | 'FIXED';
    value: string;
    min_purchase: string | null;
    max_discount: string | null;
    usage_limit: number | null;
    used_count: number;
    valid_from: string | null;
    valid_until: string | null;
    is_active: boolean;
    created_at: string;
}

const EMPTY_FORM = {
    code: '',
    name: '',
    type: 'PERCENTAGE' as const,
    value: '',
    min_purchase: '',
    max_discount: '',
    usage_limit: '',
    valid_from: '',
    valid_until: '',
};

export default function DiscountCodesPage() {
    const [codes, setCodes] = useState<DiscountCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => { loadCodes(); }, []);

    async function loadCodes() {
        setLoading(true);
        try {
            const data = await api.getDiscountCodes();
            setCodes(Array.isArray(data) ? data : data?.data ?? []);
        } catch {
            setError('Failed to load discount codes');
        } finally {
            setLoading(false);
        }
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            await api.createDiscountCode({
                code: form.code,
                name: form.name,
                type: form.type,
                value: parseFloat(form.value),
                min_purchase: form.min_purchase ? parseFloat(form.min_purchase) : null,
                max_discount: form.max_discount ? parseFloat(form.max_discount) : null,
                usage_limit: form.usage_limit ? parseInt(form.usage_limit) : null,
                valid_from: form.valid_from || null,
                valid_until: form.valid_until || null,
            });
            setShowForm(false);
            setForm(EMPTY_FORM);
            setSuccess('Discount code created');
            setTimeout(() => setSuccess(''), 3000);
            await loadCodes();
        } catch (err: any) {
            setError(err?.message ?? 'Failed to create code');
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(id: string) {
        try {
            await api.toggleDiscountCode(id);
            await loadCodes();
        } catch {
            setError('Failed to update code');
        }
    }

    async function handleDelete(id: string, code: string) {
        if (!confirm(`Delete code "${code}"?`)) return;
        try {
            await api.deleteDiscountCode(id);
            await loadCodes();
        } catch {
            setError('Failed to delete code');
        }
    }

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Tag className="h-6 w-6 text-gray-600" />
                    <h1 className="text-2xl font-bold text-gray-900">Discount Codes</h1>
                </div>
                <button
                    onClick={() => { setShowForm(true); setError(''); }}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                    <Plus className="h-4 w-4" />
                    New Code
                </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                Create discount codes for promotions, Eid sales, bulk buyers, and loyal customers.
                Codes can be applied at the POS checkout screen.
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError('')}><X className="h-4 w-4" /></button>
                </div>
            )}

            {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    {success}
                </div>
            )}

            {/* Create Form */}
            {showForm && (
                <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="font-semibold text-gray-800">New Discount Code</h2>
                        <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                                <input
                                    required
                                    type="text"
                                    value={form.code}
                                    onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                                    placeholder="e.g. EID2025"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                                <input
                                    required
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. Eid Special 2025"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                                <select
                                    value={form.type}
                                    onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                >
                                    <option value="PERCENTAGE">Percentage (%)</option>
                                    <option value="FIXED">Fixed Amount (৳)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Value * {form.type === 'PERCENTAGE' ? '(%)' : '(৳)'}
                                </label>
                                <input
                                    required
                                    type="number"
                                    min="0"
                                    max={form.type === 'PERCENTAGE' ? 100 : undefined}
                                    step="0.01"
                                    value={form.value}
                                    onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                                    placeholder={form.type === 'PERCENTAGE' ? '10' : '200'}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Min Purchase (৳)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.min_purchase}
                                    onChange={e => setForm(f => ({ ...f, min_purchase: e.target.value }))}
                                    placeholder="e.g. 500"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            {form.type === 'PERCENTAGE' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Max Discount (৳)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={form.max_discount}
                                        onChange={e => setForm(f => ({ ...f, max_discount: e.target.value }))}
                                        placeholder="e.g. 1000"
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Usage Limit</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={form.usage_limit}
                                    onChange={e => setForm(f => ({ ...f, usage_limit: e.target.value }))}
                                    placeholder="Unlimited"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Valid From</label>
                                <input
                                    type="datetime-local"
                                    value={form.valid_from}
                                    onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until</label>
                                <input
                                    type="datetime-local"
                                    value={form.valid_until}
                                    onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowForm(false)}
                                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saving ? 'Creating…' : 'Create Code'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Codes List */}
            {loading ? (
                <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
            ) : codes.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <Tag className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No discount codes yet</p>
                    <p className="text-xs mt-1">Create your first code to start offering promotions</p>
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100 bg-gray-50">
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Code</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Discount</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Conditions</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Usage</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Validity</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {codes.map(c => (
                                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="font-mono font-bold text-gray-900">{c.code}</div>
                                        <div className="text-xs text-gray-500">{c.name}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="font-semibold text-blue-700">
                                            {c.type === 'PERCENTAGE'
                                                ? `${parseFloat(c.value)}%`
                                                : formatBDT(parseFloat(c.value))}
                                        </span>
                                        {c.type === 'PERCENTAGE' && c.max_discount && (
                                            <div className="text-xs text-gray-400">
                                                max {formatBDT(parseFloat(c.max_discount))}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-500">
                                        {c.min_purchase
                                            ? `Min ${formatBDT(parseFloat(c.min_purchase))}`
                                            : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs">
                                        <span className="text-gray-700">{c.used_count}</span>
                                        {c.usage_limit !== null && (
                                            <span className="text-gray-400"> / {c.usage_limit}</span>
                                        )}
                                        {c.usage_limit === null && (
                                            <span className="text-gray-400"> / ∞</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-500">
                                        {c.valid_until
                                            ? <>Until {new Date(c.valid_until).toLocaleDateString('en-BD')}</>
                                            : <span className="text-gray-300">No expiry</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={() => handleToggle(c.id)}
                                            className="flex items-center gap-1.5 text-xs font-medium"
                                        >
                                            {c.is_active ? (
                                                <>
                                                    <ToggleRight className="h-5 w-5 text-green-500" />
                                                    <span className="text-green-600">Active</span>
                                                </>
                                            ) : (
                                                <>
                                                    <ToggleLeft className="h-5 w-5 text-gray-400" />
                                                    <span className="text-gray-400">Inactive</span>
                                                </>
                                            )}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={() => handleDelete(c.id, c.code)}
                                            className="p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
