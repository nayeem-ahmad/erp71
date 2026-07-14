'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Palette, Image, Globe, Building2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ToastState = { type: 'success' | 'error'; message: string } | null;

interface BrandingForm {
    brand_business_name: string;
    brand_primary_color: string;
    brand_logo_url: string;
    brand_favicon_url: string;
}

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

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
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold transition-all ${
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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_COLOR = '#2563eb';

export default function BrandingSettingsPage() {
    const { t } = useI18n();
    const m = t.settingsExtras.branding;
    const [form, setForm] = useState<BrandingForm>({
        brand_business_name: '',
        brand_primary_color: DEFAULT_COLOR,
        brand_logo_url: '',
        brand_favicon_url: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<ToastState>(null);

    useEffect(() => {
        setLoading(true);
        fetchWithAuth('/tenants/branding')
            .then((data: any) => {
                setForm({
                    brand_business_name: data?.brand_business_name ?? '',
                    brand_primary_color: data?.brand_primary_color ?? DEFAULT_COLOR,
                    brand_logo_url: data?.brand_logo_url ?? '',
                    brand_favicon_url: data?.brand_favicon_url ?? '',
                });
            })
            .catch(() => {
                // Use defaults
            })
            .finally(() => setLoading(false));
    }, []);

    const handleColorPickerChange = (hex: string) => {
        setForm((prev) => ({ ...prev, brand_primary_color: hex }));
    };

    const handleHexInputChange = (value: string) => {
        // Allow typing — only normalise on valid hex
        const trimmed = value.startsWith('#') ? value : `#${value}`;
        setForm((prev) => ({ ...prev, brand_primary_color: trimmed }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            // Build payload — omit empty strings to allow clearing optional fields
            const payload: Record<string, string> = {};
            if (form.brand_business_name.trim()) {
                payload.brand_business_name = form.brand_business_name.trim();
            } else {
                // Send empty string to clear the value
                payload.brand_business_name = '';
            }
            if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(form.brand_primary_color)) {
                payload.brand_primary_color = form.brand_primary_color;
            }
            if (form.brand_logo_url.trim()) {
                payload.brand_logo_url = form.brand_logo_url.trim();
            }
            if (form.brand_favicon_url.trim()) {
                payload.brand_favicon_url = form.brand_favicon_url.trim();
            }

            await fetchWithAuth('/tenants/branding', {
                method: 'PATCH',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
            });
            setToast({ type: 'success', message: m.saved });

            // Apply primary color change immediately
            if (payload.brand_primary_color) {
                document.documentElement.style.setProperty('--color-primary', payload.brand_primary_color);
            }
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || m.saveFailed });
        } finally {
            setSaving(false);
        }
    };

    const inputCls =
        'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <PageHeader
                    title={(
                        <span className="inline-flex items-center gap-2">
                            <Palette className="w-6 h-6 text-blue-600" />
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

                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    {loading ? (
                        <div className="p-8 flex items-center gap-2 text-gray-400 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {m.loading}
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            {/* Business Name */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1.5">
                                    <Building2 className="w-4 h-4 text-gray-400" />
                                    {m.businessName.label}
                                </label>
                                <input
                                    type="text"
                                    value={form.brand_business_name}
                                    onChange={(e) => setForm((p) => ({ ...p, brand_business_name: e.target.value }))}
                                    placeholder={m.businessName.placeholder}
                                    maxLength={100}
                                    className={inputCls}
                                />
                                <p className="mt-1.5 text-xs text-gray-400">
                                    {m.businessName.hint}
                                </p>
                            </div>

                            {/* Primary Color */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1.5">
                                    <Palette className="w-4 h-4 text-gray-400" />
                                    {m.primaryColor.label}
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="color"
                                        value={/^#[0-9a-fA-F]{6}$/.test(form.brand_primary_color) ? form.brand_primary_color : DEFAULT_COLOR}
                                        onChange={(e) => handleColorPickerChange(e.target.value)}
                                        className="w-12 h-10 rounded-xl border border-gray-200 cursor-pointer p-1 bg-white"
                                        title={m.primaryColor.pickTitle}
                                    />
                                    <input
                                        type="text"
                                        value={form.brand_primary_color}
                                        onChange={(e) => handleHexInputChange(e.target.value)}
                                        placeholder={m.primaryColor.placeholder}
                                        maxLength={7}
                                        className="w-36 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition font-mono"
                                    />
                                    <div
                                        className="w-10 h-10 rounded-xl border border-gray-200 flex-shrink-0"
                                        style={{
                                            backgroundColor: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(form.brand_primary_color)
                                                ? form.brand_primary_color
                                                : DEFAULT_COLOR,
                                        }}
                                        title={m.primaryColor.previewTitle}
                                    />
                                </div>
                                <p className="mt-1.5 text-xs text-gray-400">
                                    {m.primaryColor.hint}
                                </p>
                            </div>

                            {/* Logo URL */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1.5">
                                    <Image className="w-4 h-4 text-gray-400" />
                                    {m.logo.label}
                                </label>
                                <input
                                    type="url"
                                    value={form.brand_logo_url}
                                    onChange={(e) => setForm((p) => ({ ...p, brand_logo_url: e.target.value }))}
                                    placeholder={m.logo.placeholder}
                                    maxLength={500}
                                    className={inputCls}
                                />
                                {form.brand_logo_url && (
                                    <div className="mt-3 inline-block rounded-xl border border-gray-200 bg-gray-50 p-2">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={form.brand_logo_url}
                                            alt={m.logo.previewAlt}
                                            className="h-12 max-w-[200px] object-contain"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    </div>
                                )}
                                <p className="mt-1.5 text-xs text-gray-400">
                                    {m.logo.hint}
                                </p>
                            </div>

                            {/* Favicon URL */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1.5">
                                    <Globe className="w-4 h-4 text-gray-400" />
                                    {m.favicon.label}
                                </label>
                                <input
                                    type="url"
                                    value={form.brand_favicon_url}
                                    onChange={(e) => setForm((p) => ({ ...p, brand_favicon_url: e.target.value }))}
                                    placeholder={m.favicon.placeholder}
                                    maxLength={500}
                                    className={inputCls}
                                />
                                {form.brand_favicon_url && (
                                    <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={form.brand_favicon_url}
                                            alt={m.favicon.previewAlt}
                                            className="w-6 h-6 object-contain"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                        <span className="text-xs text-gray-500">{m.favicon.previewLabel}</span>
                                    </div>
                                )}
                                <p className="mt-1.5 text-xs text-gray-400">
                                    {m.favicon.hint}
                                </p>
                            </div>

                            {/* Save */}
                            <div className="pt-2 border-t border-gray-100">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                                >
                                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {saving ? m.saving : m.saveButton}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
