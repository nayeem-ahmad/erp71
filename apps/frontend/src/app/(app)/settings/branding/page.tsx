'use client';

import { useEffect, useState } from 'react';
import { Loader2, Palette, Image, Globe, Building2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { Button, Field, Input, PageShell } from '@/components/ui';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BrandingForm {
    brand_business_name: string;
    brand_primary_color: string;
    brand_logo_url: string;
    brand_favicon_url: string;
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
            toast.success(m.saved);

            // Apply primary color change immediately
            if (payload.brand_primary_color) {
                document.documentElement.style.setProperty('--color-primary', payload.brand_primary_color);
            }
        } catch (err: any) {
            toast.error(err?.message || m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageShell maxWidth="full">
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

            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mt-4">
                {loading ? (
                    <div className="p-8 flex items-center gap-2 text-gray-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {m.loading}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        {/* Business Name */}
                        <Field
                            label={(
                                <span className="inline-flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-gray-400" />
                                    {m.businessName.label}
                                </span>
                            )}
                            hint={m.businessName.hint}
                        >
                            <Input
                                type="text"
                                value={form.brand_business_name}
                                onChange={(e) => setForm((p) => ({ ...p, brand_business_name: e.target.value }))}
                                placeholder={m.businessName.placeholder}
                                maxLength={100}
                            />
                        </Field>

                        {/* Primary Color */}
                        <Field
                            label={(
                                <span className="inline-flex items-center gap-2">
                                    <Palette className="w-4 h-4 text-gray-400" />
                                    {m.primaryColor.label}
                                </span>
                            )}
                            hint={m.primaryColor.hint}
                        >
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={/^#[0-9a-fA-F]{6}$/.test(form.brand_primary_color) ? form.brand_primary_color : DEFAULT_COLOR}
                                    onChange={(e) => handleColorPickerChange(e.target.value)}
                                    className="w-12 h-10 rounded-md border border-gray-200 cursor-pointer p-1 bg-white"
                                    title={m.primaryColor.pickTitle}
                                />
                                <Input
                                    type="text"
                                    value={form.brand_primary_color}
                                    onChange={(e) => handleHexInputChange(e.target.value)}
                                    placeholder={m.primaryColor.placeholder}
                                    maxLength={7}
                                    className="w-36 font-mono"
                                />
                                <div
                                    className="w-10 h-10 rounded-md border border-gray-200 flex-shrink-0"
                                    style={{
                                        backgroundColor: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(form.brand_primary_color)
                                            ? form.brand_primary_color
                                            : DEFAULT_COLOR,
                                    }}
                                    title={m.primaryColor.previewTitle}
                                />
                            </div>
                        </Field>

                        {/* Logo URL */}
                        <Field
                            label={(
                                <span className="inline-flex items-center gap-2">
                                    <Image className="w-4 h-4 text-gray-400" />
                                    {m.logo.label}
                                </span>
                            )}
                            hint={m.logo.hint}
                        >
                            <Input
                                type="url"
                                value={form.brand_logo_url}
                                onChange={(e) => setForm((p) => ({ ...p, brand_logo_url: e.target.value }))}
                                placeholder={m.logo.placeholder}
                                maxLength={500}
                            />
                            {form.brand_logo_url && (
                                <div className="mt-3 inline-block rounded-md border border-gray-200 bg-gray-50 p-2">
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
                        </Field>

                        {/* Favicon URL */}
                        <Field
                            label={(
                                <span className="inline-flex items-center gap-2">
                                    <Globe className="w-4 h-4 text-gray-400" />
                                    {m.favicon.label}
                                </span>
                            )}
                            hint={m.favicon.hint}
                        >
                            <Input
                                type="url"
                                value={form.brand_favicon_url}
                                onChange={(e) => setForm((p) => ({ ...p, brand_favicon_url: e.target.value }))}
                                placeholder={m.favicon.placeholder}
                                maxLength={500}
                            />
                            {form.brand_favicon_url && (
                                <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
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
                        </Field>

                        {/* Save */}
                        <div className="pt-2 border-t border-gray-100">
                            <Button type="submit" disabled={saving} loading={saving}>
                                {saving ? m.saving : m.saveButton}
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </PageShell>
    );
}
