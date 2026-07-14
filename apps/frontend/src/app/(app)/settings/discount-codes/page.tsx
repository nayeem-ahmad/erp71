'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import { useState, useEffect } from 'react';
import { Tag, Plus, Trash2, ToggleLeft, ToggleRight, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Alert, Button, Field, FormFooter, Input, PageShell, Select } from '@/components/ui';

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
    const { t } = useI18n();
    const m = t.settingsExtras.discountCodes;
    const [codes, setCodes] = useState<DiscountCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { loadCodes(); }, []);

    async function loadCodes() {
        setLoading(true);
        try {
            const data = await api.getDiscountCodes();
            setCodes(Array.isArray(data) ? data : data?.data ?? []);
        } catch {
            setError(m.loadFailed);
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
            toast.success(m.created);
            await loadCodes();
        } catch (err: any) {
            setError(err?.message ?? m.createFailed);
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(id: string) {
        try {
            await api.toggleDiscountCode(id);
            await loadCodes();
        } catch {
            setError(m.updateFailed);
        }
    }

    async function handleDelete(id: string, code: string) {
        if (!confirm(formatMessage(m.deleteConfirm, { code }))) return;
        try {
            await api.deleteDiscountCode(id);
            await loadCodes();
        } catch {
            setError(m.deleteFailed);
        }
    }

    return (
        <PageShell maxWidth="full" className="space-y-4">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-2">
                        <Tag className="h-6 w-6 text-gray-600" />
                        {m.title}
                    </span>
                )}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    m.title,
                    'settings',
                )}
                actions={(
                    <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setShowForm(true); setError(''); }}>
                        {m.newCode}
                    </Button>
                )}
            />

            <Alert tone="info">{m.infoBanner}</Alert>

            {error && (
                <Alert tone="danger">
                    <div className="flex items-center justify-between gap-2">
                        <span>{error}</span>
                        <button onClick={() => setError('')} aria-label={t.common.close ?? 'Close'}>
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </Alert>
            )}

            {/* Create Form */}
            {showForm && (
                <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="font-semibold text-gray-800">{m.form.title}</h2>
                        <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Field label={m.form.code} required>
                                <Input
                                    required
                                    type="text"
                                    value={form.code}
                                    onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                                    placeholder={m.form.codePlaceholder}
                                    className="font-mono uppercase"
                                />
                            </Field>
                            <Field label={m.form.name} required>
                                <Input
                                    required
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder={m.form.namePlaceholder}
                                />
                            </Field>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <Field label={m.form.type}>
                                <Select
                                    value={form.type}
                                    onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                                >
                                    <option value="PERCENTAGE">{m.form.percentage}</option>
                                    <option value="FIXED">{m.form.fixed}</option>
                                </Select>
                            </Field>
                            <Field label={`Value * ${form.type === 'PERCENTAGE' ? '(%)' : '(৳)'}`}>
                                <Input
                                    required
                                    type="number"
                                    min="0"
                                    max={form.type === 'PERCENTAGE' ? 100 : undefined}
                                    step="0.01"
                                    value={form.value}
                                    onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                                    placeholder={form.type === 'PERCENTAGE' ? '10' : '200'}
                                />
                            </Field>
                            <Field label={m.form.minPurchase}>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.min_purchase}
                                    onChange={e => setForm(f => ({ ...f, min_purchase: e.target.value }))}
                                    placeholder={m.form.minPurchasePlaceholder}
                                />
                            </Field>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            {form.type === 'PERCENTAGE' && (
                                <Field label={m.form.maxDiscount}>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={form.max_discount}
                                        onChange={e => setForm(f => ({ ...f, max_discount: e.target.value }))}
                                        placeholder={m.form.maxDiscountPlaceholder}
                                    />
                                </Field>
                            )}
                            <Field label={m.form.usageLimit}>
                                <Input
                                    type="number"
                                    min="1"
                                    value={form.usage_limit}
                                    onChange={e => setForm(f => ({ ...f, usage_limit: e.target.value }))}
                                    placeholder={m.form.usageLimitPlaceholder}
                                />
                            </Field>
                            <Field label={m.form.validFrom}>
                                <Input
                                    type="datetime-local"
                                    value={form.valid_from}
                                    onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))}
                                />
                            </Field>
                            <Field label={m.form.validUntil}>
                                <Input
                                    type="datetime-local"
                                    value={form.valid_until}
                                    onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))}
                                />
                            </Field>
                        </div>

                        <FormFooter>
                            <Button variant="ghost" type="button" onClick={() => setShowForm(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={saving} loading={saving}>
                                {saving ? m.form.creating : m.form.create}
                            </Button>
                        </FormFooter>
                    </form>
                </div>
            )}

            {/* Codes List */}
            {loading ? (
                <div className="text-center py-12 text-gray-400 text-sm">{m.loading}</div>
            ) : codes.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <Tag className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">{m.emptyTitle}</p>
                    <p className="text-xs mt-1">{m.emptyDescription}</p>
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100 bg-gray-50">
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{m.table.code}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{m.table.discount}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{m.table.conditions}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{m.table.usage}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{m.table.validity}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{m.table.status}</th>
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
                                                {m.table.maxPrefix} {formatBDT(parseFloat(c.max_discount))}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-500">
                                        {c.min_purchase
                                            ? `${m.table.minPrefix} ${formatBDT(parseFloat(c.min_purchase))}`
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
                                            ? <>{m.table.until} {new Date(c.valid_until).toLocaleDateString('en-BD')}</>
                                            : <span className="text-gray-300">{m.table.noExpiry}</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={() => handleToggle(c.id)}
                                            className="flex items-center gap-1.5 text-xs font-medium"
                                        >
                                            {c.is_active ? (
                                                <>
                                                    <ToggleRight className="h-5 w-5 text-green-500" />
                                                    <span className="text-green-600">{m.table.active}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <ToggleLeft className="h-5 w-5 text-gray-400" />
                                                    <span className="text-gray-400">{m.table.inactive}</span>
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
        </PageShell>
    );
}
