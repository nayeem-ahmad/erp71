'use client';

import { useEffect, useState } from 'react';
import { Settings, Globe, ToggleLeft, ToggleRight, Save, ExternalLink } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';

const isBrowser = Boolean(globalThis.window);

const API_BASE = isBrowser
    ? (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000')
    : '';

interface StorefrontSettings {
    id: string;
    name: string;
    storefront_slug: string | null;
    storefront_enabled: boolean;
    storefront_banner: string | null;
    storefront_hero_image: string | null;
    storefront_hero_headline: string | null;
}

export default function StorefrontSettingsPage() {
    const { t } = useI18n();
    const m = t.storefront.dashboard.settings;
    const [loading, setLoading] = useState(true);

    const [slug, setSlug] = useState('');
    const [enabled, setEnabled] = useState(false);
    const [banner, setBanner] = useState('');
    const [heroImage, setHeroImage] = useState('');
    const [heroHeadline, setHeroHeadline] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        fetchWithAuth('/tenants/storefront-settings')
            .then((data: StorefrontSettings) => {
                setSlug(data.storefront_slug || '');
                setEnabled(data.storefront_enabled ?? false);
                setBanner(data.storefront_banner || '');
                setHeroImage(data.storefront_hero_image || '');
                setHeroHeadline(data.storefront_hero_headline || '');
            })
            .catch((err) => console.error('Failed to load settings', err))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async (e: React.SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);

        try {
            const updated: StorefrontSettings = await fetchWithAuth('/tenants/storefront-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storefront_slug: slug.trim() || null,
                    storefront_enabled: enabled,
                    storefront_banner: banner.trim() || null,
                    storefront_hero_image: heroImage.trim() || null,
                    storefront_hero_headline: heroHeadline.trim() || null,
                }),
            });
            setSlug(updated.storefront_slug || '');
            setEnabled(updated.storefront_enabled ?? false);
            setBanner(updated.storefront_banner || '');
            setHeroImage(updated.storefront_hero_image || '');
            setHeroHeadline(updated.storefront_hero_headline || '');
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            setSaveError(err.message || m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const publicStoreUrl =
        isBrowser && slug ? `${globalThis.window.location.origin}/store/${slug}` : null;

    return (
        <PageShell>
            <div className="space-y-4">
                {/* Header */}
                <PageHeader
                    title={m.title}
                    subtitle={m.description}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.storefront,
                        'storefront',
                        [{ label: t.storefront.dashboard.orders.title, href: routes.storefront.root }],
                        m.title,
                    )}
                />

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="animate-spin w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full" />
                    </div>
                ) : (
                    <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-100 shadow-sm p-6 space-y-6">
                        {/* Enable / Disable toggle */}
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-semibold text-gray-900">{m.enable.title}</p>
                                <p className="text-sm text-gray-500 mt-0.5">{m.enable.description}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEnabled((v) => !v)}
                                className="flex items-center space-x-2 focus:outline-none"
                                aria-label={m.enable.toggleAria}
                            >
                                {enabled ? (
                                    <ToggleRight className="w-10 h-10 text-blue-600" />
                                ) : (
                                    <ToggleLeft className="w-10 h-10 text-gray-300" />
                                )}
                            </button>
                        </div>

                        <hr className="border-gray-100" />

                        {/* Store Slug */}
                        <div>
                            <label htmlFor="store-slug" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {m.slug.label}
                            </label>
                            <div className="flex items-center space-x-2">
                                <span className="text-sm text-gray-400 whitespace-nowrap">{m.slug.prefix}</span>
                                <input
                                    id="store-slug"
                                    type="text"
                                    value={slug}
                                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50))}
                                    placeholder={m.slug.placeholder}
                                    maxLength={50}
                                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                                {m.slug.hint}
                            </p>
                        </div>

                        {/* Public URL display */}
                        {publicStoreUrl && (
                            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between">
                                <div className="flex items-center space-x-2 min-w-0">
                                    <Globe className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                    <span className="text-sm font-medium text-blue-700 truncate">
                                        {publicStoreUrl}
                                    </span>
                                </div>
                                <a
                                    href={publicStoreUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-shrink-0 ml-3 text-blue-600 hover:text-blue-800"
                                    title={m.publicUrl.open}
                                >
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>
                        )}

                        {/* Banner Text */}
                        <div>
                            <label htmlFor="store-banner" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {m.banner.label}
                            </label>
                            <textarea
                                id="store-banner"
                                value={banner}
                                onChange={(e) => setBanner(e.target.value)}
                                placeholder={m.banner.placeholder}
                                rows={2}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                {m.banner.hint}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">{m.banner.optional}</p>
                        </div>

                        <div>
                            <label htmlFor="store-hero-headline" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {m.heroHeadline.label}
                            </label>
                            <input
                                id="store-hero-headline"
                                type="text"
                                value={heroHeadline}
                                onChange={(e) => setHeroHeadline(e.target.value)}
                                placeholder={m.heroHeadline.placeholder}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                {m.heroHeadline.hint}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">{m.heroHeadline.optional}</p>
                        </div>

                        <div>
                            <label htmlFor="store-hero-image" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {m.heroImage.label}
                            </label>
                            <input
                                id="store-hero-image"
                                type="url"
                                value={heroImage}
                                onChange={(e) => setHeroImage(e.target.value)}
                                placeholder={m.heroImage.placeholder}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                {m.heroImage.hint}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">{m.heroImage.optional}</p>
                        </div>

                        {saveError && (
                            <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">
                                {saveError}
                            </p>
                        )}

                        {saveSuccess && (
                            <p className="text-emerald-700 text-sm bg-emerald-50 rounded-lg px-3 py-2">
                                {m.savedExclaim}
                            </p>
                        )}

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={saving}
                                className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60"
                            >
                                <Save className="w-4 h-4" />
                                <span>{saving ? m.savingAlt : m.save}</span>
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </PageShell>
    );
}
